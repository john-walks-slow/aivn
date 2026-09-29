import type { SequencedEvent, StageEvent } from "../dsl/events.js";
import type { OptionAttrs, StopType } from "../dsl/spec.js";
import type { LineageEvent, LineageNodeView } from "./model.js";
import type { StopPayload } from "../ws/protocol.js";

/**
 * 谱系 → 客户端事件流（只读物化层）。
 *
 * 谱系事件日志是唯一真相源，任何一条「某节点为止」的链都能重放成客户端 IR 事件流。
 * 服务端分岔/编辑/重写之后用它重建缓冲（世界线写操作），客户端「跳过去看」用它
 * 在本地物化任意节点——包括废弃分支——不发任何 WS、不动物理分支。
 */

/** 谱系事件 → 路线树投影。客户端与服务端共用这一份，避免两处投影各写一遍走偏。 */
export function toNodeView(event: LineageEvent): LineageNodeView {
  const stop = readStop(event.payload);
  return {
    id: event.id,
    parentId: event.parentId,
    kind: event.kind,
    turn: event.turn,
    // 玩家表态/OOC 只落在 payload.input，回落到它，否则路线树里是一排空节点。
    text: event.text ?? event.payload?.input ?? "",
    attrs: event.payload?.attrs ?? {},
    createdAt: event.createdAt,
    onPath: false,
    children: 0,
    editTargetId: event.editTargetId,
    granularity: event.payload?.granularity,
    instruction: event.payload?.instruction,
    seq: typeof event.payload?.seq === "number" ? event.payload.seq : undefined,
    ...stop,
  };
}

/** 停止点挂在 payload 顶层（attrs 里那个只是给旧客户端兜底的），投影时提上来。 */
function readStop(payload: LineageEvent["payload"]): Pick<LineageNodeView, "stopType" | "stopOptions" | "stopPlaceholder"> {
  const raw = (payload ?? {}) as {
    stopType?: StopType;
    options?: OptionAttrs[];
    placeholder?: string;
  };
  if (raw.stopType !== "choice" && raw.stopType !== "free") return {};
  return {
    stopType: raw.stopType,
    ...(raw.options ? { stopOptions: raw.options } : {}),
    ...(raw.placeholder ? { stopPlaceholder: raw.placeholder } : {}),
  };
}

/**
 * 扁平节点表 → 某节点的祖先链（root → node，序即演出顺序）。
 *
 * 走 parentId 上溯，与 `LineageTree.ancestorChain` 同一条规则；入参可以是整棵路线树的
 * 投影，所以客户端拿 REST 拉来的 LineageView 就能自己拼出任意分支的链。
 */
export function chainToNodes(
  nodes: readonly LineageNodeView[],
  nodeId: string,
): LineageNodeView[] {
  const byId = new Map(nodes.map((node) => [node.id, node]));
  const chain: LineageNodeView[] = [];
  const seen = new Set<string>();
  let cursor: string | null = nodeId;
  while (cursor) {
    if (seen.has(cursor)) break; // 谱系成环也不把界面挂死
    seen.add(cursor);
    const node: LineageNodeView | undefined = byId.get(cursor);
    if (!node) break;
    chain.push(node);
    cursor = node.parentId;
  }
  return chain.reverse();
}

/**
 * edit 事件覆盖目标行文本（与 materialize 同一套规则）：改过的台词在
 * 客户端重放与 LLM 上下文重建里都必须是新文本——所见即所忆。
 */
function editOverrides(chain: readonly LineageNodeView[]): Map<string, string> {
  const overrides = new Map<string, string>();
  for (const node of chain) {
    if (node.kind === "edit" && node.editTargetId) {
      overrides.set(node.editTargetId, node.text);
    }
  }
  return overrides;
}

/**
 * 谱系链 → 客户端 IR 事件（preload 不重放——生成不因回放重来）。
 *
 * seq 沿用每个节点当初的 seq，而不是从 1 重新编号：分岔/编辑重生成之后
 * 路线树还指着老的剧本行，重放若改尺子那些锚点就全漂了。一行台词现场至少占 3 个
 * seq（start + ≥1 段文本 + end），重放正好塞得下，不会与下一行的 seq 相撞；
 * 老档没有 seq 才退回顺序编号。
 */
export function lineageToEvents(chain: readonly LineageNodeView[]): SequencedEvent[] {
  const overrides = editOverrides(chain);
  const out: SequencedEvent[] = [];
  let seq = 0;
  const push = (base: number | undefined, ...events: StageEvent[]): void => {
    const from = base !== undefined && base > seq ? base : seq + 1;
    events.forEach((event, i) => out.push({ seq: from + i, event }));
    seq = from + events.length - 1;
  };
  /**
   * 台词现场 = 开始 + 文本 + 结束。空台词在现场只占 2 个 seq（解析器不发空 delta），
   * 这里必须同规格，否则重放会往后挤一位、把下一行的锚点带偏。
   */
  const pushLine = (
    base: number | undefined,
    start: StageEvent,
    mid: StageEvent,
    end: StageEvent,
    text: string,
  ): void => {
    if (text) push(base, start, mid, end);
    else push(base, start, end);
  };
  for (const node of chain) {
    const attrs = node.attrs;
    const base = node.seq;
    const delta = (): string => overrides.get(node.id) ?? node.text;
    switch (node.kind) {
      case "scene":
        push(base, { kind: "scene", ...pickDefined(attrs, ["bg", "bgm", "ambient", "transition"]) });
        break;
      case "actor":
        push(base, {
          kind: "actor",
          id: attrs.id ?? "",
          ...pickDefined(attrs, ["pos", "expression", "action"]),
        });
        break;
      case "cg":
        push(base, { kind: "cg", id: attrs.id ?? "", ...pickDefined(attrs, ["caption"]) });
        break;
      case "sfx":
        push(base, { kind: "sfx", src: attrs.src ?? "" });
        break;
      case "stop": {
        const stop = stopFromNode(node);
        if (stop) push(base, stopEvent(stop));
        break;
      }
      case "say":
        pushLine(
          base,
          { kind: "say_start", id: attrs.id ?? "", ...(attrs.mood ? { mood: attrs.mood } : {}) },
          { kind: "say_text", delta: delta() },
          { kind: "say_end" },
          delta(),
        );
        break;
      case "narrate":
        pushLine(
          base,
          { kind: "narrate_start" },
          { kind: "narrate_text", delta: delta() },
          { kind: "narrate_end" },
          delta(),
        );
        break;
      case "thought":
        pushLine(
          base,
          { kind: "thought_start", id: attrs.id ?? "" },
          { kind: "thought_text", delta: delta() },
          { kind: "thought_end" },
          delta(),
        );
        break;
      default:
        // preload 只触发生图、不影响重放画面（背景由 scene 携带）；player/ooc/beat_end 是元信息
        break;
    }
  }
  return out;
}

/** 谱系里只会出现 DSL 认识的两种停止点——编排器自造的 pause 不落谱系。 */
type DslStop = Omit<StopPayload, "stopType"> & { stopType: StopType };

/**
 * 谱系 stop 节点 → 停止点载荷。
 * 老档里的 `pause` 归一为 null：它当年是模型写的幕间「什么都不做就继续」，
 * 那种幕间现在由 `beat_end(act_end)` 承担（黑场 +「下一幕」），不是停止点。
 */
export function stopFromNode(node: LineageNodeView): DslStop | null {
  const stopType = node.stopType ?? readLegacyStopType(node.attrs);
  if (stopType !== "choice" && stopType !== "free") return null;
  return {
    stopType,
    ...(node.stopOptions ? { options: node.stopOptions } : {}),
    ...(node.stopPlaceholder ? { placeholder: node.stopPlaceholder } : {}),
  };
}

/** 老档（投影补全之前）只把 stopType 塞在 attrs 里，选项已经随日志丢失。 */
function readLegacyStopType(attrs: Record<string, string>): StopType | undefined {
  const value = attrs.stopType ?? attrs.type;
  return value === "choice" || value === "free" ? value : undefined;
}

function stopEvent(stop: DslStop): StageEvent {  return {
    kind: "stop",
    stopType: stop.stopType,
    ...(stop.options ? { options: stop.options } : {}),
    ...(stop.placeholder ? { placeholder: stop.placeholder } : {}),
  };
}


function pickDefined(
  attrs: Record<string, string>,
  keys: readonly string[],
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const key of keys) {
    const value = attrs[key];
    if (value !== undefined && value !== "") out[key] = value;
  }
  return out;
}
