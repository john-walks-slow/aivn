import { appendFile, mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import MiniSearch from "minisearch";
import type { PlayStore } from "./store.js";

/**
 * 剧目记忆（D7 三层）：always（每轮注入）/ index（标题列表注入 + 详情按需读）/ archive（只可检索命中）。
 * 剧目级内容（craft/premise/index 卡）读自 memory/ 目录，随 runtime 重建即时生效；
 * 谱系级内容（state 文件、arcs 引用）走 LineageTree 快照，archive 切片落 events.jsonl。
 */
export class PlayMemory {
  /** always/craft.md（剧艺守则，可空——空则用系统提示词内置准则）。 */
  readonly craft: string;
  /** always/premise.md（世界观前提，可空——空则回退 play.json premise）。 */
  readonly premise: string;
  /** index 卡（locations/lore/arcs 三层，标题+一句话摘要注入 A 区）。 */
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
      cards?: IndexCard[];
      archiveFile?: string | null;
      arcsDir?: string | null;
      slices?: ArchiveSlice[];
    } = {},
  ) {
    this.craft = opts.craft ?? "";
    this.premise = opts.premise ?? "";
    this.cards = opts.cards ?? [];
    this.archiveFile = opts.archiveFile ?? null;
    this.arcsDir = opts.arcsDir ?? null;
    this.slices = opts.slices ?? [];
  }

  static async load(store: PlayStore): Promise<PlayMemory> {
    const [craft, premise, cards, slices] = await Promise.all([
      readText(store.memoryDir("always", "craft.md")),
      readText(store.memoryDir("always", "premise.md")),
      loadCards(store),
      loadArchive(store.memoryDir("archive", "events.jsonl")),
    ]);
    return new PlayMemory({
      craft,
      premise,
      cards,
      archiveFile: store.memoryDir("archive", "events.jsonl"),
      arcsDir: store.memoryDir("index", "arcs"),
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

  /** 当前分支可见的 A 区 index 卡（arcs 按 ids 过滤——分岔回旧分支不得看到后世的章节摘要）。 */
  visibleCards(arcIds: readonly string[] = []): IndexCard[] {
    const allowed = new Set(arcIds);
    return this.cards.filter((c) => c.layer !== "arcs" || allowed.has(c.file));
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

  /** 按标题或文件名读 index 卡详情（read_memory_detail 工具后端）。arcs 按当前分支过滤。 */
  readCard(name: string, arcIds: readonly string[] = []): string | null {
    const key = name.replace(/\.md$/, "");
    const allowed = new Set(arcIds);
    const card = this.cards.find(
      (c) => (c.name === key || c.file === key) && (c.layer !== "arcs" || allowed.has(c.file)),
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

  /** 逐节拍事件切片追加（finishBeat 调用；JSONL append-only）。 */
  async appendArchive(slice: ArchiveSlice): Promise<void> {
    if (slice.summary.trim() === "") return;
    this.slices.push(slice);
    this.index?.add({ ...slice, id: sliceId(slice) });
    if (!this.archiveFile) return;
    await mkdir(dirname(this.archiveFile), { recursive: true });
    await appendFile(this.archiveFile, `${JSON.stringify(slice)}\n`, "utf8");
  }

  /**
   * 纪元摘要落盘（纪元压缩产物）：写入 index/arcs/<id>.md 并即时进 cards——下一个纪元的
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
    });
    if (!this.arcsDir) return;
    await mkdir(this.arcsDir, { recursive: true });
    await writeFile(join(this.arcsDir, `${arc.id}.md`), detail, "utf8");
  }
}

/** index 卡：首行 `# 标题`，次行一句话摘要，其余为详情（read_memory_detail 返回全文）。 */
export interface IndexCard {
  layer: "locations" | "lore" | "arcs";
  name: string;
  summary: string;
  detail: string;
  file: string;
}

/** archive 逐节拍事件切片（entryId = 收束时谱系叶，防剧透过滤键）。 */
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

/** index 三层目录扫描（arcs 为纪元压缩产物，P4b 写入；手工放卡同样生效）。 */
async function loadCards(store: PlayStore): Promise<IndexCard[]> {
  const layers = ["locations", "lore", "arcs"] as const;
  const cards: IndexCard[] = [];
  for (const layer of layers) {
    const dir = store.memoryDir("index", layer);
    if (!existsSync(dir)) continue;
    // 排序：readdir 顺序由文件系统决定，A 区行序漂移会让整个前缀缓存失效
    for (const entry of (await readdir(dir)).sort()) {
      if (!entry.endsWith(".md")) continue;
      const detail = await readText(join(dir, entry));
      const lines = detail.split("\n").map((l) => l.trim());
      const title = lines.map((l) => /^#\s+(.+)$/.exec(l)?.[1]).find(Boolean);
      const name = title ?? entry.replace(/\.md$/, "");
      const titleIdx = lines.findIndex((l) => /^#\s+/.test(l));
      const summary = lines.slice(titleIdx + 1).find((l) => l !== "") ?? "";
      cards.push({
        layer,
        name,
        summary,
        detail,
        file: entry.replace(/\.md$/, ""),
      });
    }
  }
  return cards;
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
