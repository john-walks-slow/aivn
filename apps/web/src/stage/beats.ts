import type { LineageNodeView, LineageView, StopType } from "@stage-ai/core";
import type { ScriptLine } from "./script.js";

/** 分岔来源：这张卡是被重演的那一轮顶出来的，父卡 id + 它当时的轮号。 */
export interface ForkOrigin {
  nodeId: string;
  turn: number;
}

/** 一轮一卡：轮不是存储实体，是行级事件日志上的区间，渲染期聚合出来。 */
export interface BeatCard {
  /** 代表事件 id = 该轮首个事件 id（分岔/重来锚点用它）。 */
  id: string;
  /** 轮首第一个有意义的台词/叙述/场景节点（从此处重读的落点）。 */
  startNodeId: string;
  /** 该轮演完那一刻的最后一个节点（通常是 beat_end 或分支末梢，回到选项落点）。 */
  endNodeId: string;
  /** 该轮的停止点节点（若存在 stop 事件）。 */
  stopNodeId?: string;
  /** 「重演本轮」的分岔锚点：本轮之前的那一点（首个节点的父），第一轮退回首节点自身。 */
  forkFromId: string;
  turn: number;
  nodes: LineageNodeView[];
  /** 摘要：轮内首句台词/narration，≤32 字。整轮只有布景就是空串。 */
  preview: string;
  speakers: string[];
  /** 这一轮落笔的墙上时刻（毫秒）：卡上给玩家看的是时间，不是轮号。 */
  at: number;
  /** 本轮最后一张 CG 的素材 id（`<cg id>`）。只在有 CG 的轮上非空，**不跨轮继承**——
   *  CG 是插进这一幕的画，下一幕回到该回的背景；卡片照抄「这一轮屏幕上是什么」。 */
  cgId: string | null;
  sceneBg: string | null;
  stopType: StopType | null;
  /** 本轮首个剧本事件的 seq：回看/定位到该轮首行。全无 seq（老档/纯插一句轮）时为 null。 */
  startSeq: number | null;
  /** 本轮末尾剧本事件的 seq。 */
  endSeq: number | null;
  onPath: boolean;
  isLeaf: boolean;
  isAbandoned: boolean;
  depth: number;
  parentId: string | null;
  /** 承接哪一个 fork 标记长出来的；不是分岔重演出来的轮为 null。 */
  forkedFrom: ForkOrigin | null;
}

/**
 * 切轮规则：基于树拓扑自顶向下聚类。
 * 换场景不切轮；遇到 beat_end、fork 标记或多分支分岔口切轮。
 * 每个卡片的父卡片严格由其起始节点（或 fork 锚点）的拓扑父节点所属卡片决定。
 */
export function buildBeats(view: LineageView, lines: readonly ScriptLine[]): BeatCard[] {
  if (!view.nodes.length) return [];
  const ordered = [...view.nodes].sort((a, b) => a.createdAt - b.createdAt || a.id.localeCompare(b.id));
  const byId = new Map(ordered.map((node) => [node.id, node]));
  const childrenOf = new Map<string, LineageNodeView[]>();

  for (const node of ordered) {
    if (node.parentId && byId.has(node.parentId)) {
      const list = childrenOf.get(node.parentId);
      if (list) list.push(node);
      else childrenOf.set(node.parentId, [node]);
    }
  }

  const cards: BeatCard[] = [];
  const cardOfNode = new Map<string, BeatCard>();
  const visited = new Set<string>();

  function traceBeat(
    startNode: LineageNodeView,
    parentCard: BeatCard | null,
    forkedFrom: ForkOrigin | null,
  ): void {
    if (visited.has(startNode.id)) return;

    if (startNode.kind === "fork") {
      visited.add(startNode.id);
      if (parentCard) cardOfNode.set(startNode.id, parentCard);
      const anchor = startNode.parentId ? byId.get(startNode.parentId) : null;
      const origin: ForkOrigin | null = anchor ? { nodeId: anchor.id, turn: anchor.turn } : null;
      const forkKids = childrenOf.get(startNode.id) ?? [];
      for (const fk of forkKids) {
        traceBeat(fk, parentCard, origin);
      }
      return;
    }

    const card = newCard(startNode, parentCard, forkedFrom);
    cards.push(card);

    let curr: LineageNodeView = startNode;
    while (curr) {
      visited.add(curr.id);
      card.nodes.push(curr);
      cardOfNode.set(curr.id, card);

      if (curr.kind === "beat_end") {
        const kids = childrenOf.get(curr.id) ?? [];
        for (const child of kids) {
          traceBeat(child, card, null);
        }
        break;
      }

      const kids = childrenOf.get(curr.id) ?? [];
      if (kids.length === 0) {
        break;
      }
      if (kids.length === 1) {
        const next = kids[0]!;
        if (next.kind === "fork") {
          visited.add(next.id);
          cardOfNode.set(next.id, card);
          const anchor = next.parentId ? byId.get(next.parentId) : null;
          const origin: ForkOrigin | null = anchor ? { nodeId: anchor.id, turn: anchor.turn } : null;
          const forkKids = childrenOf.get(next.id) ?? [];
          for (const fk of forkKids) {
            traceBeat(fk, card, origin);
          }
          break;
        }
        curr = next;
      } else {
        for (const child of kids) {
          if (child.kind === "fork") {
            visited.add(child.id);
            cardOfNode.set(child.id, card);
            const anchor = child.parentId ? byId.get(child.parentId) : null;
            const origin: ForkOrigin | null = anchor ? { nodeId: anchor.id, turn: anchor.turn } : null;
            const forkKids = childrenOf.get(child.id) ?? [];
            for (const fk of forkKids) {
              traceBeat(fk, card, origin);
            }
          } else {
            traceBeat(child, card, null);
          }
        }
        break;
      }
    }
  }

  const roots = ordered.filter((n) => !n.parentId || !byId.has(n.parentId));
  for (const root of roots) {
    traceBeat(root, null, null);
  }

  // 兜底孤儿与未访问节点
  for (const node of ordered) {
    if (!visited.has(node.id) && node.kind !== "fork") {
      const parentCard = node.parentId ? cardOfNode.get(node.parentId) ?? null : null;
      traceBeat(node, parentCard, null);
    }
  }

  // 场景是持续状态：换了一次就一直有效到下一次换。轮里没有 scene 事件的，继承上一轮的景。
  let currentBg: string | null = null;
  for (const card of cards) {
    card.onPath = card.nodes.some((n) => n.onPath);
    card.isAbandoned = !card.onPath;
    card.startSeq = card.nodes.find((n) => n.seq !== undefined)?.seq ?? null;
    card.endSeq = card.nodes.slice().reverse().find((n) => n.seq !== undefined)?.seq ?? null;
    collect(card);
    currentBg = card.sceneBg ?? currentBg;
    card.sceneBg = currentBg;
  }
  const leafCard = cards.find((card) => card.nodes.some((n) => n.id === view.leafId));
  if (leafCard) leafCard.isLeaf = true;

  // 活动路径上的卡片：摘要取本轮的第一句台词（场景/音效行只是布景，不配当摘要）。
  // 找不着就留着 collect() 从树上取的正文——行缓冲只覆盖不擦除。
  for (const [card, text] of beatPreviews(cards, lines)) {
    if (text) setPreview(card, text);
  }
  return cards;
}

/**
 * 活动路径卡片 → 这一轮该显示的摘要。废弃分支的行不在缓冲里；本轮只有布景的卡
 * 也不能去认下一轮的行，否则摘要会指到别人家门口。取不到就交回空串（调用方保留树上的正文）。
 */
function beatPreviews(
  cards: readonly BeatCard[],
  lines: readonly ScriptLine[],
): Map<BeatCard, string> {
  const map = new Map<BeatCard, string>();
  const startSeqs = cards.map((card) => card.startSeq);
  cards.forEach((card, i) => {
    if (!card.onPath) return;
    const next = startSeqs.slice(i + 1).find((seq) => seq !== null && seq > (card.startSeq ?? 0));
    const anchor = firstLineOf(card, lines, next ?? null);
    map.set(card, anchor ? spokenText(anchor, lines, next ?? null) : "");
  });
  return map;
}

/** 台词三类。scene/sfx/cg 是控制指令，落到卡上是 `bg_xxx · bgm_yyy` 这种工程串。 */
const SPOKEN = new Set<ScriptLine["type"]>(["say", "narrate", "thought"]);

/**
 * 摘要取本轮的第一句台词：锚点行自己就是台词就直接用；锚点是布景行就往后找本轮内的
 * 第一句，越不过下一轮的起点。整轮只有控制指令就返回空串（卡上显示「（无台词）」）——
 * 控制指令不端给玩家。
 */
function spokenText(anchor: ScriptLine, lines: readonly ScriptLine[], until: number | null): string {
  if (SPOKEN.has(anchor.type) && anchor.text) return anchor.text;
  const spoken = lines.find(
    (l) =>
      l.seq !== undefined &&
      l.seq >= (anchor.seq ?? 0) &&
      (until === null || l.seq < until) &&
      l.text &&
      SPOKEN.has(l.type),
  );
  return spoken?.text ?? "";
}

/**
 * 该轮在世界线上的首行；废弃分支的行已不在缓冲里，定位不到就是 null。
 * `until` 是下一轮的起点：越过它就说明本轮根本没台词。
 */
export function firstLineOf(
  card: BeatCard,
  lines: readonly ScriptLine[],
  until: number | null = null,
): ScriptLine | null {
  const from = card.startSeq;
  if (from === null) return null;
  return (
    lines.find(
      (l) => l.seq !== undefined && l.seq >= from && (until === null || l.seq < until),
    ) ?? null
  );
}

/** 原地改写只对台词三件套开放（与 core 的 EDITABLE_KINDS 同尺）。 */
const EDITABLE = new Set<LineageNodeView["kind"]>(["say", "narrate", "thought"]);

/**
 * 舞台上正在显示的那一行落在哪一轮——导演原语的锚点。
 * 舞台缓冲里只有当前分支的行，所以只在 onPath 的卡里找；纯布景轮没有 seq，定位不到就是 null。
 * 回看游标可能停在玩家发来的那句话上（它没有 seq），同样定位不到——原语按钮就该是灰的。
 */
export function beatAtLine(
  cards: readonly BeatCard[],
  line: { seq?: number | null } | null,
): BeatCard | null {
  if (!line || line.seq === undefined || line.seq === null) return null;
  const at = line.seq;
  let hit: BeatCard | null = null;
  for (const card of cards) {
    if (!card.onPath || card.startSeq === null || card.startSeq > at) continue;
    if (!hit || card.startSeq > hit.startSeq!) hit = card;
  }
  return hit;
}

/** 同一行对应的谱系节点：「改写这一句」要拿它的 id 发给编排器。 */
export function editableNodeAtLine(
  view: LineageView,
  line: { seq?: number | null } | null,
): LineageNodeView | null {
  if (!line || line.seq === undefined || line.seq === null) return null;
  return (
    view.nodes.find((node) => node.seq === line.seq && node.onPath && EDITABLE.has(node.kind)) ?? null
  );
}

function newCard(first: LineageNodeView, parent: BeatCard | null, forkedFrom: ForkOrigin | null): BeatCard {
  return {
    id: first.id,
    startNodeId: first.id,
    endNodeId: first.id,
    stopNodeId: undefined,
    forkFromId: first.id,
    turn: first.turn,
    nodes: [],
    preview: "",
    speakers: [],
    at: first.createdAt,
    cgId: null,
    sceneBg: null,
    stopType: null,
    startSeq: null,
    endSeq: null,
    onPath: false,
    isLeaf: false,
    isAbandoned: false,
    depth: parent ? parent.depth + 1 : 0,
    parentId: parent ? parent.id : null,
    forkedFrom,
  };
}

function collect(card: BeatCard): void {
  for (const node of card.nodes) {
    if (node.kind === "scene" && node.attrs.bg) card.sceneBg = node.attrs.bg;
    // 同一轮多张 CG 时取最后一张：那是这一幕结束前屏幕上停着的那张
    if (node.kind === "cg" && node.attrs.id) card.cgId = node.attrs.id;
    if (node.kind === "stop") {
      card.stopType = stopTypeOf(node.attrs);
      card.stopNodeId = node.id;
    }
    if (node.kind === "say" || node.kind === "thought") {
      const who = node.attrs.id ?? "";
      if (who && !card.speakers.includes(who)) card.speakers.push(who);
    }
  }

  // startNodeId: 优先选台词/心声/旁白节点，次选场景/演员/CG，最后退回卡片首节点
  const spoken = card.nodes.find((n) => n.kind === "say" || n.kind === "narrate" || n.kind === "thought");
  const dramatic = card.nodes.find((n) => n.kind !== "preload" && n.kind !== "fork");
  card.startNodeId = spoken?.id ?? dramatic?.id ?? card.nodes[0]?.id ?? card.id;

  // endNodeId: 取本轮最后一个有效节点
  card.endNodeId = card.nodes[card.nodes.length - 1]?.id ?? card.id;
  // 重演本轮：从本轮之前的那一点开新分支重新生成；第一轮没有前驱就退回首节点
  card.forkFromId = card.nodes[0]?.parentId ?? card.nodes[0]?.id ?? card.id;

  setPreview(card, spoken?.text ?? "");
}

function setPreview(card: BeatCard, text: string): void {
  card.preview = text.length > 32 ? `${text.slice(0, 32)}…` : text;
}

/** 停止点类型；老档把类型存在 attrs.type 下，读不到或旧版 pause 一律按「无停止点」算（= 本轮无停止点收尾）。 */
function stopTypeOf(attrs: LineageNodeView["attrs"]): StopType | null {
  const value = attrs.stopType ?? attrs.type;
  return value === "choice" || value === "free" ? value : null;
}
