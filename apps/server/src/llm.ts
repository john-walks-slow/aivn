import type { StreamFn } from "@earendil-works/pi-agent-core";
import { normalizeContext, type Api, type Model } from "@earendil-works/pi-ai";

export interface OneShotOptions {
  streamFn: StreamFn;
  model: Model<Api>;
  getApiKey: () => string | undefined;
}

/** 单发输出上限：润色/翻译均为短文本。 */
const MAX_TOKENS = 2048;

/**
 * 单发补全（润色/翻译等轻量旁路）：一次性 system+user → 全量文本。
 * 直调 streamFn（SimpleStreamOptions 契约，reasoning 换算在 streamSimple 侧）：
 * - reasoning 走 low（glm 网关拒绝对无工具调用关闭思考，且该模型始终思考，low 仅是标签）；
 * - maxTokens 自限，绕开模型目录元数据与网关上限的错配。
 */
export async function completeText(opts: OneShotOptions, system: string, user: string): Promise<string> {
  const stream = await opts.streamFn(
    opts.model,
    normalizeContext({
      systemPrompt: system,
      messages: [{ role: "user", content: [{ type: "text", text: user }], timestamp: Date.now() }],
    }),
    { reasoning: "low", apiKey: opts.getApiKey(), maxTokens: MAX_TOKENS },
  );
  let text = "";
  let error: string | null = null;
  for await (const event of stream) {
    if (event.type === "text_delta") {
      text += event.delta;
    } else if (event.type === "error") {
      error = event.error.errorMessage ?? "LLM 调用失败";
    } else if (event.type === "done" && text === "") {
      // 非流式兜底：从终态消息提取文本
      for (const block of event.message.content) {
        if (block.type === "text") text += block.text;
      }
    }
  }
  if (error) throw new Error(error);
  const result = text.trim();
  if (result === "") throw new Error("模型返回空文本");
  return result;
}
