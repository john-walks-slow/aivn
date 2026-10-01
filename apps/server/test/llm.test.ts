import { describe, expect, it } from "vitest";
import type { StreamFn } from "@earendil-works/pi-agent-core";
import type { Api, Model } from "@earendil-works/pi-ai";
import { completeText } from "../src/llm.js";

/** 假流：只回放给定的两类事件，不碰任何真实接口。 */
function fakeStream(events: unknown[]): StreamFn {
  return (async () => {
    const iter = events[Symbol.iterator]();
    return {
      async *[Symbol.asyncIterator]() {
        for (const event of iter) yield event as never;
      },
    } as never;
  }) as unknown as StreamFn;
}

const model = { id: "stub", api: "stub" } as unknown as Model<Api>;
const base = { streamFn: fakeStream([]), model, getApiKey: () => "stub-key" };

function doneEvent(reason: "stop" | "length", text = ""): unknown {
  return { type: "done", reason, message: { content: [{ type: "text", text }] } };
}

describe("completeText", () => {
  it("拼起流式增量", async () => {
    const text = await completeText(
      { ...base, streamFn: fakeStream([{ type: "text_delta", delta: "黄昏" }, { type: "text_delta", delta: "的教室" }, doneEvent("stop")]) },
      "sys",
      "user",
    );
    expect(text).toBe("黄昏的教室");
  });

  it("没有增量时从终态消息取文本", async () => {
    const text = await completeText({ ...base, streamFn: fakeStream([doneEvent("stop", "只在终态里")]) }, "sys", "user");
    expect(text).toBe("只在终态里");
  });

  it("撞输出上限就报错，不把半句话交出去", async () => {
    // 真实故障：思考 token 吃光单发预算，正文停在 "…wearing"。收下它 = 生图跑偏、润色半句。
    const stream = fakeStream([{ type: "text_delta", delta: "17-year-old girl, wearing" }, doneEvent("length")]);
    await expect(completeText({ ...base, streamFn: stream }, "sys", "user")).rejects.toThrow(/截断/);
  });

  it("流里报错按原样抛", async () => {
    const stream = fakeStream([{ type: "text_delta", delta: "半句" }, { type: "error", reason: "error", error: { errorMessage: "网关炸了" } }]);
    await expect(completeText({ ...base, streamFn: stream }, "sys", "user")).rejects.toThrow("网关炸了");
  });

  it("空文本报错", async () => {
    await expect(completeText({ ...base, streamFn: fakeStream([doneEvent("stop")]) }, "sys", "user")).rejects.toThrow(/空/);
  });
});