import { describe, expect, it, vi } from "vitest";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadConfig, readKeysFile } from "../src/config.js";

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

describe("ServerConfig 联网检索与凭据文件", () => {
  it("exa 默认开、走本地代理；env 能改 key 路径与端点", () => {
    const base = loadConfig({}, "/repo");
    expect(base.exa.enabled).toBe(true);
    expect(base.exa.baseUrl).toBe("https://api.exa.ai");
    expect(base.exa.proxy).toBe("http://127.0.0.1:7890");
    expect(base.exa.keysPath).toContain(".config/exa/keys.json");

    const custom = loadConfig({ STAGE_EXA_KEYS: "keys/exa.json", STAGE_EXA_ENABLED: "false" }, "/repo");
    expect(custom.exa.keysPath).toBe("/repo/keys/exa.json");
    expect(custom.exa.enabled).toBe(false);
  });

  it("凭据文件两种形状都认；坏文件按空表处理（不拖垮装配）", () => {
    const dir = mkdtempSync(join(tmpdir(), "stage-keys-"));
    const write = (name: string, body: string): string => {
      const path = join(dir, name);
      writeFileSync(path, body);
      return path;
    };
    expect(readKeysFile(write("array.json", '["k1", "k2"]'))).toEqual(["k1", "k2"]);
    expect(readKeysFile(write("object.json", '{"keys":["k1"]}'))).toEqual(["k1"]);
    // 空串与空文件都当没配，不把脏 key 递给 API
    expect(readKeysFile(write("blank.json", '["k1", "", 2]'))).toEqual(["k1"]);
    expect(readKeysFile(write("garbage.json", "not json"))).toEqual([]);
    expect(readKeysFile(join(dir, "missing.json"))).toEqual([]);
  });
});
