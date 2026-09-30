import { describe, expect, it } from "vitest";
import { LineageTree, type LineageEvent } from "../src/index.js";

/** 物化后取有台词的行（prompt/fork 等无文本节点不进剧本）。 */
function spoken(tree: LineageTree, fromLeaf?: string): (string | undefined)[] {
  return tree
    .materialize(fromLeaf)
    .filter((n) => n.text !== undefined)
    .map((n) => n.text);
}

function buildPlay(tree: LineageTree): { say1: LineageEvent; say2: LineageEvent } {
  const say1 = tree.append("say", { text: "……太慢了！不是约好立刻集合的吗？" });
  tree.append("prompt", { payload: { input: "抱歉，路上耽搁了。" } });
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

    tree.jumpTo(say1.id);
    const newLine = tree.append("say", { text: "新分支第二句" });

    // 分岔到 say1 = say1 保留在新分支，其后的旧行（输入/旧句）不在链上
    const script = tree.materialize();
    expect(script.map((e) => e.text)).toEqual(["……太慢了！不是约好立刻集合的吗？", "新分支第二句"]);
    expect(newLine.parentId).toBe(say1.id);
  });

  it("祖先链与 isAncestor：跨分支不串", () => {
    const tree = new LineageTree();
    const { say1, say2 } = buildPlay(tree);
    const abandoned = tree.append("say", { text: "废弃分支" });
    tree.jumpTo(say1.id);
    const fresh = tree.append("say", { text: "新分支" });

    expect(tree.isAncestor(say1.id, fresh.id)).toBe(true);
    expect(tree.isAncestor(say2.id, fresh.id)).toBe(false);
    expect(tree.isAncestor(abandoned.id, fresh.id)).toBe(false);
    expect(tree.ancestorChain(fresh.id)).toHaveLength(2);
  });

  it("recordFork：挂载点移到目标并落一个 fork 标记，其后内容整段转兄弟分支", () => {
    const tree = new LineageTree();
    const { say1, say2 } = buildPlay(tree);

    const fork = tree.recordFork(say1.id);

    expect(fork.kind).toBe("fork");
    expect(fork.parentId).toBe(say1.id);
    expect(tree.leafId).toBe(fork.id);
    // 锚点本身留在链上（上一轮的选择因此保留、不重新问），它之后的内容不在了
    expect(tree.ancestorChain(fork.id)).toContain(say1.id);
    expect(tree.ancestorChain(fork.id)).not.toContain(say2.id);
    // fork 是结构标记，物化剧本不占行
    expect(tree.materialize().some((e) => e.kind === "fork")).toBe(false);
    expect(spoken(tree)).toEqual(["……太慢了！不是约好立刻集合的吗？"]);

    // 重演的内容挂在 fork 之下，成为 say1 的兄弟分支
    const regen = tree.append("say", { text: "新的一遍。" });
    expect(regen.parentId).toBe(fork.id);
    expect(tree.describe().nodes.find((n) => n.id === say1.id)?.children).toBe(2);
  });
});

describe("原地编辑（旁注，不入树）", () => {
  it("改写旁挂在目标行上：挂载点不动、树里没有 edit 节点", () => {
    const tree = new LineageTree();
    const { say1 } = buildPlay(tree);
    tree.append("narrate", { text: "夜风穿过走廊。" });
    const leafBefore = tree.leafId;

    const edit = tree.recordEdit(say1.id, "……太慢了！不是说了立刻集合吗？");

    // 纯原地：剧情接着往下演，不产生隐藏分支
    expect(tree.leafId).toBe(leafBefore);
    expect(tree.ancestorChain(leafBefore)).not.toContain(edit.id);
    expect(tree.describe().nodes.some((n) => n.kind === "edit")).toBe(false);
    const say1View = tree.describe().nodes.find((n) => n.id === say1.id)!;
    expect(say1View.children).toBe(1);
    expect(say1View.editedText).toBe("……太慢了！不是说了立刻集合吗？");
    expect(say1View.editCount).toBe(1);
    expect(say1View.editedAt).toBeTypeOf("number");
    // 物化生效，其后剧情原样不动
    expect(spoken(tree)).toEqual(["……太慢了！不是说了立刻集合吗？", "算了，上来吧。", "夜风穿过走廊。"]);
  });

  it("同句反复改：物化取最后一条", () => {
    const tree = new LineageTree();
    const { say1 } = buildPlay(tree);
    tree.recordEdit(say1.id, "第一版");
    tree.recordEdit(say1.id, "第二版");

    expect(tree.materialize()[0]!.text).toBe("第二版");
    expect(tree.describe().nodes.find((n) => n.id === say1.id)?.editCount).toBe(2);
  });

  it("非台词行不可编辑", () => {
    const tree = new LineageTree();
    const scene = tree.append("scene", { payload: { attrs: { bg: "hall" } } });
    expect(() => tree.recordEdit(scene.id, "x")).toThrow(/只有台词行可编辑/);
  });

  it("编辑旁注不跨分支：不在当前链上的行拿不到改写", () => {
    const tree = new LineageTree();
    const before = tree.append("narrate", { text: "夜。" });
    const { say1 } = buildPlay(tree);
    tree.recordEdit(say1.id, "改过的第一句");

    // 当前分支：改写生效
    expect(tree.materialize()[1]!.text).toBe("改过的第一句");

    // 分岔到 say1 之前：say1 不在链上，原文原样
    tree.recordFork(before.id);
    expect(spoken(tree)).toEqual(["夜。"]);
  });
});

describe("谱系快照", () => {
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
    tree.recordFork(say2.id);
    tree.append("say", { text: "从快照点重走的分支" });
    const restored = tree.latestSnapshotOnPath();
    expect(restored?.id).toBe(snap1.id);
    expect(restored?.engine.affinity).toEqual({ mio: 10 });

    // 回到 say1（快照之前）：路径上无快照，冷启动
    tree.jumpTo(say1.id);
    expect(tree.latestSnapshotOnPath()).toBeNull();
  });

  it("无快照路径返回 null（冷启动）", () => {
    const tree = new LineageTree();
    tree.append("say", { text: "x" });
    expect(tree.latestSnapshotOnPath()).toBeNull();
  });
});

describe("持久化往返", () => {
  it("事件流导出回放重建：分支结构与物化一致", () => {
    const tree = new LineageTree();
    const { say1 } = buildPlay(tree);
    tree.append("say", { text: "废弃分支" });
    tree.recordFork(say1.id);
    tree.append("say", { text: "新分支" });

    const rebuilt = new LineageTree();
    rebuilt.load(tree.export());

    expect(rebuilt.materialize().map((e) => e.text)).toEqual(tree.materialize().map((e) => e.text));
    expect(rebuilt.leafId).toBe(tree.leafId);
    // 废弃分支也在树上（export 含全部分支）
    expect(rebuilt.export().events).toHaveLength(tree.export().events.length);
  });

  it("编辑旁注与 fork 标记跨进程无损", () => {
    const tree = new LineageTree();
    const { say1 } = buildPlay(tree);
    tree.recordFork(say1.id);
    tree.recordEdit(say1.id, "改过的第一句");
    tree.recordEdit(say1.id, "又改一次");
    tree.append("say", { text: "重演的第一句" });

    const rebuilt = new LineageTree();
    rebuilt.load(tree.export());

    expect(rebuilt.leafId).toBe(tree.leafId);
    expect(rebuilt.materialize().map((e) => e.text)).toEqual(tree.materialize().map((e) => e.text));
    const view = rebuilt.describe().nodes.find((n) => n.id === say1.id)!;
    expect(view.editedText).toBe("又改一次");
    expect(view.editCount).toBe(2);
    // 树事件里没有混进 edit，但 edit 仍随日志落盘
    expect(rebuilt.export().events.some((e) => e.kind === "edit")).toBe(true);
    expect(rebuilt.describe().nodes.some((n) => n.kind === "edit")).toBe(false);
  });

  it("裸分岔状态：导出重载 leaf 不指旧分支末端", () => {
    const tree = new LineageTree();
    const { say1 } = buildPlay(tree);
    tree.append("say", { text: "旧分支末句" });
    tree.jumpTo(say1.id); // 分岔后尚未重生成

    const rebuilt = new LineageTree();
    rebuilt.load(tree.export());
    expect(rebuilt.leafId).toBe(say1.id);
    expect(rebuilt.materialize().map((e) => e.text)).toEqual(["……太慢了！不是约好立刻集合的吗？"]);
    // 重生成内容接到正确分支
    const regen = rebuilt.append("say", { text: "重生成句" });
    expect(regen.parentId).toBe(say1.id);
  });

  it("快照与 seq 锚点跨进程存活", () => {
    const tree = new LineageTree();
    const say1 = tree.append("say", { text: "……太慢了！", payload: { seq: 11 } });
    const say2 = tree.append("say", { text: "算了，上来吧。", payload: { seq: 19 } });
    const snap = tree.saveSnapshot(
      { turn: 2, affinity: { mio: 10 }, flags: {} },
      { state: { scene: "走廊" }, arcs: ["arc1"] },
    );

    const rebuilt = new LineageTree();
    rebuilt.load(tree.export());

    const restored = rebuilt.latestSnapshotOnPath(say2.id);
    expect(restored?.id).toBe(snap.id);
    expect(restored?.engine.affinity).toEqual({ mio: 10 });
    expect(restored?.memory.arcs).toEqual(["arc1"]);
    // 剧本事件的 seq 锚点随事件流往返：路线树据此把每张卡对到剧本首行
    expect(rebuilt.describe().nodes.find((n) => n.id === say1.id)?.seq).toBe(11);
    expect(rebuilt.describe().nodes.find((n) => n.id === say2.id)?.seq).toBe(19);
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

  it("同刻事件排序稳定：describe() 连读两次顺序一致", () => {
    const tree = new LineageTree();
    buildPlay(tree);
    // 模拟同一次工具批次落下的多个事件：时间戳全同，只有 id 能定序
    for (const event of tree.export().events) event.createdAt = 1_700_000_000_000;
    const tree2 = new LineageTree();
    tree2.load(tree.export());

    const first = tree2.describe().nodes.map((n) => n.id);
    expect(first).toEqual([...first].sort((a, b) => a.localeCompare(b)));
    expect(tree2.describe().nodes.map((n) => n.id)).toEqual(first);
  });
});

describe("路径集合（检索防剧透）", () => {
  it("pathSet 一次性判定：祖先链 ⊆ 当前分支路径", () => {
    const tree = new LineageTree();
    const { say1, say2 } = buildPlay(tree);
    const abandoned = tree.append("say", { text: "废弃分支" });
    tree.jumpTo(say1.id);
    tree.append("say", { text: "新分支" });

    const path = tree.pathSet();
    expect(path.has(say1.id)).toBe(true);
    expect(path.has(say2.id)).toBe(false);
    expect(path.has(abandoned.id)).toBe(false);
  });
});
