import { existsSync } from "node:fs";
import { readFile, readdir } from "node:fs/promises";
import { parsePlayConfig } from "@stage-ai/core";
import { aspectMatches, extOf, sizeOfImage, type ImageAspect, type ImageBackend } from "./imageBackend.js";
import { cutout } from "./cutout.js";
import type { Limiter } from "./limiter.js";
import type { PlayFiles } from "./playFiles.js";
import type { PlayStore } from "./store.js";
import type { WorkshopWrite } from "./workshop.js";

/**
 * 剧目素材生成层：工坊 `generate_asset` 的落盘实现。
 *
 * 与 D6 的 `ImageAssets` 分工明确——
 * - `ImageAssets` 落 media-cache/，内容寻址缓存，playwriter 预发射用，运行时不进 git；
 * - 本层落 `assets/`，进 git，是剧目定义的一部分，素材页看得见、用户能改能删。
 * 落静态素材还有个好处：playwriter 后续 `preload_asset` 同 id 会被「静态优先」跳过，
 * 不会把工坊定的图重生一遍。
 *
 * 角色一致性靠 `neutral` 差分兼任定妆照与垫图——它既是合法差分（actor 能直接引用），
 * 又是进 git 后换机器也保得住的「同一个人」。不另开 assets/refs/ 目录，免得污染素材清单。
 */

/** 立绘差分名 = 文件名主体，故用素材名的字符集；角色 id 不受此限（play.json 里可能叫 Koharu）。 */
const STEM = /^[a-z][a-z0-9_]{0,39}$/;

const NEUTRAL = "neutral";

/** 立绘身份锚：正脸站姿，差分都从它派生。竖构图提示词里也点明，配合 9:16 画布。 */
const NEUTRAL_SUFFIX =
  "full body, front-facing standing pose, neutral expression, plain solid pure white background, " +
  "no text, no shadow, no gradient, vertical portrait composition.";
/** 差分：只改表情，身份特征一律锁死——垫图之外的第二道保险。 */
const IDENTITY_SUFFIX =
  "Same character as the reference image: identical hairstyle, hair color, eye color, outfit and body type. " +
  "Change only the facial expression. Plain solid pure white background, no text, no shadow, no gradient.";

export type AssetKind = "background" | "cg" | "sprite";

export interface AssetTarget {
  kind: AssetKind;
  /** 背景/CG 的素材 id（同时是文件名主体）。 */
  name?: string;
  /** 立绘所属角色 id（对 play.json 角色做成员校验，不用正则）。 */
  characterId?: string;
  /** 立绘差分名（neutral / smile / ...）。 */
  expression?: string;
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
}

export interface WorkshopAssetsDeps {
  store: PlayStore;
  files: PlayFiles;
  backend: ImageBackend;
  limiter: Limiter;
  /** play.json 立绘映射补写要进撤销条（二进制本身不进）。 */
  onWrite: (write: WorkshopWrite) => void;
}

export class WorkshopAssets {
  /** 同一目标的在飞生成：同批次两次调用打同一路径会烧两份配额、竞态写、覆盖标记说不清。 */
  private readonly inflight = new Map<string, Promise<GeneratedPlayAsset[]>>();

  constructor(
    private readonly playId: string,
    private readonly deps: WorkshopAssetsDeps,
  ) {}

  async generate(target: AssetTarget, prompt: string, style?: string): Promise<GeneratedPlayAsset[]> {
    const spec = await this.resolve(target);
    const key = `${spec.kindPath}/${spec.stem}`;
    const running = this.inflight.get(key);
    if (running) return running;
    const job = this.run(spec, prompt, style).finally(() => {
      if (this.inflight.get(key) === job) this.inflight.delete(key);
    });
    this.inflight.set(key, job);
    return job;
  }

  /** 返回的数组可能第一项是自动补的定妆照——那是真金白银出的图，必须一起交给上层广播。 */
  private async run(spec: AssetSpec, prompt: string, style?: string): Promise<GeneratedPlayAsset[]> {
    const auto = spec.kind === "sprite" ? await this.ensureNeutral(spec, prompt) : null;
    const references = await this.referencesFor(spec);
    const { data, mimeType } = await this.deps.limiter.run(
      () =>
        this.deps.backend.generate({
          prompt: suffixFor(spec, style ? `${style}, ${prompt}` : prompt),
          aspectRatio: spec.aspect,
          references,
        }),
      "normal",
    );
    this.assertCanvas(spec, data);
    const bytes = spec.kind === "sprite" ? (await cutout(data)).data : data;
    const ext = spec.kind === "sprite" ? ".png" : extOf(mimeType);
    const written = await this.persist(spec, bytes, ext);
    if (spec.kind === "sprite") await this.mapSprite(spec, `${spec.stem}${ext}`);
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
        "换个生图后端或模型名（STAGE_IMAGE_BACKEND / STAGE_FLOW_MODEL）再试——" +
        "画幅不符的图落进素材只会在演出时崩。",
    );
  }

  /**
   * 校验目标：素材名走文件名白名单，角色 id 走 play.json 成员校验。
   * 角色 id 不做正则——`parsePlayConfig` 不约束它的大小写，`Koharu` 这类 id 完全合法。
   */
  private async resolve(target: AssetTarget): Promise<AssetSpec> {
    if (target.kind === "sprite") return this.resolveSprite(target);
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

  private async resolveSprite(target: AssetTarget): Promise<AssetSpec> {
    const characterId = target.characterId?.trim() ?? "";
    if (!characterId) throw new Error("立绘必须给 characterId（play.json 里的角色 id）");
    const play = await this.deps.store.loadPlay();
    const ids = play.characters.map((c) => c.id);
    if (!ids.includes(characterId)) {
      throw new Error(`play.json 里没有角色「${characterId}」。可选：${ids.join(" / ")}`);
    }
    const expression = target.expression?.trim() ?? "";
    if (!expression) throw new Error("立绘必须给 expression（差分名，如 neutral / smile）");
    if (!STEM.test(expression)) {
      throw new Error(`差分名「${expression}」非法：只允许小写字母开头的 a-z/数字/下划线，最长 40 字符`);
    }
    return {
      kind: "sprite",
      kindPath: `sprites/${characterId}`,
      stem: expression,
      aspect: "9:16",
      characterId,
      expression,
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
  private async ensureNeutral(spec: AssetSpec, prompt: string): Promise<GeneratedPlayAsset | null> {
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
    );
    return auto ?? null;
  }

  private async referencesFor(spec: AssetSpec) {
    if (spec.kind !== "sprite" || spec.expression === NEUTRAL) return [];
    const neutral = await this.existingPath(spec.kindPath, NEUTRAL);
    if (!neutral) return [];
    const data = await readFile(this.deps.files.absoluteOf(neutral));
    return [{ mimeType: sniffMime(data), data }];
  }

  /**
   * 立绘映射补写：文件在盘上但 play.json 没映射，playwriter 与编排器都取不到，等于没生成。
   *
   * 排队锁不可省：一次对话里模型可以并发调两次 generate_asset，两个 read-modify-write
   * 各自读到旧 play.json，后写的会把先写的差分映射整个冲掉（用户看到的现象是「刚出的表情
   * 在角色卡里消失了」）。
   */
  private playJsonWrites: Promise<unknown> = Promise.resolve();

  private mapSprite(spec: AssetSpec, file: string): Promise<void> {
    const task = this.playJsonWrites.then(async () => {
      const raw = await this.deps.files.read("play.json");
      const config = parsePlayConfig(JSON.parse(raw));
      const character = config.characters.find((c) => c.id === spec.characterId);
      if (!character) return;
      const next = { ...character, sprites: { ...(character.sprites ?? {}), [spec.expression!]: file } };
      const content = JSON.stringify(
        { ...config, characters: config.characters.map((c) => (c.id === spec.characterId ? next : c)) },
        null,
        2,
      );
      await this.deps.files.write("play.json", content);
      this.deps.onWrite({ path: "play.json", before: raw, after: content });
    });
    // 队列本身不该把失败传染给后续的排队者，但调用方要看见自己这次写失败
    this.playJsonWrites = task.catch(() => {});
    return task;
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
