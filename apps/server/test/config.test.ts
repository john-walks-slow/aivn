import { describe, expect, it, vi } from "vitest";
import { imagePendingTtlMs, loadConfig, parseKeyList, parseModelList } from "../src/config.js";

describe("STAGE_MODELS 支持清单", () => {
  it("不配 = 不限制（空表）", () => {
    expect(loadConfig({}, "/repo").models).toEqual([]);
    expect(parseModelList(undefined)).toEqual([]);
    expect(parseModelList("   ")).toEqual([]);
  });

  it("逗号与空白都算分隔，保序去重（下拉的顺序就是配置里写的顺序）", () => {
    expect(parseModelList("low, high\tvision\nmedium")).toEqual(["low", "high", "vision", "medium"]);
    expect(loadConfig({ STAGE_MODELS: "low, low ,high" }, "/repo").models).toEqual(["low", "high"]);
  });
});

describe("ServerConfig 纪元压缩参数", () => {
  it("默认窗口/阈值/保留预算", () => {
    const config = loadConfig({}, "/repo");
    expect(config.contextWindow).toBe(131072);
    expect(config.compactRatio).toBe(0.6);
    expect(config.keepRecentTokens).toBe(20000);
  });

  it("非法值回退默认并告警（越界比例会让压缩永不触发或每轮都触发）", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    expect(loadConfig({ STAGE_COMPACT_RATIO: "3" }, "/repo").compactRatio).toBe(0.6);
    expect(loadConfig({ STAGE_COMPACT_RATIO: "0" }, "/repo").compactRatio).toBe(0.6);
    expect(loadConfig({ STAGE_CONTEXT_WINDOW: "abc" }, "/repo").contextWindow).toBe(131072);
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });

  it("保留预算 ≥ 触发阈值：告警（否则每轮判超标却永远切不出可压段）", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    loadConfig({ STAGE_KEEP_RECENT_TOKENS: "100000" }, "/repo");
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("纪元压缩将无法切出可压段"));
    warn.mockRestore();
  });
});

describe("ServerConfig 联网检索与凭据", () => {
  it("exa 默认开、走本地代理；env 能改端点与开关", () => {
    const base = loadConfig({}, "/repo");
    expect(base.exa.enabled).toBe(true);
    expect(base.exa.baseUrl).toBe("https://api.exa.ai");
    expect(base.exa.proxy).toBe("http://127.0.0.1:7890");
    expect(base.exa.keys).toEqual([]);

    const custom = loadConfig({ STAGE_EXA_ENABLED: "false" }, "/repo");
    expect(custom.exa.enabled).toBe(false);
  });

  it("多把 key 从 env 逗号分隔读入（不再指向凭据文件）", () => {
    expect(parseKeyList(undefined)).toEqual([]);
    expect(parseKeyList("   ")).toEqual([]);
    expect(parseKeyList("k1, k2 , k3")).toEqual(["k1", "k2", "k3"]);
    expect(parseKeyList("k1 k2\tk3")).toEqual(["k1", "k2", "k3"]);
    // 保序去重：轮询顺序就是配置里写的顺序
    expect(parseKeyList("k2, k1, k2")).toEqual(["k2", "k1"]);
    expect(loadConfig({ STAGE_TTS_KEYS: "sk-a,sk-b" }, "/repo").tts.keys).toEqual(["sk-a", "sk-b"]);
  });
});

describe("骨架兜底上界", () => {
  it("覆盖「自己超时 + 排队等到自己」最坏情况，且随生图配置缩放", () => {
    const base = loadConfig({}, "/repo").image;
    // 默认 180s 超时、并发 6、队列 12 → 自己一次 + 排在两批后面 = 540s
    expect(imagePendingTtlMs(base)).toBe(540_000);

    // 超时变长、并发变小 → 上界跟着变长（写死 45s 时这两条都无从谈起）
    expect(imagePendingTtlMs({ ...base, timeoutMs: 60_000 })).toBe(180_000);
    expect(imagePendingTtlMs({ ...base, concurrency: 12 })).toBe(360_000);
  });
});
