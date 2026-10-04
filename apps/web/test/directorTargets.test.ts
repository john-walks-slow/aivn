import { describe, expect, it } from "vitest";
import type { LineageNodeView, LineageView } from "@aivn/core";
import { beatAtLine, buildBeats, editableNodeAtLine } from "../src/stage/beats.js";
import type { ScriptLine } from "../src/stage/script.js";

/** 线性链上的一个事件：parentId 指回前一个 id，就是行级日志的自然形态。 */
function node(
  id: string,
  seq: number,
  kind: LineageNodeView["kind"],
  parentId: string | null,
  onPath = true,
): LineageNodeView {
  return {
    id,
    parentId,
    turn: 0,
    kind,
    actorId: kind === "say" ? "koharu" : null,
    text: null,
    seq,
    onPath,
    editTargetId: null,
    attrs: {},
  } as LineageNodeView;
}

/** 两拍：第一拍 = 布景 + 台词 + 收束，第二拍 = 台词 + 收束。 */
function buildView(extra: LineageNodeView[] = []): LineageView {
  return {
    playId: "demo",
    leafId: "b",
    head: "b",
    nodes: [
      node("a", 0, "scene", null),
      node("a1", 1, "say", "a"),
      node("a2", 2, "thought", "a1"),
      node("aE", 3, "beat_end", "a2"),
      node("b", 4, "say", "aE"),
      node("b1", 5, "narrate", "b"),
      node("bE", 6, "beat_end", "b1"),
      ...extra,
    ],
  } as unknown as LineageView;
}

/** 第二拍由玩家的一句话开出来（常态：点了选项 / 敲了输入 / 排了引导）。 */
function buildViewWithInput(extra: LineageNodeView[] = []): LineageView {
  return {
    playId: "demo",
    leafId: "bE",
    head: "a",
    nodes: [
      node("a", 0, "scene", null),
      node("a1", 1, "say", "a"),
      node("aE", 2, "beat_end", "a1"),
      { ...node("p", 3, "prompt", "aE"), text: "（选择了：道歉）" } as LineageNodeView,
      node("b", 4, "say", "p"),
      node("bE", 5, "beat_end", "b"),
      ...extra,
    ],
  } as unknown as LineageView;
}

const lines: ScriptLine[] = [
  { key: "l1", type: "say", actorId: "koharu", mood: null, text: "行 1", seq: 1 },
  { key: "l2", type: "think", actorId: "koharu", mood: null, text: "行 2", seq: 2 },
  { key: "l4", type: "say", actorId: "koharu", mood: null, text: "行 4", seq: 4 },
  { key: "l5", type: "narrate", actorId: null, mood: null, text: "行 5", seq: 5 },
];

describe("舞台行 → 谱系反查（导演原语的锚点）", () => {
  const cards = buildBeats(buildView(), lines);

  it("当前行落在含它的最内层拍上", () => {
    expect(beatAtLine(cards, lines[0])?.id).toBe("a");
    expect(beatAtLine(cards, lines[1])?.id).toBe("a");
    // 跨过 beat_end 锚点就换拍：这是「重生成这一拍」作用范围的保证
    expect(beatAtLine(cards, lines[2])?.id).toBe("b");
    expect(beatAtLine(cards, lines[3])?.id).toBe("b");
  });

  it("没有当前行就没有拍锚点", () => {
    expect(beatAtLine(cards, null)).toBeNull();
  });

  it("玩家发来的话不落任何一轮：带着 seq 也只用于认领，不拿来锚定", () => {
    // input 行排在两轮之间（seq 3 在 a 拍收束之后、b 拍开口之前）——
    // 不加这个守卫它会错锚到前一拍，回顾工具栏的重来按钮就不该亮
    expect(beatAtLine(cards, { seq: 3, kind: "input" })).toBeNull();
    // 相邻的台词行照常锚定，守卫没有误伤
    expect(beatAtLine(cards, { seq: 3 })?.id).toBe("a");
  });

  it("只有台词三件套给改写目标，布景/收束行没有", () => {
    expect(editableNodeAtLine(buildView(), lines[0])?.id).toBe("a1");
    expect(editableNodeAtLine(buildView(), lines[1])?.id).toBe("a2");
    expect(editableNodeAtLine(buildView(), lines[3])?.id).toBe("b1");
    expect(editableNodeAtLine(buildView(), null)).toBeNull();
  });

  it("布景行不给出可编辑目标（导演栏的 ✎ 应置灰）", () => {
    const sceneLine: ScriptLine = { ...lines[0], key: "l0", type: "scene", text: "黄昏教室", seq: 0 };
    expect(editableNodeAtLine(buildView(), sceneLine)).toBeNull();
  });

  it("废弃分支上的同 seq 行不会被认成可改写的当前行", () => {
    const abandoned = node("x", 1, "say", "a", false);
    expect(editableNodeAtLine(buildView([abandoned]), lines[0])?.id).toBe("a1");
  });
});

describe("重写这一轮退到哪儿（卡片自己算）", () => {
  const lines: ScriptLine[] = [
    { key: "l0", type: "scene", actorId: null, mood: null, text: "黄昏教室", seq: 0 },
    { key: "l1", type: "say", actorId: "mio", mood: null, text: "行 1", seq: 1 },
    { key: "l4", type: "say", actorId: "mio", mood: null, text: "行 4", seq: 4 },
  ];

  it("本轮不是从玩家的一句话开头的：锚本轮之前的那一点（整轮重来）", () => {
    const cards = buildBeats(buildView(), lines);
    const second = beatAtLine(cards, lines[2])!;
    expect(second.id).toBe("b");
    expect(second.rewriteFromId).toBe("aE");
  });

  it("本轮由玩家的一句话开头：锚那句话本身，它留在新枝上（重写的是它之后的回应）", () => {
    const cards = buildBeats(buildViewWithInput(), lines);
    const second = beatAtLine(cards, lines[2])!;
    expect(second.rewriteFromId).toBe("p");
    // 被顶掉的那一拍的首节点仍是这张卡自己（新 fork 标记按它算来源标签）
    expect(second.id).toBe("p");
  });

  it("分叉点正好落在那句输入上：它单独成卡，正文就是这句话，不是「（无台词）」", () => {
    // 重写把 fork 挂在 p 上 —— 输入与它的两条回应各成一张卡
    const fork = {
      ...node("f", 6, "fork", "p"),
      text: "",
      attrs: { origin: "input:（选择了：道歉）" },
    } as LineageNodeView;
    const rewritten = node("n", 10, "say", "f");
    const rewrittenEnd = node("nE", 11, "beat_end", "n");
    const cards = buildBeats(buildViewWithInput([fork, rewritten, rewrittenEnd]), lines);

    const inputCard = cards.find((c) => c.id === "p")!;
    expect(inputCard.nodes.map((n) => n.kind)).toEqual(["prompt"]);
    expect(inputCard.preview).toBe("（选择了：道歉）");
  });
});
