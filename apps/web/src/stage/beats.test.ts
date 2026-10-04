import { describe, expect, it } from "vitest";
import type { LineageNodeView, LineageView } from "@aivn/core";
import { buildBeats, firstLineOf } from "./beats.js";
import type { ScriptLine } from "./script.js";

type NodeSpec = [
  id: string,
  kind: LineageNodeView["kind"],
  seq?: number,
  text?: string,
  onPath?: boolean,
  attrs?: Record<string, string>,
];

function view(specs: NodeSpec[], leafId: string): LineageView {
  const nodes = specs.map(([id, kind, seq, text, onPath = true, attrs = {}], index) => ({
    id,
    parentId: index > 0 ? specs[index - 1]![0] : null,
    turn: 1,
    kind,
    text: text ?? "",
    attrs,
    createdAt: 1_700_000_000_000 + index,
    onPath,
    children: 0,
    editedText: null,
    editCount: 0,
    editedAt: undefined,
    seq,
    cgs: [],
  }));
  return { nodes, leafId, pathIds: nodes.filter((n) => n.onPath).map((n) => n.id) };
}

function line(key: string, seq: number, text: string, type: ScriptLine["type"] = "say"): ScriptLine {
  return { key, seq, text, type };
}

/** 控制指令行：舞台上是布景/音效，落到卡上就是 `bg_xxx · bgm_yyy` 这种工程串。 */
function sceneLine(key: string, seq: number, text: string): ScriptLine {
  return line(key, seq, text, "scene");
}

describe("buildBeats 一轮一卡", () => {
  it("beat_end 收束、换场景不切轮", () => {
    const cards = buildBeats(
      view(
        [
          ["a", "say", 1, "第一句"],
          ["b", "scene", 4, undefined, true, { bg: "bg-rooftop" }],
          ["c", "say", 5, "第二句"],
          ["d", "beat_end"],
          ["e", "say", 9, "下一轮"],
          ["f", "beat_end"],
        ],
        "f",
      ),
      [],
    );
    expect(cards.map((card) => card.id)).toEqual(["a", "e"]);
    expect(cards[0]!.startSeq).toBe(1);
    expect(cards[1]!.startSeq).toBe(9);
    expect(cards[0]!.sceneBg).toBe("bg-rooftop");
    expect(cards[0]!.nodes).toHaveLength(4);
    // 卡上给玩家看的是这一拍落笔的时刻
    expect(cards[0]!.at).toBe(1_700_000_000_000);
  });

  it("挂回祖先即分岔口：新卡 depth+1、废弃分支标记", () => {
    const cards = buildBeats(
      view(
        [
          ["a", "say", 1, "第一句"],
          ["b", "say", 5, "第二句"],
          ["c", "beat_end"],
          ["d", "say", 6, "分出去的版本", false],
          ["e", "beat_end", undefined, undefined, false],
          ["f", "say", 12, "原路继续"],
          ["g", "beat_end"],
        ],
        "g",
      ),
      [],
    );
    expect(cards.map((card) => card.id)).toEqual(["a", "d", "f"]);
    expect(cards[1]!.parentId).toBe("a");
    expect(cards[1]!.depth).toBe(1);
    expect(cards[1]!.isAbandoned).toBe(true);
    expect(cards[0]!.isAbandoned).toBe(false);
    expect(cards[2]!.isLeaf).toBe(true);
  });

  it("分岔卡的后继卡从新行起算，不受前一轮的废弃尾巴影响", () => {
    const cards = buildBeats(
      view(
        [
          ["a", "say", 1, "开场"],
          ["b", "beat_end"],
          ["c", "say", 4, "原第二轮"],
          ["d", "say", 8, "分岔点", false],
          ["e", "beat_end", undefined, undefined, false],
          ["f", "say", 9, "新第二轮"],
          ["g", "beat_end"],
        ],
        "g",
      ),
      [line("l1", 1, "开场"), line("l2", 4, "原第二轮"), line("l3", 9, "新第二轮")],
    );
    expect(cards.map((card) => [card.id, card.startSeq])).toEqual([
      ["a", 1],
      ["c", 4],
      ["f", 9],
    ]);
    // 活动路径上的卡片摘要取该轮首行原文
    expect(cards[0]!.preview).toBe("开场");
    expect(cards[2]!.preview).toBe("新第二轮");
  });

  it("废弃分支的行已不在缓冲里 → 没有可回看目标", () => {
    const cards = buildBeats(
      view(
        [
          ["a", "say", 1, "开场"],
          ["b", "beat_end"],
          ["c", "say", 4, "旧版本", false],
          ["d", "beat_end", undefined, undefined, false],
        ],
        "b",
      ),
      [line("l1", 1, "开场")],
    );
    expect(cards[0]!.isAbandoned).toBe(false);
    expect(firstLineOf(cards[0]!, [line("l1", 1, "开场")])?.key).toBe("l1");
    expect(firstLineOf(cards[1]!, [line("l1", 1, "开场")])).toBeNull();
  });

  it("重演出来的新轮挂在被重写的那一轮下（兄弟，不是无根新枝）", () => {
    const cards = buildBeats(
      view(
        [
          ["a", "say", 1, "第一轮"],
          ["b", "beat_end"],
          ["c", "say", 4, "第二轮", false],
          ["r", "fork", undefined, "重演"],
          ["d", "say", 9, "第二轮·重演"],
          ["e", "beat_end"],
        ],
        "e",
      ),
      [],
    );
    expect(cards.map((card) => [card.id, card.parentId])).toEqual([
      ["a", null],
      ["c", "a"],
      ["d", "c"],
    ]);
    expect(cards[1]!.isAbandoned).toBe(true); // 旧版那一轮作废，但新轮挂在它下面
    expect(cards[2]!.onPath).toBe(true);
  });

  it("停止点类型读 attrs.stopType，老档的 attrs.type 也能认", () => {
    const cards = buildBeats(
      view(
        [
          ["a", "say", 1, "开场"],
          ["s", "stop", 2, undefined, true, { stopType: "choice" }],
          ["b", "beat_end"],
          ["c", "say", 9, "老档"],
          ["t", "stop", 10, undefined, true, { type: "free" }],
          ["d", "beat_end"],
        ],
        "d",
      ),
      [],
    );
    expect(cards.map((card) => card.stopType)).toEqual(["choice", "free"]);
  });

  it("preload/edit 不进卡，fork 断开后续", () => {
    const cards = buildBeats(
      view(
        [
          ["a", "say", 1, "开场"],
          ["p", "preload", 2],
          ["b", "beat_end"],
          ["r", "fork", undefined, "分岔", false],
          ["c", "say", 9, "重演"],
          ["d", "beat_end"],
        ],
        "d",
      ),
      [],
    );
    expect(cards.map((card) => card.id)).toEqual(["a", "c"]);
  });

  it("整拍只有控制指令（布景/音效）→ 摘要空着，不端工程串给玩家", () => {
    const cards = buildBeats(
      view(
        [
          ["a", "scene", 1, undefined, true, { bg: "bg-classroom" }],
          ["b", "sfx", 3],
          ["c", "beat_end"],
        ],
        "c",
      ),
      [sceneLine("l1", 1, "bg-classroom · bgm-sunset")],
    );
    expect(cards).toHaveLength(1);
    expect(cards[0]!.preview).toBe("");
  });

  it("布景开拍、台词在后 → 摘要取本拍那句台词", () => {
    const cards = buildBeats(
      view(
        [
          ["a", "scene", 1, undefined, true, { bg: "bg-classroom" }],
          ["b", "say", 2, "第一句"],
          ["c", "beat_end"],
        ],
        "c",
      ),
      [sceneLine("l1", 1, "bg-classroom · bgm-sunset"), line("l2", 2, "第一句")],
    );
    expect(cards[0]!.preview).toBe("第一句");
  });

  it("纯布景拍不去认下一拍的台词（摘要与回看都不越界）", () => {
    const cards = buildBeats(
      view(
        [
          ["a", "scene", 1, undefined, true, { bg: "bg-classroom" }],
          ["b", "beat_end"],
          ["c", "say", 9, "下一拍的台词"],
          ["d", "beat_end"],
        ],
        "d",
      ),
      [sceneLine("l1", 1, "bg-classroom · bgm-sunset"), line("l2", 9, "下一拍的台词")],
    );
    expect(cards[0]!.preview).toBe("");
    expect(cards[1]!.preview).toBe("下一拍的台词");
  });

  it("本拍的 CG 记在卡上，且不跨拍继承（背景才继承）", () => {
    const cards = buildBeats(
      view(
        [
          ["a", "scene", 1, undefined, true, { bg: "bg-classroom" }],
          ["b", "cg", 2, undefined, true, { id: "cg-confession" }],
          ["c", "beat_end"],
          ["d", "say", 9, "下一拍"],
          ["e", "beat_end"],
        ],
        "e",
      ),
      [],
    );
    expect(cards[0]!.cgId).toBe("cg-confession");
    // CG 是插进这一幕的画，下一幕回到该回的背景
    expect(cards[1]!.cgId).toBeNull();
    expect(cards[1]!.sceneBg).toBe("bg-classroom");
  });

  it("同一拍多张 CG → 取最后一张（这一幕结束前屏幕上停着的那张）", () => {
    const cards = buildBeats(
      view(
        [
          ["a", "cg", 1, undefined, true, { id: "cg-a" }],
          ["b", "cg", 2, undefined, true, { id: "cg-b" }],
          ["c", "beat_end"],
        ],
        "c",
      ),
      [],
    );
    expect(cards[0]!.cgId).toBe("cg-b");
  });

  it("明确划分 startNodeId 与 endNodeId，开场 scene+say 不会切出无台词卡", () => {
    const cards = buildBeats(
      view(
        [
          ["n_scene", "scene", 1, undefined, true, { bg: "bg-hall" }],
          ["n_say1", "say", 2, "你好！"],
          ["n_say2", "say", 3, "很高兴见到你。"],
          ["n_stop", "stop", 4, undefined, true, { stopType: "choice" }],
          ["n_end", "beat_end"],
        ],
        "n_end",
      ),
      [],
    );
    expect(cards).toHaveLength(1);
    expect(cards[0]!.startNodeId).toBe("n_say1"); // 优先选台词首句作为重读入口
    expect(cards[0]!.endNodeId).toBe("n_end"); // 轮末收束点作为回到选项入口
    expect(cards[0]!.stopNodeId).toBe("n_stop");
    expect(cards[0]!.preview).toBe("你好！");
  });

  it("在历史旧轮分岔时，新卡片严格认分岔源为父，绝不可认旧叶子为父", () => {
    // 构造真实树：
    // Round 1: r1_say -> r1_end
    // Round 2: r2_say -> r2_end
    // Round 3 (旧叶子): r3_say -> r3_end
    // 此时从 Round 1 分岔: fork(parentId=r1_end) -> r1b_say -> r1b_end
    const node = (
      id: string,
      parentId: string | null,
      turn: number,
      kind: LineageNodeView["kind"],
      text: string,
      createdAt: number,
      onPath: boolean,
      children: number,
      seq?: number,
    ): LineageNodeView => ({
      id,
      parentId,
      turn,
      kind,
      text,
      attrs: {},
      createdAt,
      onPath,
      children,
      editedText: null,
      editCount: 0,
      editedAt: undefined,
      seq,
      cgs: [],
    });
    const nodes: LineageNodeView[] = [
      node("r1_say", null, 1, "say", "第1轮", 100, true, 1, 1),
      node("r1_end", "r1_say", 1, "beat_end", "", 101, true, 2),
      // 旧分支（Round 2 & 3）
      node("r2_say", "r1_end", 2, "say", "第2轮旧", 200, false, 1, 4),
      node("r2_end", "r2_say", 2, "beat_end", "", 201, false, 1),
      node("r3_say", "r2_end", 3, "say", "第3轮旧叶子", 300, false, 1, 7),
      node("r3_end", "r3_say", 3, "beat_end", "", 301, false, 0),
      // 新分支从 r1_end 分岔出来，时间在最后
      node("fork_mark", "r1_end", 4, "fork", "", 400, true, 1),
      node("r1b_say", "fork_mark", 4, "say", "新第2轮", 401, true, 1, 10),
      node("r1b_end", "r1b_say", 4, "beat_end", "", 402, true, 0),
    ];
    const treeView: LineageView = {
      nodes,
      leafId: "r1b_end",
      pathIds: ["r1_say", "r1_end", "fork_mark", "r1b_say", "r1b_end"],
    };
    const cards = buildBeats(treeView, []);
    expect(cards).toHaveLength(4);
    const cardR1 = cards.find((c) => c.id === "r1_say")!;
    const cardR2 = cards.find((c) => c.id === "r2_say")!;
    const cardR3 = cards.find((c) => c.id === "r3_say")!;
    const cardR1B = cards.find((c) => c.id === "r1b_say")!;

    expect(cardR1.parentId).toBeNull();
    expect(cardR2.parentId).toBe(cardR1.id);
    expect(cardR3.parentId).toBe(cardR2.id);

    // 关键断言：新分岔卡片 r1b 的 parentId 必须是 cardR1，绝不可被错认为 cardR3（旧叶子）！
    expect(cardR1B.parentId).toBe(cardR1.id);
    expect(cardR1B.forkedFrom?.nodeId).toBe("r1_end");
    expect(cardR1B.onPath).toBe(true);
    expect(cardR1B.isLeaf).toBe(true);
    expect(cardR3.isAbandoned).toBe(true);
  });
});
