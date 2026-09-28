import { describe, expect, it } from "vitest";
import { LineageTree, type LineageEvent } from "../src/index.js";

function buildPlay(tree: LineageTree): { say1: LineageEvent; say2: LineageEvent } {
  const say1 = tree.append("say", { text: "……太慢了！不是约好立刻集合的吗？" });
  tree.append("player", { payload: { input: "抱歉，路上耽搁了。" } });
  const say2 = tree.append("say", { text: "算了，上来吧。" });
  return { say1, say2 };
}

describe("行级事件与分支树", () => {
  it("append 按序挂链，turn 递增", () => {
    const tree = new LineageTree();
    const a = tree.append("scene", { payload: { attrs: { bg: "hall" } } });
    const b = tree.append("narrate", { text: "夜。" });
    expect(a.parentId).toBeNull();
    expect(b.parentId).toBe(a.id);
    expect(b.turn).toBe(a.turn + 1);
    expect(tree.leafId).toBe(b.id);
  });

  it("分岔：从历史节点开新分支，旧分支保留", () => {
    const tree = new LineageTree();
    const { say1 } = buildPlay(tree);
    tree.append("say", { text: "旧分支第三句" });

    tree.forkAt(say1.id);
    const newLine = tree.append("say", { text: "新分支第二句" });

    // 分岔到 say1 = say1 保留在新分支，其后的旧行（player/旧句）不在链上
    const script = tree.materialize();
    expect(script.map((e) => e.text)).toEqual(["……太慢了！不是约好立刻集合的吗？", "新分支第二句"]);
    expect(newLine.parentId).toBe(say1.id);
  });

  it("祖先链与 isAncestor：跨分支不串", () => {
    const tree = new LineageTree();
    const { say1, say2 } = buildPlay(tree);
    const abandoned = tree.append("say", { text: "废弃分支" });
    tree.forkAt(say1.id);
    const fresh = tree.append("say", { text: "新分支" });

    expect(tree.isAncestor(say1.id, fresh.id)).toBe(true);
    expect(tree.isAncestor(say2.id, fresh.id)).toBe(false);
    expect(tree.isAncestor(abandoned.id, fresh.id)).toBe(false);
    expect(tree.ancestorChain(fresh.id)).toHaveLength(2);
  });

  it("原地编辑：日志 append-only，物化覆盖目标行", () => {
    const tree = new LineageTree();
    const { say1 } = buildPlay(tree);
    tree.editInPlace(say1.id, "……太慢了！不是说了立刻集合吗？");

    const script = tree.materialize();
    expect(script[0]).toMatchObject({ id: say1.id, text: "……太慢了！不是说了立刻集合吗？" });
    expect(script.some((e) => e.kind === "edit")).toBe(false);
  });

  it("原地编辑不跨分支：分岔回编辑前的节点看到原文", () => {
    const tree = new LineageTree();
    const { say1 } = buildPlay(tree);
    tree.editInPlace(say1.id, "改写后的第一句");
    // 当前分支：编辑生效
    expect(tree.materialize()[0]!.text).toBe("改写后的第一句");
    // 分岔回 say1（edit 事件挂在 say1 之后的原链上，不在此链）：原文
    tree.forkAt(say1.id);
    expect(tree.materialize()[0]!.text).toBe("……太慢了！不是约好立刻集合的吗？");
  });

  it("非台词行不可编辑", () => {
    const tree = new LineageTree();
    const scene = tree.append("scene", { payload: { attrs: { bg: "hall" } } });
    expect(() => tree.editInPlace(scene.id, "x")).toThrow(/只有台词行可编辑/);
  });

  it("重写标注：回退到目标之前（父节点），目标行留在废弃分支", () => {
    const tree = new LineageTree();
    const { say1, say2 } = buildPlay(tree);
    // 重写 say2：挂载点回到 say2 的父节点（player），say2 作废
    const rewrite = tree.recordRewrite(say2.id, "line", "更傲娇一点");
    expect(rewrite.parentId).not.toBe(say2.id);
    expect(tree.ancestorChain(rewrite.id)).not.toContain(say2.id);
    expect(rewrite.payload).toMatchObject({ granularity: "line", instruction: "更傲娇一点" });
    const regen = tree.append("say", { text: "哼，居然才来。" });
    expect(regen.parentId).toBe(rewrite.id);
    // rewrite 是结构标注，物化剧本不占行
    expect(tree.materialize().some((e) => e.kind === "rewrite")).toBe(false);
  });
});

describe("谱系快照与书签", () => {
  it("快照随分支走：路径上最近快照可恢复，旧分支看不到未来", () => {
    const tree = new LineageTree();
    const { say1, say2 } = buildPlay(tree);
    const snap1 = tree.saveSnapshot(
      { turn: 2, affinity: { mio: 10 }, flags: {} },
      { state: { scene: "走廊" }, arcs: [] },
    );
    expect(snap1.nodeId).toBe(say2.id);

    tree.append("say", { text: "第三章剧情（未来）" });
    // 从 say2 之后分岔：快照在链上，可恢复
    tree.forkAt(say2.id);
    tree.append("say", { text: "从快照点重走的分支" });
    const restored = tree.latestSnapshotOnPath();
    expect(restored?.id).toBe(snap1.id);
    expect(restored?.engine.affinity).toEqual({ mio: 10 });

    // 回到 say1（快照之前）：路径上无快照，冷启动
    tree.forkAt(say1.id);
    expect(tree.latestSnapshotOnPath()).toBeNull();
  });

  it("无快照路径返回 null（冷启动）", () => {
    const tree = new LineageTree();
    tree.append("say", { text: "x" });
    expect(tree.latestSnapshotOnPath()).toBeNull();
  });

  it("书签挂节点，列表按时间排序", () => {
    const tree = new LineageTree();
    const { say1, say2 } = buildPlay(tree);
    tree.addBookmark(say1.id, "初遇");
    tree.addBookmark(say2.id, "和解");
    const marks = tree.listBookmarks();
    expect(marks.map((m) => m.name)).toEqual(["初遇", "和解"]);
    expect(marks[1]!.nodeId).toBe(say2.id);
  });
});

describe("持久化往返", () => {
  it("事件流导出回放重建：分支结构与物化一致", () => {
    const tree = new LineageTree();
    const { say1 } = buildPlay(tree);
    tree.append("say", { text: "废弃分支" });
    tree.forkAt(say1.id);
    tree.append("say", { text: "新分支" });

    const rebuilt = new LineageTree();
    rebuilt.load(tree.export());

    expect(rebuilt.materialize().map((e) => e.text)).toEqual(tree.materialize().map((e) => e.text));
    expect(rebuilt.leafId).toBe(tree.leafId);
    // 废弃分支也在树上（export 含全部分支）
    expect(rebuilt.export().events).toHaveLength(tree.export().events.length);
  });

  it("裸分岔状态：导出重载 leaf 不指旧分支末端", () => {
    const tree = new LineageTree();
    const { say1 } = buildPlay(tree);
    tree.append("say", { text: "旧分支末句" });
    tree.forkAt(say1.id); // 分岔后尚未重生成

    const rebuilt = new LineageTree();
    rebuilt.load(tree.export());
    expect(rebuilt.leafId).toBe(say1.id);
    expect(rebuilt.materialize().map((e) => e.text)).toEqual(["……太慢了！不是约好立刻集合的吗？"]);
    // 重生成内容接到正确分支
    const regen = rebuilt.append("say", { text: "重生成句" });
    expect(regen.parentId).toBe(say1.id);
  });

  it("快照与书签跨进程存活", () => {
    const tree = new LineageTree();
    const { say1, say2 } = buildPlay(tree);
    const snap = tree.saveSnapshot(
      { turn: 2, affinity: { mio: 10 }, flags: {} },
      { state: { scene: "走廊" }, arcs: ["arc1"] },
    );
    tree.addBookmark(say1.id, "初遇");

    const rebuilt = new LineageTree();
    rebuilt.load(tree.export());

    const restored = rebuilt.latestSnapshotOnPath(say2.id);
    expect(restored?.id).toBe(snap.id);
    expect(restored?.engine.affinity).toEqual({ mio: 10 });
    expect(restored?.memory.arcs).toEqual(["arc1"]);
    expect(rebuilt.listBookmarks().map((b) => b.name)).toEqual(["初遇"]);
  });

  it("重启后 id 计数器播种，新 id 不与已有碰撞", () => {
    const tree = new LineageTree();
    buildPlay(tree);
    const before = tree.export();
    const maxCounter = Math.max(
      ...before.events.map((e) => Number.parseInt(e.id.split("-")[1]!, 36)),
    );

    const rebuilt = new LineageTree();
    rebuilt.load(before);
    const fresh = rebuilt.append("say", { text: "新句" });
    expect(Number.parseInt(fresh.id.split("-")[1]!, 36)).toBeGreaterThan(maxCounter);
  });
});

describe("路径集合（检索防剧透）", () => {
  it("pathSet 一次性判定：祖先链 ⊆ 当前分支路径", () => {
    const tree = new LineageTree();
    const { say1, say2 } = buildPlay(tree);
    const abandoned = tree.append("say", { text: "废弃分支" });
    tree.forkAt(say1.id);
    tree.append("say", { text: "新分支" });

    const path = tree.pathSet();
    expect(path.has(say1.id)).toBe(true);
    expect(path.has(say2.id)).toBe(false);
    expect(path.has(abandoned.id)).toBe(false);
  });
});
