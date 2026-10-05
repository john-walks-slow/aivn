import { describe, expect, it } from "vitest";
import { pendingTtlMs } from "@aivn/stage";

describe("骨架兜底上界", () => {
  it("服务端给了就用服务端的（写死 45s 会让正在生成的占位被自己撤掉）", () => {
    expect(pendingTtlMs(450_000)).toBe(450_000);
    expect(pendingTtlMs(30_000)).toBe(30_000);
  });

  it("服务端没给（旧协议/0）回落到保守默认值，不回到 45s", () => {
    const fallback = pendingTtlMs(null);
    expect(pendingTtlMs(undefined)).toBe(fallback);
    expect(pendingTtlMs(0)).toBe(fallback);
    // 生图默认 150s 才超时，兜底必须比它长
    expect(fallback).toBeGreaterThan(150_000);
  });
});
