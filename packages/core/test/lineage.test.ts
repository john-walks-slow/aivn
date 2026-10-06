import { describe, expect, it } from "vitest";
import { LineageTree, originOfBeat, type LineageEvent } from "../src/index.js";

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
  it("append 按序挂链，turn 递增，首个业务节点接在哨兵节点后", () => {
    const tree = new LineageTree();
    const a = tree.append("scene", { payload: { attrs: { bg: "hall" } } });
    const b = tree.append("narrate", { text: "夜。" });
    expect(a.parentId).toBe("root");
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
    // 包含哨兵节点: [root, say1, fresh]
    expect(tree.ancestorChain(fresh.id)).toHaveLength(3);
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

describe("插图旁注（回看中生图，不入树）", () => {
  it("图挂在那一行上：挂载点不动、树里没有 cg 节点、物化照旧", () => {
    const tree = new LineageTree();
    const { say1 } = buildPlay(tree);
    tree.append("narrate", { text: "夜风穿过走廊。" });
    const leafBefore = tree.leafId;

    const note = tree.recordCg(say1.id, "cg_back");

    expect(tree.leafId).toBe(leafBefore);
    expect(tree.ancestorChain(leafBefore)).not.toContain(note.id);
    expect(tree.describe().nodes.some((n) => n.kind === "cg")).toBe(false);
    const view = tree.describe().nodes.find((n) => n.id === say1.id)!;
    expect(view.children).toBe(1);
    expect(view.cgs).toEqual(["cg_back"]);
    expect(spoken(tree)).toEqual(["……太慢了！不是约好立刻集合的吗？", "算了，上来吧。", "夜风穿过走廊。"]);
  });

  it("同一行挂两张：按挂上的先后排列，末位最新", () => {
    const tree = new LineageTree();
    const { say1, say2 } = buildPlay(tree);
    tree.recordCg(say1.id, "cg_first");
    tree.recordCg(say1.id, "cg_second");

    expect(tree.describe().nodes.find((n) => n.id === say1.id)?.cgs).toEqual(["cg_first", "cg_second"]);
    // 没挂过的行是空表
    expect(tree.describe().nodes.find((n) => n.id === say2.id)?.cgs).toEqual([]);
  });

  it("挂到不存在的节点上报错，不静默丢图", () => {
    const tree = new LineageTree();
    buildPlay(tree);
    expect(() => tree.recordCg("e-not-here-1", "cg_x")).toThrow(/谱系节点不存在/);
  });

  it("插图旁注跨进程无损：树里查不到，日志里有", () => {
    const tree = new LineageTree();
    const { say1 } = buildPlay(tree);
    tree.recordCg(say1.id, "cg_back");
    tree.recordEdit(say1.id, "改过的第一句");

    const rebuilt = new LineageTree();
    rebuilt.load(tree.export());

    expect(rebuilt.leafId).toBe(tree.leafId);
    expect(rebuilt.describe().nodes.find((n) => n.id === say1.id)?.cgs).toEqual(["cg_back"]);
    expect(rebuilt.describe().nodes.some((n) => n.kind === "cg")).toBe(false);
    // 旁注（改写与插图）仍随日志落盘，且顺序不因谁先谁后而丢
    expect(rebuilt.export().events.filter((e) => e.kind === "cg" || e.kind === "edit")).toHaveLength(2);
  });

  it("剪掉一段时挂在它上面的插图跟着清掉", () => {
    const tree = new LineageTree();
    tree.append("say", { text: "开场" });
    const target = tree.append("say", { text: "会被剪掉的一句" });
    tree.recordCg(target.id, "cg_doomed");

    tree.removeSubtree(target.id);

    expect(tree.export().events.some((e) => e.kind === "cg")).toBe(false);
  });
});

describe("谱系快照", () => {
  it("快照随分支走：路径上最近快照可恢复，旧分支看不到未来", () => {
    const tree = new LineageTree();
    const { say1, say2 } = buildPlay(tree);
    const snap1 = tree.saveSnapshot({
      engine: { turn: 2, affinity: { mio: 10 }, flags: {} },
      stateFiles: { scene: "走廊" },
      nsfw: false,
    });
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
    const snap = tree.saveSnapshot({
      engine: { turn: 2, affinity: { mio: 10 }, flags: {} },
      stateFiles: { scene: "走廊" },
      compaction: { summary: "两人走到旧校舍。", cutNodeId: say1.id, tokensBefore: 900 },
      nsfw: false,
    });

    const rebuilt = new LineageTree();
    rebuilt.load(tree.export());

    const restored = rebuilt.latestSnapshotOnPath(say2.id);
    expect(restored?.id).toBe(snap.id);
    expect(restored?.engine.affinity).toEqual({ mio: 10 });
    expect(restored?.compaction).toEqual({
      summary: "两人走到旧校舍。",
      cutNodeId: say1.id,
      tokensBefore: 900,
    });
    // 剧本事件的 seq 锚点随事件流往返：路线树据此把每张卡对到剧本首行
    expect(rebuilt.describe().nodes.find((n) => n.id === say1.id)?.seq).toBe(11);
    expect(rebuilt.describe().nodes.find((n) => n.id === say2.id)?.seq).toBe(19);
  });

  it("重启后 id 计数器播种，新 id 不与已有碰撞", () => {
    const tree = new LineageTree();
    buildPlay(tree);
    const before = tree.export();
    const maxCounter = Math.max(
      ...before.events
        .filter((e) => e.id.includes("-"))
        .map((e) => Number.parseInt(e.id.split("-")[1]!, 36)),
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

/** 一轮的骨架：输入节点 → 若干台词 → beat_end。返回这几个锚点。 */
function buildBeat(
  tree: LineageTree,
  input: string,
  text: string,
): { prompt: LineageEvent; say: LineageEvent; end: LineageEvent } {
  const prompt = tree.append("prompt", { payload: { input } });
  const say = tree.append("say", { text });
  const end = tree.append("beat_end", { payload: { reason: "stop" } });
  return { prompt, say, end };
}

describe("来源标签（回到旧轮时认出同一拍）", () => {
  it("prompt 节点是那次输入的原话，其余是 continue", () => {
    const tree = new LineageTree();
    const prompt = tree.append("prompt", { payload: { input: "（选择了：道歉）" } });
    const say = tree.append("say", { text: "算了。" });
    const end = tree.append("beat_end", { payload: { reason: "stop" } });

    expect(originOfBeat(prompt)).toBe("input:（选择了：道歉）");
    // 「继续」不落 prompt 节点，它的身份就是「没有输入」
    expect(originOfBeat(say)).toBe("continue");
    expect(originOfBeat(end)).toBe("continue");
  });

  it("fork 继承被顶掉那一拍的来源；没带就退回 continue", () => {
    const tree = new LineageTree();
    const anchor = tree.append("beat_end", { payload: { reason: "stop" } });

    const inherited = tree.recordFork(anchor.id, { origin: "input:（选择了：道歉）" });
    expect(inherited.payload?.origin).toBe("input:（选择了：道歉）");
    expect(originOfBeat(inherited)).toBe("input:（选择了：道歉）");

    const bare = tree.recordFork(anchor.id);
    expect(originOfBeat(bare)).toBe("continue");
  });
});

describe("childrenOf / beatEndFrom（一拍的末节点）", () => {
  it("childrenOf 按落笔顺序给出直接子节点", () => {
    const tree = new LineageTree();
    const anchor = tree.append("beat_end", { payload: { reason: "stop" } });
    const first = tree.append("prompt", { payload: { input: "a" } });
    tree.jumpTo(anchor.id);
    const second = tree.append("prompt", { payload: { input: "b" } });
    // 两个兄弟之外，first 自己还有一个孩子，不该混进来
    tree.jumpTo(first.id);
    tree.append("say", { text: "x" });

    expect(tree.childrenOf(anchor.id).map((e) => e.id)).toEqual([first.id, second.id]);
  });

  it("沿唯一子节点走到 beat_end", () => {
    const tree = new LineageTree();
    tree.append("scene", { payload: { attrs: { bg: "hall" } } });
    const { prompt, end } = buildBeat(tree, "（选择了：X）", "那就这样吧。");
    expect(tree.beatEndFrom(prompt.id)).toBe(end.id);
  });

  it("分岔标记属于下一段：走到 fork 前就停", () => {
    const tree = new LineageTree();
    const head = tree.append("say", { text: "第一句" });
    tree.recordFork(head.id);
    tree.append("say", { text: "重写出来的那句" });

    expect(tree.beatEndFrom(head.id)).toBe(head.id);
  });

  it("轮中被截断（子节点不唯一）就停在截断处", () => {
    const tree = new LineageTree();
    const head = tree.append("say", { text: "分岔点" });
    tree.append("say", { text: "旧的后半截" });
    tree.jumpTo(head.id);
    tree.append("say", { text: "新的后半截" });

    expect(tree.beatEndFrom(head.id)).toBe(head.id);
  });

  it("没有子节点就是这一拍的末尾", () => {
    const tree = new LineageTree();
    tree.append("beat_end", { payload: { reason: "no_stop" } });
    const tail = tree.append("say", { text: "写到一半" });
    expect(tree.beatEndFrom(tail.id)).toBe(tail.id);
  });

  it("首节点是 fork 且恰好一个孩子：照样走到底", () => {
    const tree = new LineageTree();
    const anchor = tree.append("beat_end", { payload: { reason: "stop" } });
    const fork = tree.recordFork(anchor.id, { origin: "input:X" });
    const { end } = buildBeat(tree, "（选择了：X）", "重写的一拍。");

    expect(tree.beatEndFrom(fork.id)).toBe(end.id);
  });

  it("空壳 fork 与岔口 fork 都无解（返回 null），调用方必须处理", () => {
    const tree = new LineageTree();
    const anchor = tree.append("beat_end", { payload: { reason: "stop" } });

    // 空壳：子树被剪光之后剩下的那个标记
    const shell = tree.recordFork(anchor.id, { origin: "input:X" });
    expect(tree.beatEndFrom(shell.id)).toBeNull();

    // 岔口：一个 fork 底下长出两条枝，没有「唯一的一拍」
    tree.jumpTo(shell.id);
    tree.append("say", { text: "第一版" });
    tree.jumpTo(shell.id);
    tree.append("say", { text: "第二版" });
    expect(tree.beatEndFrom(shell.id)).toBeNull();
  });
});

describe("剪枝（删除一段及其后代）", () => {
  it("连根删：挂载点在删除集里就回落到父节点", () => {
    const tree = new LineageTree();
    const root = tree.append("say", { text: "开场" });
    const mid = tree.append("say", { text: "中段" });
    const tail = tree.append("say", { text: "末句" });

    const removed = tree.removeSubtree(mid.id);

    expect(removed).toEqual([mid.id, tail.id]);
    expect(tree.get(mid.id)).toBeUndefined();
    expect(tree.leafId).toBe(root.id);
  });

  it("删别的枝不动世界线", () => {
    const tree = new LineageTree();
    tree.append("say", { text: "开场" });
    const anchor = tree.append("beat_end", { payload: { reason: "stop" } });
    const b1 = tree.append("prompt", { payload: { input: "（选择了：X）" } });
    tree.append("say", { text: "X 枝" });
    tree.jumpTo(anchor.id);
    const c1 = tree.append("prompt", { payload: { input: "（选择了：Y）" } });
    const c2 = tree.append("say", { text: "Y 枝" });

    tree.removeSubtree(b1.id);

    expect(tree.get(b1.id)).toBeUndefined();
    expect(tree.get(c1.id)).toBeDefined();
    expect(tree.leafId).toBe(c2.id);
  });

  it("快照与改写旁注跟着被删的枝一起清掉", () => {
    const tree = new LineageTree();
    tree.append("say", { text: "开场" });
    const target = tree.append("say", { text: "会被剪掉的一句" });
    tree.saveSnapshot({ engine: { turn: 1, affinity: {}, flags: {} }, stateFiles: {}, nsfw: false });
    tree.recordEdit(target.id, "改过的一句");

    tree.removeSubtree(target.id);

    expect(tree.export().snapshots).toHaveLength(0);
    expect(tree.export().events.some((e) => e.kind === "edit")).toBe(false);
  });

  it("剪完把空壳 fork 一并清掉：下次回到同一锚点不会命中一片空白", () => {
    const tree = new LineageTree();
    tree.append("say", { text: "开场" });
    const anchor = tree.append("beat_end", { payload: { reason: "stop" } });
    const fork = tree.recordFork(anchor.id, { origin: "input:（选择了：X）" });
    const head = tree.append("prompt", { payload: { input: "（选择了：X）" } });
    const end = tree.append("beat_end", { payload: { reason: "stop" } });

    const removed = tree.removeSubtree(head.id);

    expect(removed).toEqual([head.id, end.id, fork.id]);
    expect(tree.get(fork.id)).toBeUndefined();
    expect(tree.childrenOf(anchor.id)).toHaveLength(0);
    expect(tree.leafId).toBe(anchor.id);
  });

  it("空壳会一级一级往上清（fork 叠 fork）", () => {
    const tree = new LineageTree();
    tree.append("say", { text: "开场" });
    const anchor = tree.append("beat_end", { payload: { reason: "stop" } });
    const outer = tree.recordFork(anchor.id, { origin: "input:X" });
    const inner = tree.recordFork(outer.id, { origin: "input:X" });
    const say = tree.append("say", { text: "最后一句" });

    const removed = tree.removeSubtree(say.id);

    expect(removed).toEqual([say.id, inner.id, outer.id]);
    expect(tree.childrenOf(anchor.id)).toHaveLength(0);
    expect(tree.leafId).toBe(anchor.id);
  });

  it("哨兵节点：自带 root 节点，不可删除，删除首轮后回退到哨兵节点", () => {
    const tree = new LineageTree();
    expect(tree.leafId).toBe("root");
    const rootNode = tree.get("root");
    expect(rootNode).toBeDefined();
    expect(rootNode?.kind).toBe("root");
    expect(rootNode?.parentId).toBeNull();

    expect(() => tree.removeSubtree("root")).toThrow("哨兵节点不可删除");

    const firstSay = tree.append("say", { text: "第一轮第一句" });
    expect(firstSay.parentId).toBe("root");
    expect(tree.leafId).toBe(firstSay.id);

    // 删除第一轮
    const removed = tree.removeSubtree(firstSay.id);
    expect(removed).toContain(firstSay.id);
    expect(tree.leafId).toBe("root");
  });

  it("旧存档加载：没有 root 节点的旧存档自动补上 root 并将根事件重定向到 root", () => {
    const oldStore = {
      events: [
        { id: "e1", parentId: null, kind: "scene" as const, turn: 1, createdAt: 100 },
        { id: "e2", parentId: "e1", kind: "say" as const, turn: 2, text: "旧台词", createdAt: 200 },
      ],
      leafId: "e2",
      snapshots: [],
    };
    const tree = new LineageTree();
    tree.load(oldStore);

    expect(tree.get("root")).toBeDefined();
    expect(tree.get("e1")?.parentId).toBe("root");
    expect(tree.ancestorChain("e2")).toEqual(["root", "e1", "e2"]);
    expect(tree.materialize().map((e) => e.id)).toEqual(["e1", "e2"]);
  });
});
