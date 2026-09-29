import type { LineageNodeView, LineageView, StopType } from "@stage-ai/core";
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
  stopType: StopType | null;
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
      // 重写记在被重写的那张卡上：重演出来的新拍是它的兄弟，不是无根的新枝
      if (current) cardOfNode.set(node.id, current);
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

  // 活动路径上的卡片：摘要取该拍的第一句台词（场景/音效行只是布景，不配当摘要）
  for (const [card, line] of beatAnchors(cards, lines)) {
    if (card.onPath && line) setPreview(card, spokenText(line, lines));
  }
  return cards;
}

/**
 * 活动路径卡片 → 舞台上的那一行。废弃分支的行不在缓冲里；本拍没有台词的卡（纯场景切换）
 * 也不能去认下一拍的行，否则摘要和回看都会指到别人家门口。
 */
export function beatAnchors(
  cards: readonly BeatCard[],
  lines: readonly ScriptLine[],
): Map<BeatCard, ScriptLine | null> {
  const map = new Map<BeatCard, ScriptLine | null>();
  const startSeqs = cards.map((card) => card.startSeq);
  cards.forEach((card, i) => {
    if (!card.onPath) return;
    const next = startSeqs.slice(i + 1).find((seq) => seq !== null && seq > (card.startSeq ?? 0));
    map.set(card, firstLineOf(card, lines, next ?? null));
  });
  return map;
}

/** 从锚点行往后找第一句有台词的行；整拍只有布景就退回锚点行自己的文本。 */
function spokenText(anchor: ScriptLine, lines: readonly ScriptLine[]): string {
  if (anchor.text && anchor.type !== "scene" && anchor.type !== "sfx" && anchor.type !== "cg") {
    return anchor.text;
  }
  const spoken = lines.find(
    (l) =>
      l.seq !== undefined &&
      l.seq >= (anchor.seq ?? 0) &&
      l.text &&
      l.type === "say",
  );
  return spoken?.text ?? anchor.text;
}

/**
 * 该拍在世界线上的首行；废弃分支的行已不在缓冲里，定位不到就是 null。
 * `until` 是下一拍的起点：越过它就说明本拍根本没台词。
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
 * 舞台上正在显示的那一行落在哪一拍——导演原语的锚点。
 * 舞台缓冲里只有当前分支的行，所以只在 onPath 的卡里找；纯布景拍没有 seq，定位不到就是 null。
 * 回看游标可能停在玩家的表态/导演注上（它们没有 seq），同样定位不到——原语按钮就该是灰的。
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
    if (node.kind === "stop") card.stopType = stopTypeOf(node.attrs);
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

/** 停止点类型；老档把类型存在 attrs.type 下，读不到或旧版 pause 一律按「无停止点」算（= 幕末）。 */
function stopTypeOf(attrs: LineageNodeView["attrs"]): StopType | null {
  const value = attrs.stopType ?? attrs.type;
  return value === "choice" || value === "free" ? value : null;
}
