import { appendFile, mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { dirname, extname, join, relative } from "node:path";
import MiniSearch from "minisearch";
import type { PlayStore } from "./store.js";

/**
 * 剧目记忆（D7 三层）：always（每轮注入）/ index（标题列表注入 + 详情按需读）/ archive（只可检索命中）。
 * 剧目级内容（craft/premise/index 卡）读自 memory/ 目录，随 runtime 重建即时生效；
 * 谱系级内容（state 文件、arcs 引用）走 LineageTree 快照，archive 切片落 events.jsonl。
 *
 * `index/` 下可以有任意子目录（`locations/` 放地点、`lore/` 放设定只是惯例，不是约束），
 * 卡的 layer 就是相对 `index/` 的子目录路径。A 区里标出来是为了让剧作家知道这张卡属于哪一块。
 * `arcs/` 在 index 之外：它是纪元压缩的机器产物，文件名就是谱系快照引用的 arcId，
 * 跟用户可写的设定卡混在一个目录里，手改或手建会绕过按分支过滤的防剧透。
 */
export class PlayMemory {
  /** always/craft.md（剧艺守则，可空——空则用系统提示词内置准则）。 */
  readonly craft: string;
  /** always/premise.md（世界观前提，缺文件即缺——就绪门与 A 区注入的唯一来源）。 */
  readonly premise: string;
  /** always/characters/<id>.md — 角色设定（persona/台词风格）；id → 全文。纪元内冻结，工坊热改走 reload。 */
  readonly characters: ReadonlyMap<string, string>;
  /** index 卡（用户设定卡 + 纪元 arcs 卡，标题+一句话摘要注入 A 区）。 */
  readonly cards: IndexCard[];
  /** archive 切片文件（空 = 不落盘，纯内存检索——测试/无归档剧目）。 */
  private readonly archiveFile: string | null;
  /** arcs 纪元摘要目录（空 = 不落盘，纯内存）。 */
  private readonly arcsDir: string | null;
  private slices: ArchiveSlice[];
  private index: MiniSearch<{ id: string } & ArchiveSlice> | null = null;

  constructor(
    opts: {
      craft?: string;
      premise?: string;
      characters?: Map<string, string>;
      cards?: IndexCard[];
      archiveFile?: string | null;
      arcsDir?: string | null;
      slices?: ArchiveSlice[];
    } = {},
  ) {
    this.craft = opts.craft ?? "";
    this.premise = opts.premise ?? "";
    this.characters = opts.characters ?? new Map();
    this.cards = opts.cards ?? [];
    this.archiveFile = opts.archiveFile ?? null;
    this.arcsDir = opts.arcsDir ?? null;
    this.slices = opts.slices ?? [];
  }

  static async load(store: PlayStore): Promise<PlayMemory> {
    const [craft, premise, characters, indexCards, arcCards, slices] = await Promise.all([
      readText(store.memoryDir("always", "craft.md")),
      readText(store.memoryDir("always", "premise.md")),
      loadCharacters(store.memoryDir("always", "characters")),
      loadCards(store),
      loadArcs(store),
      loadArchive(store.memoryDir("archive", "events.jsonl")),
    ]);
    return new PlayMemory({
      craft,
      premise,
      characters,
      cards: [...indexCards, ...arcCards],
      archiveFile: store.memoryDir("archive", "events.jsonl"),
      arcsDir: store.memoryDir("arcs"),
      slices,
    });
  }

  /** A 区注入上下文（标题+摘要；详情由 playwriter 按需 read_memory_detail）。arcs 为谱系级，只注入当前分支已走过的纪元。 */
  get indexContext(): { layer: string; name: string; summary: string }[] {
    return this.cards.map(({ layer, name, summary }) => ({
      layer,
      name,
      summary,
    }));
  }

  /**
   * 当前分支可见的 A 区卡（arcs 按 arcIds 过滤——分岔回旧分支不得看到后世的章节摘要）。
   * 用户写的 index 卡一律可见：它们是剧目设定，不随分支变化。
   */
  visibleCards(arcIds: readonly string[] = []): IndexCard[] {
    const allowed = new Set(arcIds);
    return this.cards.filter((c) => !c.arc || allowed.has(c.file));
  }

  /** 同上，但只给标题+摘要（A 区注入用）。 */
  visibleContext(
    arcIds: readonly string[] = [],
  ): { layer: string; name: string; summary: string }[] {
    return this.visibleCards(arcIds).map(({ layer, name, summary }) => ({
      layer,
      name,
      summary,
    }));
  }

  /** 按标题、相对路径或文件名读 index 卡详情（read_memory_detail 工具后端）。arcs 按当前分支过滤。 */
  readCard(name: string, arcIds: readonly string[] = []): string | null {
    const key = name.replace(/\.md$/, "");
    const allowed = new Set(arcIds);
    const card = this.cards.find(
      (c) =>
        (c.name === key || c.file === key || c.file.split("/").pop() === key) &&
        (!c.arc || allowed.has(c.file)),
    );
    return card ? card.detail : null;
  }

  /**
   * archive 检索（search_archive 工具后端）：MiniSearch 全文命中 → 防剧透过滤（祖先链 ⊆ 当前分支路径）。
   * allowed = tree.pathSet()——兄弟/废弃分支的切片不可召回。
   */
  searchArchive(query: string, allowed: Set<string>, limit = 5): ArchiveSlice[] {
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
    const byId = new Map(this.slices.map((s) => [sliceId(s), s]));
    const hits: ArchiveSlice[] = [];
    for (const { id } of this.index.search(query, { tokenize: cjkBigrams })) {
      const slice = byId.get(id);
      if (slice && allowed.has(slice.entryId)) hits.push(slice);
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

  /**
   * 纪元摘要落盘（纪元压缩产物）：写入 memory/arcs/<id>.md 并即时进 cards——下一个纪元的
   * A 区立即带得上这条摘要（纪元内冻结）。arcId 由编排器给定（谱系级快照引用同一 id）。
   */
  async appendArc(arc: {
    id: string;
    title: string;
    summary: string;
    detail: string;
  }): Promise<void> {
    if (this.cards.some((c) => c.file === arc.id)) return;
    const detail = [`# ${arc.title}`, "", arc.summary, "", arc.detail, ""].join("\n");
    this.cards.push({
      layer: "arcs",
      name: arc.title,
      summary: arc.summary,
      detail,
      file: arc.id,
      arc: true,
    });
    if (!this.arcsDir) return;
    await mkdir(this.arcsDir, { recursive: true });
    await writeFile(join(this.arcsDir, `${arc.id}.md`), detail, "utf8");
  }
}

/** index 卡：首行 `# 标题`，次行一句话摘要，其余为详情（read_memory_detail 返回全文）。 */
export interface IndexCard {
  /** 相对 `memory/index/` 的子目录路径（顶层卡为空串）；arcs 卡恒为 `"arcs"`，只作提示词里的分类标签。 */
  layer: string;
  name: string;
  summary: string;
  detail: string;
  /** 相对 `memory/index/` 的路径（不含扩展名）；arcs 卡是 arcId。 */
  file: string;
  /**
   * 纪元压缩产物（跟分支走，按 arcIds 过滤）。
   * 显式标记而非拿 layer 名字认：用户完全可以在 `index/arcs/` 下面放自己的设定卡，
   * 那些卡是剧目设定，不该跟着分支消失。
   */
  arc: boolean;
}

/** archive 逐轮事件切片（entryId = 收束时谱系叶，防剧透过滤键）。 */
export interface ArchiveSlice {
  entryId: string;
  turn: number;
  at: number;
  summary: string;
}

function sliceId(slice: ArchiveSlice): string {
  return `${slice.entryId}:${slice.turn}`;
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

/** 纪元摘要卡（纪元压缩产物，落在 index 之外的 memory/arcs/）。 */
async function loadArcs(store: PlayStore): Promise<IndexCard[]> {
  const dir = store.memoryDir("arcs");
  if (!existsSync(dir)) return [];
  const cards: IndexCard[] = [];
  for (const entry of (await readdir(dir)).sort()) {
    if (extname(entry) !== ".md") continue;
    const file = entry.replace(/\.md$/, "");
    cards.push({ ...parseCard(file, await readText(join(dir, entry))), layer: "arcs", file, arc: true });
  }
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
    out.push({ ...parseCard(file, await readText(path)), layer, file, arc: false });
  }
}

/** 卡解析：首行 `# 标题`，次行（首个非空行）一句话摘要，其余是详情。没写标题就用文件名。 */
function parseCard(file: string, detail: string): Omit<IndexCard, "layer" | "file" | "arc"> {
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

/** 扫描 always/characters/ 目录，返回 id → 全文 Map（文件名去 .md 即 id）。 */
async function loadCharacters(dir: string): Promise<Map<string, string>> {
  const result = new Map<string, string>();
  if (!existsSync(dir)) return result;
  for (const entry of (await readdir(dir)).sort()) {
    if (!entry.endsWith(".md")) continue;
    const id = entry.replace(/\.md$/, "");
    const text = await readText(join(dir, entry));
    if (text) result.set(id, text);
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
