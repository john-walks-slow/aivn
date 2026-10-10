import type { LineageNodeView, LineageView, StopOption, StopType } from "@aivn/core";
import type { TranscriptEntry } from "./transcript.js";

/**
 * 剧本页的一条舞台指令。
 *
 * 与「说过的话」（transcript）分开：那边只为**读**服务（谁说了什么，回看/重写都挂在台词上），
 * 这边要的是**照剧本原样**铺开——换景、立绘、音效、插图、效果、停止点都各占一行。
 * 文案一律说人话：不写 `<scene>` / `attrs` 这类引擎内部说法。
 */
export interface ScriptDirection {
  key: string;
  type: "scene" | "actor" | "sfx" | "cg" | "fx" | "preload" | "stop";
  /** 这一步在做什么（「换场景」「立绘」「音效」…）。 */
  label: string;
  /** 具体内容：素材 id、参数、选项摘要。空则只出 label。 */
  detail: string | null;
  seq: number | null;
  nodeId: string;
  /** 停止点专有：回看要按原样重建选项。 */
  stopType?: StopType;
  stopOptions?: StopOption[];
}

export type ScriptFeedItem =
  | { kind: "line"; key: string; entry: TranscriptEntry }
  | { kind: "direction"; key: string; direction: ScriptDirection };

/** 哪些谱系节点是「布景指令」——台词节点走 transcript，不在这里重复。 */
const DIRECTIONS = new Set<LineageNodeView["kind"]>(["scene", "actor", "sfx", "cg", "fx", "preload", "stop"]);

/**
 * 剧本 = 台词（transcript）+ 舞台指令（谱系里的布景节点），按演出顺序合并。
 *
 * 合并键是各事件的 `seq`（同一把尺子：台词行、布景、玩家输入都带）。没有 seq 的老档条目
 * 排在它们各自那一侧的原位——transcript 本身已经是顺序的，只把指令按 seq 插进去。
 */
export function buildScriptFeed(
  view: LineageView | null,
  entries: readonly TranscriptEntry[],
  names: Readonly<Record<string, string>> = {},
): ScriptFeedItem[] {
  if (!view) return entries.map((entry) => ({ kind: "line", key: entry.key, entry }));

  const used = new Set<string>();
  const nodeById = new Map(view.nodes.map((node) => [node.id, node]));
  /** 台词条目按谱系节点认领：认到的按谱系顺序摆，认不到（新鲜尾巴）补在后面。 */
  const entryByNode = new Map<string, TranscriptEntry>();
  const entriesBySeq = new Map<number, TranscriptEntry[]>();
  for (const entry of entries) {
    if (entry.nodeId) entryByNode.set(entry.nodeId, entry);
    if (entry.seq !== null) {
      const list = entriesBySeq.get(entry.seq);
      if (list) list.push(entry);
      else entriesBySeq.set(entry.seq, [entry]);
    }
  }
  /**
   * 认领这一行对应的会话条目。nodeId 是首选；玩家输入那类条目没有 nodeId
   * （它从事件缓冲直接来），就按 seq 认——同一把尺子，两边对得上。
   */
  const claim = (node: LineageNodeView): TranscriptEntry | undefined => {
    const byNode = entryByNode.get(node.id);
    if (byNode && !used.has(byNode.key)) return byNode;
    if (node.seq === undefined) return undefined;
    return (entriesBySeq.get(node.seq) ?? []).find((entry) => !used.has(entry.key));
  };

  const out: ScriptFeedItem[] = [];
  for (const id of view.pathIds) {
    const node = nodeById.get(id);
    if (!node) continue;
    if (DIRECTIONS.has(node.kind)) {
      const direction = directionOf(node, names);
      if (direction) out.push({ kind: "direction", key: `d:${node.id}`, direction });
      continue;
    }
    const entry = claim(node);
    if (!entry) continue;
    used.add(entry.key);
    out.push({ kind: "line", key: entry.key, entry });
  }

  // 谱系里还没有的新鲜尾巴（刚流出来的那几行）：照 transcript 的顺序补在最后
  for (const entry of entries) {
    if (used.has(entry.key)) continue;
    out.push({ kind: "line", key: entry.key, entry });
  }
  return out;
}

function directionOf(node: LineageNodeView, names: Readonly<Record<string, string>>): ScriptDirection | null {
  const attrs = node.attrs ?? {};
  const base = { seq: node.seq ?? null, nodeId: node.id };
  switch (node.kind) {
    case "scene":
      return {
        ...base,
        key: node.id,
        type: "scene",
        label: attrs.clear === "true" ? "新场" : "换景",
        detail: sceneDetail(attrs),
      };
    case "actor": {
      const id = attrs.id ?? "";
      const who = names[id] ?? id;
      const bits: string[] = [];
      if (attrs.variant) bits.push(`差分 ${attrs.variant}`);
      if (attrs.pos) bits.push(`站位 ${attrs.pos}`);
      if (attrs.action) bits.push(attrs.action);
      return { ...base, key: node.id, type: "actor", label: "立绘", detail: [who, ...bits].join(" · ") };
    }
    case "sfx":
      return { ...base, key: node.id, type: "sfx", label: "音效", detail: attrs.src ?? null };
    case "cg":
      return {
        ...base,
        key: node.id,
        type: "cg",
        label: "插图",
        detail: [attrs.id, attrs.caption].filter(Boolean).join(" · ") || null,
      };
    case "fx":
      return {
        ...base,
        key: node.id,
        type: "fx",
        label: "舞台效果",
        detail: [attrs.effect, attrs.verb, attrs.value].filter(Boolean).join(" ") || null,
      };
    case "preload":
      return { ...base, key: node.id, type: "preload", label: "提前生成", detail: [attrs.type, attrs.id].filter(Boolean).join(" ") || null };
    case "stop": {
      const count = node.stopOptions?.length ?? 0;
      return {
        ...base,
        key: node.id,
        type: "stop",
        label: "停止点",
        detail: count > 0 ? `${count} 个选项` : "等玩家自己写",
        ...(node.stopType ? { stopType: node.stopType } : {}),
        ...(node.stopOptions ? { stopOptions: node.stopOptions } : {}),
      };
    }
    default:
      return null;
  }
}

function sceneDetail(attrs: Record<string, string>): string | null {
  const bits: string[] = [];
  if (attrs.bg) bits.push(attrs.bg);
  if (attrs.bgm) bits.push(attrs.bgm === "none" ? "停音乐" : `音乐 ${attrs.bgm}`);
  if (attrs.ambient) bits.push(attrs.ambient === "none" ? "停环境音" : `环境音 ${attrs.ambient}`);
  if (attrs.transition) bits.push(attrs.transition);
  return bits.join(" · ") || null;
}
