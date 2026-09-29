import { describe, expect, it } from "vitest";
import type { BeatCard } from "../src/stage/beats.js";
import { GAP, layoutRoute, NODE_BLOCK_H, NODE_W } from "../src/stage/routeTree.js";

function card(id: string, parentId: string | null, turn: number, onPath = true): BeatCard {
  return {
    id,
    turn,
    nodes: [],
    preview: id,
    speakers: [],
    sceneBg: null,
    stopType: null,
    startSeq: turn,
    onPath,
    isLeaf: false,
    isAbandoned: !onPath,
    depth: 0,
    parentId,
  };
}

describe("横向路线树布局", () => {
  it("父节点恒在子节点左边，纵向不重叠", () => {
    // A → B → C，另从 A 分出 D → E
    const cards = [
      card("a", null, 0),
      card("b", "a", 1),
      card("c", "b", 2),
      card("d", "a", 1, false),
      card("e", "d", 2, false),
    ];
    const { placed } = layoutRoute(cards);
    expect(placed).toHaveLength(5);
    for (const node of placed) {
      for (const kid of placed.filter((p) => p.card.parentId === node.card.id)) {
        expect(kid.x).toBeGreaterThan(node.x);
        expect(Math.abs(kid.y - node.y)).toBeLessThanOrEqual(NODE_BLOCK_H);
      }
    }
    for (let i = 0; i < placed.length; i += 1) {
      for (let j = i + 1; j < placed.length; j += 1) {
        const a = placed[i]!;
        const b = placed[j]!;
        const overlap = Math.abs(a.y - b.y) < NODE_BLOCK_H - 1 && Math.abs(a.x - b.x) < NODE_W - 1;
        expect(overlap, `${a.card.id} 与 ${b.card.id} 叠了`).toBe(false);
      }
    }
  });

  it("x = 树深度，一条边对应一个父节点", () => {
    const cards = [card("a", null, 0), card("b", "a", 1), card("c", "a", 1, false)];
    const { placed, edges, width, height } = layoutRoute(cards);
    const byId = new Map(placed.map((p) => [p.card.id, p]));
    expect(byId.get("a")!.x).toBe(0);
    expect(byId.get("b")!.x).toBe(byId.get("a")!.x + NODE_W + GAP);
    expect(edges).toHaveLength(2);
    expect(edges.every((e) => e.d.startsWith("M "))).toBe(true);
    expect(width).toBeGreaterThan(NODE_W);
    expect(height).toBeGreaterThan(NODE_BLOCK_H);
  });

  it("父节点缺失（孤儿）不丢节点", () => {
    const cards = [card("a", null, 0), card("ghost", "missing", 1)];
    const { placed, edges } = layoutRoute(cards);
    expect(placed.map((p) => p.card.id).sort()).toEqual(["a", "ghost"]);
    expect(edges).toHaveLength(0);
  });

  it("成环的谱系不会死循环", () => {
    const cards = [card("a", "b", 0), card("b", "a", 1)];
    expect(layoutRoute(cards).placed).toHaveLength(2);
  });
});

describe("纵向路线树（窄屏）", () => {
  it("时间往下走，兄弟左右排，连线父下中 → 子上中", () => {
    const cards = [card("a", null, 0), card("b", "a", 1), card("c", "a", 1, false), card("d", "b", 2)];
    const { placed, edges, width, height } = layoutRoute(cards, "vertical");
    const byId = new Map(placed.map((p) => [p.card.id, p]));
    expect(byId.get("a")!.y).toBe(0);
    expect(byId.get("b")!.y).toBeGreaterThan(byId.get("a")!.y);
    // 兄弟在同一深度上左右分开
    expect(byId.get("b")!.y).toBe(byId.get("c")!.y);
    expect(byId.get("c")!.x).toBe(byId.get("b")!.x + NODE_W + GAP);
    expect(width).toBeGreaterThan(NODE_W);
    expect(height).toBeGreaterThan(NODE_BLOCK_H);
    const edge = edges.find((e) => e.id === "a->b")!;
    const from = byId.get("a")!;
    const to = byId.get("b")!;
    // 起点父节点下中，终点子节点上中，中间的控制点拉出 S 弯
    expect(edge.d).toMatch(
      new RegExp(
        `^M ${from.x + NODE_W / 2} ${from.y + NODE_BLOCK_H} C \\S+ \\S+, \\S+ \\S+, ${to.x + NODE_W / 2} ${to.y}$`,
      ),
    );
  });

  it("横向间距按节点宽度算，节点谁也不叠", () => {
    // 回归：兄弟间距曾错用节点高度当横向步长，窄屏上整棵树糊成一坨
    const cards = [
      card("a", null, 0),
      card("b", "a", 1),
      card("c", "a", 1, false),
      card("d", "a", 1, false),
      card("e", "b", 2),
      card("f", "b", 2, false),
    ];
    const { placed } = layoutRoute(cards, "vertical");
    for (let i = 0; i < placed.length; i += 1) {
      for (let j = i + 1; j < placed.length; j += 1) {
        const a = placed[i]!;
        const b = placed[j]!;
        const overlap = Math.abs(a.y - b.y) < NODE_BLOCK_H - 1 && Math.abs(a.x - b.x) < NODE_W - 1;
        expect(overlap, `${a.card.id} 与 ${b.card.id} 叠了`).toBe(false);
      }
    }
  });

  // 回归：卡面下方的工具条是节点占位的一部分。纵向流向下它正落在下一层的位置上，
  // 只按卡面高度排版的话工具条会盖住下一张卡的按钮。
  it("卡下工具条不压到邻居节点（两个方向）", () => {
    const cards = [
      card("a", null, 0),
      card("b", "a", 1),
      card("c", "a", 1, false),
      card("d", "b", 2),
    ];
    for (const dir of ["horizontal", "vertical"] as const) {
      const { placed } = layoutRoute(cards, dir);
      for (let i = 0; i < placed.length; i += 1) {
        for (let j = i + 1; j < placed.length; j += 1) {
          const a = placed[i]!;
          const b = placed[j]!;
          const hit =
            Math.abs(a.y - b.y) < NODE_BLOCK_H - 1 && Math.abs(a.x - b.x) < NODE_W - 1;
          expect(hit, `${dir}：${a.card.id} 的工具条压住了 ${b.card.id}`).toBe(false);
        }
      }
    }
  });
});
