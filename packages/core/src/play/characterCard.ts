/**
 * 角色卡：markdown 正文 + frontmatter 头部。
 *
 * 角色配置散在两处的历史：人设写进 `memory/always/characters/<id>.md`，
 * 音色与差分映射写进 play.json 的 `characters[]`。于是 `persona` 有 markdown 兜底、
 * `voiceId` 没有——工坊建了卡也配不上音色，因为那半边它写不进去。
 *
 * 头部把这些机器字段收在一起，与正文（人设、台词风格这类创作内容）分开：
 * `---
 * id: mio
 * name: ミオ
 * voice: 清冷少女声
 * voiceId: aaa111...
 * framing: half
 * sprites:
 *   neutral: mio_neutral.png
 *   smile: mio_smile.png
 * spriteFraming:
 *   shout: full
 * ---`
 *
 * **play.json 不再承载任何角色数据**——`characters` 那个字段留着只是剧目元数据
 * （像主要角色表），没有任何运行时逻辑读它。角色的全部配置在这里。
 *
 * 嵌套只支持一层（`sprites` / `spriteFraming` 这种 `k: v` 块）。再多一层就是
 * YAML 的工作量，而不是角色卡的工作量。
 *
 * 手写而非引 YAML 依赖：字段集固定且很小（id/name/voice/voiceId），
 * 解析规则必须与「模型会怎么写」对齐——引一个完整 YAML 解析器只会多出
 * 「冒号后要不要空格」「引号要不要闭合」这类模型写不对、报错又难懂的失败模式。
 */

import { SPRITE_FRAMINGS, type SpriteFraming } from "./framing.js";

const FENCE = "---";

/** 角色卡的机器字段。play.json 的 `CharacterCard` 是这份的超集（多素材元数据）。 */
export interface CharacterHead {
  /** 角色 id（= 文件名主体）。缺省时用文件名。 */
  id?: string;
  /** 显示名（剧作家 A 区与舞台名牌用）。 */
  name?: string;
  /** 音色的人话描述（角色卡上给用户看的），不是 id。 */
  voice?: string;
  /** Fish Audio reference_id（32 位 hex），TTS 取音色按它查。 */
  voiceId?: string;
  /** 立绘取景（full/half/square）：出图画幅与舞台摆位都跟着它走，缺省 = 全身（见 play/framing.ts）。 */
  framing?: SpriteFraming;
  /** 立绘差分映射：expression id → assets/sprites/<id>/ 文件名。 */
  sprites?: Record<string, string>;
  /** 逐差分的取景覆盖：同一角色里混入不同画幅时用（如 shout = full、sigh = half）。 */
  spriteFraming?: Record<string, SpriteFraming>;
}

/** 一张角色卡：头部字段 + 正文（不含 frontmatter 本身）。 */
export interface CharacterDocument extends CharacterHead {
  /** 正文（人设、台词风格……）。空则说明这张卡只有头部。 */
  body: string;
}

/** 头部字段的书写顺序——序列化时按这个顺序，文件在 diff 里才稳定。 */
const SCALAR_FIELDS = ["id", "name", "voice", "voiceId", "framing"] as const;
const MAP_FIELDS = ["sprites", "spriteFraming"] as const;

/**
 * 解析角色卡。文件没有 frontmatter 时全部字段为空、正文是全文——
 * 存量卡片（`# 名字` 开头那种）照旧能读，不强制迁移。
 */
export function parseCharacterCard(text: string): CharacterDocument {
  const normalized = text.replace(/^﻿/, "").replace(/\r\n/g, "\n");
  if (!normalized.startsWith(`${FENCE}\n`)) return { body: normalized.trim() };

  const end = normalized.indexOf(`\n${FENCE}`, FENCE.length);
  if (end < 0) return { body: normalized.trim() };

  const head = parseHead(normalized.slice(FENCE.length + 1, end + 1));
  return { ...head, body: normalized.slice(end + 1 + FENCE.length).replace(/^\n+/, "").trim() };
}

/** 序列化成写盘前的文本。头部没有字段时返回纯正文，不留空 fence。 */
export function serializeCharacterCard(doc: CharacterDocument): string {
  const lines: string[] = [];
  for (const key of SCALAR_FIELDS) {
    const value = doc[key];
    if (value === undefined || value === "") continue;
    lines.push(`${key}: ${formatScalar(value)}`);
  }
  for (const key of MAP_FIELDS) {
    const map = doc[key];
    const entries = Object.entries(map ?? {});
    if (entries.length === 0) continue;
    lines.push(`${key}:`);
    // 键排序：模型写的顺序每次都不一样，不排的话 diff 永远在动
    for (const [k, v] of entries.sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))) {
      lines.push(`  ${k}: ${formatScalar(v)}`);
    }
  }
  const body = doc.body.trim();
  if (lines.length === 0) return body;
  return `${[FENCE, ...lines, FENCE].join("\n")}\n\n${body}\n`;
}

function parseHead(block: string): CharacterHead {
  const head: CharacterHead = {};
  const maps: Partial<Record<(typeof MAP_FIELDS)[number], Record<string, string>>> = {};
  let inMap: (typeof MAP_FIELDS)[number] | null = null;

  for (const raw of block.split("\n")) {
    const line = raw.trim();
    if (line === "" || line.startsWith("#")) continue;
    const colon = line.indexOf(":");
    if (colon < 0) continue;
    const key = line.slice(0, colon).trim();
    const value = unquote(line.slice(colon + 1).trim());

    if ((SCALAR_FIELDS as readonly string[]).includes(key)) {
      inMap = null;
      // 景别取值窄（full/half/square），写成别的就不认——静默当全身会让立绘按错的
      // 画幅摆位，比少一个字段更难查
      if (key === "framing") {
        if (SPRITE_FRAMINGS.includes(value as SpriteFraming)) head.framing = value as SpriteFraming;
      } else if (value !== "") {
        head[key as Exclude<(typeof SCALAR_FIELDS)[number], "framing">] = value;
      }
      continue;
    }
    if ((MAP_FIELDS as readonly string[]).includes(key)) {
      inMap = key as (typeof MAP_FIELDS)[number];
      if (value !== "") maps[inMap] = { "": value };
      else maps[inMap] = maps[inMap] ?? {};
      continue;
    }
    // 块里的 `k: v`；没在块内（缩进错了）就当噪声丢掉，不猜
    if (inMap && key !== "") maps[inMap]![key] = value;
  }

  for (const key of MAP_FIELDS) {
    const map = maps[key];
    if (!map) continue;
    // spriteFraming 的值同样是景别，逐个筛；sprites 的值是文件名，原样留
    const entries = Object.entries(map).filter(([, v]) =>
      key === "spriteFraming" ? SPRITE_FRAMINGS.includes(v as SpriteFraming) : v !== "",
    );
    if (entries.length > 0) head[key] = Object.fromEntries(entries) as never;
  }
  return head;
}

/**
 * 值含冒号、空格包裹的引号或换行时加引号，否则 YAML 读回来会散。
 * 模型写 `voice: 清冷 少女`（中间多个空格）不该被当成两个字段。
 */
function formatScalar(value: string): string {
  const risky = /^[\s>|&*!%@`{}[\],#?:-]|[:#]\s|\s$|^$|\n/.test(value);
  return risky ? JSON.stringify(value) : value;
}

function unquote(value: string): string {
  if (value.length >= 2 && value.startsWith('"') && value.endsWith('"')) {
    try {
      return JSON.parse(value) as string;
    } catch {
      return value.slice(1, -1);
    }
  }
  if (value.length >= 2 && value.startsWith("'") && value.endsWith("'")) return value.slice(1, -1).replace(/''/g, "'");
  return value;
}
