import { existsSync } from "node:fs";
import { readFile, readdir } from "node:fs/promises";
import { join, relative } from "node:path";
import {
  DEFAULT_SPRITE_FRAMING,
  DEFAULT_SPRITE_STATURE,
  SPRITE_FRAMING_ASPECT,
  spriteDeclarationOf,
  type ActorAnchor,
  type CharacterDocument,
  type SpriteFraming,
  type SpriteStature,
  type WorkshopAssetView,
} from "@aivn/core";
import { assetIoOf, parseManifest, writeManifest } from "./assetFiles.js";
import { assertSpriteLanding, ingestSprite } from "./spriteIngest.js";
import {
  aspectMatches,
  extOf,
  sizeOfImage,
  type ImageAspect,
  type ImageBackends,
  type ImageKind,
  type ImageReference,
} from "./imageBackend.js";
import { prepareSprite, resolveTuning, type CutoutTuning, type PreparedSprite } from "./cutout.js";
import {
  adoptDraft,
  assetMetaKey,
  declareMeta,
  existingAssetName,
  type AssetMetaPatch,
  type AssetSubject,
  assetMetaOf,
  registerAsset,
  declareSprite as declareSpriteIn,
  genericReferenceSuffix,
  IMAGE_EXTS,
  isKeyBackgroundColor,
  keepSpriteSource as keepSpriteSourceIn,
  ledgerEntryOf,
  loadDraft as loadDraftFrom,
  markCommitted as markCommittedIn,
  mimeForExt,
  readDraftImage,
  NEUTRAL_LEAD,
  newDraftId,
  persistAsset,
  referenceSuffix,
  sniffImageMime,
  spriteRefOfPath,
  spriteSuffix,
  writeDraft as writeDraftTo,
  type AssetIo,
  type AssetLocation,
  type AssetRefParts,
  type AssetSource,
  type AssetManifest,
  type DraftPlan,
  type DraftRecord,
  type KeyBackgroundColor,
  type LedgerEntry,
} from "@aivn/agent";
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

/**
 * 色键底色的白名单：工具 schema 与设置页只会给这两个值，但 REST 入口搬的是裸字符串，
 * 值域在这里收口——放过去的话提示词里会拼出「use undefined」。
 */
function assertKeyColor(value: unknown): KeyBackgroundColor | undefined {
  if (value === undefined || value === null) return undefined;
  if (isKeyBackgroundColor(value)) return value;
  throw new Error(`色键底色「${String(value)}」非法：只有 green / magenta`);
}

const NEUTRAL = "neutral";

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

export type AssetKind = ImageKind;

/**
 * 立绘的色键底色：纯绿（默认）或纯品红（主体自己就是绿色系时）。
 *
 * **由调用方显式给**（`generate_image` / 手动生图的 `keyColor`），不由模型在提示词里自己挑：
 * 「算不算绿色系」是个判断，藏在措辞里交给生图模型，绿瞳、绿配饰都会被算进去，底色就不可预期
 * （2026-10-09 实测：一个金发红瞳、身上一点绿都没有的角色被模型判成了绿色系，给了洋红底）。
 */
export type { KeyBackgroundColor };

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
   * 立绘的色键底色：不给按纯绿。只影响定妆照（neutral）那条后缀——差分跟着垫图的底色走。
   */
  keyColor?: KeyBackgroundColor;
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
  /** 立绘抠底**前**原片的留底路径（`media-cache/sprite-sources/…`）；没有留底则缺省。 */
  sourcePath?: string;
  /** 刚跑过的抠底体检（只有抠底路径会带）：前景占比与主体高度，回执据此提示「是不是抠穿了」。 */
  cutout?: { coverage: number; figureTop: number; figureHeight: number };
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
  /** 这次的色键底色（解析结果，出后缀用）。 */
  keyColor?: KeyBackgroundColor;
  /** 立绘级取景（不含差分覆盖）：自动补的定妆照按它出，不按当前差分那档。
   *  定妆照是所有差分的垫图基准，一个「全身主体 + 一条 closeup 差分」不该把基准也变成胸像。 */
  baseFraming?: SpriteFraming;
  /** 抠图量出来的落位指标（头顶留白 / 人物像素高）：写进素材表的立绘级与差分级。 */
  figureTop?: number;
  figureHeight?: number;
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
  /** 三类素材各自的后端（背景 / CG / 立绘可以走不同的网关、模型、档位）。 */
  backends: ImageBackends;
  limiter: Limiter;
  /** 逐类目的垫图策略：`none` = 不传参考图（见 `referencesFor`）。 */
  reference: Record<ImageKind, ImageReference>;
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
        `${spec.spriteId} 还没有入库的 ${NEUTRAL} 定妆照：先出定妆照候选、挑一张用 import_asset 采用（立绘先 cut），再派生差分。`,
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
    if (!draft.kind) throw new Error(`草稿 ${draftId} 没有剧目目标（通用出图），不能入库`);
    const spec = await this.resolve({
      kind: draft.kind,
      name: draft.name,
      spriteId: draft.spriteId,
      variant: draft.variant,
      framing: draft.framing,
      stature: draft.stature,
      title: draft.title,
    });
    // 落位、素材表声明、台账、留底、留痕的编排在包里（与插件共用一份）；
    // 这里只把本层的 IO 口（`PlayFiles` 白名单 + 剧目锁 + notify）接上去。
    // 候选不抠底（P5-c）：立绘的透明那一刀在**入库**时补上——入库那张必须是透明 PNG，
    // 舞台靠 alpha 叠在场景上。
    const cut = spec.kind === "sprite"
      ? await this.normalizeSprite(spec.framing, await readDraftImage(this.deps.store.dir, draft.draftId, draft.imageExt))
      : null;
    // 抠图量出的头顶留白与人物高度只能借这一格进 adoptDraft → declareSprite：
    // 入库是那条路，素材表里没有第二个写口。
    const imageOverride = cut
      ? { bytes: cut.data, ext: ".png", figureTop: cut.figureTop, figureHeight: cut.figureHeight }
      : undefined;
    const adopted = await adoptDraft(
      {
        playDir: this.deps.store.dir,
        assets: this.assetIo(),
        updateManifest: (mutate) => this.withManifest(notify, mutate),
        recordLedger: (entry) => this.saveLedger(entry),
      },
      draft,
      spec,
      imageOverride,
    );
    return {
      kind: spec.kind,
      path: adopted.rel,
      url: `/plays/${this.playId}/${adopted.rel}`,
      replaced: adopted.replaced,
      autoNeutral: false,
    };
  }

  /**
   * 登记一张**外来的图**：调用方显式给的落位 + 剧目自己的 IO（白名单读、素材写口、两张表）。
   *
   * 与 `commit` 是姊妹：采用走草稿里记下的出图意图，登记走**显式给的落位**——于是「别的工具产出的图、
   * 用户自己下的图、从资源库搬来的图」都走同一条入库路。入库流水线（写 `assets/`、素材表声明与描述、
   * 台账、原片留底）在包内 `registerAsset`，与插件共用一份；这里只接本层的 IO。
   */
  async register(
    source: string,
    location: AssetLocation,
    extra: { description?: string; prompt?: string; original?: string } = {},
  ): Promise<GeneratedPlayAsset> {
    const spec = await this.resolve(location);
    const image = await this.readSource(source, "source");
    const original = extra.original?.trim() ? await this.readSource(extra.original.trim(), "original") : undefined;
    // 立绘在入库前归一化：模型可能跳过了 `cut` 直接登记草稿原片（那就是一张绿底图），
    // 也可能登记的是一张已经抠好底的 PNG——两种输入都由 `normalizeSprite` 收成同一种画布。
    const prepared = spec.kind === "sprite" ? await this.normalizeSprite(spec.framing, image.bytes) : null;
    const keptOriginal = original ?? (prepared?.keyed ? image : undefined);
    const registered = await registerAsset(
      {
        playDir: this.deps.store.dir,
        assets: this.assetIo(),
        updateManifest: (mutate) => this.withManifest("workshop", mutate),
        recordLedger: (entry) => this.saveLedger(entry),
      },
      prepared ? { ...spec, figureTop: prepared.figureTop, figureHeight: prepared.figureHeight } : spec,
      {
        image: prepared ? { bytes: prepared.data, ext: ".png" } : image,
        ...(keptOriginal ? { original: keptOriginal } : {}),
        ...(extra.description ? { description: extra.description } : {}),
        ...(extra.prompt ? { prompt: extra.prompt } : {}),
      },
    );
    return {
      kind: spec.kind,
      path: registered.rel,
      url: `/plays/${this.playId}/${registered.rel}`,
      replaced: registered.replaced,
      autoNeutral: false,
      ...(registered.sourceRel ? { sourcePath: registered.sourceRel } : {}),
      // 立绘这一刀是入库顺手做的（可能真抠了底、也可能只是重排画布），回执要说清结果，
      // 否则「登记完头顶偏了」只能靠肉眼在舞台上发现。
      ...(prepared
        ? { cutout: { coverage: prepared.coverage ?? 0, figureTop: prepared.figureTop, figureHeight: prepared.figureHeight } }
        : {}),
    };
  }

  /** 剧目内相对路径 → 静态服务 URL（回执里给模型看图用）。 */
  urlOf(rel: string): string {
    return `/plays/${this.playId}/${rel}`;
  }

  /**
   * 标注：给**已经入库**的素材补 / 改元数据（`asset.annotate`）。
   *
   * 与出图无关：图片类的元数据可以在登记时一次给全，这个口子负责事后改，也是 BGM 唯一的元数据出口
   *（曲子没有登记那一步，生成只落一条来源标记）。素材必须**真的在**——写一条指向空气的元数据，
   * 素材页与剧作家都会照着它找不存在的文件。
   */
  async annotate(
    subject: AssetSubject,
    patch: AssetMetaPatch,
  ): Promise<{ path: string; url: string }> {
    // 配乐归 `PlayMusic`（曲子有自己的落盘与清旧扩展名），本层只认三类图。
    if (subject.kind === "bgm") throw new Error("配乐的元数据走 PlayMusic.annotate：图片与音频两个落盘面不混。");
    const found = await this.locate(subject);
    if (!found) {
      throw new Error(`剧目里没有这份素材：${subject.spriteId ? `${subject.spriteId}/${subject.variant ?? NEUTRAL}` : subject.name}（先出图 / 出曲或导入，再标注）`);
    }
    await this.withManifest("workshop", (current) => declareMeta(current, found.key, patch));
    return { path: found.path, url: `/plays/${this.playId}/${found.path}` };
  }

  /** 按主体找那一份素材：立绘找 `<主体>/<差分>.png`，其余按 stem 找任意扩展名的文件。 */
  private async locate(subject: AssetSubject): Promise<{ key: string; path: string } | null> {
    const dir = subject.kind === "sprite" ? `sprites/${subject.spriteId}` : subject.kind === "cg" ? "cg" : "backgrounds";
    const stem = subject.kind === "sprite" ? (subject.variant ?? NEUTRAL) : subject.name!;
    const abs = this.deps.files.absoluteOf(`assets/${dir}`);
    if (!existsSync(abs)) return null;
    const wanted = await readdir(abs);
    const file = existingAssetName(wanted, stem);
    if (!file) return null;
    return { key: subject.kind === "sprite" ? `${subject.spriteId}/${stem}` : stem, path: `assets/${dir}/${file}` };
  }

  /**
   * 抠底：把一张纯色底图变成透明 PNG。源两种寻址，与 `image.cutout` 对齐：
   *
   * - **已入库立绘**（`assets/sprites/<主体id>/<差分>.png`）：拿它的抠底前原片重跑；不给 `output` 就**原地重抠**
   *   （覆盖素材那张、顺带补素材表声明）；给了 `output` 就写到那儿。
   * - **草稿或其它剧目内路径**：读那张图（透明 PNG 写到哪里请显式给 `output`）。
   *   输出落在 `assets/sprites/` 下时这一刀就是**立绘入库前的抠底**，画幅与落位指标都按立绘办。
   */
  async cut(request: {
    source?: string;
    target?: AssetRefParts;
    output?: string;
    tuning?: Partial<CutoutTuning>;
  }): Promise<GeneratedPlayAsset & { absPath: string }> {
    const output = request.output?.trim();

    if (request.target) {
      if (request.target.kind !== "sprite") throw new Error("只有立绘需要抠底（请给 assets/sprites/<主体id>/<差分>.png）");
      const spec = await this.resolve({
        kind: "sprite",
        spriteId: request.target.spriteId ?? request.target.name,
        variant: request.target.variant ?? "neutral",
      });
      const source = await this.readSpriteSource(spec);
      // 不给 output 就是**原地重抠**：落位、清旧扩展名、两格指标都由统一写口做完。
      const ingested = await ingestSprite(
        { store: this.deps.store, files: this.deps.files },
        {
          spriteId: spec.spriteId!,
          variant: spec.stem,
          bytes: source,
          framing: spec.framing,
          tuning: request.tuning,
        },
      );
      const cutoutInfo = { coverage: ingested.coverage, figureTop: ingested.figureTop, figureHeight: ingested.figureHeight };
      if (!output) {
        return {
          kind: "sprite",
          path: ingested.path,
          url: this.urlOf(ingested.path),
          replaced: ingested.replaced,
          autoNeutral: false,
          absPath: this.deps.files.absoluteOf(ingested.path),
          cutout: cutoutInfo,
        };
      }
      // 给了 output：输出落在别的立绘目录上就按**那个主体**再入库一次（同一张图、同一套不变量）；
      // 落到非立绘路径才按普通二进制写。**不许有第二条直写 assets/sprites/ 的路**。
      const written = await this.writeCutOutput(output, spec.spriteId!, source, request.tuning);
      return { ...written, cutout: cutoutInfo };
    }

    const source = request.source?.trim();
    if (!source) throw new Error("抠底要 source（一张纯色底图或已入库立绘的剧目内相对路径）");
    if (!output) throw new Error("抠底要 output（本宿主没有候选区：透明 PNG 写到哪里请显式给一个 assets/ 下的路径）");
    // 落位以**写盘层规范化后**的路径为准：`./assets/…` 与 `assets/…` 写下去是同一个文件，
    // 认立绘身份也得照同一条规矩——只差个前缀就静默退回缺省画幅、指标也丢，是查不出来的那种错。
    const relOutput = relative(this.deps.files.root, this.deps.files.absoluteOf(output));
    const read = await this.readSource(source, "抠底的源图");
    // 输出落在立绘目录上时，这一刀就是**立绘入库前的抠底**：画幅跟这张图的出图意图走（草稿里记着取景），
    // 归一化、落位与两格指标都由统一写口做完——紧接着的 `import_asset` 只补描述。
    const written = await this.writeCutOutput(relOutput, undefined, read.bytes, request.tuning, source);
    return { ...written };
  }

  /**
   * 把抠底结果写到 `output`：**落点是不是立绘目录**决定了走哪条路。
   *
   * - 是（`assets/sprites/<主体>/<差分>.png`）→ 走统一入库（`ingestSprite`）：归一化、清同 stem 旧扩展名、
   *   两格指标进素材表。画幅优先按 `identity` 给的那位主体（原地重抠）；否则按这张图的出身
   *   （草稿里记的取景）→ 该立绘已有声明 → 缺省。**这是 `assets/sprites/` 下的唯一写路**。
   * - 不是（背景 / CG / 临时落点）→ 只写这一份二进制：那不是立绘，素材表里也没有它该占的位。
   */
  private async writeCutOutput(
    output: string,
    identity: string | undefined,
    bytes: Buffer,
    tuning?: Partial<CutoutTuning>,
    framingSource?: string,
  ): Promise<GeneratedPlayAsset & { absPath: string }> {
    const rel = relative(this.deps.files.root, this.deps.files.absoluteOf(output));
    const sprite = spriteRefOfPath(rel);
    if (sprite) {
      const framing = identity === sprite.spriteId
        ? spriteDeclarationOf(await this.deps.store.assetMeta(), sprite.spriteId, sprite.variant).framing
        : await this.cutFraming(framingSource ?? output, sprite);
      const ingested = await ingestSprite(
        { store: this.deps.store, files: this.deps.files },
        { spriteId: sprite.spriteId, variant: sprite.variant, bytes, framing, tuning },
      );
      return {
        kind: "sprite",
        path: ingested.path,
        url: this.urlOf(ingested.path),
        replaced: ingested.replaced,
        autoNeutral: false,
        absPath: this.deps.files.absoluteOf(ingested.path),
        cutout: { coverage: ingested.coverage, figureTop: ingested.figureTop, figureHeight: ingested.figureHeight },
      };
    }
    // 落到 `assets/sprites/` 却不是标准立绘落位的，在这一步就顶回来（见 `assertSpriteLanding`）：
    // 这一支是「非立绘」的写路，不能成为立绘目录的第二个写口。
    assertSpriteLanding(rel);
    const existed = existsSync(this.deps.files.absoluteOf(rel));
    const prepared = await this.normalizeSprite(undefined, bytes, tuning);
    const written = await this.deps.files.writeBinary(rel, prepared.data);
    return {
      kind: written.startsWith("assets/backgrounds/") ? "background" : written.startsWith("assets/cg/") ? "cg" : "sprite",
      path: written,
      url: this.urlOf(written),
      absPath: this.deps.files.absoluteOf(written),
      replaced: existed,
      autoNeutral: false,
      cutout: { coverage: prepared.coverage ?? 0, figureTop: prepared.figureTop, figureHeight: prepared.figureHeight },
    };
  }

  /**
   * **立绘归一化**：所有立绘写口共用这一步——纯色底原片先抠底，已经抠好的透明 PNG 直接重排画布，
   * 产出恒为「该取景的画布 + 固定顶留白 + 人物 95%」的透明 PNG 与两格落位指标。
   *
   * 画幅取调用方给的 `framing`（立绘入库时由 `resolve` 从 显式给 > 差分级 > 立绘级 > 缺省 解析出来），
   * 算法在 `@aivn/agent` 的 `prepareSprite`——抠底那条路与重排那条路共用同一段落画布代码。
   */
  private normalizeSprite(
    framing: SpriteFraming | undefined,
    bytes: Buffer,
    tuning?: Partial<CutoutTuning>,
  ): Promise<PreparedSprite> {
    return prepareSprite(bytes, { framing, tuning: resolveTuning(tuning) });
  }

  /**
   * 抠一张**还没入库**的立绘时画幅取哪一档：这张图的出身优先，其次该立绘已有的声明。
   *
   * 草稿里记着出图时的取景，是最权威的一手（工坊的候选落在 `media-cache/drafts/`，取景随提示词一起定的）；
   * 素材表那档给「对着 `assets/` 里一张现成的图重抠」用。两处都不认识才退回缺省（full = 9:16）。
   */
  private async cutFraming(source: string, ref: { spriteId: string; variant: string }): Promise<SpriteFraming> {
    const draftId = /^media-cache\/drafts\/([\w-]{1,64})\//.exec(source.trim().replace(/^\.\//, ""))?.[1];
    if (draftId) {
      const draft = await this.loadDraft(draftId).catch(() => null);
      if (draft?.framing) return draft.framing;
    }
    const declared = spriteDeclarationOf(await this.deps.store.assetMeta(), ref.spriteId, ref.variant);
    return declared.framing ?? DEFAULT_SPRITE_FRAMING;
  }

  /**
   * 读一张来源图。两种寻址：
   *
   * - 剧目内相对路径：走 `PlayFiles` 白名单（`assets/` 与生图草稿区 `media-cache/drafts/`）。
   * - http(s)：走带 SSRF 防护的下载器。
   */
  private async readSource(source: string, what: string): Promise<AssetSource> {
    const src = source.trim();
    if (src === "") throw new Error(`${what} 要给（剧目内相对路径 / http(s) 网址）`);

    let bytes: Buffer;
    if (/^https?:\/\//i.test(src)) {
      if (!this.deps.fetchImage) throw new Error("外部网络图下载未配置（fetchImage 缺失），无法读 URL 图片。");
      bytes = (await this.deps.fetchImage(src)).data;
    } else {
      const abs = this.deps.files.pathOf(src, "read");
      if (!existsSync(abs)) throw new Error(`${what} 找不到：${src}（剧目里没有这个文件）`);
      bytes = await readFile(abs);
    }
    const mime = sniffImageMime(bytes);
    if (!mime) throw new Error(`${what} 不是 png/jpeg/webp/gif 图片：${src}`);
    return { bytes, ext: extOf(mime) };
  }

  private loadDraft(draftId: string): Promise<DraftRecord> {
    return loadDraftFrom(this.deps.store.dir, draftId);
  }

  /** 入库留痕（best-effort）：草稿目录迟早会被清理，这一笔只为当下看得出「已经采用过」。 */
  private markCommitted(draftId: string, draft: DraftRecord): Promise<void> {
    return markCommittedIn(this.deps.store.dir, draftId, draft);
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
    const prepared = await this.normalizeSprite(spec.framing, await this.readSpriteSource(spec), tuning);
    // 重抠就是重新量一次头顶：素材表跟着更新，否则舞台还照旧值摆。
    await this.declareSprite({ ...spec, figureTop: prepared.figureTop, figureHeight: prepared.figureHeight }, "workshop");
    return {
      ...(await this.persist(spec, prepared.data, ".png")),
      autoNeutral: false,
      cutout: {
        coverage: prepared.coverage ?? 0,
        figureTop: prepared.figureTop,
        figureHeight: prepared.figureHeight,
      },
    };
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
          // 按素材类目取后端：背景 / CG / 立绘可以各走一个网关、模型与档位（见 imageConfigFor）。
          this.deps.backends[spec.kind].generate({
            prompt: fullPrompt,
            aspectRatio: spec.aspect,
            references,
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
    // **候选不抠底**（P5-c / D2）：抠底是显式的一步（`cut`），候选就是出图后端给的那张。
    // 原片照样收进草稿（留底是抠底参数唯一的后悔药，见 `recut`），入库时跟着搬进
    // media-cache/sprite-sources/。
    return this.writeDraft(spec, fullPrompt, { image: data, raw: data, mimeType });
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
    const draftId = newDraftId();
    const imageExt = spec.kind === "sprite" ? ".png" : extOf(bytes.mimeType);
    const sourceExt = spec.kind === "sprite" ? extOf(bytes.mimeType) : undefined;
    const plan: DraftPlan = {
      draftId,
      kind: spec.kind,
      ...(spec.kind === "sprite"
        ? {
            spriteId: spec.spriteId,
            variant: spec.variant,
            framing: spec.framing,
            stature: spec.stature,
          }
        : { name: spec.stem }),
      ...(spec.title ? { title: spec.title } : {}),
      aspect: spec.aspect,
      prompt,
      createdAt: new Date().toISOString(),
    };
    const drafted = await writeDraftTo(this.deps.store.dir, plan, {
      image: bytes.image,
      imageExt,
      ...(sourceExt ? { source: { data: bytes.raw, ext: sourceExt } } : {}),
    });
    return {
      draftId: drafted.draftId,
      kind: spec.kind,
      path: drafted.path,
      url: `/plays/${this.playId}/drafts/${drafted.draftId}/image${imageExt}`,
    };
  }

  /**
   * 素材写口：包里按 `list / write / remove` 三步编排落位，本层只接上 `PlayFiles`——
   * 「agent 的素材写都在白名单内」这条铁律仍然生效（包不绕过它）。
   */
  private assetIo(): AssetIo {
    return assetIoOf(this.deps.files);
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
    try {
      await keepSpriteSourceIn(this.deps.store.dir, spec, data, ext);
    } catch (error) {
      console.warn(
        `[aivn] 立绘 ${spec.spriteId}/${spec.stem} 的留底原片没写成（之后没法原地重抠）：` +
          `${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  /** 落盘 + 清掉同 stem 的旧扩展名。抠底输出恒为 PNG，扩展名变了旧的 .jpg 必须清掉。 */
  private async persist(spec: AssetSpec, bytes: Buffer, ext: string): Promise<Omit<GeneratedPlayAsset, "autoNeutral">> {
    const { rel, replaced } = await persistAsset(this.assetIo(), spec, bytes, ext);
    return {
      kind: spec.kind,
      path: rel,
      url: `/plays/${this.playId}/${rel}`,
      replaced,
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
    await this.saveLedger(ledgerEntryOf(spec, path, prompt, new Date().toISOString()));
  }

  /**
   * 台账写一条：图已经落盘了，为一条记账把一次成功的出图报成失败更糟——这里出声，
   * 图与 prompt 对不上时能查到。并发差分同时记账要走剧目锁，否则后写的会冲掉先写的记录。
   */
  private async saveLedger(entry: LedgerEntry): Promise<void> {
    try {
      await withPlayConfigLock(this.deps.store.dir, () => this.deps.store.saveLedgerEntry(entry));
    } catch (error) {
      console.warn(
        `[aivn] 出图 prompt 未记进 assets/generated.json（${entry.id}）: ${error instanceof Error ? error.message : String(error)}`,
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
   * 2. 剧目内相对路径（如 "assets/backgrounds/ref.png" 或 "media-cache/drafts/<id>/image.png"）；
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
      if (pathLike.startsWith("assets/") || pathLike.startsWith("media-cache/drafts/") || pathLike.startsWith("plays/")) {
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
    const keyColor = assertKeyColor(target.keyColor);
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
      ...(keyColor ? { keyColor } : {}),
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
        // 顺手补的这张定妆照跟本次调用同一个底色：底色是**主体级**的选择，差分只是跟着垫图走。
        ...(spec.keyColor ? { keyColor: spec.keyColor } : {}),
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
   * `image.reference` 是逐类目的开关（背景 / CG / 立绘各可关），显式指定的参考图同样归它管，
   * 否则这个开关形同虚设。
   */
  private async referencesFor(spec: AssetSpec) {
    if (this.deps.reference[spec.kind] === "none") return [];
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
    edit: (current: AssetManifest) => AssetManifest | void,
  ): Promise<void> {
    return withPlayConfigLock(this.deps.store.dir, async () => {
      const raw = await this.deps.files.read("assets/manifest.json").catch(() => "");
      const next = edit(parseManifest(raw)) ?? parseManifest(raw);
      if (`${JSON.stringify(next, null, 2)}\n` === raw) return;
      await writeManifest(this.deps.files, next);
      this.deps.onWrite({ path: "assets/manifest.json" }, notify);
    });
  }

  /**
   * 出图后把呈现声明补进素材表：文件在盘上但没人声明取景与体量时，
   * 舞台只能拿缺省档去套——一张半身图会被按全身摆位，机甲会被画成一人高。
   *
   * 并表规则（立绘级取景以 neutral 为准、差分级只写不同那一档、描述一个字不动）在
   * `@aivn/agent` 的 `media/catalog.ts`，与插件共用一份。
   */
  private declareSprite(spec: AssetSpec, notify: AssetNotify): Promise<void> {
    return this.withManifest(notify, (current) => declareSpriteIn(current, spec));
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
    return this.withManifest(notify, (current) => {
      const meta = assetMetaOf(current, key) as Record<string, unknown>;
      for (const [field, value] of Object.entries(patch)) {
        if (value === null || value === "") delete meta[field];
        else if (value !== undefined) meta[field] = value;
      }
      const next: AssetManifest = { ...current };
      if (Object.keys(meta).length === 0) delete next[key];
      else next[key] = meta as AssetManifest[string];
      return next;
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

/**
 * 后缀的调度：背景 / CG 按「垫图是不是全为具名角色」二选一，立绘一律走包内的 `spriteSuffix`。
 *
 * 提示词正文（画风、色键底、留白、身份锁、序号锚点）全在 `@aivn/agent` 的 `media/prompt.ts` 里，
 * 与 DSH 插件共用一份；这里只负责把本层的 `AssetSpec` 翻译成那几个原语。
 */
function suffixFor(spec: AssetSpec, prompt: string, sentReferences: number): string {
  if (spec.kind !== "sprite") {
    if (sentReferences <= 0) return prompt;
    // 如果全部为具名角色
    if (spec.referenceSprites?.length && spec.referenceSprites.length === sentReferences) {
      return `${prompt}. ${referenceSuffix(spec.referenceSprites.map((c) => c.name))}`;
    }
    // 包含通用参考图或混合参考
    return `${prompt}. ${genericReferenceSuffix((spec.explicitReferences ?? []).map((r) => r.name ?? null))}`;
  }
  // 定妆照与差分走同一个出口：抠底底色、画风、不留杂物这几条必须两条分支一致，
  // 分开写就一定会漂。
  return `${prompt}. ${spriteSuffix(spec.framing, spec.variant === NEUTRAL, sentReferences, spec.keyColor)}`;
}
