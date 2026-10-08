import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import {
  ASSET_DRAFT_RETENTION_DAYS,
  DEFAULT_SPRITE_FRAMING,
  DEFAULT_SPRITE_STATURE,
  SPRITE_FRAMING_ASPECT,
  SPRITE_FRAMING_SHOT,
  spriteDeclarationOf,
  type ActorAnchor,
  type CharacterDocument,
  type SpriteFraming,
  type SpriteStature,
  type WorkshopAssetView,
} from "@aivn/core";
import { aspectMatches, extOf, sizeOfImage, type ImageAspect, type ImageBackend } from "./imageBackend.js";
import { cutout, resolveTuning, type CutoutTuning } from "./cutout.js";
import { IMAGE_EXTS, mimeForExt, sniffImageMime } from "./imageMime.js";
import type { Limiter } from "./limiter.js";
import { PlayMemory } from "./memory.js";
import { errorText, jobIdForImage, type PendingJobs } from "./pendingJobs.js";
import type { PlayFiles } from "./playFiles.js";
import type { PlayStore } from "./store.js";
import { withPlayConfigLock } from "./store.js";
import type { PlayFileWrite } from "./agentkit/deps.js";
import type { WebImageFetcher } from "./webImage.js";

/**
 * 剧目素材生成层：**工坊与剧作家共用的唯一出图实现**（两个 agent 的 `generate_image` 工具都走这里）。
 *
 * 与 D6 的 `ImageAssets` 分工明确——
 * - `ImageAssets` 落 media-cache/，内容寻址缓存，剧作家预发射 bg/cg 用，运行时不进 git；
 * - 本层落 `assets/`，进 git，是剧目定义的一部分，素材页看得见、用户能改能删。
 * 落静态素材还有个好处：剧作家后续 `generate_image` 同 id 会被「静态优先」跳过，
 * 不会把工坊定的图重生一遍。
 *
 * 主体一致性靠 `neutral` 差分兼任定妆照与垫图——它既是合法差分（actor 能直接引用），
 * 又是进 git 后换机器也保得住的「同一个人」。不另开 assets/refs/ 目录，免得污染素材清单。
 *
 * 立绘与角色卡**互不依赖**：出图只认 `spriteId`（目录名），机甲、道具、猫照样能出，
 * 不必先有卡；出图后把呈现声明（取景/体量/标题）补进 `assets/manifest.json`，
 * 差分映射这一层随之消失——variant 就是文件名。
 *
 * 实例由 PlayHouse 按剧目缓存：工坊与剧作家拿的是同一个，两边同时要同一张图时
 * 在飞去重只烧一次配额（`inflight` 表按目标路径，跨角色共享）。
 */

/** 立绘差分名 = 文件名主体，故用素材名的字符集；角色 id 不受此限（角色卡里可能叫 Koharu）。 */
const STEM = /^[a-z][a-z0-9_]{0,39}$/;

/**
 * 素材名 / 差分名的合法性：小写字母开头，a-z、数字、下划线，最长 40。
 *
 * 单独导出是因为它必须在**两个时刻**都判：REST 入口同步拒（否则 200 已返回一个非法
 * path，用户要等一分多钟才在 WS 上收到失败），出图前再判一次（工具与预埋 CG 走不到入口）。
 */
export function assertAssetStem(value: string, label: string): string {
  const trimmed = value.trim();
  if (!trimmed) throw new Error(`${label}不能为空`);
  if (!STEM.test(trimmed)) {
    throw new Error(`${label}「${trimmed}」非法：只允许小写字母开头的 a-z/数字/下划线，最长 40 字符`);
  }
  return trimmed;
}

const NEUTRAL = "neutral";

/** 草稿区的保鲜期：超过这个时间没动过的草稿目录，在下一次出图时顺手清掉。 */
const DRAFT_TTL_MS = ASSET_DRAFT_RETENTION_DAYS * 24 * 60 * 60 * 1000;

/**
 * 立绘主体 id 的合法形状：它就是 `assets/sprites/` 下的目录名。
 *
 * 不做小写限制——角色卡允许 `Koharu` 这样的 id，立绘目录跟着卡走；只挡路径分隔符、
 * 父目录引用与控制字符，别让一个 id 把文件写到别的目录去。
 */
export function assertSpriteId(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) throw new Error("立绘必须给 spriteId（主体 id，剧本里 <actor id> 引用的那个名字）");
  if (/[/\\]/.test(trimmed) || trimmed.startsWith(".") || /[\u0000-\u001f]/.test(trimmed)) {
    throw new Error(`立绘主体 id「${trimmed}」非法：不能含路径分隔符或以点开头`);
  }
  return trimmed;
}


/** 谁触发的这次出图。工坊要素材气泡，剧作家在拍内预发射一样都不产。manual 为用户从工坊面板手动触发（不产生对话流气泡，也不排队自动重建）。 */
export type AssetNotify = "workshop" | "silent" | "manual";

export type AssetKind = "background" | "cg" | "sprite";

export interface AssetTarget {
  kind: AssetKind;
  /** 背景/CG 的素材 id（同时是文件名主体）。 */
  name?: string;
  /**
   * 立绘的主体 id（人、机甲、猫、道具同权）：立绘目录名，也是剧本里的引用名。
   *
   * 不要求有角色卡——立绘与卡是两件各自可选的附件，谁也不依赖谁；有卡时目录名按卡上的
   * `sprite` 绑定取（不写就是与卡同名，见 core 的 `spriteIdOf`）。
   */
  spriteId?: string;
  /** 立绘差分名（neutral / smile / damaged / asleep ...）。 */
  variant?: string;
  /** 立绘取景（full/half/square）：决定出图景别与画幅，缺省全身。不给就沿用素材表里该主体的声明。 */
  framing?: SpriteFraming;
  /** 立绘体量（small/normal/large/huge）：决定舞台上的大小，缺省标准。不给就沿用素材表里的声明。 */
  stature?: SpriteStature;
  /** 立绘标题：写进素材表的立绘级声明，无卡主体靠它出名牌。给了卡就跟着卡走。 */
  title?: string;
  /**
   * 参考图列表（通用垫图）：可填角色 id（自动引用其立绘）、剧目内相对路径或 http(s) URL。
   */
  references?: string[];
  /**
   * 兼容别名：等同于 references（主要用于只填角色 id 的历史调用）。
   */
  referenceCharacters?: string[];
}

export interface GenerateOptions {
  /** 事件去向：工坊要素材气泡，剧作家的后台预发射一律静默。 */
  notify?: AssetNotify;
}

export interface GeneratedPlayAsset {
  kind: AssetKind;
  /** 剧目内相对路径（assets/backgrounds/rooftop.jpg）。 */
  path: string;
  /** 静态服务 URL。 */
  url: string;
  /** 目标此前已有素材（可能是用户导入的），本次是覆盖。 */
  replaced: boolean;
  /** 落盘前没有 neutral 垫图，本轮先自动定了一张定妆照。 */
  autoNeutral: boolean;
}

/**
 * 一张**草稿**：已经出好图（立绘也抠好了底），但还没进 `assets/`。
 *
 * 出图与入库拆开是为了「一次出几张候选、用户挑一张」这条流程：generate 只产草稿，
 * 挑中的那张才 `commit` 成素材。草稿落在 media-cache/drafts/ 下，是中间物不是剧目内容。
 */
export interface DraftedAsset {
  draftId: string;
  kind: AssetKind;
  /** 剧目内相对路径（media-cache/drafts/<id>/image.png），预览用。 */
  path: string;
  /** 预览 URL（/plays/<playId>/drafts/<id>/image.png）。 */
  url: string;
}

/** `commit` 的选项：事件去向（工坊要素材气泡，剧作家的后台链路一律静默）。 */
export interface CommitOptions {
  notify?: AssetNotify;
}

/** 草稿目录里的 draft.json：出图那一刻的意图，`commit` 不在同一个回合也能拿回来。 */
interface DraftRecord {
  draftId: string;
  kind: AssetKind;
  name?: string;
  spriteId?: string;
  variant?: string;
  framing?: SpriteFraming;
  stature?: SpriteStature;
  title?: string;
  /** 出图时的画幅（提交时按目标重算，这里只作留痕）。 */
  aspect: ImageAspect;
  prompt: string;
  /** 成图扩展名（含点）；立绘是抠底后的 .png。 */
  imageExt: string;
  /** 抠底前原片的扩展名（立绘才有）。 */
  sourceExt?: string;
  createdAt: string;
  committedAt?: string;
}

/** 一张要垫给模型的参考图规格：可能是剧目内立绘，也可能是指定路径或网络图片。 */
export interface ResolvedReference {
  /** 显示名或主体名（用于在 prompt 里标注「第几张是谁」）；若无法识别则为 null。 */
  name: string | null;
  /** 主体 id（若来自立绘：角色卡或立绘目录）。 */
  spriteId?: string;
  /** 来源：剧目内相对路径或 http(s) 网址。 */
  source: string;
}

interface AssetSpec {
  kind: AssetKind;
  /** assets/ 下的目录：backgrounds | cg | sprites/<spriteId>。 */
  kindPath: string;
  stem: string;
  aspect: ImageAspect;
  spriteId?: string;
  variant?: string;
  /** 立绘取景；背景/CG 不带。 */
  framing?: SpriteFraming;
  /** 立绘体量；背景/CG 不带。 */
  stature?: SpriteStature;
  /** 无卡主体的标题：写进素材表的立绘级声明，名牌回落链的第三档。 */
  title?: string;
  /** 立绘级取景（不含差分覆盖）：自动补的定妆照按它出，不按当前差分那档。
   *  定妆照是所有差分的垫图基准，一个「全身主体 + 一条 closeup 差分」不该把基准也变成胸像。 */
  baseFraming?: SpriteFraming;
  /** 解析后的显式参考图列表（按传入顺序）。 */
  explicitReferences?: ResolvedReference[];
  /** 参考图里的立绘主体（如果参考图中有角色）。 */
  referenceSprites?: ReferenceSprite[];
}

/** 一张要垫进背景/CG 的立绘：id 用于排引用顺序，name 进提示词标注「这张图是谁」。 */
interface ReferenceSprite {
  id: string;
  name: string;
}

export interface PlayAssetsDeps {
  store: PlayStore;
  files: PlayFiles;
  backend: ImageBackend;
  limiter: Limiter;
  /** 垫图策略：不传 = 派生差分时用该角色的 neutral 定妆照垫图（保角色一致性）；none = 不传参考图。 */
  reference?: "none" | "neutral";
  /** 在生成的事（面板上那一行）：出图期间让玩家看得见在忙什么、等了多久。 */
  pending?: PendingJobs;
  /** 网络图下载（可选，外部 URL 参考图需要它）。 */
  fetchImage?: WebImageFetcher;
  /** 素材声明补写推刷新信号（二进制本身不进）。 */
  onWrite: (write: PlayFileWrite, notify: AssetNotify) => void;
  /** 素材到货（工坊侧挂到对话气泡里）。 */
  onAsset?: (asset: WorkshopAssetView, replaced: boolean, notify: AssetNotify) => void;
}

export class PlayAssets {
  /**
   * 逐剧目的生图模型 / 档位覆盖（play.json 的 `image` 段）。
   *
   * 现读现用而不是构造时取一次：`PlayAssets` 按剧目缓存、进程内不重建，构造时取的快照
   * 在用户改完设置之后还是老值——「设置页改了模型，出图还是老模型」是最难查的那类。
   */
  private async imageOverride(): Promise<{ model?: string; size?: string }> {
    const image = (await this.deps.store.loadPlay()).image;
    return {
      ...(image?.model ? { model: image.model } : {}),
      ...(image?.size ? { size: image.size } : {}),
    };
  }

  /** 同一目标的在飞生成：同批次两次调用打同一路径会烧两份配额、竞态写、覆盖标记说不清。 */
  private readonly inflight = new Map<string, Promise<GeneratedPlayAsset[]>>();

  constructor(
    private readonly playId: string,
    private readonly deps: PlayAssetsDeps,
  ) {}

  /**
   * 出图并**入库**：`draft` + `commit` 的组合，签名与语义对调用方不变。
   *
   * 剧作家的后台预发射、素材页的手动生图、原地重抠都走这条——那边的图一出来就是要用的，
   * 没有「让用户在候选里挑」这一步。工坊的 `generate_image` 走 `draft`，挑中了再 `commit`。
   *
   * `inflight` 只在这一层去重：同一最终目标在同批次里被要两次纯属浪费；`draft` 不去重——
   * 同一目标并发出三张候选，正是候选流程本身要的。
   */
  async generate(
    target: AssetTarget,
    prompt: string,
    style?: string,
    options?: GenerateOptions,
  ): Promise<GeneratedPlayAsset[]> {
    const notify = options?.notify ?? "workshop";
    const spec = await this.resolve(target);
    const key = `${spec.kindPath}/${spec.stem}`;
    const running = this.inflight.get(key);
    if (running) return running;
    const job = this.run(spec, prompt, style, notify).finally(() => {
      if (this.inflight.get(key) === job) this.inflight.delete(key);
    });
    this.inflight.set(key, job);
    return job;
  }

  /**
   * 只出图、不落库：出好图（立绘抠好底）放进草稿区，等 `commit` 才进 `assets/`。
   *
   * 这是「一次出三张候选给用户挑」的入口——三张都只是草稿，没被挑中的那张不会在素材表里
   * 留下任何痕迹。工坊的 `generate_image` 走它；剧作家与手动生图走 `generate`。
   */
  async draft(target: AssetTarget, prompt: string, style?: string): Promise<DraftedAsset> {
    const spec = await this.resolve(target);
    // 差分的身份基准恒为**已入库**的 neutral：草稿当不了基准（拿一张没人过目的脸锚定全套差分，
    // 事后换掉基准等于整套差分换人）。要出差分先出定妆照候选、挑一张入库。
    if (spec.kind === "sprite" && spec.variant !== NEUTRAL && !(await this.existingPath(spec.kindPath, NEUTRAL))) {
      throw new Error(
        `${spec.spriteId} 还没有入库的 ${NEUTRAL} 定妆照：先出定妆照候选、挑一张用 commit_asset 采用，再派生差分。`,
      );
    }
    return this.produce(spec, prompt, style);
  }

  /**
   * 把一张草稿正式入库：写 `assets/`、补素材表呈现声明、记生图台账、把留底原片搬进
   * `media-cache/sprite-sources/`（重抠要用）。
   *
   * 落位就用**草稿出图时的意图**（立绘的 spriteId/variant、背景/CG 的 name）——候选之间
   * 的差别在画面不在身份：定妆照的三张候选都按 `neutral` 出图，挑中的那张就按 `neutral` 入库。
   * 同一张草稿重复入库只是把同一个文件再写一遍，幂等。
   */
  async commit(draftId: string, options?: CommitOptions): Promise<GeneratedPlayAsset> {
    const notify = options?.notify ?? "workshop";
    const draft = await this.loadDraft(draftId);
    const spec = await this.resolve({
      kind: draft.kind,
      name: draft.name,
      spriteId: draft.spriteId,
      variant: draft.variant,
      framing: draft.framing,
      stature: draft.stature,
      title: draft.title,
    });
    const dir = this.deps.store.draftDir(draftId);
    const bytes = await readFile(join(dir, `image${draft.imageExt}`));
    // 留底跟着入库：`recut_sprite` 只认 media-cache/sprite-sources/ 那一份。
    if (spec.kind === "sprite" && draft.sourceExt) {
      await this.keepSpriteSource(spec, await readFile(join(dir, `source${draft.sourceExt}`)), draft.sourceExt);
    }
    const written = await this.persist(spec, bytes, draft.imageExt);
    if (spec.kind === "sprite") await this.declareSprite(spec, notify);
    await this.recordPrompt(spec, written.path, draft.prompt);
    await this.markCommitted(draftId, draft);
    return { ...written, autoNeutral: false };
  }

  private async loadDraft(draftId: string): Promise<DraftRecord> {
    const id = draftId.trim();
    if (!/^[\w-]{1,64}$/.test(id)) throw new Error(`草稿 id「${draftId}」非法`);
    const file = join(this.deps.store.draftDir(id), "draft.json");
    if (!existsSync(file)) {
      throw new Error(`找不到草稿 ${id}：它可能已被清理，或者 id 记错了——重新出一次图。`);
    }
    return JSON.parse(await readFile(file, "utf8")) as DraftRecord;
  }

  /** 入库留痕（best-effort）：草稿目录迟早会被清理，这一笔只为当下看得出「已经采用过」。 */
  private async markCommitted(draftId: string, draft: DraftRecord): Promise<void> {
    try {
      const file = join(this.deps.store.draftDir(draftId), "draft.json");
      await writeFile(file, `${JSON.stringify({ ...draft, committedAt: new Date().toISOString() }, null, 2)}\n`);
    } catch {
      // 素材已经落好了，为一条留痕报错不值
    }
  }

  /**
   * 原地重抠立绘：拿抠底前留的原片重跑一遍抠底，覆盖 assets/ 里那张透明 PNG。
   *
   * 只为「图挺好、抠得脏」而存在：这种没法靠重新出图解决（重画出来是另一张图，
   * 用户刚点头的那张会被顶掉，还白烧一次配额）。留了底就是本地几秒的事，画面一个像素不变。
   */
  async recut(target: AssetTarget, tuning?: Partial<CutoutTuning>): Promise<GeneratedPlayAsset> {
    const spec = await this.resolve(target);
    if (spec.kind !== "sprite") throw new Error("只有立绘需要抠底");
    const key = `${spec.kindPath}/${spec.stem}`;
    // 同一张图正在出（一张约 100s）就先等它出完：留底是出图途中写的，
    // 抢在它前面读到的要么是旧原片要么读不到。
    await this.inflight.get(key);
    if (!(await this.existingPath(spec.kindPath, spec.stem))) {
      throw new Error(`${spec.spriteId}/${spec.stem} 还没有抠底图，先 generate_image 出图再来重抠。`);
    }
    const { data } = await cutout(await this.readSpriteSource(spec), resolveTuning(tuning));
    return { ...(await this.persist(spec, data, ".png")), autoNeutral: false };
  }

  private async readSpriteSource(spec: AssetSpec): Promise<Buffer> {
    const rel = this.spriteSourcePath(spec.spriteId, spec.stem);
    if (!rel) {
      throw new Error(
        `${spec.spriteId}/${spec.stem} 没有留底原片（抠底前那一张），没法原地重抠。` +
          "留底是出图时顺手写的：更早出的图、用户自己上传的立绘都没有——那种只能重新出图。",
      );
    }
    return readFile(this.deps.files.absoluteOf(rel));
  }

  /**
   * 该 stem 的留底原片（抠底前那一张）的剧目内相对路径，没有则 null。
   *
   * 两个用处，**传的 stem 不一样**：`recut` 传当前 stem 重抠自己；
   * 差分传 `NEUTRAL`——差分的身份基准恒为定妆照，拿差分自己的原片当基准是换脸。
   * 原片在 `media-cache/` 下——那目录不进 git，换机器后老图就没有原片了，
   * 这条路径会返回 null，调用方各自退回自己的兜底。
   */
  private spriteSourcePath(spriteId: string | undefined, stem: string): string | null {
    if (!spriteId) return null;
    for (const ext of IMAGE_EXTS) {
      const rel = `media-cache/sprite-sources/${spriteId}/${stem}${ext}`;
      if (existsSync(this.deps.files.absoluteOf(rel))) return rel;
    }
    return null;
  }

  /** 目标是否已有图（工坊/剧作家跳过重复出图用）。 */
  async exists(target: AssetTarget): Promise<boolean> {
    return (await this.existingUrl(target)) !== null;
  }

  /**
   * 目标已有图的静态服务 URL，没有则 null。
   *
   * `exists()` 只回答「有没有」，但「跳过重复出图」的那条路还需要一个能直接发给客户端的
   * URL：素材名不带扩展名，真实文件名要按 .jpg/.png/.webp 逐个试出来（用户手传的可能是 png）。
   */
  async existingUrl(target: AssetTarget): Promise<string | null> {
    const path = await this.existingTargetPath(target);
    return path ? `/plays/${this.playId}/${path}` : null;
  }

  private async existingTargetPath(target: AssetTarget): Promise<string | null> {
    if (target.kind === "sprite") {
      if (!target.spriteId || !target.variant) return null;
      return this.existingPath(`sprites/${target.spriteId}`, target.variant);
    }
    if (!target.name) return null;
    return this.existingPath(target.kind === "background" ? "backgrounds" : "cg", target.name);
  }

  /** 返回的数组可能第一项是自动补的定妆照——那是真金白银出的图，必须一起交给上层广播。 */
  private async run(
    spec: AssetSpec,
    prompt: string,
    style?: string,
    notify: AssetNotify = "workshop",
  ): Promise<GeneratedPlayAsset[]> {
    const auto = spec.kind === "sprite" ? await this.ensureNeutral(spec, prompt, notify) : null;
    const draft = await this.produce(spec, prompt, style);
    const committed = await this.commit(draft.draftId, { notify });
    return auto ? [auto, { ...committed, autoNeutral: true }] : [committed];
  }

  /**
   * 真正出图那一段：垫图、拼后缀、等后端、抠底、落草稿区。**不写 `assets/`、不碰素材表**——
   * 入库是 `commit` 的事。
   */
  private async produce(spec: AssetSpec, prompt: string, style?: string): Promise<DraftedAsset> {
    const references = await this.referencesFor(spec);
    const image = await this.imageOverride();
    // 后缀跟着**真正发出去的图**走：STAGE_IMAGE_REFERENCE=none 时一张都没发，
    // 提示词里却还留着「第几张是谁」，等于凭空给模型指了三张不存在的图。
    const fullPrompt = suffixFor(
      spec,
      style ? `${style}, ${prompt}` : prompt,
      references.length,
    );
    // 记的是「开始等」的那一刻：排队等位的那一分多钟也是玩家在等的时间。
    const kind = spec.kind === "background" ? "bg" : spec.kind;
    const done = this.deps.pending?.begin({
      id: jobIdForImage(kind, `${spec.kindPath}/${spec.stem}`),
      kind,
      label: labelFor(spec),
      prompt: fullPrompt,
    });
    let data: Buffer;
    let mimeType: string;
    try {
      ({ data, mimeType } = await this.deps.limiter.run(
        () =>
          this.deps.backend.generate({
            prompt: fullPrompt,
            aspectRatio: spec.aspect,
            references,
            // 立绘要抠底，源图分辨率是唯一能压住轮廓锯齿的手段；背景与 CG 不挑这个。
            minTier: spec.kind === "sprite" ? "2K" : undefined,
            ...image,
          }),
        "normal",
      ));
    } catch (error) {
      // 面板上那一行留成失败态记下错因：出图挂了不该悄悄从面板上消失
      done?.(errorText(error));
      throw error;
    }
    done?.();
    this.assertCanvas(spec, data);
    // 立绘抠底成透明 PNG，同时把抠底前那张原片一起收进草稿——留底是抠底参数唯一的后悔药
    // （见 `recut`），入库时跟着搬进 media-cache/sprite-sources/。
    const bytes = spec.kind === "sprite" ? (await cutout(data, resolveTuning())).data : data;
    return this.writeDraft(spec, fullPrompt, { image: bytes, raw: data, mimeType });
  }

  /**
   * 落一张草稿：成图 + （立绘的）抠底前原片 + `draft.json`（出图意图）。
   *
   * 顺带清掉过期的旧草稿——草稿是中间物，攒着只占盘。清理是 best-effort，删不掉不影响出图。
   */
  private async writeDraft(
    spec: AssetSpec,
    prompt: string,
    bytes: { image: Buffer; raw: Buffer; mimeType: string },
  ): Promise<DraftedAsset> {
    const draftId = randomUUID();
    const dir = this.deps.store.draftDir(draftId);
    await mkdir(dir, { recursive: true });
    const imageExt = spec.kind === "sprite" ? ".png" : extOf(bytes.mimeType);
    const sourceExt = spec.kind === "sprite" ? extOf(bytes.mimeType) : undefined;
    await writeFile(join(dir, `image${imageExt}`), bytes.image);
    if (sourceExt) await writeFile(join(dir, `source${sourceExt}`), bytes.raw);
    const intent =
      spec.kind === "sprite"
        ? {
            spriteId: spec.spriteId,
            variant: spec.variant,
            framing: spec.framing,
            stature: spec.stature,
            ...(spec.title ? { title: spec.title } : {}),
          }
        : { name: spec.stem };
    const record: DraftRecord = {
      draftId,
      kind: spec.kind,
      ...intent,
      aspect: spec.aspect,
      prompt,
      imageExt,
      ...(sourceExt ? { sourceExt } : {}),
      createdAt: new Date().toISOString(),
    };
    await writeFile(join(dir, "draft.json"), `${JSON.stringify(record, null, 2)}\n`);
    await this.pruneDrafts();
    return {
      draftId,
      kind: spec.kind,
      path: `media-cache/drafts/${draftId}/image${imageExt}`,
      url: `/plays/${this.playId}/drafts/${draftId}/image${imageExt}`,
    };
  }

  /** 清掉过期草稿：超过 `DRAFT_TTL_MS` 没动过的整份目录删掉。删不掉就算了，不打断出图。 */
  private async pruneDrafts(): Promise<void> {
    const root = this.deps.store.draftsDir();
    if (!existsSync(root)) return;
    const cutoff = Date.now() - DRAFT_TTL_MS;
    try {
      for (const entry of await readdir(root, { withFileTypes: true })) {
        if (!entry.isDirectory()) continue;
        const dir = join(root, entry.name);
        try {
          if ((await stat(dir)).mtimeMs < cutoff) await rm(dir, { recursive: true, force: true });
        } catch {
          // 单份草稿删不掉不该影响这次出图
        }
      }
    } catch {
      // 草稿区列不出来同理
    }
  }

  /**
   * 把抠底前的原片留一份到 `media-cache/sprite-sources/`：抠底参数唯一的后悔药。
   *
   * 透明 PNG 一落盘底色就没了，之后想改抠底只剩「重新出图」——而重新出图出来的是另一张画，
   * 用户刚点头的那张会被顶掉，还白烧一份配额。留了底，「图挺好、抠得脏」就是本地重跑一遍的事。
   * 留底是跑批产物（不进 git）：换机器后老图没法重抠，这是有意的取舍。
   * 写失败只记一条告警，不把一次成功的出图报成失败。
   */
  private async keepSpriteSource(spec: AssetSpec, data: Buffer, ext: string): Promise<void> {
    if (!spec.spriteId) return;
    const dir = this.deps.store.spriteSourceDir(spec.spriteId);
    try {
      await mkdir(dir, { recursive: true });
      await writeFile(join(dir, `${spec.stem}${ext}`), data);
      // 换后端后同一张图可能从 jpg 变成 png：留着旧的那份，readSpriteSource 会一直命中它，
      // 重抠出来的是上一张画。与 persist() 清 assets 旧扩展名是同一条理由。
      await Promise.all(
        IMAGE_EXTS.filter((other) => other !== ext).map((other) => rm(join(dir, `${spec.stem}${other}`), { force: true })),
      );
    } catch (error) {
      console.warn(
        `[aivn] 立绘 ${spec.spriteId}/${spec.stem} 的留底原片没写成（之后没法原地重抠）：` +
          `${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  /** 落盘 + 清掉同 stem 的旧扩展名。抠底输出恒为 PNG，扩展名变了旧的 .jpg 必须清掉。 */
  private async persist(spec: AssetSpec, bytes: Buffer, ext: string): Promise<Omit<GeneratedPlayAsset, "autoNeutral">> {
    const rel = `assets/${spec.kindPath}/${spec.stem}${ext}`;
    const previous = await this.existingPath(spec.kindPath, spec.stem);
    await this.deps.files.writeBinary(rel, bytes);
    if (previous && previous !== rel) await this.deps.files.removeAsset(previous);
    return {
      kind: spec.kind,
      path: rel,
      url: `/plays/${this.playId}/${rel}`,
      replaced: previous !== null,
    };
  }

  /**
   * 出图留痕：把这张图实际用的 prompt 原文记进 assets/generated.json。
   *
   * 不记就等于没发生过——工坊出的图只剩像素，prompt 既不进工坊线程也不进任何台账，
   * 换个机器 clone 下来谁都说不出这张图当初是怎么生成的。键与立绘查表一致：
   * 背景/CG 用文件名主体，立绘用 `<角色id>/<差分名>`。
   *
   * 写独立台账而不是素材描述表：那张表归工坊与用户写，实测两边都动同一张表时，
   * 工坊补一条中文描述就把引擎记的 prompt 整条替换掉了。一张表一个写者。
   * 并发差分同时记账要走剧目锁，否则后写的会冲掉先写的记录。
   */
  private async recordPrompt(spec: AssetSpec, path: string, prompt: string): Promise<void> {
    const id = spec.kind === "sprite" ? `${spec.spriteId}/${spec.stem}` : spec.stem;
    const kind = spec.kind === "background" ? "background" : spec.kind;
    try {
      await withPlayConfigLock(this.deps.store.dir, () =>
        this.deps.store.saveLedgerEntry({ id, kind, path, prompt, at: new Date().toISOString() }),
      );
    } catch (error) {
      // 图已经落盘了，为一条记账把一次成功的出图报成失败更糟；这里出声，图与 prompt 对不上时能查到。
      console.warn(
        `[aivn] 出图 prompt 未记进 assets/generated.json（${id}）: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  /**
   * 画幅回执校验。网关对画幅是**静默降级**而不是报错：实测 flow2api（2026-09-29）把
   * `3:4` 与 `4:3` 都出成 1200x896 横图，而 16:9 / 9:16 正常。立绘拿到横图等于站位崩掉，
   * 与其把废图落进 assets/ 再在舞台上炸，不如当场把画幅不符这件事讲清楚。
   */
  private assertCanvas(spec: AssetSpec, data: Buffer): void {
    const size = sizeOfImage(data);
    if (!size) {
      // 读不出尺寸的图后面还要过一遍解码（sprite 走 cutout），真坏了会在这里炸；
      // 但格式没识别属于我们没覆盖到的情况，留个痕好排查
      console.warn(`[aivn] 读不出 ${spec.stem} 的图片尺寸，跳过画幅校验（${data.length}B）`);
      return;
    }
    if (aspectMatches(size, spec.aspect)) return;
    throw new Error(
      `出图画幅不对：请求 ${spec.aspect}，模型回了 ${size.width}x${size.height}。` +
        "换个生图后端或模型名（STAGE_IMAGE_FORMAT / STAGE_IMAGE_MODEL）再试——" +
        "画幅不符的图落进素材只会在演出时崩。",
    );
  }

  /**
   * 校验目标：素材名走文件名白名单，角色 id 走角色卡成员校验。
   * 角色 id 不做正则——`parseCharacterCard` 不约束它的大小写，`Koharu` 这类 id 完全合法。
   */
  private async resolve(target: AssetTarget): Promise<AssetSpec> {
    const rawRefs = target.references?.length ? target.references : target.referenceCharacters;
    const explicitReferences = rawRefs?.length ? await this.resolveReferences(rawRefs) : undefined;
    const referenceSprites = explicitReferences
      ?.filter((r): r is ResolvedReference & { spriteId: string; name: string } => !!r.spriteId && !!r.name)
      .map((r) => ({ id: r.spriteId, name: r.name }));

    if (target.kind === "sprite") {
      const spriteSpec = await this.resolveSprite(target);
      return {
        ...spriteSpec,
        explicitReferences,
        referenceSprites,
      };
    }
    const name = target.name?.trim() ?? "";
    if (!name) throw new Error("背景/CG 必须给 name（素材 id，剧本里的 bg/cg id 就是它）");
    assertAssetStem(name, "素材名");
    return {
      kind: target.kind,
      kindPath: target.kind === "background" ? "backgrounds" : "cg",
      stem: name,
      aspect: "16:9",
      explicitReferences,
      referenceSprites,
    };
  }

  /**
   * 角色卡（`characters/*.md`）：角色配置的唯一真相源。
   *
   * 走 `PlayMemory.load` 而不是自己 readdir：角色卡的解析规则只有 `parseCharacterCard` 一处，
   * 这里再抄一遍就等于开了第二条真相源。出图一次几十秒，多读一个 memory 目录不占成本。
   */
  private async cast(): Promise<ReadonlyMap<string, CharacterDocument>> {
    return (await PlayMemory.load(this.deps.store)).characters;
  }

  /**
   * 参考图解析：每个输入项可以是：
   * 1. 主体 id（如 "xiaoyu" / "mecha"）——有立绘就能垫，不要求有角色卡；
   * 2. 剧目内相对路径（如 "assets/backgrounds/ref.png"）；
   * 3. http(s) URL。
   *
   * 解析不合法的项时显式报错，避免静默漏垫图导致生成结果偏差。
   */
  private async resolveReferences(items: string[]): Promise<ResolvedReference[]> {
    const known = await this.spriteIds();
    const unique = [...new Set(items.map((it) => it.trim()).filter(Boolean))];

    // 不含路径分隔符也不是 URL 的项按主体 id 解释：既没有立绘也没有卡就是笔误，当场说清楚
    const missing = unique.filter((it) => !/^https?:\/\//i.test(it) && !it.includes("/") && !known.has(it));
    if (missing.length > 0) {
      throw new Error(
        `没有立绘也没有角色卡的主体「${missing.join("、")}」。可选：${[...known].join(" / ") || "（剧目里还没有主体）"}`,
      );
    }

    const manifest = await this.deps.store.assetMeta();
    const resolved: ResolvedReference[] = [];

    for (const item of unique) {
      if (/^https?:\/\//i.test(item)) {
        resolved.push({ name: null, source: item });
        continue;
      }
      if (known.has(item)) {
        const name = (await this.cast()).get(item)?.name ?? spriteDeclarationOf(manifest, item).title ?? item;
        resolved.push({ name, spriteId: item, source: await this.referenceSpriteOf(item) });
        continue;
      }
      // 路径形式的参考图：容错前导斜杠（agent 常常直接复制 `/plays/<id>/assets/...` 这种静态 URL），
      // 兼容 `plays/<playId>/` 前缀，再校验文件存在性。
      const pathLike = item.replace(/^\/+/, "");
      if (pathLike.startsWith("assets/") || pathLike.startsWith("plays/")) {
        const norm = pathLike.startsWith("plays/") ? pathLike.replace(/^plays\/[^/]+\//, "") : pathLike;
        const abs = this.deps.files.absoluteOf(norm);
        if (existsSync(abs)) {
          resolved.push({ name: null, source: norm });
          continue;
        }
      }
      throw new Error(
        `未知的参考图「${item}」：既不是剧目里有立绘的主体（可选：${[...known].join(" / ") || "无"}），` +
          "也不是存在的剧目内路径或 http(s) 网址。",
      );
    }
    return resolved;
  }

  /** 剧目里已知的主体 id：角色卡目录 ∪ 立绘目录。 */
  private async spriteIds(): Promise<Set<string>> {
    const ids = new Set<string>((await this.cast()).keys());
    const root = this.deps.files.absoluteOf("assets/sprites");
    if (existsSync(root)) {
      for (const entry of await readdir(root, { withFileTypes: true })) {
        if (entry.isDirectory() && !entry.name.startsWith(".")) ids.add(entry.name);
      }
    }
    return ids;
  }

  /**
   * 立绘目标归一化。
   *
   * 只要求主体 id 与差分名——**不查角色卡**：立绘是独立素材，机甲、道具、猫都没有卡。
   * 取景与体量的回落顺序：调用方显式给 > 素材表差分级的声明 > 立绘级的声明 > 缺省。
   * 先看差分声明是为了让「一整套里另有一条 closeup」成立，再看立绘级是为了让
   * 「给主体定过一次取景、之后每次出图都跟着它」成立。
   */
  private async resolveSprite(target: AssetTarget): Promise<AssetSpec> {
    const spriteId = assertSpriteId(target.spriteId ?? "");
    const variant = assertAssetStem(target.variant ?? "", "差分名");
    const manifest = await this.deps.store.assetMeta();
    const declared = spriteDeclarationOf(manifest, spriteId, variant);
    const framing = target.framing ?? declared.framing ?? DEFAULT_SPRITE_FRAMING;
    const stature = target.stature ?? declared.stature ?? DEFAULT_SPRITE_STATURE;
    return {
      kind: "sprite",
      kindPath: `sprites/${spriteId}`,
      stem: variant,
      aspect: SPRITE_FRAMING_ASPECT[framing] as ImageAspect,
      spriteId,
      variant,
      framing,
      stature,
      ...(target.title ? { title: target.title.trim() } : {}),
      // 自动补的定妆照按**立绘级**取景走，不按这条差分的覆盖：它是所有差分的基准，
      // 跟着一条 closeup 出会把这个主体整体带近（见 ensureNeutral）。
      baseFraming: spriteDeclarationOf(manifest, spriteId).framing ?? DEFAULT_SPRITE_FRAMING,
    };
  }

  /**
   * 差分生成前确保有 neutral 垫图，返回自动补出来的那张（没有则 null）：
   * - 有 → 正常派生；
   * - 没有且该角色一个差分都没有 → 自动先定一张（没有既存差分，不存在不一致）；
   * - 没有但已有其它差分 → 报错让用户先过目新定妆照，否则新图与旧差分不是同一个人，
   *   演出中会静默换脸。
   *
   * 一批并发出 6 个差分时，6 条调用会一起看到「没定妆照」并各自来补。多花的 6 倍钱和换脸
   * 靠 `inflight` 挡住：6 条内层调用的目标都是 `sprites/<id>/neutral` 这同一个 key，
   * 后到的 5 条直接复用第一条的 promise（见 generate 与 test 里「并发出 6 个差分」那条）。
   */
  private async ensureNeutral(spec: AssetSpec, prompt: string, notify: AssetNotify): Promise<GeneratedPlayAsset | null> {
    if (spec.variant === NEUTRAL) return null;
    if (await this.existingPath(spec.kindPath, NEUTRAL)) return null;
    const others = await this.spriteStems(spec.spriteId!);
    if (others.length > 0) {
      throw new Error(
        `${spec.spriteId} 缺 ${NEUTRAL} 定妆照，但已有 ${others.length} 个差分（${others.join("、")}）：` +
          "新出的定妆照会与已有差分不是同一个人，演出中会静默换脸。" +
          "请先单独生成一次 neutral 让用户过目，确认后再生成差分。",
      );
    }
    // prompt 是"角色描述 + 本次表情"，直接拿去出定妆照会变成「哭得很凶但表情中性」的自相矛盾指令。
    // 压一条前置的中性描述盖住表情词，角色外观描述留在后面。取景与姿势措辞按**角色级**取景走，
    // 不按当前这条差分：对半身说 standing 会把画拉回全身，景别后缀与它当场打架。
    const neutralFraming = spec.baseFraming ?? DEFAULT_SPRITE_FRAMING;
    const [auto] = await this.generate(
      {
        kind: "sprite",
        spriteId: spec.spriteId,
        variant: NEUTRAL,
        framing: neutralFraming,
        ...(spec.stature ? { stature: spec.stature } : {}),
        ...(spec.title ? { title: spec.title } : {}),
      },
      `${NEUTRAL_LEAD[neutralFraming]} ${prompt}`,
      undefined,
      { notify },
    );
    return auto ?? null;
  }

  /**
   * 垫图（参考图）的唯一装配点。
   *
   * - **立绘差分（非 neutral）恒以该角色的 neutral 定妆照为身份基准**：这是「同一个角色的所有
   *   差分是同一个人」的底层约定，不接受调用方拿别的图顶掉它（顶掉会静默换脸）。要换基准就把
   *   neutral 重出一遍，那一次可以带 references。
   * - **neutral 定妆照**：带 references 就按它垫图出图（首次定妆走这条，用户给的既有角色图从这里进来）；
   *   不带就是纯文生图。
   * - **背景 / CG**：按 references 垫图（角色立绘、剧目内路径、网络图都行）。
   *
   * `STAGE_IMAGE_REFERENCE=none` 是全局开关，显式指定的参考图同样归它管，否则这个开关形同虚设。
   */
  private async referencesFor(spec: AssetSpec) {
    if (this.deps.reference === "none") return [];
    const explicit = spec.explicitReferences ?? [];

    if (spec.kind === "sprite" && spec.variant !== NEUTRAL) {
      if (explicit.length > 0) {
        throw new Error(
          `立绘差分「${spec.spriteId}/${spec.variant}」不能自带参考图：` +
            `差分的身份基准恒为该角色的 neutral 定妆照，换基准会与既有差分不是同一个人。` +
            "要换基准就重新出一次 neutral（那一次可以带 references），再派生差分。",
        );
      }
      const reference = await this.neutralReferenceOf(spec);
      return reference ? [await this.loadReference(reference)] : [];
    }

    const refs = [];
    for (const ref of explicit) refs.push(await this.loadReference(ref.source));
    return refs;
  }

  /**
   * 差分垫的那张 neutral：**优先用留底原片，没有才退回已抠底的 PNG**。
   *
   * 留底原片（`media-cache/sprite-sources/<id>/neutral.jpg`）带着出图时的色键底，
   * 而 `assets/sprites/<id>/neutral.png` 是**已经抠过底的透明 PNG**。给模型垫一张透明图，
   * 它会自行把透明还原成白底，而差分提示词里「底色跟参考图一致」这句就落到了白底上——
   * 纯色键随即把角色身上一切接近白的像素（白袜、白制服、银发）判成背景，
   * 整张立绘被打成镂空（见 `docs/issues/261008-sprite-variant-dirty-cutout/`）。
   * 垫带底的原片，模型的参照物与提示词描述的是同一件事。
   *
   * 但**不能无条件换成原片**：用户自己导入的立绘（`assetImport.ts`）直接落 `assets/sprites/`，
   * 不留原片——那种主体只有抠好的 PNG 可垫，退回它。
   */
  private async neutralReferenceOf(spec: AssetSpec): Promise<string | null> {
    // 找的必须是 **neutral** 的原片，不是当前差分的：身份基准恒为定妆照。
    // 差分自己那张原片是另一个表情，拿它当基准就是换脸。
    const source = this.spriteSourcePath(spec.spriteId, NEUTRAL);
    if (source) return source;
    return this.existingPath(spec.kindPath, NEUTRAL);
  }

  /**
   * 前置校验参考立绘的角色表与盘上文件是否存在。
   * 供舞台 WS `generate_cg` 与工坊手动出图在落节点/发请求前守卫。
   */
  async assertReferences(ids: string[]): Promise<ResolvedReference[]> {
    return this.resolveReferences(ids);
  }

  /**
   * 一张给定主体的立绘：优先 neutral（身份基准），其次目录里排序第一张。
   *
   * 没有映射表可查了——variant 就是文件名，找图就是按 stem 找文件。
   */
  private async referenceSpriteOf(spriteId: string): Promise<string> {
    const dir = `sprites/${spriteId}`;
    const neutral = await this.existingPath(dir, NEUTRAL);
    if (neutral) return neutral;
    for (const stem of await this.spriteStems(spriteId)) {
      const path = await this.existingPath(dir, stem);
      if (path) return path;
    }
    throw new Error(
      `主体「${spriteId}」还没有立绘，不能当参考图：` +
        `先 generate_image(kind="sprite", spriteId="${spriteId}", variant="neutral") 出一张再来。`,
    );
  }

  private async loadReference(source: string) {
    if (/^https?:\/\//i.test(source)) {
      if (!this.deps.fetchImage) {
        throw new Error("外部网络参考图下载未配置（fetchImage 缺失），无法加载 URL 图片。");
      }
      const img = await this.deps.fetchImage(source);
      return { mimeType: img.mimeType, data: img.data };
    }
    const data = await readFile(this.deps.files.absoluteOf(source));
    // 参考图必须是真图：字节头认不出来时不能冒充 image/jpeg 发给后端（那只会换来一句难懂的模型报错）
    const mimeType = sniffImageMime(data);
    if (!mimeType) throw new Error(`参考图「${source}」不是 png/jpeg/webp/gif 图片，垫不进去。`);
    return { mimeType, data };
  }

  /**
   * 素材表的读-改-写一趟（`assets/manifest.json`）。
   *
   * 排队锁不可省：一次对话里模型可以并发调两次 generate_image，也会和立绘包导入、素材页的
   * 声明下拉撞上——两个 read-modify-write 各自读到旧表，后写的会把先写的整段冲掉。
   */
  private withManifest(
    notify: AssetNotify,
    edit: (current: Record<string, unknown>, asMeta: (key: string) => Record<string, unknown>) => void,
  ): Promise<void> {
    return withPlayConfigLock(this.deps.store.dir, async () => {
      const raw = await this.deps.files.read("assets/manifest.json").catch(() => "");
      const current: Record<string, unknown> =
        raw && raw.trim()
          ? (() => {
              try {
                const parsed: unknown = JSON.parse(raw);
                return parsed && typeof parsed === "object" && !Array.isArray(parsed)
                  ? (parsed as Record<string, unknown>)
                  : {};
              } catch {
                return {};
              }
            })()
          : {};

      const asMeta = (key: string): Record<string, unknown> => {
        const value = current[key];
        if (value && typeof value === "object" && !Array.isArray(value)) return { ...(value as Record<string, unknown>) };
        return typeof value === "string" ? { description: value } : {};
      };

      edit(current, asMeta);

      const after = `${JSON.stringify(current, null, 2)}\n`;
      if (after === raw) return;
      await this.deps.files.write("assets/manifest.json", after);
      this.deps.onWrite({ path: "assets/manifest.json" }, notify);
    });
  }

  /**
   * 出图后把呈现声明补进素材表：文件在盘上但没人声明取景与体量时，
   * 舞台只能拿缺省档去套——一张半身图会被按全身摆位，机甲会被画成一人高。
   *
   * 只写它知道的那几格：`framing`（neutral 那次作为立绘级基准；与基准不同的差分写差分级覆盖）、
   * `stature`、`title`（无卡主体的名牌）。**描述一个字不动**——那是工坊与用户的账。
   */
  private declareSprite(spec: AssetSpec, notify: AssetNotify): Promise<void> {
    const spriteId = spec.spriteId!;
    const variant = spec.variant!;
    return this.withManifest(notify, (current, asMeta) => {
      const base = asMeta(spriteId);
      // 立绘级取景以 neutral 那次为准：它是所有差分的垫图基准，一条 closeup 不该把基准带跑
      if (variant === NEUTRAL && spec.framing) base.framing = spec.framing;
      if (spec.stature) base.stature = spec.stature;
      if (spec.title) base.title = spec.title;
      current[spriteId] = base;

      // 差分级的取景只在与立绘级不同时才写一条覆盖：与基准一致时留空表，文件才读得下去
      const baseFraming = base.framing;
      if (spec.framing && variant !== NEUTRAL && spec.framing !== baseFraming) {
        current[`${spriteId}/${variant}`] = { ...asMeta(`${spriteId}/${variant}`), framing: spec.framing };
      }
    });
  }

  /**
   * 素材页手写的呈现声明：立绘级（`<id>`）或差分级（`<id>/<variant>`）各四格，
   * 传 `null` 就是摘掉那一格（回到缺省），整条空了就把键删掉——manifest 是给人读的，
   * 不留一串空对象。
   *
   * 描述与差分表照样一个字不动：这一趟只碰呈现那四格。
   */
  declareSpriteMeta(
    spriteId: string,
    variant: string | null,
    patch: {
      framing?: SpriteFraming | null;
      stature?: SpriteStature | null;
      anchor?: ActorAnchor | null;
      title?: string | null;
    },
    notify: AssetNotify,
  ): Promise<void> {
    const id = assertSpriteId(spriteId);
    const key = variant && variant.trim() !== "" ? `${id}/${variant.trim()}` : id;
    return this.withManifest(notify, (current, asMeta) => {
      const meta = asMeta(key);
      for (const [field, value] of Object.entries(patch)) {
        if (value === null || value === "") delete meta[field];
        else if (value !== undefined) meta[field] = value;
      }
      if (Object.keys(meta).length === 0) delete current[key];
      else current[key] = meta;
    });
  }

  /** 同一 stem 下已有的图像（任一扩展名）：用于覆盖判定与清旧。 */
  private async existingPath(kindPath: string, stem: string): Promise<string | null> {
    for (const ext of IMAGE_EXTS) {
      const rel = `assets/${kindPath}/${stem}${ext}`;
      if (existsSync(this.deps.files.absoluteOf(rel))) return rel;
    }
    return null;
  }

  private async spriteStems(spriteId: string): Promise<string[]> {
    const dir = this.deps.files.absoluteOf(`assets/sprites/${spriteId}`);
    if (!existsSync(dir)) return [];
    return (await readdir(dir))
      .filter((f) => /\.(png|jpe?g|webp)$/i.test(f))
      .map((f) => f.slice(0, f.lastIndexOf(".")))
      .sort();
  }
}

/** pending 面板上那一行的话。 */
function labelFor(spec: AssetSpec): string {
  if (spec.kind === "sprite") return `立绘 ${spec.spriteId}/${spec.variant}`;
  return spec.kind === "background" ? `背景 ${spec.stem}` : `CG ${spec.stem}`;
}

function suffixFor(spec: AssetSpec, prompt: string, sentReferences: number): string {
  if (spec.kind !== "sprite") {
    if (sentReferences <= 0) return prompt;
    // 如果全部为具名角色
    if (spec.referenceSprites?.length && spec.referenceSprites.length === sentReferences) {
      return `${prompt}. ${referenceSuffix(spec.referenceSprites)}`;
    }
    // 包含通用参考图或混合参考
    return `${prompt}. ${genericReferenceSuffix(spec.explicitReferences ?? [])}`;
  }
  // 定妆照与差分走同一个出口：抠底底色、画风、不留杂物这几条必须两条分支一致，
  // 分开写就一定会漂（见 `spriteSuffix`）。
  return `${prompt}. ${spriteSuffix(spec.framing, spec.variant, sentReferences)}`;
}

/**
 * 通用参考图后缀：用于背景、CG 或未全具名角色的垫图场景。
 */
function genericReferenceSuffix(refs: ResolvedReference[]): string {
  const named = refs.filter((r) => !!r.name);
  if (named.length > 0) {
    const roster = refs
      .map((r, i) => `${i + 1}) ${r.name ? r.name : "reference image"}`)
      .join(", ");
    return (
      `The attached reference images are, in this exact order: ${roster}. ` +
      "Maintain consistent visual appearance, character identity, hairstyle, facial features, and design elements " +
      "as depicted in the corresponding reference images while adapting them to the scene."
    );
  }
  return (
    "Follow the attached reference image(s) for visual appearance, design details, " +
    "color palette and overall aesthetic while rendering the described scene."
  );
}

/**
 * 定妆照的参考图尾注：拼在构图后缀**之后**，点明这一张要长得像参考图里的那个人。
 *
 * 与差分的 `HUMAN_IDENTITY` / `PROP_IDENTITY` 分工不同——差分垫的是自家 neutral，
 * 说的是「只改表情」；这里垫的是外部图（用户给的既有角色图、原画），
 * 要的是「把那个人的样子搬到这张定妆照上」。姿势、底色、画风仍由 `spriteSuffix` 管，
 * 这一段只补身份。**不带句尾标点**：拼接由 `join(". ")` 统一负责。
 */
function neutralReferenceTail(framing: SpriteFraming | undefined): string {
  if ((framing ?? DEFAULT_SPRITE_FRAMING) === "square") {
    return "Based on the attached reference image: the same subject with identical colors, markings and features";
  }
  return (
    "Based on the attached reference image: the same character — identical face, hairstyle, hair color, " +
    "eye color and outfit — redrawn in the pose and framing described above"
  );
}

/**
 * 参考立绘在提示词里的**序号锚点**。
 *
 * 非可省：`geminiImage.ts` 把垫图按 `references` 的顺序一个个 push 成 inlineData，
 * 图片本身没有名字，模型只看到「第一张、第二张……」。不点明谁是谁，多人 CG 就会各画各的，
 * 而且是**看起来完全正常**地画错——不会报错，图也好看，只是七濑长成了澪。
 *
 * 编号从 1 起、顺序与 references 数组严格一致；名字取角色卡的 `name`（没写就退回 id）。
 */
function referenceSuffix(characters: ReferenceSprite[]): string {
  const roster = characters.map((c, i) => `${i + 1}) ${c.name}`).join(", ");
  return (
    `The attached reference images are, in this exact order: ${roster}. ` +
    "Keep each of them recognisably that same person — identical face, hairstyle, hair color, " +
    "eye color and outfit — while placing them in the new scene. Do not merge them into one person."
  );
}


/**
 * 画风句。定妆照与差分共用同一份——两边各写一句时，两句话只要有一处措辞不同，
 * 出来就是两张画风不同的画，而「同一个人」正是靠这套词锁的。
 */
const STYLE =
  "Japanese anime style 2D illustration, flat cel shading with clean crisp lineart, " +
  "NOT a 3D render, no 3D CGI look";

/**
 * 抠底底色：**单一纯色，且这个颜色不出现在角色身上**。
 *
 * 抠底（`src/cutout.ts`）是纯色键：离底色够近的像素一律算背景，不分内外、不看连通性。
 * 所以底色一旦和角色撞色，角色身上那块就跟着被抠穿——「纯白底 + 白袜子」就是撞色的极端，
 * 算法救不了，是出图这一步的责任：底色必须选成角色配色里没有的颜色。
 *
 * 默认纯绿 #00FF00，不再让模型自由挑色——绿幕对深色描边、暖色皮肤、深发色都是最远的色距，
 * 抠完的边最干净。**只有角色配色本身就是绿色系（绿发/绿衣/绿瞳）时才换**成纯品红 #FF00FF
 * 或纯蓝 #0000FF。换了哪个抠底端不需要知道：它从整圈边框量出实际底色。
 *
 * **这一句是底线，定妆照与差分都走它。** 别在别的分支里另写一句「跟参考图同色」——
 * 差分曾经就是这么写的，而差分的垫图是**已经抠过底的透明 PNG**（没有颜色），
 * 模型把透明还原成白底，色键于是把角色身上一切接近白的像素（白袜、白制服、银发）
 * 判成背景，整张立绘被打成镂空。约束被复制就会只改一份，只改一份就是线上事故。
 */
const KEY_BACKGROUND =
  "Background is one single flat solid colour used as a chroma key, chosen to appear nowhere on the " +
  "character themselves; always use pure green #00FF00, unless the character's own colouring is " +
  "greenish (green hair, green clothing, green eyes), in which case use pure magenta #FF00FF instead";

/**
 * 不许渐变、投影、纹理、装饰：色键只认一种颜色，任何过渡都是抠不干净的白边。
 * 与画风句、底色句一样，只此一份——先前 `IDENTITY_TAIL` 手里抄了一份
 * （`no text, no shadow, no gradient.`），两句还只对上了三个词。
 */
const NO_ARTIFACTS = "No gradient, no shadow, no texture, no decoration, no text";

/**
 * 留白约束：人形专属。舞台按统一头顶留白摆位（见 app.css 的 .theater-sprite）。
 *
 * **姿势不在这里规定。** 早先这一段写死 `front-facing standing pose, both arms held slightly away
 * from the body`，于是每个角色、每张定妆照都是同一个正面对称站桩；而定妆照是所有差分的垫图基准，
 * 姿势就此终身固定。站姿还是坐姿、什么机位，属于角色气质，由调用方写（`imageTool.ts` 的
 * PROMPT_RULES 已经要求「姿势、机位、景别都要显式写」），引擎不覆盖。
 *
 * 留在这里的是抠底真要的那条：手臂与躯干之间**不能留窄缝**——色键够不着那条窄缝，
 * 人会被拆成两块轮廓（要么贴住，要么彻底分开、让底色能灌进去）。
 */
const POSE_TAIL =
  "arms either resting against the body or clearly separated from it, never with a narrow sliver of " +
  "background trapped between an arm and the torso" +
  // 人物矮的那一头空间本来就该空得多，不点明的话模型会把所有角色都顶到画幅上沿，
  // 矮个子的头顶就直接贴边了。
  ". Shorter characters may leave more empty space above the head, and taller characters may leave less, " +
  "so every character keeps some space above the head rather than touching the top edge of the frame";

/**
 * 主体非人（`square`）时的留白约束：只说「完整入画 + 四周留白」。
 *
 * 抠底靠的是「主体四周有一圈底色」，这与人形无关，所以留白这句留着；
 * 姿态与「头顶留白」都去掉——猫没有双臂，吊灯没有头顶。
 */
const PROP_TAIL =
  "the entire subject fully inside the frame with clear empty background space all around it, " +
  "nothing cropped by the frame edges";

/**
 * 定妆照的前置中性描述：压住角色卡里的表情词（那一条只对当前差分有效）。
 *
 * **只说表情与气质，不说姿势**：姿势归调用方。这里写死站姿时，调用方写在 prompt 里的任何姿势
 * 都会被压掉——定妆照要能当这个角色的基本立绘用，姿势本身就得是表达气质的一部分。
 *
 * **按取景取词，不是一句通吃**：给非人主体（`square`）说 portrait 会得到「猫的肖像照」——
 * portrait 是人形概念，套到猫/道具身上语义不通，模型要么给你一只坐着的人形猫，要么干脆画个人。
 * `square` 用「完整入画、中性状态」，不提姿势也不提表情。
 */
const NEUTRAL_LEAD: Record<SpriteFraming, string> = {
  full: "a calm neutral-expression portrait of the character, in a natural pose that expresses their personality.",
  half:
    "a calm neutral-expression portrait of the character, in a natural pose that expresses their personality, waist up.",
  square: "the subject shown whole, in a neutral state.",
};

/**
 * 差分：只改**表情/状态**，身份特征一律锁死——垫图之外的第二道保险。
 *
 * 「facial expression」也是人形词，猫的差分（睡着的/炸毛的）说「只改面部表情」会让模型
 * 认真去找那张猫脸。所以非人那套说的是「只改状态」。
 */
const HUMAN_IDENTITY =
  "Same character as the reference image: identical hairstyle, hair color, eye color, outfit and body type. " +
  "Change only the facial expression.";
const PROP_IDENTITY =
  "The same subject as the reference image, in the same pose and same colours. Change only its state.";

/**
 * 立绘提示词的**唯一出口**：定妆照与差分拼的是同一个片段序列，差别只在「身份」那一段。
 *
 * 这么写是为了让「底色 / 画风 / 不留杂物」这几条**不可能只在一条分支上生效**——
 * 它们曾经分居两处（`COMMON_TAIL` 与 `IDENTITY_TAIL`），绿幕改造只改了前者，
 * 差分就此带着白底出图、被色键打成镂空（见 `docs/issues/261008-sprite-variant-dirty-cutout/`）。
 * 片段之间统一由 `join(". ")` 拼，标点不再手写——手拼时出过 `one arm.. Same character` 这种双句点。
 *
 * 顺序有讲究：景别与构图在前，身份在后，底色与画风压轴。垫图会带自己的背景与景别，
 * 约束放在它后面才盖得住。
 */
function spriteSuffix(
  framing: SpriteFraming | undefined,
  variant: string | undefined,
  sentReferences: number,
): string {
  const f = framing ?? DEFAULT_SPRITE_FRAMING;
  // square 是「非人主体」的唯一入口，所以它同时决定了后缀走哪一套。
  // 人与非人的差别只有一处：姿势与头顶留白（人形专属），其余构图与画风约束两边通用。
  const human = f !== "square";
  const neutral = variant === NEUTRAL;
  const parts = [
    // 差分也要点明景别：垫图（neutral 定妆照）是全身时，模型很容易照着垫图把一条
    // 半身差分也画成全身。不点明的代价是图出来了取景对不上，舞台按半身摆却是张全身像。
    neutral ? SPRITE_FRAMING_SHOT[f] : human ? HUMAN_IDENTITY : PROP_IDENTITY,
    ...(neutral ? [] : [SPRITE_FRAMING_SHOT[f]]),
    human ? POSE_TAIL : PROP_TAIL,
    STYLE,
    KEY_BACKGROUND,
    NO_ARTIFACTS,
  ];
  // 定妆照垫图时补一句「这就是参考图里那个人」，压在最后：参考图带背景与景别，压后才盖得住。
  if (neutral && sentReferences > 0) parts.push(neutralReferenceTail(f));
  // 标点由这一处说了算：片段自带的尾句点一律削掉再拼，否则 `expression.` 撞上 `". "`
  // 就是 `expression..`——片段各写各的标点时实测出过 30/57 条带双句点的提示词。
  return `${parts.map((p) => p.trim().replace(/\.+$/, "")).join(". ")}.`;
}
