import type {
  LineageEvent,
  OptionAttrs,
  SequencedEvent,
  StageEvent,
  StopPayload,
  StopType,
} from "@stage-ai/core";

/**
 * 上下文重建（P6 transformContext 的纯函数层）：谱系事件日志是唯一真相源，
 * 分岔/跳转/编辑/重写之后从日志重放出「客户端事件流」与「LLM 对话轮次」，
 * 完成一次突变后即回到 append-only 稳态。
 */

/**
 * edit 事件覆盖目标行文本（与 materialize 同一套规则）：改过的台词在
 * 客户端重放与 LLM 上下文重建里都必须是新文本——所见即所忆。
 */
function editOverrides(chain: readonly LineageEvent[]): Map<string, string> {
  const overrides = new Map<string, string>();
  for (const event of chain) {
    if (event.kind === "edit" && event.editTargetId) {
      overrides.set(event.editTargetId, event.text ?? "");
    }
  }
  return overrides;
}

/**
 * 谱系链 → 客户端 IR 事件（preload 不重放——生成不因回放重来）。
 *
 * seq 沿用每个节点当初的 payload.seq，而不是从 1 重新编号：分岔/编辑重生成之后
 * 路线树还指着老的剧本行，重放若改尺子那些锚点就全漂了。一行台词现场至少占 3 个
 * seq（start + ≥1 段文本 + end），重放正好塞得下，不会与下一行的 seq 相撞；
 * 老档没有 payload.seq 才退回顺序编号。
 */
export function lineageToEvents(chain: readonly LineageEvent[]): SequencedEvent[] {
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
  const pushLine = (base: number | undefined, start: StageEvent, mid: StageEvent, end: StageEvent, text: string): void => {
    if (text) push(base, start, mid, end);
    else push(base, start, end);
  };
  for (const event of chain) {
    const attrs = event.payload?.attrs ?? {};
    const base = typeof event.payload?.seq === "number" ? event.payload.seq : undefined;
    const delta = () => textOf(event, overrides);
    switch (event.kind) {
      case "scene":
        push(base, { kind: "scene", ...pickDefined(attrs, ["bg", "bgm", "ambient", "transition"]) });
        break;
      case "actor":
        push(base, { kind: "actor", id: attrs.id ?? "", ...pickDefined(attrs, ["pos", "expression", "action"]) });
        break;
      case "cg":
        push(base, { kind: "cg", id: attrs.id ?? "", ...pickDefined(attrs, ["caption"]) });
        break;
      case "sfx":
        push(base, { kind: "sfx", src: attrs.src ?? "" });
        break;
      case "stop": {
        const stop = stopFromEvent(event);
        if (stop) push(base, stopEvent(stop));
        break;
      }
      case "say":
        pushLine(base, { kind: "say_start", id: attrs.id ?? "", ...(attrs.mood ? { mood: attrs.mood } : {}) }, { kind: "say_text", delta: delta() }, { kind: "say_end" }, delta());
        break;
      case "narrate":
        pushLine(base, { kind: "narrate_start" }, { kind: "narrate_text", delta: delta() }, { kind: "narrate_end" }, delta());
        break;
      case "thought":
        pushLine(base, { kind: "thought_start", id: attrs.id ?? "" }, { kind: "thought_text", delta: delta() }, { kind: "thought_end" }, delta());
        break;
      default:
        // preload 只触发生图、不影响重放画面（背景由 scene 携带）；player/ooc/beat_end 是元信息
        break;
    }
  }
  return out;
}

function textOf(event: LineageEvent, overrides: ReadonlyMap<string, string>): string {
  return overrides.get(event.id) ?? event.text ?? "";
}

/**
 * 谱系 stop 事件 → 停止点载荷。
 * 老档里的 `pause`（已从 DSL 删除的类型）归一为 null：它当年只是「什么都不做就继续」，
 * 现在等价于幕末的「下一幕」按钮，不是一个停止点。
 */
export function stopFromEvent(event: LineageEvent): StopPayload | null {
  const payload = (event.payload ?? {}) as {
    stopType?: StopType;
    options?: OptionAttrs[];
    placeholder?: string;
  };
  if (payload.stopType !== "choice" && payload.stopType !== "free") return null;
  return {
    stopType: payload.stopType,
    ...(payload.options ? { options: payload.options } : {}),
    ...(payload.placeholder ? { placeholder: payload.placeholder } : {}),
  };
}

function stopEvent(stop: StopPayload): StageEvent {
  return {
    kind: "stop",
    stopType: stop.stopType,
    ...(stop.options ? { options: stop.options } : {}),
    ...(stop.placeholder ? { placeholder: stop.placeholder } : {}),
  };
}

/** 一拍的重建素材：玩家输入（可空 = 开场）与已演出脚本。 */
export interface RebuiltBeat {
  user: string | null;
  assistant: string;
}

/**
 * 谱系链 → LLM 对话轮次。
 *
 * 拍边界 = 上一个 beat_end 之后的第一个事件；末尾未收束的半拍（拍中节点分岔）也成拍。
 * 玩家输入段照搬玩家原话（不在重建时替模型润色），【状态】不进历史轮次——
 * 状态由下一次生成时的 user 消息携带，避免 anachronistic 的旧状态快照。
 */
export function lineageToBeats(
  chain: readonly LineageEvent[],
  names: Readonly<Record<string, string>>,
  opening: string,
): RebuiltBeat[] {
  const overrides = editOverrides(chain);
  const text = (event: LineageEvent): string => overrides.get(event.id) ?? event.text ?? "";
  const beats: RebuiltBeat[] = [];
  let inputs: string[] = [];
  let script: string[] = [];
  const flush = (): void => {
    if (script.length === 0 && inputs.length === 0) return;
    const user = inputs.length > 0 ? inputs.join("\n\n") : "【开场】\n" + opening;
    beats.push({ user, assistant: script.join("\n") });
    inputs = [];
    script = [];
  };
  for (const event of chain) {
    const attrs = event.payload?.attrs ?? {};
    switch (event.kind) {
      case "player":
        inputs.push(`【玩家表态】\n${event.payload?.input ?? ""}`);
        break;
      case "ooc":
        inputs.push(`【导演注】\n${event.payload?.input ?? ""}`);
        break;
      case "say": {
        const who = names[attrs.id ?? ""] ?? attrs.id ?? "";
        const mood = attrs.mood ? `（${attrs.mood}）` : "";
        script.push(`${who}${mood}：${text(event)}`);
        break;
      }
      case "thought":
        script.push(`${names[attrs.id ?? ""] ?? attrs.id ?? ""}（心声）：${text(event)}`);
        break;
      case "narrate":
        script.push(`（旁白）${text(event)}`);
        break;
      case "scene":
        script.push(
          `（场景：${attrs.bg ?? "未定"}${attrs.bgm ? ` · ♪ ${attrs.bgm}` : ""}${
            attrs.ambient ? ` · ${attrs.ambient}` : ""
          }）`,
        );
        break;
      case "actor":
        script.push(
          `（${names[attrs.id ?? ""] ?? attrs.id ?? ""} 就位${
            attrs.pos ? ` · ${attrs.pos}` : ""
          }${attrs.expression ? ` · ${attrs.expression}` : ""}${attrs.action ? ` · ${attrs.action}` : ""}）`,
        );
        break;
      case "cg":
        script.push(`（CG：${attrs.id ?? ""}${attrs.caption ? ` ${attrs.caption}` : ""}）`);
        break;
      case "sfx":
        script.push(`（音效：${attrs.src ?? ""}）`);
        break;
      case "stop": {
        const stop = stopFromEvent(event);
        if (stop) script.push(stopLine(stop));
        break;
      }
      case "beat_end":
        flush();
        break;
      default:
        break;
    }
  }
  flush();
  return beats;
}

function stopLine(stop: StopPayload): string {
  if (stop.stopType === "choice") {
    const labels = (stop.options ?? []).map((option) => option.text).join(" / ");
    return `（等待玩家选择：${labels || "（无选项）"}）`;
  }
  return "（等待玩家自由回应）";
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
