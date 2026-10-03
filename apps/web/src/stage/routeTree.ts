import type { BeatCard } from "./beats.js";

/** 节点盒子：固定尺寸才能算整齐的树，卡面内容超出就截断。
 *  高度 = 时刻行 + 三行正文 + 底行动词（三个动词带字样，宽度按最长一组留够）。 */
export const NODE_W = 300;
export const NODE_H = 128;
/** 流向、兄弟两个方向上相邻盒子之间的空隙。 */
export const GAP = 64;

/** 树有两个流向：宽屏从左往右读时间，窄屏从上往下。哪个长用哪个。 */
export type RouteDir = "horizontal" | "vertical";

export interface PlacedCard {
  card: BeatCard;
  x: number;
  y: number;
  /** 树深度（流向位置用它）。 */
  level: number;
}

export interface PlacedEdge {
  id: string;
  /** 贝塞尔路径 d：横向树是父右中 → 子左中，纵向树是父下中 → 子上中。 */
  d: string;
  live: boolean;
  dead: boolean;
  /** 从旧版那一轮斜插出来的分岔线。 */
  fork: boolean;
}

export interface RouteLayout {
  placed: PlacedCard[];
  edges: PlacedEdge[];
  width: number;
  height: number;
}

/**
 * 树布局：流向坐标 = 树深度，兄弟坐标 = 叶子各占一格、父居中于子。
 * 两条轴各配自己的步长——纵向树里兄弟是左右排的，拿盒子高度当横向步长，节点必叠。
 */
export function layoutRoute(cards: readonly BeatCard[], dir: RouteDir = "horizontal"): RouteLayout {
  const byId = new Map(cards.map((card) => [card.id, card]));
  const childrenOf = new Map<string, BeatCard[]>();
  const roots: BeatCard[] = [];
  for (const card of cards) {
    const parent = card.parentId ? byId.get(card.parentId) : undefined;
    if (!parent || parent === card) roots.push(card);
    else childrenOf.set(parent.id, [...(childrenOf.get(parent.id) ?? []), card]);
  }
  // 同层按产生顺序排：分岔口上下次序 = 玩家当时的操作顺序
  const byOrder = (a: BeatCard, b: BeatCard): number => a.turn - b.turn || a.id.localeCompare(b.id);
  roots.sort(byOrder);
  for (const [, list] of childrenOf) list.sort(byOrder);

  const along = dir === "horizontal" ? NODE_W + GAP : NODE_H + GAP;
  const cross = dir === "horizontal" ? NODE_H + GAP : NODE_W + GAP;
  const put = (entry: PlacedCard, level: number, crossPos: number): void => {
    if (dir === "horizontal") {
      entry.x = level * along;
      entry.y = crossPos;
    } else {
      entry.y = level * along;
      entry.x = crossPos;
    }
  };
  const crossOf = (entry: PlacedCard): number => (dir === "horizontal" ? entry.y : entry.x);

  const placed: PlacedCard[] = [];
  const placedById = new Map<string, PlacedCard>();
  const seen = new Set<string>();
  let slot = 0;

  const place = (card: BeatCard, level: number): PlacedCard => {
    const entry: PlacedCard = { card, x: 0, y: 0, level };
    placed.push(entry);
    placedById.set(card.id, entry);
    const kids = (childrenOf.get(card.id) ?? []).filter((kid) => !seen.has(kid.id));
    if (kids.length === 0) {
      put(entry, level, slot * cross);
      slot += 1;
    } else {
      // 已访问过的孩子不重复排版：万一谱系成环，也不能把界面挂死
      for (const kid of kids) seen.add(kid.id);
      const childEntries = kids.map((kid) => place(kid, level + 1));
      const first = crossOf(childEntries[0]!);
      const last = crossOf(childEntries[childEntries.length - 1]!);
      put(entry, level, (first + last) / 2);
    }
    return entry;
  };

  for (const root of roots) {
    if (seen.has(root.id)) continue;
    seen.add(root.id);
    place(root, 0);
  }
  // 兜底：孤儿（父节点不在这批卡里）也画出来，历史不许凭空消失
  for (const card of cards) {
    if (seen.has(card.id)) continue;
    seen.add(card.id);
    place(card, 0);
  }

  const edges: PlacedEdge[] = [];
  for (const entry of placed) {
    const parent = entry.card.parentId ? placedById.get(entry.card.parentId) : undefined;
    if (!parent) continue;
    edges.push({
      id: `${parent.card.id}->${entry.card.id}`,
      d: edgePath(parent, entry, dir),
      live: parent.card.onPath && entry.card.onPath,
      dead: !parent.card.onPath && !entry.card.onPath,
      // 通向分岔轮首的那条线就是分岔线——它从旧版那一轮旁边斜插出来，画法要跟普通连线分开
      fork: entry.card.forkedFrom !== null,
    });
  }

  const width = Math.max(...placed.map((p) => p.x + NODE_W), NODE_W);
  const height = Math.max(...placed.map((p) => p.y + NODE_H), NODE_H);
  return { placed, edges, width, height };
}

function edgePath(parent: PlacedCard, child: PlacedCard, dir: RouteDir): string {
  if (dir === "horizontal") {
    const x1 = parent.x + NODE_W;
    const y1 = parent.y + NODE_H / 2;
    const x2 = child.x;
    const y2 = child.y + NODE_H / 2;
    const dx = Math.max((x2 - x1) / 2, 12);
    return `M ${x1} ${y1} C ${x1 + dx} ${y1}, ${x2 - dx} ${y2}, ${x2} ${y2}`;
  }
  const x1 = parent.x + NODE_W / 2;
  const y1 = parent.y + NODE_H;
  const x2 = child.x + NODE_W / 2;
  const y2 = child.y;
  const dy = Math.max((y2 - y1) / 2, 12);
  return `M ${x1} ${y1} C ${x1} ${y1 + dy}, ${x2} ${y2 - dy}, ${x2} ${y2}`;
}
