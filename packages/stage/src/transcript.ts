import type { LineageNodeView, LineageView } from "@aivn/core";
import type { ScriptLine } from "./script.js";

/** 会话记录里的一条：角色台词，或玩家发来的一句话。 */
export type TranscriptKind = "line" | "input";

export interface TranscriptEntry {
  /** 台词行取 ScriptLine.key（语音关联与回看游标都对它）；玩家输入取谱系节点 id。 */
  key: string;
  kind: TranscriptKind;
  /** 显示形态：line 用自己的说话方式，input 借对话框样式。 */
  type: "say" | "narrate" | "thought";
  actorId: string | null;
  /** 一次性名牌覆盖（来自 say name="..."），只影响本句名牌显示。 */
  nameOverride?: string;
  text: string;
  /** 起始事件序号（语音关联与回执认领的键）；老档的玩家输入行没有 seq。 */
  seq: number | null;
  /** 谱系节点 id：分岔/编辑的锚点。找得到就是它，找不到为 null（此时原语按钮置灰）。 */
  nodeId: string | null;
}

/** 只有这三类算「会话里说过的话」；其余（场景/音效/CG/立绘/停止点/本轮收束/生图预发射）都是布景。 */
const SPOKEN: ReadonlySet<LineageNodeView["kind"]> = new Set(["say", "narrate", "thought"]);

/** 会话记录收录的行类型：台词三件套 + 玩家输入（输入也是「他说了什么」，不是布景）。 */
const RECORDED: ReadonlySet<ScriptLine["type"]> = new Set(["say", "narrate", "thought", "input"]);

/**
 * 会话记录 = 这一支世界线上，剧作家说过的话 + 玩家说过的话。
 *
 * 玩家输入从事件缓冲直接来（`player_input` 事件，落下即可见，不等谱系轮询）；
 * 谱系 path 上的 prompt 节点按 seq 对回同一条缓冲行——对得上就共用 key，
 * 两轨永不为同一次输入各造一条。台词的文本与编辑覆盖仍以缓冲为准
 * （谱系存的是编辑前的原句）。谱系是行级事件日志的唯一真相源，
 * 剧作家的原句与玩家的输入都在同一条链上按演出顺序排着。
 */
export function buildTranscript(
  view: LineageView | null,
  lines: readonly ScriptLine[],
): TranscriptEntry[] {
  if (!view) return lines.filter((l) => RECORDED.has(l.type) && l.text !== "").map(fromLine);
  return withFreshTail(fromView(view, lines), lines);
}

/** 台词行的取数口径：文本与编辑覆盖以缓冲为准（谱系存的是编辑前的原句）。 */
function fromLine(line: ScriptLine): TranscriptEntry {
  if (line.type === "input") {
    return {
      key: line.key,
      kind: "input",
      type: "say",
      actorId: "player",
      text: line.text,
      seq: line.seq ?? null,
      nodeId: null,
    };
  }
  return {
    key: line.key,
    kind: "line",
    type: line.type === "sfx" || line.type === "cg" || line.type === "scene" ? "narrate" : line.type,
    actorId: line.actorId ?? null,
    ...(line.nameOverride ? { nameOverride: line.nameOverride } : {}),
    text: line.text,
    seq: line.seq ?? null,
    nodeId: null,
  };
}

function fromView(view: LineageView, lines: readonly ScriptLine[]): TranscriptEntry[] {
  const nodeById = new Map(view.nodes.map((node) => [node.id, node]));
  const lineBySeq = new Map<number, ScriptLine>();
  for (const line of lines) if (line.seq !== undefined) lineBySeq.set(line.seq, line);
  // 升级前的老档 prompt 节点没有 seq，重放出来的 input 行也认不回它——按路径顺序
  // 对上缓冲里同文本的下一条 input 行（重放顺序 = 路径顺序），对得上就借用它的 key，
  // 回顾里同一次输入才不会出现两条。
  const unmatchedInputs = lines.filter((l) => l.type === "input");

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
        ...(line?.nameOverride ? { nameOverride: line.nameOverride } : {}),
        text: line?.text || node.text,
        seq: node.seq ?? null,
        nodeId: node.id,
      });
      continue;
    }
    if (node.kind !== "prompt") continue;
    const text = node.text;
    if (!text) continue;
    let line = node.seq === undefined ? undefined : lineBySeq.get(node.seq);
    if (line) {
      // seq 命中的这条可能还躺在兜底池里：及时移出，后面无 seq 的老档节点
      // 才不会把同一条再认一次（同 key 两条记录）。
      const at = unmatchedInputs.indexOf(line);
      if (at >= 0) unmatchedInputs.splice(at, 1);
    } else {
      const at = unmatchedInputs.findIndex((candidate) => candidate.text === text);
      if (at >= 0) line = unmatchedInputs.splice(at, 1)[0];
    }
    out.push({
      key: line?.key ?? node.id,
      kind: "input",
      type: "say",
      actorId: "player",
      text: line?.text || text,
      seq: node.seq ?? line?.seq ?? null,
      nodeId: node.id,
    });
  }
  return out;
}

/**
 * 谱系是按需拉取的，落后缓冲一两个轮；把缓冲里还没进谱系的台词行补在末尾，
 * 否则「回顾」会缺最新一两句，而那正是玩家最想翻回去看的那几句。
 */
function withFreshTail(entries: TranscriptEntry[], lines: readonly ScriptLine[]): TranscriptEntry[] {
  const seen = new Set(entries.map((entry) => entry.key));
  for (const line of lines) {
    if (!RECORDED.has(line.type) || line.text === "" || seen.has(line.key)) continue;
    entries.push(fromLine(line));
    seen.add(line.key);
  }
  return entries;
}

/** 台词三件套才有「改写这一句」；玩家发来的话不是剧作家的原句，改它没有意义。 */
export function editableNodeId(entry: TranscriptEntry): string | null {
  return entry.kind === "line" && entry.nodeId ? entry.nodeId : null;
}
