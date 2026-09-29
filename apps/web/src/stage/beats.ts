import type { LineageNodeView, LineageView } from "@stage-ai/core";
import type { ScriptLine } from "./script.js";

/** 一拍一卡：拍不是存储实体，是行级事件日志上的区间，渲染期聚合出来。 */
export interface BeatCard {
  /** 代表事件 id = 该拍首个事件 id（分岔/重生成锚点用它）。 */
  id: string;
  turn: number;
  nodes: LineageNodeView[];
  /** 摘要：拍内首句台词/narration，≤32 字。 */
  preview: string;
  speakers: string[];
  sceneBg: string | null;
  stopType: string | null;
  /** 本拍首个剧本事件的 seq：回看/定位到该拍首行。全无 seq（老档/纯导演注拍）时为 null。 */
  startSeq: number | null;
  onPath: boolean;
  isLeaf: boolean;
  isAbandoned: boolean;
  depth: number;
  parentId: string | null;
}

/**
 * 切拍规则：换场景不切；分岔口、重写之后、beat_end 之后各开新拍。
 * 定位用每个剧本事件自带的 seq（编排器写入 payload.seq，与客户端 ScriptLine.seq 同尺），
 * 所以分岔/废弃分支的卡片也能各自对到自己的那一行。
 */
export function buildBeats(view: LineageView, lines: readonly ScriptLine[]): BeatCard[] {
  const ordered = [...view.nodes].sort((a, b) => a.createdAt - b.createdAt || a.id.localeCompare(b.id));
  const cards: BeatCard[] = [];
  const cardOfNode = new Map<string, BeatCard>();
  let current: BeatCard | null = null;
  let closed = true;
  // 链上前一个进卡的事件（preload/edit 也在链上，比对分岔口时不能拿它们当邻居）
  let prevInChain: string | null = null;

  for (const node of ordered) {
    // edit/rewrite 是操作标记不是剧情：edit 挂回被编辑行、重写即世界线断裂，都不进卡
    if (node.kind === "preload") {
      prevInChain = node.id;
      continue;
    }
    if (node.kind === "edit") continue;
    if (node.kind === "rewrite") {
      closed = true;
      continue;
    }

    // 拍内事件逐个直挂上一个；一旦挂回更早的祖先，就是分岔口，开新卡
    const atFork = prevInChain !== null && node.parentId !== prevInChain;
    if (!current || closed || atFork) {
      const parent = atFork ? cardOfNode.get(node.parentId ?? "") ?? null : current;
      current = newCard(node, parent);
      cards.push(current);
      closed = false;
    }
    current.nodes.push(node);
    cardOfNode.set(node.id, current);
    prevInChain = node.id;
    if (node.kind === "beat_end") closed = true;
  }

  for (const card of cards) {
    card.onPath = card.nodes.some((n) => n.onPath);
    card.isAbandoned = !card.onPath;
    card.startSeq = card.nodes.find((n) => n.seq !== undefined)?.seq ?? null;
    collect(card);
  }
  const leafCard = cards.find((card) => card.nodes.some((n) => n.id === view.leafId));
  if (leafCard) leafCard.isLeaf = true;

  // 活动路径上的卡片：摘要取该拍首行原文（编辑/改写后的真实台词）
  for (const card of cards) {
    const line = firstLineOf(card, lines);
    if (card.onPath && line) setPreview(card, line.text);
  }
  return cards;
}

/** 该拍在世界线上的首行；废弃分支的行已不在缓冲里，定位不到就是 null。 */
export function firstLineOf(card: BeatCard, lines: readonly ScriptLine[]): ScriptLine | null {
  const from = card.startSeq;
  if (from === null) return null;
  return lines.find((l) => l.seq !== undefined && l.seq >= from) ?? null;
}

function newCard(first: LineageNodeView, parent: BeatCard | null): BeatCard {
  return {
    id: first.id,
    turn: first.turn,
    nodes: [],
    preview: "",
    speakers: [],
    sceneBg: null,
    stopType: null,
    startSeq: null,
    onPath: false,
    isLeaf: false,
    isAbandoned: false,
    depth: parent ? parent.depth + 1 : 0,
    parentId: parent ? parent.id : null,
  };
}

function collect(card: BeatCard): void {
  for (const node of card.nodes) {
    if (node.kind === "scene" && node.attrs.bg) card.sceneBg = node.attrs.bg;
    if (node.kind === "stop") card.stopType = node.attrs.stopType ?? "continue";
    if (node.kind === "say" || node.kind === "thought") {
      const who = node.attrs.id ?? "";
      if (who && !card.speakers.includes(who)) card.speakers.push(who);
    }
  }
  const spoken = card.nodes.find((n) => n.kind === "say" || n.kind === "narrate" || n.kind === "thought");
  setPreview(card, spoken?.text ?? "");
}

function setPreview(card: BeatCard, text: string): void {
  card.preview = text.length > 32 ? `${text.slice(0, 32)}…` : text;
}
