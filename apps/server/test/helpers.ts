import type { StreamFn } from "@earendil-works/pi-agent-core";
import { createAssistantMessageEventStream, type AssistantMessage } from "@earendil-works/pi-ai";
import type { PlayConfig } from "@stage-ai/core";
import type { IndexCard } from "../src/memory.js";

export interface FakeResponse {
  /** 剧本 DSL 原文（流式输出的 assistant 文本）。 */
  text: string;
  /** 剧作家的思考文本（assistant 消息里的 thinking 块）。 */
  thinking?: string;
  /** 是否附带 beat_done 工具调用。 */
  beatDone?: boolean;
  /** 额外工具调用（与 beat_done 同批：如 write_memory）。 */
  toolCalls?: { name: string; args: Record<string, unknown> }[];
  /** 闸门：正文照发，但 done 押后到 gate 兑现——用来把某一轮卡在「演出中」。 */
  gate?: Promise<unknown>;
}
export const PLAY: PlayConfig = {
  id: "test",
  title: "测试剧目",
  premise: "测试 premise",
  characters: [{ id: "mio", name: "澪", persona: "测试角色" }],
  opening: "（游戏开始）",
  initialState: { turn: 0, affinity: { mio: 10 }, flags: {} },
  initialScene: "走廊",
};

export const CARD: IndexCard = {
  layer: "lore",
  name: "旧约定",
  summary: "两人初中时的约定。",
  detail: "# 旧约定\n初中时澪和主角约好一起参加文化祭。\n",
  file: "旧约定",
};

export const BEAT_1 = [
  '<scene bg="corridor_dusk" bgm="melancholy" transition="fade"/>',
  '<actor id="mio" pos="center" expression="pout" action="enter"/>',
  "<narrate>放学后的走廊空无一人。</narrate>",
  '<say id="mio" mood="annoyed">……太慢了！</say>',
  '<stop type="choice"><option value="a">道歉</option><option>装傻</option></stop>',
].join("\n");

export const BEAT_2 = [
  '<say id="mio" mood="soft">……算了。</say>',
  "<narrate>风停了。</narrate>",
].join("\n");

/** 假 LLM 流：按调用序号回放脚本，完整模拟 text 流 + tool_call + done。 */
export function createFakeStreamFn(responses: FakeResponse[]): StreamFn {
  let call = 0;
  return () => {
    const response = responses[Math.min(call, responses.length - 1)]!;
    call += 1;
    const stream = createAssistantMessageEventStream();
    const partial = { role: "assistant", content: [] } as AssistantMessage;

    queueMicrotask(() => {
      stream.push({ type: "start", partial });
      if (response.thinking) {
        // 思考块在 content 数组里排在正文之前，事件序与之一致（先 thinking_* 后 text_*）
        stream.push({ type: "thinking_start", contentIndex: 0, partial });
        stream.push({ type: "thinking_delta", contentIndex: 0, delta: response.thinking, partial });
        stream.push({ type: "thinking_end", contentIndex: 0, content: response.thinking, partial });
      }
      const textIndex = response.thinking ? 1 : 0;
      stream.push({ type: "text_start", contentIndex: textIndex, partial });
      for (const delta of response.text.match(/[\s\S]{1,7}/g) ?? []) {
        stream.push({ type: "text_delta", contentIndex: textIndex, delta, partial });
      }
      stream.push({
        type: "text_end",
        contentIndex: textIndex,
        content: response.text,
        partial,
      });

      if (response.gate) {
        void response.gate.then(() => finish());
      } else {
        finish();
      }

      function finish(): void {
        const finalMessage: AssistantMessage = {
          role: "assistant",
          content: [
            ...(response.thinking
              ? ([{ type: "thinking", thinking: response.thinking }] as AssistantMessage["content"])
              : []),
            { type: "text", text: response.text },
          ],
          api: "openai-completions",
          provider: "fake",
          model: "fake-test",
          // usage 全零：假流不知道真实上下文大小，交回 pi 的字符启发式（纪元压缩按它判定阈值）
          usage: {
            input: 0,
            output: 0,
            cacheRead: 0,
            cacheWrite: 0,
            totalTokens: 0,
            cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
          },
          stopReason: "stop",
          timestamp: Date.now(),
        };
        if (response.beatDone) {
          finalMessage.content.push({
            type: "toolCall",
            id: "call-1",
            name: "beat_done",
            arguments: {},
          });
          finalMessage.stopReason = "toolUse";
        }
        let callNo = 2;
        for (const tool of response.toolCalls ?? []) {
          finalMessage.content.push({
            type: "toolCall",
            id: `call-${callNo++}`,
            name: tool.name,
            arguments: tool.args,
          });
          finalMessage.stopReason = "toolUse";
        }
        stream.push({ type: "done", message: finalMessage });
        stream.end(finalMessage);
      }
    });
    return stream;
  };
}
