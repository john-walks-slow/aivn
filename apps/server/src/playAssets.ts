import { existsSync } from "node:fs";
import { readFile, readdir } from "node:fs/promises";
import { parsePlayConfig, type WorkshopAssetView } from "@stage-ai/core";
import { aspectMatches, extOf, sizeOfImage, type ImageAspect, type ImageBackend } from "./imageBackend.js";
import { cutout, resolveTuning, type CutoutTuning } from "./cutout.js";
import type { Limiter } from "./limiter.js";
import { jobIdForImage, type PendingJobs } from "./pendingJobs.js";
import type { PlayFiles } from "./playFiles.js";
import type { PlayStore } from "./store.js";
import { withPlayConfigLock } from "./store.js";
import type { WorkshopWrite } from "./agentkit/deps.js";

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

/** 立绘差分名 = 文件名主体，故用素材名的字符集；角色 id 不受此限（play.json 里可能叫 Koharu）。 */
const STEM = /^[a-z][a-z0-9_]{0,39}$/;

/** 自动注册的临时角色 id：它会成为 play.json 条目与 assets/sprites/ 目录名，与 write_memory 同一套白名单。 */
const CHAR_ID = /^[A-Za-z][A-Za-z0-9_-]{0,39}$/;

const NEUTRAL = "neutral";

/** 谁触发的这次出图。工坊要撤销条与素材气泡，剧作家在拍内预发射一样都不产。 */
export type AssetNotify = "workshop" | "silent";

export type AssetKind = "background" | "cg" | "sprite";

export interface AssetTarget {
  kind: AssetKind;
  /** 背景/CG 的素材 id（同时是文件名主体）。 */
  name?: string;
  /** 立绘所属角色 id（默认对 play.json 角色做成员校验）。 */
  characterId?: string;
  /** 立绘差分名（neutral / smile / ...）。 */
  expression?: string;
}

export interface GenerateOptions {
  /** 事件去向：工坊要撤销条与素材气泡，剧作家的后台预发射一律静默。 */
  notify?: AssetNotify;
  /**
   * 角色不在 play.json 时自动注册一个 stub（剧作家的临时角色生图）。
   * 给了就建，不给仍按成员校验报错——工坊侧的角色表是用户与工坊的账，不该被一次出图悄悄塞进陌生人。
   */
  characterName?: string;
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

interface AssetSpec {
  kind: AssetKind;
  /** assets/ 下的目录：backgrounds | cg | sprites/<charId>。 */
  kindPath: string;
  stem: string;
  aspect: ImageAspect;
  characterId?: string;
  expression?: string;
  /** 角色不在 play.json 时自动补的 stub（null = 不自动注册，缺失即报错）。 */
  stubName?: string;
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
  /** play.json 立绘映射补写要进撤销条（二进制本身不进）。 */
  onWrite: (write: WorkshopWrite, notify: AssetNotify) => void;
  /** 素材到货（工坊侧挂到对话气泡里）。 */
  onAsset?: (asset: WorkshopAssetView, replaced: boolean, notify: AssetNotify) => void;
  /**
   * play.json 被这一层改过（补写差分映射 / 注册临时角色 stub）：宿主据此决定要不要重建 runtime。
   * 工坊侧一轮收束时自己会重建，这里收到 "workshop" 无需动作；剧作家侧在拍内不能腰斩演出，
   * 收到 "silent" 得排到轮边界。
   */
  onPlayConfigChanged?: (notify: AssetNotify) => void;
}

export class PlayAssets {
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
    cutoutTuning?: Partial<CutoutTuning>,
    options?: GenerateOptions,
  ): Promise<GeneratedPlayAsset[]> {
    const notify = options?.notify ?? "workshop";
    const spec = await this.resolve(target, notify, options?.characterName);
    const key = `${spec.kindPath}/${spec.stem}`;
    const running = this.inflight.get(key);
    if (running) return running;
    const job = this.run(spec, prompt, style, cutoutTuning, notify).finally(() => {
      if (this.inflight.get(key) === job) this.inflight.delete(key);
    });
    this.inflight.set(key, job);
    return job;
  }

  /** 目标是否已有图（工坊/剧作家跳过重复出图用）。 */
  async exists(target: AssetTarget): Promise<boolean> {
    if (target.kind === "sprite") {
      if (!target.characterId || !target.expression) return false;
      return (await this.existingPath(`sprites/${target.characterId}`, target.expression)) !== null;
    }
    if (!target.name) return false;
    return (await this.existingPath(target.kind === "background" ? "backgrounds" : "cg", target.name)) !== null;
  }

  /** 返回的数组可能第一项是自动补的定妆照——那是真金白银出的图，必须一起交给上层广播。 */
  private async run(
    spec: AssetSpec,
    prompt: string,
    style?: string,
    cutoutTuning?: Partial<CutoutTuning>,
    notify: AssetNotify = "workshop",
  ): Promise<GeneratedPlayAsset[]> {
    const auto = spec.kind === "sprite" ? await this.ensureNeutral(spec, prompt, notify) : null;
    const references = await this.referencesFor(spec);
    const fullPrompt = suffixFor(spec, style ? `${style}, ${prompt}` : prompt);
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
          }),
        "normal",
      ));
    } finally {
      done?.();
    }
    this.assertCanvas(spec, data);
    const tuning = resolveTuning(cutoutTuning);
    const bytes = spec.kind === "sprite" ? (await cutout(data, tuning)).data : data;
    const ext = spec.kind === "sprite" ? ".png" : extOf(mimeType);
    const written = await this.persist(spec, bytes, ext);
    if (spec.kind === "sprite") await this.mapSprite(spec, `${spec.stem}${ext}`, notify);
    await this.recordPrompt(spec, written.path, fullPrompt);
    return auto ? [auto, { ...written, autoNeutral: true }] : [{ ...written, autoNeutral: false }];
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
   * 校验目标：素材名走文件名白名单，角色 id 走 play.json 成员校验。
   * 角色 id 不做正则——`parsePlayConfig` 不约束它的大小写，`Koharu` 这类 id 完全合法。
   * 例外是「自动注册 stub」这条路：那时角色还不存在，id 会直接变成目录名，必须过白名单。
   */
  private async resolve(target: AssetTarget, notify: AssetNotify, characterName?: string): Promise<AssetSpec> {
    if (target.kind === "sprite") return this.resolveSprite(target, notify, characterName);
    const name = target.name?.trim() ?? "";
    if (!name) throw new Error("背景/CG 必须给 name（素材 id，剧本里的 bg/cg id 就是它）");
    if (!STEM.test(name)) {
      throw new Error(`素材名「${name}」非法：只允许小写字母开头的 a-z/数字/下划线，最长 40 字符`);
    }
    return {
      kind: target.kind,
      kindPath: target.kind === "background" ? "backgrounds" : "cg",
      stem: name,
      aspect: "16:9",
    };
  }

  private async resolveSprite(
    target: AssetTarget,
    notify: AssetNotify,
    characterName?: string,
  ): Promise<AssetSpec> {
    const characterId = target.characterId?.trim() ?? "";
    if (!characterId) throw new Error("立绘必须给 characterId（play.json 里的角色 id）");
    const expression = target.expression?.trim() ?? "";
    if (!expression) throw new Error("立绘必须给 expression（差分名，如 neutral / smile）");
    if (!STEM.test(expression)) {
      throw new Error(`差分名「${expression}」非法：只允许小写字母开头的 a-z/数字/下划线，最长 40 字符`);
    }
    const play = await this.deps.store.loadPlay();
    const ids = play.characters.map((c) => c.id);
    let stubName: string | undefined;
    if (!ids.includes(characterId)) {
      // 自动注册只认「调用方明确给了显示名」的那条路：给不出名字就说明它不知道自己在给谁画，
      // 宁可报错让模型把 name 补上，也不要在角色表里落一个 id 当名字的条目。
      const name = characterName?.trim() ?? "";
      if (notify !== "silent" || !name) {
        throw new Error(`play.json 里没有角色「${characterId}」。可选：${ids.join(" / ")}`);
      }
      if (!CHAR_ID.test(characterId)) {
        throw new Error(
          `角色 id「${characterId}」不能自动注册：只允许字母开头的字母/数字/下划线/连字符，最长 40 字符`,
        );
      }
      stubName = name;
    }
    return {
      kind: "sprite",
      kindPath: `sprites/${characterId}`,
      stem: expression,
      aspect: "9:16",
      characterId,
      expression,
      ...(stubName ? { stubName } : {}),
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
    // 压一条前置的中性描述盖住表情词，角色外观描述留在后面。
    const [auto] = await this.generate(
      { kind: "sprite", characterId: spec.characterId, expression: NEUTRAL },
      `a calm neutral-expression front-facing standing portrait. ${prompt}`,
      undefined,
      undefined,
      { notify, ...(spec.stubName ? { characterName: spec.stubName } : {}) },
    );
    return auto ?? null;
  }

  /**
   * 垫图（参考图）。默认给（与 `config.image.reference` 的默认值一致）：差分靠它才是同一个人，
   * 代价是单张从 69s 变 138s（实测），像素一模一样。`STAGE_IMAGE_REFERENCE=none` 可以掐掉这条省钱。
   */
  private async referencesFor(spec: AssetSpec) {
    if (this.deps.reference === "none") return [];
    if (spec.kind !== "sprite" || spec.expression === NEUTRAL) return [];
    const neutral = await this.existingPath(spec.kindPath, NEUTRAL);
    if (!neutral) return [];
    const data = await readFile(this.deps.files.absoluteOf(neutral));
    return [{ mimeType: sniffMime(data), data }];
  }

  /**
   * 立绘映射补写：文件在盘上但 play.json 没映射，剧作家与编排器都取不到，等于没生成。
   * 临时角色（剧作家给的 stub）也在这一步一并注册进角色表。
   *
   * 排队锁不可省：一次对话里模型可以并发调两次 generate_image，也会和立绘包导入撞上，
   * 三个 read-modify-write 各自读到旧 play.json，后写的会把先写的差分映射整个冲掉
   * （用户看到的现象是「刚出的表情在角色卡里消失了」）。锁按剧目目录发（`store.dir`），
   * 与资源库导入共用同一条——两条路径改的是同一份 play.json。
   */
  private mapSprite(spec: AssetSpec, file: string, notify: AssetNotify): Promise<void> {
    return withPlayConfigLock(this.deps.store.dir, async () => {
      const raw = await this.deps.files.read("play.json");
      const config = parsePlayConfig(JSON.parse(raw));
      const existing = config.characters.find((c) => c.id === spec.characterId);
      if (!existing && !spec.stubName) return;
      const characters = existing
        ? config.characters
        : [...config.characters, { id: spec.characterId!, name: spec.stubName!, persona: "" }];
      const target = existing ?? characters[characters.length - 1]!;
      const next = { ...target, sprites: { ...(target.sprites ?? {}), [spec.expression!]: file } };
      const content = JSON.stringify(
        { ...config, characters: characters.map((c) => (c.id === spec.characterId ? next : c)) },
        null,
        2,
      );
      await this.deps.files.write("play.json", content);
      this.deps.onWrite({ path: "play.json", before: raw, after: content }, notify);
      this.deps.onPlayConfigChanged?.(notify);
    });
  }

  /** 同一 stem 下已有的图像（任一扩展名）：用于覆盖判定与清旧。 */
  private async existingPath(kindPath: string, stem: string): Promise<string | null> {
    for (const ext of [".jpg", ".jpeg", ".png", ".webp"]) {
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

function suffixFor(spec: AssetSpec, prompt: string): string {
  if (spec.kind !== "sprite") return prompt;
  return spec.expression === NEUTRAL ? `${prompt}, ${NEUTRAL_SUFFIX}` : `${prompt}. ${IDENTITY_SUFFIX}`;
}

/** 读回的文件头嗅探 mimeType（扩展名可能与实际字节不符，垫图塞错类型会被网关拒）。 */
function sniffMime(data: Buffer): string {
  if (data.length > 8 && data.subarray(1, 4).toString("latin1") === "PNG") return "image/png";
  if (data.length > 3 && data[0] === 0xff && data[1] === 0xd8 && data[2] === 0xff) return "image/jpeg";
  if (data.length > 12 && data.subarray(8, 12).toString("latin1") === "WEBP") return "image/webp";
  return "image/jpeg";
}

/**
 * 立绘身份锚：正脸站姿，差分都从它派生。竖构图提示词里也点明，配合 9:16 画布。
 *
 * 后半段不是修饰词是硬约束：`src/cutout.ts` 的全局色键抠底要求 2D 平涂 + 纯白纯色底，
 * 3D 渲染的白衣离底色只有几格色差，抠底会连人带和服一起啃掉；剪影连成一片就没法分割人物与底色。
 *
 * 后缀只规定构图，不描述任何人物特征——它每个词都会被当成设定印进图里。早先这里写的是
 * 「between the twin tails」（为了发梢与身体之间留纯白），等于给所有角色定了个双马尾：
 * 实测 prompt 里明写 pink long straight hair，出来的仍是双马尾。要什么发型由角色卡的锚点说。
 */
const NEUTRAL_SUFFIX =
  "full body, front-facing standing pose, neutral expression, both arms held slightly away from the body " +
  "so the silhouette is clearly separated, clear empty white space between the arms and the body and " +
  "between the hair and the arms. Japanese anime style 2D character illustration, flat cel shading with " +
  "clean crisp lineart, NOT a 3D render, no 3D CGI look. Plain solid pure white background, no text, no " +
  "shadow, no gradient, no vignette, vertical portrait composition.";
/** 差分：只改表情，身份特征一律锁死——垫图之外的第二道保险。画风要求与定妆照一字不差，否则两个人。 */
const IDENTITY_SUFFIX =
  "Same character as the reference image: identical hairstyle, hair color, eye color, outfit and body type. " +
  "Change only the facial expression. Same 2D flat cel-shaded anime illustration style, NOT a 3D render, " +
  "same plain solid pure white background, no text, no shadow, no gradient.";
