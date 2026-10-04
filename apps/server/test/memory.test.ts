import { describe, expect, it } from "vitest";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { LineageTree } from "@aivn/core";
import { PlayMemory, cjkBigrams, type ArchiveSlice, type IndexCard } from "../src/memory.js";
import { PlayStore } from "../src/store.js";

const CARD: IndexCard = {
  layer: "lore",
  arc: false,
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
    expect(memory.readCard("lore/旧校舍拆除")).toContain("具体日期未定"); // 相对 index/ 的路径亦可
    expect(memory.readCard("不存在")).toBeNull();
  });

  it("load：index 收任意子目录（含多层嵌套），layer 是相对 index/ 的路径", async () => {
    const dir = await mkdtemp(join(tmpdir(), "stage-memory-"));
    await mkdir(join(dir, "memory", "index", "locations"), { recursive: true });
    await mkdir(join(dir, "memory", "index", "lore", "结界"), { recursive: true });
    await writeFile(join(dir, "memory", "index", "旧约定.md"), "# 旧约定\n顶层卡不必分类。\n", "utf8");
    await writeFile(join(dir, "memory", "index", "locations", "旧校舍.md"), "# 旧校舍\n四层走廊。\n", "utf8");
    await writeFile(join(dir, "memory", "index", "lore", "结界", "代价.md"), "# 代价\n每破一次结界折寿一年。\n", "utf8");
    // arcs 在 index 之外：它的文件名是谱系快照引用的 arcId，不能跟用户卡混在一起
    await mkdir(join(dir, "memory", "arcs"), { recursive: true });
    await writeFile(join(dir, "memory", "arcs", "epoch-e1-1.md"), "# 第一纪元\n两人走到旧校舍。\n", "utf8");

    const memory = await PlayMemory.load(new PlayStore(dir));

    const byFile = new Map(memory.cards.map((c) => [c.file, c]));
    expect([...byFile.keys()].sort()).toEqual(["epoch-e1-1", "locations/旧校舍", "lore/结界/代价", "旧约定"]);
    expect(byFile.get("旧约定")!.layer).toBe(""); // 顶层卡没有分类
    expect(byFile.get("locations/旧校舍")!.layer).toBe("locations");
    expect(byFile.get("lore/结界/代价")!.layer).toBe("lore/结界");
    expect(byFile.get("epoch-e1-1")!.layer).toBe("arcs");
    // arcs 按分支过滤：不在这条分支上的纪元摘要一律不注入 A 区
    expect(memory.visibleCards([]).map((c) => c.file)).toEqual(["locations/旧校舍", "lore/结界/代价", "旧约定"]);
    expect(memory.visibleCards(["epoch-e1-1"]).map((c) => c.file)).toContain("epoch-e1-1");
  });

  it("用户自己建的 index/arcs/ 卡不被当成纪元卡过滤掉", async () => {
    const dir = await mkdtemp(join(tmpdir(), "stage-memory-"));
    await mkdir(join(dir, "memory", "index", "arcs"), { recursive: true });
    // 目录名叫 arcs、文件名也是 arcId 形状，但它没有 arc 标记：这是剧目设定卡
    await writeFile(join(dir, "memory", "index", "arcs", "prologue.md"), "# 序章设定\n故事开场就发生在结界里。\n", "utf8");
    const memory = await PlayMemory.load(new PlayStore(dir));
    const card = memory.cards[0]!;
    expect(card.layer).toBe("arcs");
    expect(card.arc).toBe(false);
    // 不在当前分支上也得看得见——否则用户的设定卡会在 A 区里凭空消失
    expect(memory.visibleCards([]).map((c) => c.file)).toEqual(["arcs/prologue"]);
  });

  it("卡没写 # 标题时用文件名，读详情认文件名/相对路径/标题三种写法", async () => {
    const dir = await mkdtemp(join(tmpdir(), "stage-memory-"));
    await mkdir(join(dir, "memory", "index", "locations"), { recursive: true });
    await writeFile(join(dir, "memory", "index", "locations", "school.md"), "没有标题行，只有正文。\n", "utf8");
    const memory = await PlayMemory.load(new PlayStore(dir));
    expect(memory.cards[0]!.name).toBe("school");
    expect(memory.readCard("school")).toContain("没有标题行");
    expect(memory.readCard("school.md")).toContain("没有标题行");
    expect(memory.readCard("locations/school")).toContain("没有标题行");
  });

  it("search_archive：命中 + 防剧透（祖先链 ⊆ 当前分支路径）", () => {
    // 树：e1 → e2（分支 A）→ e3；e1 → e4（分支 B）→ e5
    const tree = new LineageTree();
    const e1 = tree.append("scene", { payload: { attrs: { bg: "a" } } });
    const e2 = tree.append("say", { text: "分支A第一轮" });
    const e3 = tree.append("say", { text: "分支A第二轮" });
    tree.jumpTo(e1.id);
    const e4 = tree.append("say", { text: "分支B第一轮" });
    const e5 = tree.append("say", { text: "分支B第二轮" });

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
    const memory = new PlayMemory({ archiveFile, slices: [slice("e1", 1, "第一轮内容")] });

    await memory.appendArchive(slice("e2", 2, "第二轮：告白发生了"));
    await memory.appendArchive(slice("e3", 3, "  ")); // 空白摘要 → 不落盘

    // 重载：两行 JSONL（e1 预置 + e2 追加；e3 被跳过）
    const reloaded = await PlayMemory.load(new PlayStore(dir));
    expect(reloaded.searchArchive("告白", new Set(["e2"]))).toHaveLength(1);
    // e1 只在内存预置、未落盘；e3 空白摘要被跳过 → 文件仅 e2 一行
    expect(reloaded.searchArchive("第一轮", new Set(["e1"]))).toHaveLength(0);
    expect(reloaded.searchArchive("第二轮", new Set(["e9"]))).toHaveLength(0);
  });

  it("archiveFile=null：纯内存检索，不落盘也不报错", async () => {
    const memory = new PlayMemory({ slices: [slice("e1", 1, "内容")] });
    await memory.appendArchive(slice("e2", 2, "新内容"));
    expect(memory.searchArchive("新内容", new Set(["e2"]))).toHaveLength(1);
  });

  it("限制级切片：SFW 侧跳过原文、命中段末摘要；NSFW 侧两片都看得到", async () => {
    // 同一叶节点、同一轮上的两片：露骨原文（带标）与它带出的摘要（不带标）
    const memory = new PlayMemory({
      slices: [
        { entryId: "e1", turn: 3, at: 0, summary: "两人在床上赤裸相拥", nsfw: true },
        { entryId: "e1", turn: 3, at: 1, summary: "两人互诉心意，关系有了突破" },
      ],
    });
    const allowed = new Set(["e1"]);

    const sfw = memory.searchArchive("两人", allowed);
    expect(sfw).toHaveLength(1);
    expect(sfw[0]?.summary).toBe("两人互诉心意，关系有了突破");

    const raw = memory.searchArchive("两人", allowed, { nsfw: true });
    expect(raw.map((s) => s.summary).sort()).toEqual([
      "两人互诉心意，关系有了突破",
      "两人在床上赤裸相拥",
    ]);
  });

  it("限制级原文在 SFW 侧搜不出来：不带摘要的段内切片一律不可见", async () => {
    const memory = new PlayMemory({
      slices: [{ entryId: "e1", turn: 1, at: 0, summary: "赤裸的细节", nsfw: true }],
    });
    expect(memory.searchArchive("细节", new Set(["e1"]))).toEqual([]);
    expect(memory.searchArchive("细节", new Set(["e1"]), { nsfw: true })).toHaveLength(1);
  });

  it("设定卡落盘后 load 读得回来：用户卡段在前、arcs 段在后（行序即提示词前缀）", async () => {
    const dir = await mkdtemp(join(tmpdir(), "stage-memory-"));
    await mkdir(join(dir, "memory", "index", "locations"), { recursive: true });
    await mkdir(join(dir, "memory", "arcs"), { recursive: true });
    await writeFile(join(dir, "memory", "index", "locations", "天文台.md"), "# 天文台\n社团活动室在顶楼。\n", "utf8");
    await writeFile(join(dir, "memory", "index", "zzz.md"), "# 末位\n最后一张。\n", "utf8");
    await writeFile(join(dir, "memory", "arcs", "epoch-a-1.md"), "# 第一纪\n摘要\n", "utf8");

    const memory = await PlayMemory.load(new PlayStore(dir));
    expect(memory.readCard("天文台")).toContain("顶楼");
    // 用户卡段按 file localeCompare 排在前，arcs 段整体在后（loadArcs 的次序不参与重排）
    expect(memory.cards.map((c) => `${c.arc ? "arc" : "user"}:${c.file}`)).toEqual([
      "user:locations/天文台",
      "user:zzz",
      "arc:epoch-a-1",
    ]);
    // 用户卡是剧目设定，不随分支可见性变化
    expect(memory.visibleContext([]).map((c) => c.name)).toEqual(["天文台", "末位"]);
  });
});
