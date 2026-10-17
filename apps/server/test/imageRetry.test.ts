import type { FetchLike } from "@aivn/agent";
import { describe, expect, it } from "vitest";
import { retryingFetch } from "../src/imageRetry.js";

/** 小而快的窗口：策略是入参，测试不必等真实的 1 秒 / 30 秒。 */
const policy = { intervalMs: 5, windowMs: 60 };

/** 按脚本回状态码；脚本用完就一直回最后一条。 */
function scripted(statuses: number[]): { fetchImpl: FetchLike; calls: () => number } {
  let n = 0;
  const fetchImpl = (async () => {
    const status = statuses[Math.min(n, statuses.length - 1)]!;
    n += 1;
    return new Response("busy", { status });
  }) as unknown as FetchLike;
  return { fetchImpl, calls: () => n };
}

describe("出图重试（包在 fetch 外面）", () => {
  it("上游一时之忙（429/423/5xx）再敲，第一发成了就收", async () => {
    const { fetchImpl, calls } = scripted([429, 200]);
    const res = await retryingFetch(fetchImpl, policy)("https://example.test/x", {});
    expect(res.status).toBe(200);
    expect(calls()).toBe(2);
  });

  it("参数 / 鉴权错（其余 4xx）当场交回，一次都不多敲", async () => {
    const { fetchImpl, calls } = scripted([401]);
    const res = await retryingFetch(fetchImpl, policy)("https://example.test/x", {});
    // 原样交回协议层：错误话术由各家自己说（如「NovelAI 出图失败 HTTP 401：…」）
    expect(res.status).toBe(401);
    expect(calls()).toBe(1);
  });

  it("窗口内一直忙：把最后一发原样交回，不把状态码吞成一个自己造的错误", async () => {
    const { fetchImpl, calls } = scripted([429]);
    const res = await retryingFetch(fetchImpl, policy)("https://example.test/x", {});
    expect(res.status).toBe(429);
    expect(calls()).toBeGreaterThan(2);
  });

  it("网络中断照样重敲，窗口用尽才把最后一次异常抛出去", async () => {
    let calls = 0;
    const impl = (async () => {
      calls += 1;
      throw new Error("socket hang up");
    }) as unknown as FetchLike;
    await expect(retryingFetch(impl, policy)("https://example.test/x", {})).rejects.toThrow(/socket hang up/);
    expect(calls).toBeGreaterThan(1);
  });

  it("已经 abort 的请求不重试（再敲也是当场 abort，白搭一秒）", async () => {
    const controller = new AbortController();
    controller.abort();
    let calls = 0;
    const impl = (async () => {
      calls += 1;
      throw new Error("The operation was aborted");
    }) as unknown as FetchLike;
    await expect(
      retryingFetch(impl, policy)("https://example.test/x", { signal: controller.signal }),
    ).rejects.toThrow(/aborted/);
    expect(calls).toBe(1);
  });

  it("间隔或窗口填 0 = 关：原样返回宿主那份 fetch，不给调用链白加一层", () => {
    const impl = (async () => new Response("", { status: 200 })) as unknown as FetchLike;
    expect(retryingFetch(impl, { intervalMs: 0, windowMs: 30_000 })).toBe(impl);
    expect(retryingFetch(impl, { intervalMs: 1000, windowMs: 0 })).toBe(impl);
  });
});
