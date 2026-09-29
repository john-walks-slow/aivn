import {
  lineageToEvents as coreLineageToEvents,
  stopFromNode,
  toNodeView,
} from "@stage-ai/core";
import type { LineageEvent, SequencedEvent, StopPayload } from "@stage-ai/core";

/**
 * 上下文重建（P6 transformContext 的纯函数层）：谱系事件日志是唯一真相源，
 * 分岔/跳转/编辑/重写之后从日志重放出「客户端事件流」与「LLM 对话轮次」，
 * 完成一次突变后即回到 append-only 稳态。
 */

/**
 * 谱系事件链 → 客户端 IR 事件。
 *
 * 物化本身在 core（客户端只读回看同一份函数），这里只做投影适配：服务端手里是
 * LineageEvent，core 的物化吃的是路线树投影，规则只有一份。
 */
export function lineageToEvents(chain: readonly LineageEvent[]): SequencedEvent[] {
  return coreLineageToEvents(chain.map(toNodeView));
}

export function stopFromEvent(event: LineageEvent): StopPayload | null {
  return stopFromNode(toNodeView(event));
}

/**
 * edit 事件覆盖目标行文本：改过的台词在 LLM 上下文里必须是新文本——所见即所忆。
 * （客户端重放走 core 的同一条规则，这里只管对话轮次这一侧。）
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

