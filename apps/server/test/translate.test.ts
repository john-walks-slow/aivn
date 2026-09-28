import { describe, expect, it } from "vitest";
import type { StreamFn } from "@earendil-works/pi-agent-core";
import { createAssistantMessageEventStream, type AssistantMessage, type Model, type Api } from "@earendil-works/pi-ai";
import { Translator } from "../src/translate.js";

/** 假 LLM 流：回放固定译文、可延迟（并发窗口）、可选 errorMessage（失败路）。 */
function fakeStream(opts: {
  text: string;
  counter: { calls: number };
  delayMs?: number;
  errorMessage?: string;
}): StreamFn {
  return () => {
    opts.counter.calls += 1;
    const stream = createAssistantMessageEventStream();
    const partial = { role: "assistant", content: [] } as AssistantMessage;
    const finalMessage: AssistantMessage = {
      role: "assistant",
      content: [{ type: "text", text: opts.text }],
      api: "openai-completions",
      provider: "fake",
      model: "fake-test",
      usage: { input: 1, output: 1, cacheRead: 0, cacheWrite: 0, totalTokens: 2, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
      stopReason: "stop",
      timestamp: Date.now(),
      ...(opts.errorMessage ? { errorMessage: opts.errorMessage } : {}),
    };
    setTimeout(() => {
      stream.push({ type: "start", partial });
      stream.push({ type: "text_start", contentIndex: 0, partial });
      stream.push({ type: "text_delta", contentIndex: 0, delta: opts.text, partial });
      stream.push({ type: "text_end", contentIndex: 0, content: opts.text, partial });
      if (opts.errorMessage) {
        stream.push({ type: "error", reason: "error", error: finalMessage });
      } else {
        stream.push({ type: "done", reason: "stop", message: finalMessage });
      }
      stream.end(opts.errorMessage ? undefined : finalMessage);
    }, opts.delayMs ?? 0);
    return stream;
  };
}

function makeTranslator(streamFn: StreamFn): Translator {
  return new Translator({ streamFn, model: {} as Model<Api>, getApiKey: () => "test-key" }, "ja");
}

describe("Translator（语音语言翻译）", () => {
  it("短语翻译走 LLM 并返回译文", async () => {
    const counter = { calls: 0 };
    const t = makeTranslator(fakeStream({ text: "こんにちは", counter }));
    await expect(t.translate("你好")).resolves.toBe("こんにちは");
    expect(counter.calls).toBe(1);
  });

  it("同文本缓存命中不重译（相邻行重复短语只译一次）", async () => {
    const counter = { calls: 0 };
    const t = makeTranslator(fakeStream({ text: "うん。", counter }));
    await t.translate("嗯。");
    await t.translate("嗯。");
    expect(counter.calls).toBe(1);
  });

  it("同文本并发去重（inflight 合流）", async () => {
    const counter = { calls: 0 };
    const t = makeTranslator(fakeStream({ text: "こんにちは", counter, delayMs: 20 }));
    const [a, b] = await Promise.all([t.translate("你好"), t.translate("你好")]);
    expect(a).toBe("こんにちは");
    expect(b).toBe("こんにちは");
    expect(counter.calls).toBe(1);
  });

  it("LLM 失败抛错（调用方回退原文）", async () => {
    const counter = { calls: 0 };
    const t = makeTranslator(fakeStream({ text: "", counter, errorMessage: "网关错误" }));
    await expect(t.translate("你好")).rejects.toThrow("网关错误");
  });
});
