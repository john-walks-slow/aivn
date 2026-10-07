import type { SequencedEvent, StageEvent } from "../dsl/events.js";
import { DEFAULT_TITLE_ALIGN, DEFAULT_TITLE_MODE, isTitleAlign, isTitleMode } from "../dsl/spec.js";
import { isFxVerb } from "../dsl/effects.js";
import type { StopOption, StopType } from "../ws/protocol.js";
import type { LineageEvent, LineageNodeView } from "./model.js";
import type { StopPayload } from "../ws/protocol.js";

/**
 * 谱系 → 客户端事件流（只读物化层）。
 *
 * 谱系事件日志是唯一真相源，「某节点为止」的那条链能重放成客户端 IR 事件流。
 * 走向哪条链由世界线（`tree.leafId`）决定：跳转不追加事件、分岔/编辑追加事件后
 * 叶子随之移动，这里照叶子重放，客户端看到的就永远是当前世界线。
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
    // edit 是挂在目标旁边的旁注，不在树上，单个事件里查不到改写——由 describe() 补
    editedText: null,
    editCount: 0,
    editedAt: undefined,
    seq: typeof event.payload?.seq === "number" ? event.payload.seq : undefined,
    // 插图旁注同样挂在目标旁边，单个事件里查不到——由 describe() 补
    cgs: [],
    ...stop,
  };
}

/** 停止点挂在 payload 顶层（attrs 里那个只是给旧客户端兜底的），投影时提上来。 */
function readStop(payload: LineageEvent["payload"]): Pick<LineageNodeView, "stopType" | "stopOptions" | "stopPlaceholder"> {
  const raw = (payload ?? {}) as {
    stopType?: StopType;
    options?: StopOption[];
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
 * 谱系链 → 客户端 IR 事件（preload 不重放——生成不因回放重来）。
 *
 * seq 沿用每个节点当初的 seq，而不是从 1 重新编号：分岔/编辑重生成之后
 * 路线树还指着老的剧本行，重放若改尺子那些锚点就全漂了。一行台词现场至少占 3 个
 * seq（start + ≥1 段文本 + end），重放正好塞得下，不会与下一行的 seq 相撞；
 * 老档没有 seq 才退回顺序编号。
 */
export function lineageToEvents(chain: readonly LineageNodeView[]): SequencedEvent[] {
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
    // 改写已在物化阶段填回 text（edit 是挂在目标旁边的旁注，不在链上）
    const delta = (): string => node.text;
    switch (node.kind) {
      case "scene":
        push(base, {
          kind: "scene",
          ...pickDefined(attrs, ["bg", "bgm", "ambient", "transition"]),
          // 开新场标记：谱系里是 "true" 字符串，重放还原成布尔（缺省 = 老行为，只换底）。
          ...(isTruthyFlag(attrs.clear) ? { clear: true } : {}),
          ...pickVolume(attrs, ["bgm_volume", "ambient_volume"]),
        });
        break;
      case "actor": {
        // 旧存档里的 actor 属性写着 `expression` / `state`（261004 前分两个名字），
        // 重放时照旧读得出来，但产出一律是新名字。
        const variant = attrs.variant ?? attrs.expression ?? attrs.state;
        push(base, {
          kind: "actor",
          id: attrs.id ?? "",
          ...pickDefined(attrs, ["pos", "action"]),
          ...(variant ? { variant } : {}),
        });
        break;
      }
      case "cg":
        push(base, { kind: "cg", id: attrs.id ?? "", ...pickDefined(attrs, ["caption"]) });
        break;
      case "fx": {
        // effect/verb 缺失或非法（老档/手改）整条不重放：丢一个效果，好过让舞台状态机吃到坏数据。
        const effect = attrs.effect;
        const verb = attrs.verb;
        if (!effect || !isFxVerb(verb)) break;
        push(base, { kind: "fx", effect, verb, ...pickDefined(attrs, ["value"]) });
        break;
      }
      case "sfx":
        push(base, { kind: "sfx", src: attrs.src ?? "", ...pickVolume(attrs, ["volume"]) });
        break;
      case "stop": {
        const stop = stopFromNode(node);
        if (stop) push(base, stopEvent(stop));
        break;
      }
      case "prompt":
        // 玩家输入是时间线上的一帧：现场经 emitStageEvent 广播，重放在这里同规格还原，
        // seq 沿用节点当初的 seq（老档没有才顺序编号），锚点与现场一致。
        if (node.text) push(base, { kind: "player_input", text: node.text });
        break;
      case "say":
        pushLine(
          base,
          { kind: "say_start", id: attrs.id ?? "", ...(attrs.mood ? { mood: attrs.mood } : {}), nodeId: node.id },
          { kind: "say_text", delta: delta() },
          { kind: "say_end" },
          delta(),
        );
        break;
      case "narrate":
        pushLine(
          base,
          { kind: "narrate_start", nodeId: node.id },
          { kind: "narrate_text", delta: delta() },
          { kind: "narrate_end" },
          delta(),
        );
        break;
      case "thought":
        pushLine(
          base,
          { kind: "thought_start", id: attrs.id ?? "", nodeId: node.id },
          { kind: "thought_text", delta: delta() },
          { kind: "thought_end" },
          delta(),
        );
        break;
      case "title":
        // title 的对齐/出法存在 attrs 里；重放时过一遍守卫，坏值落回默认（老档/手改的日志）。
        pushLine(
          base,
          {
            kind: "title_start",
            align: isTitleAlign(attrs.align) ? attrs.align : DEFAULT_TITLE_ALIGN,
            mode: isTitleMode(attrs.mode) ? attrs.mode : DEFAULT_TITLE_MODE,
            nodeId: node.id,
          },
          { kind: "title_text", delta: delta() },
          { kind: "title_end" },
          delta(),
        );
        break;
      default:
        // preload 只触发生图、不影响重放画面（背景由 scene 携带）；ooc/beat_end 是元信息
        break;
    }
  }
  return out;
}

/** 谱系里只会出现 DSL 认识的两种停止点——编排器自造的 pause 不落谱系。 */
type DslStop = Omit<StopPayload, "stopType"> & { stopType: StopType };

/**
 * 谱系 stop 节点 → 停止点载荷。
 * 老档里的 `pause` 归一为 null：它当年是模型写的「什么都不做就继续」，
 * 那种收尾现在由 `beat_end(no_stop)` 承担（一个普通的「继续」），不是停止点。
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

function stopEvent(stop: DslStop): StageEvent {
  return {
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

/** 开关型标记（谱系里是 "true" 字符串）：裸写与真值写法都算开。 */
function isTruthyFlag(value: string | undefined): boolean {
  if (value === undefined) return false;
  const v = value.trim().toLowerCase();
  return v === "" || v === "true" || v === "1" || v === "yes";
}

/** 音量类属性：谱系里存的是字符串，重放要还原成数字（缺省 = 保持当前音量）。 */
function pickVolume(
  attrs: Record<string, string>,
  keys: readonly string[],
): Record<string, number> {
  const out: Record<string, number> = {};
  for (const key of keys) {
    const raw = attrs[key];
    // 空串必须放过：Number("") 是 0（合法有限数），会把音量打到静音
    if (raw === undefined || raw.trim() === "") continue;
    const value = Number(raw);
    if (Number.isFinite(value)) out[key] = value;
  }
  return out;
}
