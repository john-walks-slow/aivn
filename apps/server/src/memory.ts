import { appendFile, mkdir, readFile, readdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { dirname, extname, join, relative } from "node:path";
import MiniSearch from "minisearch";
import { parseCharacterCard, type CharacterDocument } from "@aivn/core";
import type { PlayStore } from "./store.js";

/** 用户写的记忆卡目录（剧目内相对路径）：A 区给的是这里起算的路径，模型照着它 read / edit。 */
const INDEX_DIR = "memory/index";

/**
 * 剧目记忆（D7 三层）：always（每轮注入）/ index（标题列表注入 + 详情按需读）/ archive（只可检索命中）。
 * 剧目级内容（craft/premise/index 卡）读自 memory/ 目录，随 runtime 重建即时生效；
 * 角色卡读自顶层 `characters/`（角色不是记忆的一层），见 store.characterDir()。
 * 谱系级内容（state 文件、纪元压缩记录）走 LineageTree 快照，archive 切片落 events.jsonl。
 *
 * `index/` 下可以有任意子目录（`locations/` 放地点、`lore/` 放设定只是惯例，不是约束），
 * 卡的 layer 就是相对 `index/` 的子目录路径。A 区里标出来是为了让剧作家知道这张卡属于哪一块。
 * 全部 index 卡都是用户写的剧目设定，不随分支变化——跟分支走的是压缩记录（在快照里）。
 */
export class PlayMemory {
  /** always/craft.md（剧艺守则，可空——空则用系统提示词内置准则）。 */
  readonly craft: string;
  /** always/nsfw.md（限制级剧情创作守则，可空）。 */
  readonly nsfw: string;
  /** always/premise.md（世界观前提，缺文件即缺——就绪门与 A 区注入的唯一来源）。 */
  readonly premise: string;
  /**
   * `<剧目>/characters/<id>.md` — 角色卡；id → 解析后的头部 + 正文。
   *
   * 结构化而不是留全文：voiceId 这类机器字段要参与合成与生图，塞在一坨 markdown 里
   * 就得每次现场正则抠。纪元内冻结，工坊热改走 reload。
   */
  readonly characters: ReadonlyMap<string, CharacterDocument>;
  /** index 卡（用户设定卡，标题+一句话摘要注入 A 区）。 */
  readonly cards: IndexCard[];
  /** archive 切片文件（空 = 不落盘，纯内存检索——测试/无归档剧目）。 */
  private readonly archiveFile: string | null;
  private slices: ArchiveSlice[];
  private index: MiniSearch<{ id: string } & ArchiveSlice> | null = null;

  constructor(
    opts: {
      craft?: string;
      nsfw?: string;
      premise?: string;
      characters?: Map<string, CharacterDocument>;
      cards?: IndexCard[];
      archiveFile?: string | null;
      slices?: ArchiveSlice[];
    } = {},
  ) {
    this.craft = opts.craft ?? "";
    this.nsfw = opts.nsfw ?? "";
    this.premise = opts.premise ?? "";
    this.characters = opts.characters ?? new Map();
    this.cards = opts.cards ?? [];
    this.archiveFile = opts.archiveFile ?? null;
    this.slices = opts.slices ?? [];
  }

  static async load(store: PlayStore): Promise<PlayMemory> {
    const [craft, nsfw, premise, characters, cards, slices] = await Promise.all([
      readText(store.memoryDir("always", "craft.md")),
      readText(store.memoryDir("always", "nsfw.md")),
      readText(store.memoryDir("always", "premise.md")),
      loadCharacters(store.characterDir()),
      loadCards(store),
      loadArchive(store.memoryDir("archive", "events.jsonl")),
    ]);
    return new PlayMemory({
      craft,
      nsfw,
      premise,
      characters,
      cards,
      archiveFile: store.memoryDir("archive", "events.jsonl"),
      slices,
    });
  }

  /**
   * A 区注入用的记忆索引：标题 + 一句话摘要 + 可写路径。
   *
   * `path` 是这张卡在剧目里的可写路径，A 区每行带出去，模型才能直接 read / edit 它——
   * **标题是 `# 标题`（`parseCard`），与文件名可以不一样**，路径推不出来，只能这里给。
   */
  visibleContext(): { layer: string; name: string; summary: string; path: string }[] {
    return this.cards.map(({ layer, name, summary, file }) => ({
      layer,
      name,
      summary,
      path: `${INDEX_DIR}/${file}.md`,
    }));
  }

  /** 按标题、相对路径或文件名读 index 卡详情（read_memory_detail 工具后端）。 */
  readCard(name: string): string | null {
    const key = name.replace(/\.md$/, "");
    const card = this.cards.find(
      (c) => c.name === key || c.file === key || c.file.split("/").pop() === key,
    );
    return card ? card.detail : null;
  }

  /**
   * archive 检索（search_archive 工具后端）：MiniSearch 全文命中 → 防剧透过滤（祖先链 ⊆ 当前分支路径）。
   * allowed = tree.pathSet()——兄弟/废弃分支的切片不可召回。
   *
   * `nsfw` = 读者此刻所处的通道。SFW 侧跳过限制级轮次的切片（露骨原文只许 NSFW 侧读到），
   * 段末那条摘要切片不带标记、两边都读得到——于是搜得到那一段、看到的是摘要，不断片。
   */
  searchArchive(
    query: string,
    allowed: Set<string>,
    opts: { limit?: number; nsfw?: boolean } = {},
  ): ArchiveSlice[] {
    if (this.slices.length === 0) return [];
    if (!this.index) {
      this.index = new MiniSearch<{ id: string } & ArchiveSlice>({
        fields: ["summary"],
        storeFields: ["entryId", "turn", "summary"],
        tokenize: cjkBigrams,
        processTerm: (term: string) => (term.length > 0 ? term : null),
      });
      this.index.addAll(this.slices.map((s) => ({ ...s, id: sliceId(s) })));
    }
    const limit = opts.limit ?? 5;
    const byId = new Map(this.slices.map((s) => [sliceId(s), s]));
    const hits: ArchiveSlice[] = [];
    for (const { id } of this.index.search(query, { tokenize: cjkBigrams })) {
      const slice = byId.get(id);
      if (slice && allowed.has(slice.entryId) && (opts.nsfw === true || slice.nsfw !== true)) {
        hits.push(slice);
      }
      if (hits.length >= limit) break;
    }
    return hits;
  }

  /** 逐轮事件切片追加（finishBeat 调用；JSONL append-only）。 */
  async appendArchive(slice: ArchiveSlice): Promise<void> {
    if (slice.summary.trim() === "") return;
    this.slices.push(slice);
    this.index?.add({ ...slice, id: sliceId(slice) });
    if (!this.archiveFile) return;
    await mkdir(dirname(this.archiveFile), { recursive: true });
    await appendFile(this.archiveFile, `${JSON.stringify(slice)}\n`, "utf8");
  }
}

/** index 卡：首行 `# 标题`，次行一句话摘要，其余为详情（read_memory_detail 返回全文）。 */
export interface IndexCard {
  /** 相对 `memory/index/` 的子目录路径（顶层卡为空串），只作提示词里的分类标签。 */
  layer: string;
  name: string;
  summary: string;
  detail: string;
  /** 相对 `memory/index/` 的路径（不含扩展名）。 */
  file: string;
}

/** archive 逐轮事件切片（entryId = 收束时谱系叶，防剧透过滤键）。 */
export interface ArchiveSlice {
  entryId: string;
  turn: number;
  at: number;
  summary: string;
  /**
   * 这片是限制级轮次的露骨原文。只约束检索可见性：SFW 模式跳过，
   * 段末那条摘要切片不带这个标记（它就是这一段留给 SFW 侧的唯一出口）。
   */
  nsfw?: boolean;
}

/**
 * 切片的检索 id。
 *
 * 限制级那段会在同一个叶节点、同一轮上留两片（原文 + 摘要），只按 `entryId:turn`
 * 认就会撞成一个 id——MiniSearch 里两篇文档同号，检索命中的是谁全看谁的坐标最后写入。
 */
function sliceId(slice: ArchiveSlice): string {
  return `${slice.entryId}:${slice.turn}${slice.nsfw === true ? ":nsfw" : ""}`;
}

async function readText(path: string): Promise<string> {
  if (!existsSync(path)) return "";
  return readFile(path, "utf8");
}

/** index 递归扫描：任意子目录都收，layer 取相对 index/ 的子目录路径（顶层卡为空串）。 */
async function loadCards(store: PlayStore): Promise<IndexCard[]> {
  const cards: IndexCard[] = [];
  await collectCards(store.memoryDir("index"), store.memoryDir("index"), "", cards);
  // 排序：readdir 顺序由文件系统决定，A 区行序漂移会让整个前缀缓存失效
  cards.sort((a, b) => a.file.localeCompare(b.file));
  return cards;
}

/** 递归下钻 index/，把每个 .md 收成一张卡（子目录名即 layer）。 */
async function collectCards(root: string, dir: string, layer: string, out: IndexCard[]): Promise<void> {
  if (!existsSync(dir)) return;
  for (const entry of (await readdir(dir, { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name))) {
    if (entry.name.startsWith(".")) continue;
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      await collectCards(root, path, layer ? `${layer}/${entry.name}` : entry.name, out);
      continue;
    }
    if (extname(entry.name) !== ".md") continue;
    // 分隔符归一：Windows 的 relative 吐反斜杠，卡的路径键全项目要一致
    const file = relative(root, path).replace(/\\/g, "/").replace(/\.md$/, "");
    out.push({ ...parseCard(file, await readText(path)), layer, file });
  }
}

/** 卡解析：首行 `# 标题`，次行（首个非空行）一句话摘要，其余是详情。没写标题就用文件名。 */
function parseCard(file: string, detail: string): Omit<IndexCard, "layer" | "file"> {
  const lines = detail.split("\n").map((l) => l.trim());
  const titleIdx = lines.findIndex((l) => /^#\s+/.test(l));
  const title = titleIdx >= 0 ? /^#\s+(.+)$/.exec(lines[titleIdx]!)?.[1] : undefined;
  const summary = lines.slice(titleIdx + 1).find((l) => l !== "") ?? "";
  // 标题之后的首个非空行是摘要；没写标题时退到全文首个非空行
  return { name: title?.trim() || file.split("/").pop() || file, summary, detail };
}

async function loadArchive(path: string): Promise<ArchiveSlice[]> {
  if (!existsSync(path)) return [];
  const raw = await readFile(path, "utf8");
  const slices: ArchiveSlice[] = [];
  for (const line of raw.split("\n")) {
    if (line.trim() === "") continue;
    try {
      slices.push(JSON.parse(line) as ArchiveSlice);
    } catch {
      // 残行（写入中断）跳过：append-only 日志容忍尾部撕裂
    }
  }
  return slices;
}

/** 角色卡目录的原文读取（id → 原始 markdown），供 store 的齐备判断等只需扫一眼的地方用。 */
export async function loadCharacterCards(dir: string): Promise<CharacterDocument[]> {
  const result: CharacterDocument[] = [];
  if (!existsSync(dir)) return result;
  for (const entry of (await readdir(dir)).sort()) {
    if (!entry.endsWith(".md")) continue;
    const text = await readText(join(dir, entry));
    if (text) result.push({ ...parseCharacterCard(text), id: entry.replace(/\.md$/, "") });
  }
  return result;
}

async function loadCharacters(dir: string): Promise<Map<string, CharacterDocument>> {
  const result = new Map<string, CharacterDocument>();
  if (!existsSync(dir)) return result;
  for (const entry of (await readdir(dir)).sort()) {
    if (!entry.endsWith(".md")) continue;
    const id = entry.replace(/\.md$/, "");
    const text = await readText(join(dir, entry));
    // 文件名是 id 的真相：frontmatter 里的 id 写错时以路径为准，否则 actor id 与卡对不上
    if (text) result.set(id, { ...parseCharacterCard(text), id });
  }
  return result;
}

/**
 * CJK bigram + unigram + ASCII 词混合分词（MiniSearch 自定义 tokenizer）：
 * 中文无空格，整句作单 token 无命中、纯 unigram 召回过泛——bigram 为主、单字补 unigram
 * 保证「澪」「校」这类单字查询也能命中。
 */
export function cjkBigrams(text: string): string[] {
  const tokens: string[] = [];
  tokens.push(...(text.toLowerCase().match(/[a-z0-9]+/g) ?? []));
  for (const run of text.match(/[\u4e00-\u9fff]+/g) ?? []) {
    if (run.length === 1) tokens.push(run);
    else {
      for (let i = 0; i + 1 < run.length; i += 1) tokens.push(run.slice(i, i + 2));
      for (const ch of run) tokens.push(ch);
    }
  }
  return tokens;
}
