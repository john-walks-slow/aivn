import { describe, expect, it } from "vitest";
import type { BeatCard } from "../src/stage/beats.js";
import { layoutRoute, NODE_H, NODE_W } from "../src/stage/routeTree.js";

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
        expect(Math.abs(kid.y - node.y)).toBeLessThanOrEqual(NODE_H);
      }
    }
    for (let i = 0; i < placed.length; i += 1) {
      for (let j = i + 1; j < placed.length; j += 1) {
        const a = placed[i]!;
        const b = placed[j]!;
        const overlap = Math.abs(a.y - b.y) < NODE_H - 1 && Math.abs(a.x - b.x) < NODE_W - 1;
        expect(overlap, `${a.card.id} 与 ${b.card.id} 叠了`).toBe(false);
      }
    }
  });

  it("x = 树深度，一条边对应一个父节点", () => {
    const cards = [card("a", null, 0), card("b", "a", 1), card("c", "a", 1, false)];
    const { placed, edges, width, height } = layoutRoute(cards);
    const byId = new Map(placed.map((p) => [p.card.id, p]));
    expect(byId.get("a")!.x).toBe(0);
    expect(byId.get("b")!.x).toBe(byId.get("a")!.x + NODE_W + 78);
    expect(edges).toHaveLength(2);
    expect(edges.every((e) => e.d.startsWith("M "))).toBe(true);
    expect(width).toBeGreaterThan(NODE_W);
    expect(height).toBeGreaterThan(NODE_H);
  });

  it("分岔口：世界线那支标主线，其余按序标支线", () => {
    const cards = [card("root", null, 0), card("live", "root", 1), card("alt", "root", 1, false), card("alt2", "root", 1, false)];
    const labels = new Map(layoutRoute(cards).placed.map((p) => [p.card.id, p.label]));
    expect(labels.get("live")).toBe("主线");
    expect(labels.get("alt")).toBe("支线 A");
    expect(labels.get("alt2")).toBe("支线 B");
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
    expect(byId.get("b")!.x).not.toBe(byId.get("c")!.x);
    expect(width).toBeGreaterThan(NODE_W);
    expect(height).toBeGreaterThan(NODE_H);
    const edge = edges.find((e) => e.id === "a->b")!;
    const from = byId.get("a")!;
    const to = byId.get("b")!;
    // 起点父节点下中，终点子节点上中，中间的控制点拉出 S 弯
    expect(edge.d).toMatch(
      new RegExp(
        `^M ${from.x + NODE_W / 2} ${from.y + NODE_H} C \\S+ \\S+, \\S+ \\S+, ${to.x + NODE_W / 2} ${to.y}$`,
      ),
    );
  });
});
