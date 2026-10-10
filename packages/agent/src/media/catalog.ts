/**
 * 素材落库与记账的**规则层**（两个宿主共用一份）：落位路径、旧扩展名清理、素材表声明、出图台账。
 *
 * 只放规则不放 IO：写盘、加锁、推刷新信号都是宿主的事（服务端的 `PlayFiles` 是权限边界，
 * 插件的锁挂在模块级的 `withFileLock` 上）。这里全是纯函数，两个宿主各自的 read-modify-write
 * 里调用它们。
 */
import { mkdir, readdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { AssetMeta, SpriteFraming, SpriteStature } from "@aivn/core";
import type { AssetMetaPatch } from "../capabilities/asset/meta.js";

/** 素材类目：背景、事件插图、立绘。 */
export type AssetKind = "background" | "cg" | "sprite";
/** 台账的键按类目多一位音乐。 */
export type LedgerKind = AssetKind | "bgm";
/** 立绘定妆照的差分名（所有差分的垫图基准）。 */
export const NEUTRAL = "neutral";

/** 素材表 `assets/manifest.json`：值是元数据对象；旧格式里直接写一句说明的字符串也收。 */
export type AssetManifest = Record<string, AssetMeta | string>;

/**
 * 规则层要的那几个字段。
 *
 * 刻意不叫 `AssetSpec`：两个宿主的规格各自有别的字段（服务端带解析后的垫图列表，
 * 插件带 `absPath`），结构上满足这里就够——包不认识宿主规格的全貌。
 */
export interface AssetRef {
  kind: AssetKind;
  /** `assets/` 下的目录：`backgrounds` / `cg` / `sprites/<spriteId>`。 */
  kindPath: string;
  /** 文件名主体（立绘是差分名）。 */
  stem: string;
  spriteId?: string;
  variant?: string;
  framing?: SpriteFraming;
  stature?: SpriteStature;
  /** 归一化头顶留白（画布高 1920 的像素数，抠图产物）：舞台据此把头顶钉回 preset 的位置。 */
  figureTop?: number;
  /** 人物实际像素高（抠图产物；宽度先卡时小于画布高）。 */
  figureHeight?: number;
  /** 立绘级标题（无卡主体靠它出名牌）。 */
  title?: string;
}

/** `assets/generated.json` 的一条：这张图当初用什么描述生成、落在哪。 */
export interface LedgerEntry {
  /** 素材 id：背景 / CG 用文件名主体，立绘用 `<主体id>/<差分名>`。 */
  id: string;
  kind: LedgerKind;
  /** 剧目内相对路径。文件是权威：图没了这条记录就不算数。 */
  path: string;
  /** 实际发给模型的 prompt 原文（含引擎拼的画风与构图后缀），原样留档。 */
  prompt: string;
  /** 记账时刻（ISO）。 */
  at: string;
  model?: string;
}

/** 素材落位的剧目内相对路径（`assets/<kindPath>/<stem><ext>`）。 */
export function assetRel(spec: AssetRef, ext: string): string {
  return `assets/${spec.kindPath}/${spec.stem}${ext}`;
}

/** 抠底前原片的留底路径；非立绘给 null（背景 / CG 没有原片这回事）。 */
export function spriteSourceRel(spec: AssetRef, ext: string): string | null {
  if (!spec.spriteId) return null;
  return `media-cache/sprite-sources/${spec.spriteId}/${spec.stem}${ext}`;
}

/**
 * 同一个 stem 下**该清掉**的旧文件名。
 *
 * 换个生图后端，同一张图可能从 `.jpg` 变成 `.png`：留着旧的那份，素材页会看见两张、
 * 垫图会一直命中先找到的那张。所以写新文件时把同 stem 的其它扩展名一并删掉。
 */
export function staleSiblings(entries: readonly string[], stem: string, keep: string): string[] {
  return entries.filter((entry) => entry !== keep && entry.replace(/\.\w+$/, "") === stem);
}

/**
 * 素材表里某个键的元数据副本。
 *
 * 旧格式 `{id: "一句说明"}` 与元数据对象两种都收——表是给人读也给人写的，
 * 字符串等价于只有 `description` 的元数据。**不做字段过滤**：表里有的字段一个都不能丢。
 */
export function assetMetaOf(manifest: AssetManifest, key: string): AssetMeta {
  const value: AssetMeta | string | undefined = manifest[key];
  if (value && typeof value === "object") return { ...value };
  return typeof value === "string" ? { description: value } : {};
}

/**
 * 出图后把呈现声明补进素材表：只写它知道的那几格。
 *
 * 立绘级取景以**定妆照**那一次为准：它是所有差分的垫图基准，一条 closeup 不该把基准带跑；
 * 差分与基准不同才写一条差分级覆盖（与基准一致时留空表，文件才读得下去）。
 * `title` 是无卡主体的名牌（名牌回落链的第三档）。**描述一个字不动**——那是工坊与用户的账。
 *
 * `figureTop` / `figureHeight` 是抠图量出来的落位指标，逐文件：neutral 那次落立绘级，
 * 非 neutral 另写一条差分级覆盖（同一主体换个表情，外框不一样，头顶位置就不一样）。
 */
export function declareSprite(manifest: AssetManifest, spec: AssetRef): AssetManifest {
  if (!spec.spriteId) return manifest;
  const key = spec.spriteId;
  const level = assetMetaOf(manifest, key);
  const neutral = spec.variant === NEUTRAL;
  const next: AssetManifest = {
    ...manifest,
    [key]: {
      ...level,
      ...(spec.title ? { title: spec.title } : {}),
      ...(neutral && spec.framing ? { framing: spec.framing } : {}),
      ...(neutral && spec.stature ? { stature: spec.stature } : {}),
      ...(neutral && spec.figureTop !== undefined ? { figureTop: spec.figureTop } : {}),
      ...(neutral && spec.figureHeight !== undefined ? { figureHeight: spec.figureHeight } : {}),
    },
  };
  // 指标是**逐文件**的（同一主体各差分的 alpha 外框不同），所以非 neutral 一律留一条差分级：
  // 取景只在真的与立绘级不同时才写（原有的口径），指标照实写、不拿立绘级的数冒充。
  if (!neutral && spec.variant) {
    const variantKey = `${spec.spriteId}/${spec.variant}`;
    const override = { ...assetMetaOf(next, variantKey) };
    if (spec.framing && spec.framing !== level.framing) override.framing = spec.framing;
    if (spec.figureTop !== undefined) override.figureTop = spec.figureTop;
    if (spec.figureHeight !== undefined) override.figureHeight = spec.figureHeight;
    next[variantKey] = override;
  }
  return next;
}

/** 素材表的键：立绘落到 `<主体id>/<差分>`，背景 / 插图 / BGM 落到文件主体名。 */
export function assetMetaKey(stem: string, subject?: { spriteId?: string; variant?: string }): string {
  return subject?.spriteId && subject.variant ? `${subject.spriteId}/${subject.variant}` : stem;
}

/**
 * 把一段元数据并进素材表（只并给出的那几格，其余原样保留）。
 *
 * 元数据的写口只有这一个：登记 / 宏（落成那一步）与 `asset.annotate`（事后改）都从这里走。
 */
export function declareMeta(manifest: AssetManifest, key: string, patch: AssetMetaPatch): AssetManifest {
  if (Object.keys(patch).length === 0) return manifest;
  return { ...manifest, [key]: { ...assetMetaOf(manifest, key), ...patch } };
}

/** 素材表里的一句话画面描述：剧作家挑素材全靠它。立绘落到 `<主体>/<差分>` 键上。 */
export function declareDescription(manifest: AssetManifest, spec: AssetRef, description: string): AssetManifest {
  return declareMeta(manifest, assetMetaKey(spec.stem, spec), { description });
}

/** BGM 的素材表来源标记（曲子没有立绘那套呈现声明，只记一条「哪来的」）。 */
export function declareBgmSource(manifest: AssetManifest, stem: string): AssetManifest {
  return { ...manifest, [stem]: { ...assetMetaOf(manifest, stem), source: "AI 生成（本插件）" } };
}

/**
 * `assets/` 下那一步 IO 的口子：宿主的权限边界与原子写在实现里。
 *
 * 服务端实现落到 `PlayFiles`（agent 的写权限面就收在那里），插件实现落到 `writeAtomic`
 * 与模块级的文件锁；包只按这几步编排。
 */
export interface AssetIo {
  /** `assets/<kindPath>/` 下的文件名（覆盖判定与清旧扩展名用）。 */
  list(kindPath: string): Promise<string[]>;
  /** 写一张素材（剧目内相对路径）。 */
  write(rel: string, data: Buffer): Promise<void>;
  /** 删一张素材（换扩展名时清旧图）。 */
  remove(rel: string): Promise<void>;
}

/** 同一 stem 下已有的素材文件名（任一扩展名）；没有则 null。 */
export function existingAssetName(entries: readonly string[], stem: string): string | null {
  return entries.find((entry) => entry.replace(/\.\w+$/, "") === stem) ?? null;
}

/**
 * 把一份字节写进 `assets/`：写新的、删同 stem 的旧扩展名，返回落位与「此前已有」。
 *
 * `replaced` 是给人看的：目标此前已有素材（可能是用户导入的）时，覆盖这件事要说出来。
 */
export async function persistAsset(
  io: AssetIo,
  spec: AssetRef,
  bytes: Buffer,
  ext: string,
): Promise<{ rel: string; replaced: boolean }> {
  const entries = await io.list(spec.kindPath);
  const previous = existingAssetName(entries, spec.stem);
  const rel = assetRel(spec, ext);
  await io.write(rel, bytes);
  for (const stale of staleSiblings(entries, spec.stem, `${spec.stem}${ext}`)) {
    await io.remove(`assets/${spec.kindPath}/${stale}`);
  }
  return { rel, replaced: previous !== null };
}

/**
 * 抠底前原片留一份到 `media-cache/sprite-sources/`：抠底参数唯一的后悔药。
 *
 * 透明 PNG 一落盘底色就没了，之后想改抠底只剩「重新出图」——而重新出图出来的是另一张画。
 * 留底是跑批产物（不进 git）：换机器后老图没法重抠，这是有意的取舍。
 * 返回剧目内相对路径；背景 / CG 没有原片这回事，返回 null。
 */
export async function keepSpriteSource(
  playDir: string,
  spec: AssetRef,
  data: Buffer,
  ext: string,
): Promise<string | null> {
  const rel = spriteSourceRel(spec, ext);
  if (!rel) return null;
  const dir = join(playDir, "media-cache", "sprite-sources", spec.spriteId!);
  await mkdir(dir, { recursive: true });
  const entries = await readdir(dir).catch(() => [] as string[]);
  for (const stale of staleSiblings(entries, spec.stem, `${spec.stem}${ext}`)) {
    await rm(join(dir, stale), { force: true });
  }
  await writeFile(join(dir, `${spec.stem}${ext}`), data);
  return rel;
}

/** 台账的键：与提示词查表一致——背景 / CG 用文件名主体，立绘用 `<主体id>/<差分名>`。 */
export function ledgerIdOf(spec: AssetRef): string {
  return spec.kind === "sprite" ? `${spec.spriteId}/${spec.variant}` : spec.stem;
}

/** 台账条目：条目自己带 id，`prompt` 是这张图实际发出去的那份原文。 */
export function ledgerEntryOf(spec: AssetRef, path: string, prompt: string, at: string): LedgerEntry {
  return { id: ledgerIdOf(spec), kind: spec.kind, path, prompt, at };
}
