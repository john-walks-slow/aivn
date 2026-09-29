import type { LineageNodeView, LineageView } from "@stage-ai/core";
import type { ScriptLine } from "./script.js";

/** 会话记录里的一条：角色台词、玩家表态、或导演注。 */
export type TranscriptKind = "line" | "player" | "ooc";

export interface TranscriptEntry {
  /** 台词行取 ScriptLine.key（语音关联与回看游标都对它）；表态/导演注取谱系节点 id。 */
  key: string;
  kind: TranscriptKind;
  /** 显示形态：player 借 say 的对话框样式，ooc 借 narrate 的旁白样式。 */
  type: "say" | "narrate" | "thought";
  actorId: string | null;
  text: string;
  /** 台词行的起始事件序号（语音关联键）；表态/导演注没有 seq。 */
  seq: number | null;
  /** 谱系节点 id：分岔/编辑的锚点。找得到就是它，找不到为 null（此时原语按钮置灰）。 */
  nodeId: string | null;
}

/** 只有这三类算「会话里说过的话」；其余（场景/音效/CG/立绘/停止点/幕末/生图预发射）都是布景。 */
const SPOKEN: ReadonlySet<LineageNodeView["kind"]> = new Set(["say", "narrate", "thought"]);

/** 玩家点「继续/下一幕」也会落一条 player 节点，但它不是发言，别混进记录里。 */
const CONTINUE_MARK = "（继续）";

/**
 * 会话记录 = 这一支世界线上，剧作家说过的话 + 玩家说过的话 + 导演说过的话。
 *
 * 为什么从谱系走而不是从事件缓冲走：缓冲里只有剧本事件（`lineageToEvents` 明确丢掉
 * player/ooc），所以「玩家的选择、自由输入、导演注」在回看与回顾里全都查无此人；
 * 反过来缓冲里躺着 scene 行，滑回去会看见一条「背景 · 校门口」，那是布景不是台词。
 * 谱系是行级事件日志的唯一真相源，剧作家的原句、玩家的表态、导演注都在同一条链上按演出顺序排着。
 */
export function buildTranscript(
  view: LineageView | null,
  lines: readonly ScriptLine[],
): TranscriptEntry[] {
  if (!view) return lines.filter((l) => SPOKEN.has(l.type) && l.text !== "").map(fromLine);
  return withFreshTail(fromView(view, lines), lines);
}

/** 台词行的取数口径：文本与编辑覆盖以缓冲为准（谱系存的是编辑前的原句）。 */
function fromLine(line: ScriptLine): TranscriptEntry {
  return {
    key: line.key,
    kind: "line",
    type: line.type === "sfx" || line.type === "cg" || line.type === "scene" ? "narrate" : line.type,
    actorId: line.actorId ?? null,
    text: line.text,
    seq: line.seq ?? null,
    nodeId: null,
  };
}

function fromView(view: LineageView, lines: readonly ScriptLine[]): TranscriptEntry[] {
  const nodeById = new Map(view.nodes.map((node) => [node.id, node]));
  const lineBySeq = new Map<number, ScriptLine>();
  for (const line of lines) if (line.seq !== undefined) lineBySeq.set(line.seq, line);

  const out: TranscriptEntry[] = [];
  const path = view.pathIds;
  for (let i = 0; i < path.length; i += 1) {
    const node = nodeById.get(path[i]!);
    if (!node) continue;
    if (SPOKEN.has(node.kind)) {
      const line = node.seq === undefined ? undefined : lineBySeq.get(node.seq);
      out.push({
        key: line?.key ?? node.id,
        kind: "line",
        type: node.kind as "say" | "narrate" | "thought",
        actorId: (node.attrs.id as string | undefined) ?? line?.actorId ?? null,
        text: line?.text || node.text,
        seq: node.seq ?? null,
        nodeId: node.id,
      });
      continue;
    }
    if (node.kind !== "player" && node.kind !== "ooc") continue;
    const text = node.text;
    if (!text || text === CONTINUE_MARK) continue;
    // 一条 OOC 同时记了 player 与 ooc 两个节点（同一段输入），玩家那份是重复。
    const next = path[i + 1] === undefined ? undefined : nodeById.get(path[i + 1]!);
    if (node.kind === "player" && next?.kind === "ooc" && next.text === text) continue;
    out.push({
      key: node.id,
      kind: node.kind,
      type: node.kind === "player" ? "say" : "narrate",
      actorId: node.kind === "player" ? "player" : null,
      text,
      seq: null,
      nodeId: node.id,
    });
  }
  return out;
}

/**
 * 谱系是按需拉取的，落后缓冲一两个节拍；把缓冲里还没进谱系的台词行补在末尾，
 * 否则「回顾」会缺最新一两句，而那正是玩家最想翻回去看的那几句。
 */
function withFreshTail(entries: TranscriptEntry[], lines: readonly ScriptLine[]): TranscriptEntry[] {
  const seen = new Set(entries.map((entry) => entry.key));
  for (const line of lines) {
    if (!SPOKEN.has(line.type) || line.text === "" || seen.has(line.key)) continue;
    entries.push(fromLine(line));
    seen.add(line.key);
  }
  return entries;
}

/** 台词三件套才有「改写这一句」；表态与导演注是玩家的输入，改写它们没有意义。 */
export function editableNodeId(entry: TranscriptEntry): string | null {
  return entry.kind === "line" && entry.nodeId ? entry.nodeId : null;
}
