/**
 * 角色卡：markdown 正文 + frontmatter 头部。
 *
 * 角色配置散在两处的历史：人设写进 `characters/<id>.md`，
 * 音色与差分映射写进 play.json 的 `characters[]`。于是 `persona` 有 markdown 兜底、
 * `voiceId` 没有——工坊建了卡也配不上音色，因为那半边它写不进去。
 *
 * 头部把这些机器字段收在一起，与正文（人设、台词风格这类创作内容）分开：
 * `---
 * id: mio
 * name: ミオ
 * sprite: mio
 * voice: 清冷少女声
 * voiceId: aaa111...
 * ---`
 *
 * **卡只管「这个人是谁」**：名字、人设、音色，以及这个人**用哪一套立绘**（`sprite`）。
 * 立绘是另一件可选附件，落在 `assets/sprites/<立绘目录>/` 并声明在素材表里
 * （见 play/assets.ts）——两张附件谁也不依赖谁。机甲、猫、道具可以只有立绘没有卡；
 * 路人不建卡也能上台，名牌与音色各有回落（README「主体与附件」）。
 *
 * **play.json 不再承载任何角色数据**——`characters` 那个字段留着只是剧目元数据
 * （像主要角色表），没有任何运行时逻辑读它。角色的全部配置在这里。
 *
 * 手写而非引 YAML 依赖：字段集固定且很小（id/name/sprite/voice/voiceId），
 * 解析规则必须与「模型会怎么写」对齐——引一个完整 YAML 解析器只会多出
 * 「冒号后要不要空格」「引号要不要闭合」这类模型写不对、报错又难懂的失败模式。
 */

const FENCE = "---";

/**
 * 角色卡目录：剧目根下的顶层目录。**角色表就是这个目录的文件列表**——
 * 名字、人设、音色全在卡上，play.json 不再承载角色数据。
 */
export const CHARACTER_DIR = "characters";

/**
 * 玩家扮演的角色：固定 id 的一张普通角色卡（`characters/protagonist.md`）。
 *
 * 不靠 frontmatter 标记来认主角——`characters/` 的不变式是「角色表 = 目录的文件列表」，
 * 固定文件名让「谁是主角」不需要第二处声明，也不会出现两个主角或零个主角。
 * 它与别的卡能力完全一致（台上有立绘、台词有音色）；是否上台、是否配音是创作口径，
 * 写在剧目自己的 craft.md 里，引擎不预设。
 */
export const PROTAGONIST_ID = "protagonist";

/** 角色卡在剧目内的相对路径。角色的读写口都从这里拼，别各自抄一份。 */
export function characterCardPath(id: string): string {
  return `${CHARACTER_DIR}/${id}.md`;
}

/**
 * `characterCardPath` 的反向：剧目内相对路径 → 角色 id；不是角色卡就 null。
 *
 * 通用文件工具的写盘回调只拿得到路径（`characters/xiaoyu.md`），要认出「这是一张卡」
 * 就得有这么一处判定——抄正则在各调用点会漂。
 */
export function characterIdOfPath(rel: string): string | null {
  const prefix = `${CHARACTER_DIR}/`;
  if (!rel.startsWith(prefix) || !rel.endsWith(".md")) return null;
  const id = rel.slice(prefix.length, -3);
  return id !== "" && !id.includes("/") ? id : null;
}

/** 是不是玩家扮演的那张卡（只有 A 区标注与输入润色关心这件事）。 */
export function isProtagonist(id: string): boolean {
  return id === PROTAGONIST_ID;
}

/** 角色卡的机器字段。play.json 的 `CharacterCard` 是这份的超集（多素材元数据）。 */
export interface CharacterHead {
  /** 角色 id（= 文件名主体）。缺省时用文件名。 */
  id?: string;
  /** 显示名（剧作家 A 区与舞台名牌用）。 */
  name?: string;
  /**
   * 显式绑定的立绘目录（`assets/sprites/<sprite>/`）。**不写就是同名**：
   * `characters/mio.md` 默认用 `assets/sprites/mio/`。要写它的场合——立绘目录不叫这个角色的 id，
   * 或一张卡要用别处画好的一整套立绘。取值交给 `spriteIdOf` 解析，别在调用点各写一遍回落。
   */
  sprite?: string;
  /** 音色的人话描述（角色卡上给用户看的），不是 id。 */
  voice?: string;
  /** Fish Audio reference_id（32 位 hex），TTS 取音色按它查。 */
  voiceId?: string;
}

/** 一张角色卡：头部字段 + 正文（不含 frontmatter 本身）。 */
export interface CharacterDocument extends CharacterHead {
  /** 正文（人设、台词风格……）。空则说明这张卡只有头部。 */
  body: string;
}

/** 头部字段的书写顺序——序列化时按这个顺序，文件在 diff 里才稳定。 */
const SCALAR_FIELDS = ["id", "name", "sprite", "voice", "voiceId"] as const;

/**
 * 一个角色用哪一套立绘（`assets/sprites/` 下的目录名）：卡上显式绑定优先，没写就是同名。
 *
 * 舞台、工坊与提示词都从这里取——绑定规则只此一处，别在调用点各写一遍 `?? id`：
 * 那样每加一个消费方就多一个漏掉显式绑定的地方。
 */
export function spriteIdOf(id: string, head: { sprite?: string } = {}): string {
  const bound = head.sprite?.trim();
  return bound ? bound : id;
}

/**
 * `spriteIdOf` 的反向：这个立绘目录属于哪张卡（谁都没绑就是 null）。
 *
 * 素材页的名字、工坊出图时喂给模型的人设都按**立绘目录**找卡——目录不一定是角色的 id，
 * 拿目录去查角色表会扑空（显式绑定之后这是常态）。两张卡绑同一个目录时取先遇到的那张：
 * 目录只有一个名字，争用时结果必须确定。
 */
export function characterOfSprite<T extends { id?: string; sprite?: string }>(
  dir: string,
  cards: Iterable<T>,
): T | null {
  for (const card of cards) {
    if (card.id && spriteIdOf(card.id, card) === dir) return card;
  }
  return null;
}

/**
 * 解析角色卡。文件没有 frontmatter 时全部字段为空、正文是全文——
 * 存量卡片（`# 名字` 开头那种）照旧能读，不强制迁移。
 *
 * 旧卡上的 `framing` / `sprites` / `spriteFraming` 现在归素材表管，这里当噪声跳过：
 * 立绘是立绘自己的事，卡不该替它说话。
 */
export function parseCharacterCard(text: string): CharacterDocument {
  const normalized = text.replace(/^\ufeff/, "").replace(/\r\n/g, "\n");
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
  const body = doc.body.trim();
  if (lines.length === 0) return body;
  return `${[FENCE, ...lines, FENCE].join("\n")}\n\n${body}\n`;
}

function parseHead(block: string): CharacterHead {
  const head: CharacterHead = {};
  for (const raw of block.split("\n")) {
    const line = raw.trim();
    if (line === "" || line.startsWith("#")) continue;
    const colon = line.indexOf(":");
    if (colon < 0) continue;
    const key = line.slice(0, colon).trim();
    if (!(SCALAR_FIELDS as readonly string[]).includes(key)) continue;
    const value = unquote(line.slice(colon + 1).trim());
    // 缩进的 `k: v`（旧卡的 sprites 块）在这里被判成噪声丢掉——键不在白名单里
    if (value !== "") head[key as (typeof SCALAR_FIELDS)[number]] = value;
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
