import { describe, expect, it, vi } from "vitest";
import { loadConfig } from "../src/config.js";

describe("ServerConfig 纪元压缩参数", () => {
  it("默认窗口/阈值/保留预算", () => {
    const config = loadConfig({}, "/repo");
    expect(config.contextWindow).toBe(131072);
    expect(config.compactRatio).toBe(0.6);
    expect(config.keepRecentTokens).toBe(20000);
  });

  it("非法值回退默认并告警（越界比例会让压缩永不触发或每拍都触发）", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    expect(loadConfig({ STAGE_COMPACT_RATIO: "3" }, "/repo").compactRatio).toBe(0.6);
    expect(loadConfig({ STAGE_COMPACT_RATIO: "0" }, "/repo").compactRatio).toBe(0.6);
    expect(loadConfig({ STAGE_CONTEXT_WINDOW: "abc" }, "/repo").contextWindow).toBe(131072);
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });

  it("保留预算 ≥ 触发阈值：告警（否则每拍判超标却永远切不出可压段）", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    loadConfig({ STAGE_KEEP_RECENT_TOKENS: "100000" }, "/repo");
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("纪元压缩将无法切出可压段"));
    warn.mockRestore();
  });
});
