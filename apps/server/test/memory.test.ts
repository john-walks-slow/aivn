import { describe, expect, it } from "vitest";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { LineageTree } from "@stage-ai/core";
import { PlayMemory, cjkBigrams, type ArchiveSlice, type IndexCard } from "../src/memory.js";
import { PlayStore } from "../src/store.js";

const CARD: IndexCard = {
  layer: "lore",
  name: "旧校舍拆除",
  summary: "旧校舍将在文化祭后拆除。",
  detail: "# 旧校舍拆除\n旧校舍将在文化祭后拆除，具体日期未定。\n",
  file: "旧校舍拆除",
};

function slice(entryId: string, turn: number, summary: string): ArchiveSlice {
  return { entryId, turn, at: 0, summary };
}

describe("cjkBigrams 分词", () => {
  it("中文 bigram + unigram + ASCII 词（单字查询也要有 token）", () => {
    expect(cjkBigrams("旧校舍拆除")).toEqual(["旧校", "校舍", "舍拆", "拆除", "旧", "校", "舍", "拆", "除"]);
    expect(cjkBigrams("hello 世界")).toEqual(["hello", "世界", "世", "界"]);
    expect(cjkBigrams("单")).toEqual(["单"]);
  });

  it("单字检索可命中（bigram-only 索引会漏）", () => {
    const memory = new PlayMemory({ slices: [slice("e1", 1, "小春在旧校舍提到了天文社")] });
    expect(memory.searchArchive("校", new Set(["e1"]))).toHaveLength(1);
    expect(memory.searchArchive("天文", new Set(["e1"]))).toHaveLength(1);
    expect(memory.searchArchive("天文", new Set(["e2"]))).toEqual([]);
  });
});

describe("PlayMemory", () => {
  it("load：craft/premise/index 卡解析（标题/摘要/详情）", async () => {
    const dir = await mkdtemp(join(tmpdir(), "stage-memory-"));
    await mkdir(join(dir, "memory", "always"), { recursive: true });
    await mkdir(join(dir, "memory", "index", "lore"), { recursive: true });
    await writeFile(join(dir, "memory", "always", "craft.md"), "# 守则\n节奏规则…", "utf8");
    await writeFile(join(dir, "memory", "index", "lore", "旧校舍拆除.md"), CARD.detail, "utf8");

    const memory = await PlayMemory.load(new PlayStore(dir));

    expect(memory.craft).toContain("节奏规则");
    expect(memory.premise).toBe("");
    expect(memory.cards).toHaveLength(1);
    expect(memory.cards[0]!.name).toBe("旧校舍拆除");
    expect(memory.cards[0]!.summary).toBe("旧校舍将在文化祭后拆除，具体日期未定。");
    expect(memory.readCard("旧校舍拆除")).toContain("具体日期未定");
    expect(memory.readCard("旧校舍拆除.md")).toContain("具体日期未定"); // 文件名亦可
    expect(memory.readCard("不存在")).toBeNull();
  });

  it("search_archive：命中 + 防剧透（祖先链 ⊆ 当前分支路径）", () => {
    // 树：e1 → e2（分支 A）→ e3；e1 → e4（分支 B）→ e5
    const tree = new LineageTree();
    const e1 = tree.append("scene", { payload: { attrs: { bg: "a" } } });
    const e2 = tree.append("say", { text: "分支A第一拍" });
    const e3 = tree.append("say", { text: "分支A第二拍" });
    tree.jumpTo(e1.id);
    const e4 = tree.append("say", { text: "分支B第一拍" });
    const e5 = tree.append("say", { text: "分支B第二拍" });

    const memory = new PlayMemory({
      slices: [
        slice(e2.id, 1, "小春在旧校舍承认了迟到的原因"),
        slice(e4.id, 1, "小春在旧校舍说出了不同的秘密"),
      ],
    });

    const onA = memory.searchArchive("秘密", tree.pathSet(e3.id));
    expect(onA.map((s) => s.entryId)).toEqual([]); // B 的切片在 A 分支不可见
    const aHits = memory.searchArchive("迟到 原因", tree.pathSet(e3.id));
    expect(aHits.map((s) => s.entryId)).toEqual([e2.id]);

    // 分支 B：召回 B 的切片，A 的不可见
    const bHits = memory.searchArchive("秘密", tree.pathSet(e5.id));
    expect(bHits.map((s) => s.entryId)).toEqual([e4.id]);
    expect(memory.searchArchive("迟到", tree.pathSet(e5.id))).toEqual([]);
  });

  it("appendArchive：追加后可检索；空切片跳过", async () => {
    const dir = await mkdtemp(join(tmpdir(), "stage-memory-archive-"));
    const archiveFile = join(dir, "memory", "archive", "events.jsonl");
    const memory = new PlayMemory({ archiveFile, slices: [slice("e1", 1, "第一拍内容")] });

    await memory.appendArchive(slice("e2", 2, "第二拍：告白发生了"));
    await memory.appendArchive(slice("e3", 3, "  ")); // 空白摘要 → 不落盘

    // 重载：两行 JSONL（e1 预置 + e2 追加；e3 被跳过）
    const reloaded = await PlayMemory.load(new PlayStore(dir));
    expect(reloaded.searchArchive("告白", new Set(["e2"]))).toHaveLength(1);
    // e1 只在内存预置、未落盘；e3 空白摘要被跳过 → 文件仅 e2 一行
    expect(reloaded.searchArchive("第一拍", new Set(["e1"]))).toHaveLength(0);
    expect(reloaded.searchArchive("第二拍", new Set(["e9"]))).toHaveLength(0);
  });

  it("archiveFile=null：纯内存检索，不落盘也不报错", async () => {
    const memory = new PlayMemory({ slices: [slice("e1", 1, "内容")] });
    await memory.appendArchive(slice("e2", 2, "新内容"));
    expect(memory.searchArchive("新内容", new Set(["e2"]))).toHaveLength(1);
  });
});
