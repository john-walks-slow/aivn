import { existsSync } from "node:fs";
import { mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import {
  DEFAULT_SPRITE_FRAMING,
  parseCharacterCard,
  serializeCharacterCard,
  SPRITE_FRAMING_ASPECT,
  SPRITE_FRAMING_SHOT,
  type CharacterDocument,
  type SpriteFraming,
  type WorkshopAssetView,
} from "@stage-ai/core";
import { aspectMatches, extOf, sizeOfImage, type ImageAspect, type ImageBackend } from "./imageBackend.js";
import { cutout, resolveTuning, type CutoutTuning } from "./cutout.js";
import { IMAGE_EXTS, mimeForExt, sniffImageMime } from "./imageMime.js";
import type { Limiter } from "./limiter.js";
import { PlayMemory } from "./memory.js";
import { errorText, jobIdForImage, type PendingJobs } from "./pendingJobs.js";
import type { PlayFiles } from "./playFiles.js";
import type { PlayStore } from "./store.js";
import { withPlayConfigLock } from "./store.js";
import type { WorkshopWrite } from "./agentkit/deps.js";
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
 * 角色一致性靠 `neutral` 差分兼任定妆照与垫图——它既是合法差分（actor 能直接引用），
 * 又是进 git 后换机器也保得住的「同一个人」。不另开 assets/refs/ 目录，免得污染素材清单。
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

/** 角色卡 `sprites[expression]` 的值：只当文件名用，带路径分隔符的一律不认。 */
const BARE_FILENAME = /^[A-Za-z0-9][A-Za-z0-9._-]{0,79}\.(png|jpe?g|webp)$/i;

const NEUTRAL = "neutral";


/** 谁触发的这次出图。工坊要撤销条与素材气泡，剧作家在拍内预发射一样都不产。manual 为用户从工坊面板手动触发（不产生对话流气泡，也不排队自动重建）。 */
export type AssetNotify = "workshop" | "silent" | "manual";

export type AssetKind = "background" | "cg" | "sprite";

export interface AssetTarget {
  kind: AssetKind;
  /** 背景/CG 的素材 id（同时是文件名主体）。 */
  name?: string;
  /** 立绘所属角色 id（默认对角色卡做成员校验）。 */
  characterId?: string;
  /**
   * 角色表里没有 characterId 时的显示名——带了它就自动建一张最小角色卡。
   * 戏里临时冒出来的人（路人、只在两轮里出现的店员）走这条路：立绘要出，
   * 而工坊与用户此刻不在场，没人来得及先建卡。
   */
  characterName?: string;
  /** 立绘差分名（neutral / smile / ...）。 */
  expression?: string;
  /** 立绘取景（full/half/square）：决定出图景别与画幅，缺省全身。不给就沿用角色卡里该角色已有的声明。 */
  framing?: SpriteFraming;
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
  /** 事件去向：工坊要撤销条与素材气泡，剧作家的后台预发射一律静默。 */
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

/** 一张要垫给模型的参考图规格：可能是剧目内角色立绘，也可能是指定路径或网络图片。 */
export interface ResolvedReference {
  /** 显示名或角色名（用于在 prompt 里标注「第几张是谁」）；若无法识别则为 null。 */
  name: string | null;
  /** 角色 id（若来自角色立绘）。 */
  characterId?: string;
  /** 来源：剧目内相对路径或 http(s) 网址。 */
  source: string;
}

interface AssetSpec {
  kind: AssetKind;
  /** assets/ 下的目录：backgrounds | cg | sprites/<charId>。 */
  kindPath: string;
  stem: string;
  aspect: ImageAspect;
  characterId?: string;
  expression?: string;
  /** 立绘取景；背景/CG 不带。 */
  framing?: SpriteFraming;
  /** 角色级取景（不含差分覆盖）：自动补的定妆照按它出，不按当前差分那档。
   *  定妆照是所有差分的垫图基准，一个「全身角色 + 一条 closeup 差分」不该把基准也变成胸像。 */
  baseFraming?: SpriteFraming;
  /** 解析后的显式参考图列表（按传入顺序）。 */
  explicitReferences?: ResolvedReference[];
  /** 兼容旧代码引用的角色列表（如果参考图中有角色）。 */
  referenceCharacters?: ReferenceCharacter[];
  /** 本次出图顺带建了一张角色卡（角色表变了，宿主要排轮边界重建）。 */
  autoRegistered?: boolean;
}

/** 一张要垫进背景/CG 的角色立绘：id 用于排引用顺序，name 进提示词标注「这张图是谁」。 */
interface ReferenceCharacter {
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
  /** 写一张角色卡（自动注册临时角色用）；没有这条能力就不自动建卡，直接报错。 */
  writeCharacter?: (charId: string, content: string) => Promise<void>;
  /** 角色卡立绘映射补写要进撤销条（二进制本身不进）。 */
  onWrite: (write: WorkshopWrite, notify: AssetNotify) => void;
  /** 素材到货（工坊侧挂到对话气泡里）。 */
  onAsset?: (asset: WorkshopAssetView, replaced: boolean, notify: AssetNotify) => void;
  /**
   * **角色卡**（`characters/<id>.md`）被这一层改过：补写差分映射与取景都落它头上，
   * 宿主据此决定要不要重建 runtime（角色表来自角色卡，不重建就取不到新差分）。
   * 工坊侧一轮收束时自己会重建，这里收到 "workshop" 无需动作；剧作家侧在拍内不能腰斩演出，
   * 收到 "silent" 得排到轮边界。
   *
   * 名字仍叫 `onPlayConfigChanged`：play.json 是剧目配置文件，角色卡是它的配置项之一，
   * 回调的形状与触发时机都没变，改名只会逼着范围外的调用方一起动。
   */
  onPlayConfigChanged?: (notify: AssetNotify) => void;
}

/**
 * 自动注册出来的最小角色卡：只声明「戏里有这么个人」。
 *
 * 人设（正文）故意留成一句「设定未补」而不是空白——空白在 A 区里读起来像是
 * 「作者写过了，就是没写」，而工坊后面看到这张卡时也不会知道该去补。
 */
function stubCharacterCard(characterId: string, name: string): string {
  return `---\nid: ${characterId}\nname: ${name}\n---\n\n（演出中临时引入，设定未补。）`;
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

  async generate(
    target: AssetTarget,
    prompt: string,
    style?: string,
    options?: GenerateOptions,
  ): Promise<GeneratedPlayAsset[]> {
    const notify = options?.notify ?? "workshop";
    const spec = await this.resolve(target);
    // 自动建的角色卡也是角色表的改动：拍进行中同样得排到轮边界重建，否则本轮之后
    // 这个角色进不了 A 区，剧作家下一轮会当成不认识他。
    if (spec.autoRegistered) this.deps.onPlayConfigChanged?.(notify);
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
      throw new Error(`${spec.characterId}/${spec.stem} 还没有抠底图，先 generate_image 出图再来重抠。`);
    }
    const { data } = await cutout(await this.readSpriteSource(spec), resolveTuning(tuning));
    return { ...(await this.persist(spec, data, ".png")), autoNeutral: false };
  }

  private async readSpriteSource(spec: AssetSpec): Promise<Buffer> {
    const dir = this.deps.store.spriteSourceDir(spec.characterId!);
    for (const ext of IMAGE_EXTS) {
      const file = join(dir, `${spec.stem}${ext}`);
      if (existsSync(file)) return readFile(file);
    }
    throw new Error(
      `${spec.characterId}/${spec.stem} 没有留底原片（抠底前那一张），没法原地重抠。` +
        "留底是出图时顺手写的：更早出的图、用户自己上传的立绘都没有——那种只能重新出图。",
    );
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
      if (!target.characterId || !target.expression) return null;
      return this.existingPath(`sprites/${target.characterId}`, target.expression);
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
    const bytes = spec.kind === "sprite" ? await this.cutSprite(spec, data, mimeType) : data;
    const ext = spec.kind === "sprite" ? ".png" : extOf(mimeType);
    const written = await this.persist(spec, bytes, ext);
    if (spec.kind === "sprite") await this.mapSprite(spec, `${spec.stem}${ext}`, notify);
    await this.recordPrompt(spec, written.path, fullPrompt);
    return auto ? [auto, { ...written, autoNeutral: true }] : [{ ...written, autoNeutral: false }];
  }

  /**
   * 立绘落盘前的最后一步：抠底成透明 PNG，并把**抠底前的原片**留一份。
   *
   * 留底是抠底参数唯一的后悔药：透明 PNG 一落盘底色就没了，之后想改抠底只剩「重新出图」——
   * 而重新出图出来的是另一张画，用户刚点头的那张会被顶掉，还白烧一份配额。
   * 留了底，「图挺好、抠得脏」就是本地重跑一遍的事（见 `recut`）。
   *
   * 留底写在 media-cache/（跑批产物，不进 git）：换机器后老图没法重抠，这是有意的取舍——
   * 原片是中间物，不是剧目内容。写失败只记一条告警，不把一次成功的出图报成失败。
   */
  private async cutSprite(spec: AssetSpec, data: Buffer, mimeType: string): Promise<Buffer> {
    const { data: png } = await cutout(data, resolveTuning());
    await this.keepSpriteSource(spec, data, mimeType);
    return png;
  }

  private async keepSpriteSource(spec: AssetSpec, data: Buffer, mimeType: string): Promise<void> {
    if (!spec.characterId) return;
    const dir = this.deps.store.spriteSourceDir(spec.characterId);
    const ext = extOf(mimeType);
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
        `[stage-ai] 立绘 ${spec.characterId}/${spec.stem} 的留底原片没写成（之后没法原地重抠）：` +
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
    const id = spec.kind === "sprite" ? `${spec.characterId}/${spec.stem}` : spec.stem;
    const kind = spec.kind === "background" ? "background" : spec.kind;
    try {
      await withPlayConfigLock(this.deps.store.dir, () =>
        this.deps.store.saveLedgerEntry({ id, kind, path, prompt, at: new Date().toISOString() }),
      );
    } catch (error) {
      // 图已经落盘了，为一条记账把一次成功的出图报成失败更糟；这里出声，图与 prompt 对不上时能查到。
      console.warn(
        `[stage-ai] 出图 prompt 未记进 assets/generated.json（${id}）: ${error instanceof Error ? error.message : String(error)}`,
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
      console.warn(`[stage-ai] 读不出 ${spec.stem} 的图片尺寸，跳过画幅校验（${data.length}B）`);
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
    const referenceCharacters = explicitReferences
      ?.filter((r): r is ResolvedReference & { characterId: string; name: string } => !!r.characterId && !!r.name)
      .map((r) => ({ id: r.characterId, name: r.name }));

    if (target.kind === "sprite") {
      const spriteSpec = await this.resolveSprite(target);
      return {
        ...spriteSpec,
        explicitReferences,
        referenceCharacters,
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
      referenceCharacters,
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
   * 1. 角色 id（如 "alice"）——自动解析为其立绘文件；
   * 2. 剧目内相对路径（如 "assets/backgrounds/ref.png"）；
   * 3. http(s) URL。
   *
   * 解析不合法的项时显式报错，避免静默漏垫图导致生成结果偏差。
   */
  private async resolveReferences(items: string[]): Promise<ResolvedReference[]> {
    const cast = await this.cast();
    const unique = [...new Set(items.map((it) => it.trim()).filter(Boolean))];

    // 先检查是否看起来像角色 id：如果不含路径分隔符也不是 URL 且角色表里没有，直接按角色卡报错
    const missingChars = unique.filter(
      (it) => !/^https?:\/\//i.test(it) && !it.includes("/") && !cast.has(it),
    );
    if (missingChars.length > 0) {
      throw new Error(
        `角色卡里没有角色「${missingChars.join("、")}」。可选：${[...cast.keys()].join(" / ") || "（角色表是空的）"}`,
      );
    }

    const resolved: ResolvedReference[] = [];

    for (const item of unique) {
      if (/^https?:\/\//i.test(item)) {
        resolved.push({ name: null, source: item });
        continue;
      }
      if (cast.has(item)) {
        const char = cast.get(item)!;
        const spriteRel = await this.referenceSpriteOf({ id: item, name: char.name ?? item });
        resolved.push({ name: char.name ?? item, characterId: item, source: spriteRel });
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
        `未知的参考图「${item}」：既不是已知角色（可选：${[...cast.keys()].join(" / ") || "无"}），` +
          "也不是存在的剧目内路径或 http(s) 网址。",
      );
    }
    return resolved;
  }

  private async resolveSprite(target: AssetTarget): Promise<AssetSpec> {
    const characterId = target.characterId?.trim() ?? "";
    if (!characterId) throw new Error("立绘必须给 characterId（角色卡的文件名主体）");
    const expression = target.expression?.trim() ?? "";
    if (!expression) throw new Error("立绘必须给 expression（差分名，如 neutral / smile）");
    assertAssetStem(expression, "差分名");
    const cast = await this.cast();
    let card = cast.get(characterId);
    // 没有角色卡：这个角色要么是笔误，要么是戏里临时冒出来的人。后者带 characterName 重新发起，
    // 就地建一张最小卡——工坊与用户此刻不在场，等他们想起建卡，这一轮早就演过去了。
    if (!card) {
      const autoName = target.characterName?.trim();
      if (!autoName) {
        throw new Error(
          `角色卡里没有角色「${characterId}」（characters/${characterId}.md）。` +
            `可选：${[...cast.keys()].join(" / ")}。` +
            "要在戏里引入一个新角色（路人、临时店员），带 characterName=显示名 重新发起，会自动建卡。",
        );
      }
      if (!this.deps.writeCharacter) {
        throw new Error(`角色卡里没有角色「${characterId}」，当前环境也不能自动建卡。先 create_character 建一张。`);
      }
      await this.deps.writeCharacter(characterId, stubCharacterCard(characterId, autoName));
      card = (await this.cast()).get(characterId);
      if (!card) throw new Error(`角色卡「${characterId}.md」写完却读不出来，检查该目录的读写权限。`);
    }
    // 取景优先级：调用方显式给 > 角色卡里该角色这条差分的声明 > 角色级声明 > 全身。
    // 不给就沿用已有声明，是为了让「先给角色定过取景、之后每次出图都跟着它」成立。
    const framing =
      target.framing ?? card.spriteFraming?.[expression] ?? card.framing ?? DEFAULT_SPRITE_FRAMING;
    return {
      kind: "sprite",
      kindPath: `sprites/${characterId}`,
      stem: expression,
      aspect: SPRITE_FRAMING_ASPECT[framing] as ImageAspect,
      characterId,
      expression,
      framing,
      baseFraming: card.framing ?? DEFAULT_SPRITE_FRAMING,
      ...(cast.has(characterId) ? {} : { autoRegistered: true }),
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
    if (spec.expression === NEUTRAL) return null;
    if (await this.existingPath(spec.kindPath, NEUTRAL)) return null;
    const others = await this.spriteStems(spec.characterId!);
    if (others.length > 0) {
      throw new Error(
        `${spec.characterId} 缺 ${NEUTRAL} 定妆照，但已有 ${others.length} 个差分（${others.join("、")}）：` +
          "新出的定妆照会与已有差分不是同一个人，演出中会静默换脸。" +
          "请先单独生成一次 neutral 让用户过目，确认后再生成差分。",
      );
    }
    // prompt 是"角色描述 + 本次表情"，直接拿去出定妆照会变成「哭得很凶但表情中性」的自相矛盾指令。
    // 压一条前置的中性描述盖住表情词，角色外观描述留在后面。取景与姿势措辞按**角色级**取景走，
    // 不按当前这条差分：对半身说 standing 会把画拉回全身，景别后缀与它当场打架。
    const neutralFraming = spec.baseFraming ?? DEFAULT_SPRITE_FRAMING;
    const [auto] = await this.generate(
      { kind: "sprite", characterId: spec.characterId, expression: NEUTRAL, framing: neutralFraming },
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

    if (spec.kind === "sprite" && spec.expression !== NEUTRAL) {
      if (explicit.length > 0) {
        throw new Error(
          `立绘差分「${spec.characterId}/${spec.expression}」不能自带参考图：` +
            `差分的身份基准恒为该角色的 neutral 定妆照，换基准会与既有差分不是同一个人。` +
            "要换基准就重新出一次 neutral（那一次可以带 references），再派生差分。",
        );
      }
      const neutral = await this.existingPath(spec.kindPath, NEUTRAL);
      return neutral ? [await this.loadReference(neutral)] : [];
    }

    const refs = [];
    for (const ref of explicit) refs.push(await this.loadReference(ref.source));
    return refs;
  }

  /**
   * 前置校验参考立绘的角色表与盘上文件是否存在。
   * 供舞台 WS `generate_cg` 与工坊手动出图在落节点/发请求前守卫。
   */
  async assertReferences(ids: string[]): Promise<ResolvedReference[]> {
    return this.resolveReferences(ids);
  }

  /** 一张给定的立绘：优先 neutral（身份基准），其次盘上映射差分，最后兜底目录任意文件（与舞台 index.sprite 对齐）。 */
  private async referenceSpriteOf(character: ReferenceCharacter): Promise<string> {
    const card = (await this.cast()).get(character.id);
    const dir = `sprites/${character.id}`;
    const expressions = [NEUTRAL, ...Object.keys(card?.sprites ?? {}).filter((e) => e !== NEUTRAL)];
    for (const expression of expressions) {
      // `sprites[expression]` 存的是**文件名**，不保证等于差分名（breezy_oak 的 grin 存成
      // oak_grin2.png）。按差分名去猜会把这种角色判成「没有立绘」，所以先信映射——与 web 侧
      // `AssetIndex.sprite` 的解析方式保持一致。映射里的值只当文件名用，带路径的一律不认。
      const mapped = card?.sprites?.[expression];
      if (mapped && BARE_FILENAME.test(mapped)) {
        const rel = `assets/${dir}/${mapped}`;
        if (existsSync(this.deps.files.absoluteOf(rel))) return rel;
      }
      const byStem = await this.existingPath(dir, expression);
      if (byStem) return byStem;
    }
    // 兜底：目录里有任意图像文件（例如用户刚上传立绘尚未绑定差分映射，舞台端 index.sprite 也会取 files[0]）
    const stems = await this.spriteStems(character.id);
    for (const stem of stems) {
      const p = await this.existingPath(dir, stem);
      if (p) return p;
    }
    throw new Error(
      `角色「${character.name}」（${character.id}）还没有立绘，不能当参考图：` +
        `先 generate_image(kind="sprite") 出一张 ${character.id}/neutral 再来。`,
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
   * 立绘映射补写：文件在盘上但角色卡没映射，剧作家与编排器都取不到，等于没生成。
   *
   * 落点是角色卡的 frontmatter（`serializeCharacterCard`），不是 play.json——角色的一切都在那张卡上。
   * 没有角色卡就什么都不写：角色表是用户与工坊的账，出图无权凭空造一个角色。
   *
   * 排队锁不可省：一次对话里模型可以并发调两次 generate_image，也会和立绘包导入撞上，
   * 三个 read-modify-write 各自读到旧角色卡，后写的会把先写的差分映射整个冲掉
   * （用户看到的现象是「刚出的表情在角色卡里消失了」）。锁按剧目目录发（`store.dir`），
   * 与资源库导入共用同一条——两条路径改的是同一张角色卡。
   */
  private mapSprite(spec: AssetSpec, file: string, notify: AssetNotify): Promise<void> {
    return withPlayConfigLock(this.deps.store.dir, async () => {
      const path = `characters/${spec.characterId}.md`;
      const raw = await this.deps.files.read(path).catch(() => null);
      if (raw === null) return;
      const card = parseCharacterCard(raw);
      const next: CharacterDocument = {
        ...card,
        sprites: { ...(card.sprites ?? {}), [spec.expression!]: file },
      };
      // 取景跟着这张图一起落进角色卡：出图是唯一知道画幅与景别的时刻，
      // 不记下来的话舞台只能拿缺省全身去套一张半身图（下次出图也会退回 9:16 全身）。
      if (spec.framing) {
        if (spec.expression === NEUTRAL) next.framing = spec.framing;
        next.spriteFraming = { ...(card.spriteFraming ?? {}), [spec.expression!]: spec.framing };
      }
      const content = serializeCharacterCard(next);
      if (content === raw) return;
      await this.deps.files.write(path, content);
      this.deps.onWrite({ path, before: raw, after: content }, notify);
      this.deps.onPlayConfigChanged?.(notify);
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

  private async spriteStems(characterId: string): Promise<string[]> {
    const dir = this.deps.files.absoluteOf(`assets/sprites/${characterId}`);
    if (!existsSync(dir)) return [];
    return (await readdir(dir))
      .filter((f) => /\.(png|jpe?g|webp)$/i.test(f))
      .map((f) => f.slice(0, f.lastIndexOf(".")))
      .sort();
  }
}

/** pending 面板上那一行的话。 */
function labelFor(spec: AssetSpec): string {
  if (spec.kind === "sprite") return `立绘 ${spec.characterId}/${spec.expression}`;
  return spec.kind === "background" ? `背景 ${spec.stem}` : `CG ${spec.stem}`;
}

function suffixFor(spec: AssetSpec, prompt: string, sentReferences: number): string {
  if (spec.kind !== "sprite") {
    if (sentReferences <= 0) return prompt;
    // 如果全部为具名角色
    if (spec.referenceCharacters?.length && spec.referenceCharacters.length === sentReferences) {
      return `${prompt}. ${referenceSuffix(spec.referenceCharacters)}`;
    }
    // 包含通用参考图或混合参考
    return `${prompt}. ${genericReferenceSuffix(spec.explicitReferences ?? [])}`;
  }
  if (spec.expression === NEUTRAL) {
    // 定妆照垫图：先给白底抠底的构图约束，再点明这是哪张参考图的同一个人。
    // 顺序不能反——参考图会带背景与景别，构图约束压后面才盖得住它。
    return sentReferences > 0
      ? `${prompt}, ${neutralSuffix(spec.framing)} ${neutralReferenceTail(spec.framing)}`
      : `${prompt}, ${neutralSuffix(spec.framing)}`;
  }
  return `${prompt}. ${identitySuffix(spec.framing)}`;
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
 * 与 `identitySuffix`（差分那条）分工不同——差分垫的是自家 neutral，说的是「只改表情」；
 * 这里垫的是外部图（用户给的既有角色图、原画），要的是「把那个人的样子搬到这张定妆照上」。
 * 姿势、白底、画风仍由 `neutralSuffix` 管，这一段只补身份。
 */
function neutralReferenceTail(framing: SpriteFraming | undefined): string {
  if ((framing ?? DEFAULT_SPRITE_FRAMING) === "square") {
    return "Based on the attached reference image: the same subject with identical colors, markings and features.";
  }
  return (
    "Based on the attached reference image: the same character — identical face, hairstyle, hair color, " +
    "eye color and outfit — redrawn in the pose and framing described above."
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
function referenceSuffix(characters: ReferenceCharacter[]): string {
  const roster = characters.map((c, i) => `${i + 1}) ${c.name}`).join(", ");
  return (
    `The attached reference images are, in this exact order: ${roster}. ` +
    "Keep each of them recognisably that same person — identical face, hairstyle, hair color, " +
    "eye color and outfit — while placing them in the new scene. Do not merge them into one person."
  );
}


/**
 * 立绘后缀：**只写与主体是人还是物无关的构图与画风约束**。
 *
 * 人形专属的那一小段（手臂留白、头顶留白）由 `POSE_TAIL` 单独提供，只在人形取景时拼；
 * 非人走 `square`，不碰它——给猫套上「手臂与躯干不能留窄缝」只会得到一只人形猫。
 *
 * 这一段留白给抠底：后半段不是修饰词是硬约束，`src/cutout.ts` 的全局色键抠底要求
 * 2D 平涂 + 纯白纯色底，3D 渲染的白衣离底色只有几格色差，抠底会连人带和服一起啃掉；
 * 剪影连成一片就没法分割人物与底色。
 *
 * 它也不描述任何人物特征——每个词都会被当成设定印进图里。早先这里写的是
 * 「between the twin tails」（为了发梢与身体之间留纯白），等于给所有角色定了个双马尾：
 * 实测 prompt 里明写 pink long straight hair，出来的仍是双马尾。要什么发型由角色卡说。
 */
const COMMON_TAIL =
  ". Japanese anime style 2D illustration, flat cel shading with clean crisp lineart, NOT a 3D render, " +
  "no 3D CGI look. Plain solid pure white background, no text, no shadow, no gradient, no vignette.";

/**
 * 留白约束：人形专属。舞台按统一头顶留白摆位（见 app.css 的 .theater-sprite）。
 *
 * **姿势不在这里规定。** 早先这一段写死 `front-facing standing pose, both arms held slightly away
 * from the body`，于是每个角色、每张定妆照都是同一个正面对称站桩；而定妆照是所有差分的垫图基准，
 * 姿势就此终身固定。站姿还是坐姿、什么机位，属于角色气质，由调用方写（`imageTool.ts` 的
 * PROMPT_RULES 已经要求「姿势、机位、景别都要显式写」），引擎不覆盖。
 *
 * 留在这里的是抠底真要的那条：手臂与躯干之间**不能留窄白缝**——窄缝面积小于 `cutout.ts` 的
 * `minHole`，会被当成眼白那样的高光填回前景，剪影里多一块白。要么贴住，要么彻底分开。
 */
const POSE_TAIL =
  ", arms either resting against the body or clearly separated from it, never with a narrow white gap " +
  "between an arm and the torso" +
  // 人物矮的那一头空间本来就该空得多，不点明的话模型会把所有角色都顶到画幅上沿，
  // 矮个子的头顶就直接贴边了。
  ". Shorter characters may leave more empty space above the head, and taller characters may leave less, " +
  "so every character keeps some space above the head rather than touching the top edge of the frame";

/**
 * 主体为人（full/half）时的立绘后缀：景别措辞 + 人形留白 + 通用约束。
 *
 * 开头换的是 `SPRITE_FRAMING_SHOT` 而不是写死的 "full body"：写死时取景是半身的角色
 * 照样会被画成全身，出图与舞台声明对不上，站位又得重新量。
 * 这不是对 `framing` 的重复声明——`framing` 决定画幅（像素）与舞台摆位（CSS），
 * 两者都传不进提示词；模型唯一能知道「画到哪儿」的通道就是措辞。
 */
function humanSuffix(framing: SpriteFraming | undefined): string {
  return SPRITE_FRAMING_SHOT[framing ?? DEFAULT_SPRITE_FRAMING] + POSE_TAIL + COMMON_TAIL;
}

/**
 * 主体非人（`square`）时的立绘后缀：只说「完整入画 + 四周留白」。
 *
 * 抠底靠的是「主体与纯白底之间有缝」，这与人形无关，所以留白这句留着；
 * 姿态与「头顶留白」都去掉——猫没有双臂，吊灯没有头顶。
 */
const PROP_TAIL =
  ", the entire subject fully inside the frame with clear empty white space all around it, " +
  "nothing cropped by the frame edges";

function neutralSuffix(framing: SpriteFraming | undefined): string {
  const f = framing ?? DEFAULT_SPRITE_FRAMING;
  // square 是「非人主体」的唯一入口，所以它同时决定了后缀走哪一套。
  // 人与非人的差别只有一处：姿势与头顶留白（人形专属），其余构图与画风约束两边通用。
  return f === "square" ? SPRITE_FRAMING_SHOT[f] + PROP_TAIL + COMMON_TAIL : humanSuffix(f);
}

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
 * 画风要求与定妆照一字不差，否则两个人。
 *
 * 「facial expression」也是人形词，猫的差分（睡着的/炸毛的）说「只改面部表情」会让模型
 * 认真去找那张猫脸。所以非人那套说的是「只改状态」。
 */
const IDENTITY_TAIL =
  "Same 2D flat cel-shaded anime illustration style, NOT a 3D render, " +
  "same plain solid pure white background, no text, no shadow, no gradient.";
const HUMAN_IDENTITY =
  "Same character as the reference image: identical hairstyle, hair color, eye color, outfit and body type. " +
  "Change only the facial expression.";
const PROP_IDENTITY =
  "The same subject as the reference image, in the same pose and same colours. Change only its state.";

/**
 * 差分也要点明景别：垫图（neutral 定妆照）是全身时，模型很容易照着垫图把一条
 * 半身差分也画成全身。不点明的代价是图出来了取景对不上，舞台按半身摆却是张全身像。
 */
function identitySuffix(framing: SpriteFraming | undefined): string {
  const f = framing ?? DEFAULT_SPRITE_FRAMING;
  const shot = SPRITE_FRAMING_SHOT[f];
  const lead = f === "square" ? PROP_IDENTITY : HUMAN_IDENTITY;
  return `${lead} ${shot}. ${f === "square" ? PROP_TAIL + ". " : ""}${IDENTITY_TAIL}`;
}
