/**
 * 素材元数据契约（资源库与剧目共用同一份 schema）。
 *
 * 两处元数据：
 * - 资源库条目 `library/<kind>/<id>/meta.json`（用户手编，服务端只读）；
 * - 剧目素材表 `plays/<id>/assets/manifest.json`（键是素材 id = 文件名主体）。
 *
 * 描述字段是给剧作家看的：它认 id 认不出画面，「bg_01」到底是教室还是天台只能靠描述。
 * 所以「描述」比标题重要，标签/情绪/时长是让它**按情境选**的辅助。
 */

import { framingOf, type SpriteFraming } from "./framing.js";

/** 素材类别：characters 是角色包（角色卡 + 可选立绘），其余是单文件条目。 */
export const ASSET_KINDS = ["backgrounds", "cg", "characters", "bgm", "sfx"] as const;
export type AssetKind = (typeof ASSET_KINDS)[number];

/** 音频类别：带时长/情绪的那一类。 */
export const AUDIO_KINDS: ReadonlySet<string> = new Set(["bgm", "sfx"]);

/** 素材类别卫兵：REST 参数与目录名都走它，避免各处各写一份字符串比较。 */
export function isAssetKind(value: string): value is AssetKind {
  return (ASSET_KINDS as readonly string[]).includes(value);
}

/** 立绘差分条目。 */
export interface SpriteExpression {
  /** 差分文件名（条目录内相对路径）。 */
  file: string;
  description?: string;
  /** 这条差分的取景：条目级 framing 不够用时按差分覆盖（如一整套里另有一张 closeup）。 */
  framing?: SpriteFraming;
}

export interface AssetCharacter {
  name?: string;
  persona?: string;
  /** 台词风格描述（play.json 的 voice）。 */
  voice?: string;
  /** TTS 音色 id（play.json 的 voiceId）。 */
  voiceId?: string;
  /** 玩家扮演的角色：导入时落 play.json 的 protagonist 而不是 characters 数组。 */
  protagonist?: boolean;
}

export interface AssetMeta {
  title?: string;
  description?: string;
  tags?: string[];
  /** 出处与许可（CC0 / Kenney / AI 生成…）。 */
  source?: string;
  /** 音乐情绪词：忧伤、紧张、温暖。 */
  mood?: string[];
  /** 音乐适用场景：离别、战斗、日常。 */
  scene?: string[];
  /** 音频时长（秒）：剧作家据此判断循环长度与该不该换曲。 */
  durationSec?: number;
  /** 是否适合循环播放。 */
  loop?: boolean;
  /** 建议默认音量（0–1）。 */
  volume?: number;
  /** 角色包的角色卡原料：导入时按它建卡或更新同 id 的角色（protagonist 则落主角卡）。 */
  character?: AssetCharacter;
  /** 立绘差分表：表情名 → 文件与画面说明。 */
  expressions?: Record<string, SpriteExpression>;
  /** 角色包立绘的取景（导入时落 play.json 的角色卡，舞台按它套站位预设）。 */
  framing?: SpriteFraming;
}

/**
 * 站内生成的一张图（CG 页的台账）。与 WS 的 `GeneratedAsset` 只差 prompt：
 * 那个刻意不带 prompt（协议给的是画面，不是内部注解），CG 页是给人读的，
 * 「这张图当初是用什么描述生成的」正是它要看的东西。
 */
export interface GeneratedImageEntry {
  id: string;
  type: "bg" | "cg";
  url: string;
  /** 生图 prompt；老 manifest 条目可能没有。 */
  prompt?: string;
}

/** CG 页台账的一条：静态素材与站内生成的图共用这一个形态，靠 origin 区分。 */
export interface CgEntry {
  /** 素材 id = 文件名主体 = 剧本 `<cg id>` 的引用名。 */
  id: string;
  /** 图片 URL：静态走素材静态服务，生成的走生图产物静态服务。 */
  url: string;
  /** 素材（assets/cg，用户导入或工坊生成落盘）还是站内预发射生成的图。 */
  origin: "asset" | "generated";
  /** 生图 prompt：站内生成的图自带；被静态素材顶掉同名 id 时从那条记录里捡回来。 */
  prompt?: string;
  /** 素材表里的描述（assets/manifest.json）：静态素材才有。 */
  description?: string;
}

/** 资源库条目里的一个文件（预览与体积；URL 由各端按自己的路由拼）。 */
export interface LibraryFile {
  name: string;
  size: number;
}

export interface LibraryEntry {
  kind: AssetKind;
  /** 素材 id = 目录名；导入剧目后也是文件名主体，即剧本里的引用名。 */
  id: string;
  title: string;
  description: string;
  meta: AssetMeta;
  /** characters 可以是整套立绘（也可以一张图都没有——纯角色卡条目），其余类型是单文件。 */
  files: LibraryFile[];
  /** 全部分文件的字节和。 */
  size: number;
  /** 目录里说不通的地方（meta.json 坏了、单文件类别放了多个文件）——列出来给人看，不静默吞掉。 */
  warnings?: string[];
}

function text(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() !== "" ? value.trim() : undefined;
}

function textList(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const out = value.map((v) => text(v)).filter((v): v is string => v !== undefined);
  return out.length > 0 ? out : undefined;
}

function num(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

/** 元数据归一化：坏字段丢掉、好字段补默认值，meta.json 是人手写的，不能一份脏数据拖垮整库。 */
export function parseAssetMeta(raw: unknown): AssetMeta {
  const data = (raw ?? {}) as Record<string, unknown>;
  const meta: AssetMeta = {};
  const title = text(data.title);
  if (title) meta.title = title;
  const description = text(data.description);
  if (description) meta.description = description;
  const tags = textList(data.tags);
  if (tags) meta.tags = tags;
  const source = text(data.source);
  if (source) meta.source = source;
  const mood = textList(data.mood);
  if (mood) meta.mood = mood;
  const scene = textList(data.scene);
  if (scene) meta.scene = scene;
  const durationSec = num(data.durationSec);
  if (durationSec !== undefined && durationSec > 0) meta.durationSec = Math.round(durationSec);
  if (typeof data.loop === "boolean") meta.loop = data.loop;
  const volume = num(data.volume);
  if (volume !== undefined) meta.volume = Math.min(1, Math.max(0, volume));
  if (data.character && typeof data.character === "object" && !Array.isArray(data.character)) {
    const c = data.character as Record<string, unknown>;
    const character: AssetCharacter = {};
    for (const key of ["name", "persona", "voice", "voiceId"] as const) {
      const v = text(c[key]);
      if (v) character[key] = v;
    }
    if (c.protagonist === true) character.protagonist = true;
    if (Object.keys(character).length > 0) meta.character = character;
  }
  if (data.expressions && typeof data.expressions === "object" && !Array.isArray(data.expressions)) {
    const expressions: Record<string, SpriteExpression> = {};
    for (const [name, value] of Object.entries(data.expressions as Record<string, unknown>)) {
      if (!text(name) || !value || typeof value !== "object") continue;
      const row = value as Record<string, unknown>;
      const file = text(row.file);
      if (!file) continue;
      const description = text(row.description);
      const framing = framingOf(row.framing);
      expressions[name.trim()] = {
        file,
        ...(description ? { description } : {}),
        ...(framing ? { framing } : {}),
      };
    }
    if (Object.keys(expressions).length > 0) meta.expressions = expressions;
  }
  const framing = framingOf(data.framing);
  if (framing) meta.framing = framing;
  return meta;
}

/**
 * 剧目素材表归一化：`{id: "一句说明"}`（旧格式）与 `{id: {...}}`（新格式）都收，
 * 字符串等价于只有 description 的元数据。
 */
export function parsePlayAssetManifest(raw: unknown): Record<string, AssetMeta> {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  const out: Record<string, AssetMeta> = {};
  for (const [id, value] of Object.entries(raw as Record<string, unknown>)) {
    if (text(id) === undefined) continue;
    const asText = text(value);
    const meta = asText ? parseAssetMeta({ description: asText }) : parseAssetMeta(value);
    if (Object.keys(meta).length > 0) out[id] = meta;
  }
  return out;
}

/**
 * 素材的一行说明（提示词与 UI 共用）：描述 + 标签 + 音乐情绪/场景 + 时长与可循环。
 * 剧作家就是靠这一行决定「这场戏该配哪首」，所以把能选的信息都摆出来。
 */
export function describeAsset(meta: AssetMeta): string {
  const parts: string[] = [];
  // 手工写的 meta.json 里混进空白字段很常见：空描述渲染成「（ ）」比不渲染更糟
  const description = text(meta.description);
  if (description) parts.push(description);
  if (meta.tags?.length) parts.push(meta.tags.join("、"));
  if (meta.mood?.length) parts.push(`情绪：${meta.mood.join("、")}`);
  if (meta.scene?.length) parts.push(`适用：${meta.scene.join("、")}`);
  if (meta.durationSec !== undefined) parts.push(`约 ${meta.durationSec} 秒`);
  if (meta.loop === true) parts.push("可循环");
  if (meta.volume !== undefined && meta.volume !== 1) parts.push(`建议音量 ${meta.volume}`);
  return parts.join("｜");
}

/** 资源库条目搜索：id / 标题 / 描述 / 标签 / 情绪 / 场景，大小写不敏感的子串匹配。 */
export function libraryEntryMatches(entry: LibraryEntry, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (q === "") return true;
  const haystack = [
    entry.id,
    entry.title,
    entry.description,
    ...(entry.meta.tags ?? []),
    ...(entry.meta.mood ?? []),
    ...(entry.meta.scene ?? []),
  ]
    .join(" ")
    .toLowerCase();
  return haystack.includes(q);
}
