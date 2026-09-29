import type { BeatCard } from "./beats.js";

/** 节点盒子：固定尺寸才能算整齐的树，卡面内容超出就截断。 */
export const NODE_W = 224;
export const NODE_H = 104;
const GAP_X = 78;
const GAP_Y = 20;

/** 树有两个流向：宽屏从左往右读时间，窄屏从上往下。哪个长用哪个。 */
export type RouteDir = "horizontal" | "vertical";

export interface PlacedCard {
  card: BeatCard;
  x: number;
  y: number;
  /** 分岔口上的兄弟标签：主线 / 支线 A。普通节点为 null。 */
  label: string | null;
  /** 直接子节点数（>1 = 分岔口，节点上挂 ⑂ 徽标）。 */
  branchCount: number;
  /** 树深度（流向位置用它）。 */
  level: number;
}

export interface PlacedEdge {
  id: string;
  /** 贝塞尔路径 d：横向树是父右中 → 子左中，纵向树是父下中 → 子上中。 */
  d: string;
  live: boolean;
  dead: boolean;
}

export interface RouteLayout {
  placed: PlacedCard[];
  edges: PlacedEdge[];
  width: number;
  height: number;
}

/**
 * 树布局：流向坐标 = 树深度，横向坐标 = 兄弟序。
 * 叶子按 DFS 顺序各占一格，父节点居中于子节点——连线长度一致，一眼看清主干。
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

  const placed: PlacedCard[] = [];
  const placedById = new Map<string, PlacedCard>();
  const seen = new Set<string>();
  let slot = 0;

  const setSpot = (entry: PlacedCard, level: number, cross: number): void => {
    if (dir === "horizontal") {
      entry.x = level * (NODE_W + GAP_X);
      entry.y = cross;
    } else {
      entry.y = level * (NODE_H + GAP_Y);
      entry.x = cross;
    }
  };

  const place = (card: BeatCard, level: number): PlacedCard => {
    const entry: PlacedCard = { card, x: 0, y: 0, label: null, branchCount: 0, level };
    placed.push(entry);
    placedById.set(card.id, entry);
    const kids = (childrenOf.get(card.id) ?? []).filter((kid) => !seen.has(kid.id));
    entry.branchCount = kids.length;
    if (kids.length === 0) {
      setSpot(entry, level, slot * (NODE_H + GAP_Y));
      slot += 1;
    } else {
      // 已访问过的孩子不重复排版：万一谱系成环，也不能把界面挂死
      for (const kid of kids) seen.add(kid.id);
      const childEntries = kids.map((kid) => place(kid, level + 1));
      const first = childEntries[0]!;
      const last = childEntries[childEntries.length - 1]!;
      // 兄弟位是叶子排出来的槽；父节点居中于它的孩子
      setSpot(entry, level, dir === "horizontal" ? (first.y + last.y) / 2 : (first.x + last.x) / 2);
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

  labelSiblings(placedById, childrenOf);

  const edges: PlacedEdge[] = [];
  for (const entry of placed) {
    const parent = entry.card.parentId ? placedById.get(entry.card.parentId) : undefined;
    if (!parent) continue;
    edges.push({
      id: `${parent.card.id}->${entry.card.id}`,
      d: edgePath(parent, entry, dir),
      live: parent.card.onPath && entry.card.onPath,
      dead: !parent.card.onPath && !entry.card.onPath,
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

/**
 * 分岔口的兄弟分支起名：世界线那支叫主线，其余按序叫支线 A/B/C。
 * 嵌套在支线里的分岔不重开字母——用父标签做前缀（A-1/A-2），免得树上出现两个「支线 A」。
 */
function labelSiblings(placedById: Map<string, PlacedCard>, childrenOf: Map<string, BeatCard[]>): void {
  const LETTERS = "ABCDEFGH";
  for (const [parentId, kids] of childrenOf) {
    if (kids.length < 2) continue;
    const live = kids.filter((kid) => kid.onPath);
    const parentLabel = placedById.get(parentId)?.label ?? "";
    const prefix = parentLabel.startsWith("支线 ") ? parentLabel.slice(3) : "";
    let letter = 0;
    for (const kid of kids) {
      const entry = placedById.get(kid.id);
      if (!entry) continue;
      letter += 1;
      if (live.length === 1 && kid.onPath) entry.label = "主线";
      else if (prefix) entry.label = `${prefix}-${letter}`;
      else entry.label = `支线 ${LETTERS[letter - 1] ?? "?"}`;
    }
  }
}
