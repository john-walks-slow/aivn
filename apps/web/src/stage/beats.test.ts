import { describe, expect, it } from "vitest";
import type { LineageNodeView, LineageView } from "@stage-ai/core";
import { buildBeats } from "./beats.js";

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
    editTargetId: undefined,
    granularity: undefined,
    instruction: undefined,
    seq,
  }));
  return { nodes, leafId, pathIds: nodes.filter((n) => n.onPath).map((n) => n.id) };
}

describe("buildBeats 一拍一卡", () => {
  it("beat_end 收束、换场景不切拍", () => {
    const cards = buildBeats(
      view(
        [
          ["a", "say", 1, "第一句"],
          ["b", "scene", 4, undefined, true, { bg: "bg-rooftop" }],
          ["c", "say", 5, "第二句"],
          ["d", "beat_end"],
          ["e", "say", 9, "下一拍"],
          ["f", "beat_end"],
        ],
        "f",
      ),
    );
    expect(cards.map((card) => card.id)).toEqual(["a", "e"]);
    expect(cards[0]!.startSeq).toBe(1);
    expect(cards[1]!.startSeq).toBe(9);
    expect(cards[0]!.sceneBg).toBe("bg-rooftop");
    expect(cards[0]!.nodes).toHaveLength(4);
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
    );
    expect(cards.map((card) => card.id)).toEqual(["a", "d", "f"]);
    expect(cards[1]!.parentId).toBe("a");
    expect(cards[1]!.depth).toBe(1);
    expect(cards[1]!.isAbandoned).toBe(true);
    expect(cards[0]!.isAbandoned).toBe(false);
    expect(cards[2]!.isLeaf).toBe(true);
  });

  it("分岔卡的后继卡从新行起算，不受前一拍的废弃尾巴影响", () => {
    const cards = buildBeats(
      view(
        [
          ["a", "say", 1, "开场"],
          ["b", "beat_end"],
          ["c", "say", 4, "原第二拍"],
          ["d", "say", 8, "分岔点", false],
          ["e", "beat_end", undefined, undefined, false],
          ["f", "say", 9, "新第二拍"],
          ["g", "beat_end"],
        ],
        "g",
      ),
    );
    expect(cards.map((card) => [card.id, card.startSeq])).toEqual([
      ["a", 1],
      ["c", 4],
      ["f", 9],
    ]);
    // 摘要取本拍第一句台词（分出去的尾巴不影响下一拍）
    expect(cards[0]!.preview).toBe("开场");
    expect(cards[2]!.preview).toBe("新第二拍");
  });

  it("废弃分支照样有摘要：读谱系，不依赖舞台缓冲", () => {
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
    );
    expect(cards[0]!.preview).toBe("开场");
    expect(cards[1]!.isAbandoned).toBe(true);
    expect(cards[1]!.preview).toBe("旧版本");
  });

  it("重演出来的新拍挂在被重写的那一拍下（兄弟，不是无根新枝）", () => {
    const cards = buildBeats(
      view(
        [
          ["a", "say", 1, "第一拍"],
          ["b", "beat_end"],
          ["c", "say", 4, "第二拍", false],
          ["r", "rewrite", undefined, "重演"],
          ["d", "say", 9, "第二拍·重演"],
          ["e", "beat_end"],
        ],
        "e",
      ),
    );
    expect(cards.map((card) => [card.id, card.parentId])).toEqual([
      ["a", null],
      ["c", "a"],
      ["d", "c"],
    ]);
    expect(cards[1]!.isAbandoned).toBe(true); // 旧版那一拍作废，但新拍挂在它下面
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
    );
    expect(cards.map((card) => card.stopType)).toEqual(["choice", "free"]);
  });

  it("preload/edit 不进卡，rewrite 断开后续", () => {
    const cards = buildBeats(
      view(
        [
          ["a", "say", 1, "开场"],
          ["p", "preload", 2],
          ["b", "beat_end"],
          ["r", "rewrite", undefined, "重写", false],
          ["c", "say", 9, "重演"],
          ["d", "beat_end"],
        ],
        "d",
      ),
    );
    expect(cards.map((card) => card.id)).toEqual(["a", "c"]);
  });
});
