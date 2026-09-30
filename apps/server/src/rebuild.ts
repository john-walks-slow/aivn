import {
  lineageToEvents as coreLineageToEvents,
  stopFromNode,
  toNodeView,
} from "@stage-ai/core";
import type { LineageEvent, SequencedEvent, StopPayload } from "@stage-ai/core";

/**
 * 上下文重建（P6 transformContext 的纯函数层）：谱系事件日志是唯一真相源，
 * 分岔/跳转/编辑之后从日志重放出「客户端事件流」与「LLM 对话轮次」，
 * 完成一次突变后即回到 append-only 稳态。
 *
 * 入参一律是 `LineageTree.materialize()` 的产物：edit 覆盖已生效、fork 标记已剔除。
 */

/**
 * 谱系事件链 → 客户端 IR 事件。
 *
 * 物化本身在 core（路线树与回看共用同一份函数），这里只做投影适配：服务端手里是
 * LineageEvent，core 的重放吃的是路线树投影，规则只有一份。
 * edit 的覆盖不在这里补——`materialize()` 已经把改写后的文本填回 text 了。
 */
export function lineageToEvents(chain: readonly LineageEvent[]): SequencedEvent[] {
  return coreLineageToEvents(chain.map(toNodeView));
}

export function stopFromEvent(event: LineageEvent): StopPayload | null {
  return stopFromNode(toNodeView(event));
}

/** 一轮的重建素材：玩家输入（可空 = 开场）与已演出脚本。 */
export interface RebuiltBeat {
  user: string;
  assistant: string;
}

/**
 * 谱系链 → LLM 对话轮次。
 *
 * 轮边界 = 上一个 beat_end 之后的第一个事件；末尾未收束的半轮（轮中节点分岔）也成轮。
 * 玩家输入段照搬玩家原话（不在重建时替模型润色），【状态】不进历史轮次——
 * 状态由下一次生成时的 user 消息携带，避免 anachronistic 的旧状态快照。
 *
 * 链尾若是「有输入没台词」的一组（分岔落在一次表态上），它不能成轮：`{user, assistant:""}`
 * 这种空回复轮次在 Anthropic 一族的接口上直接 400。这类输入原样退回给编排器，
 * 由下一轮生成时并进 user 消息——玩家那句话因此不会丢，也不需要造假轮次。
 */
export function lineageToBeats(
  chain: readonly LineageEvent[],
  names: Readonly<Record<string, string>>,
  opening: string,
): { beats: RebuiltBeat[]; trailingInputs: string[] } {
  const text = (event: LineageEvent): string => event.text ?? "";
  const beats: RebuiltBeat[] = [];
  let inputs: string[] = [];
  let script: string[] = [];
  const flush = (): void => {
    if (script.length === 0) return;
    beats.push({
      user: inputs.length > 0 ? inputs.join("\n\n") : "【开场】\n" + opening,
      assistant: script.join("\n"),
    });
    inputs = [];
    script = [];
  };
  for (const event of chain) {
    const attrs = event.payload?.attrs ?? {};
    switch (event.kind) {
      case "prompt":
        inputs.push(`【用户输入】\n${event.payload?.input ?? ""}`);
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
  return { beats, trailingInputs: inputs };
}

function stopLine(stop: StopPayload): string {
  if (stop.stopType === "choice") {
    const labels = (stop.options ?? []).map((option) => option.text).join(" / ");
    return `（等待玩家选择：${labels || "（无选项）"}）`;
  }
  return "（等待玩家自由回应）";
}

