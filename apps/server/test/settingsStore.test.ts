import { mkdtempSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { freshSettings } from "../src/config.js";
import { settingsPath, SettingsStore } from "../src/settingsStore.js";
import { settingsStoreFor } from "./helpers.js";

function dir(): string {
  return mkdtempSync(join(tmpdir(), "stage-settings-"));
}

describe("设置落盘与迁移", () => {
  it("首次启动写出一份默认设置，用户可以打开看、也可以手改", () => {
    const root = dir();
    const store = SettingsStore.open(root, {});
    const raw = readFileSync(settingsPath(root), "utf8");
    expect(JSON.parse(raw)).toEqual(JSON.parse(JSON.stringify(freshSettings())));
    expect(store.get().baseUrl).toBe("");
  });

  it("有旧 .env 时按旧语义迁移一次，此后 .env 不再参与", () => {
    const root = dir();
    const first = SettingsStore.open(root, { STAGE_BASE_URL: "http://10.0.0.9:9999/v1", STAGE_TTS_KEYS: "k1,k2" });
    expect(first.get().baseUrl).toBe("http://10.0.0.9:9999/v1");
    expect(first.get().tts.keys).toEqual(["k1", "k2"]);

    // 第二次启动带着不同的环境变量：文件已经在，环境说了不算
    const second = SettingsStore.open(root, { STAGE_BASE_URL: "http://other:1/v1" });
    expect(second.get().baseUrl).toBe("http://10.0.0.9:9999/v1");
  });

  it("改设置立刻落盘：进程崩了也不丢（过去要重启才生效的那份现在就在盘上）", () => {
    const root = dir();
    const store = SettingsStore.open(root, {});
    store.patch({ modelId: "low" });
    expect(JSON.parse(readFileSync(settingsPath(root), "utf8")).modelId).toBe("low");
  });

  it("非法补丁直接抛错，盘上那份一个字节不动", () => {
    const root = dir();
    const store = SettingsStore.open(root, {});
    const before = readFileSync(settingsPath(root), "utf8");
    expect(() => store.patch({ compactRatio: 9 })).toThrow(/0 到 1/);
    expect(readFileSync(settingsPath(root), "utf8")).toBe(before);
  });

  it("落盘不留临时文件（原子写：写坏的一半不会被读到）", () => {
    const root = dir();
    const store = SettingsStore.open(root, {});
    store.patch({ modelId: "low" });
    expect(readdirSync(root).filter((name) => name.endsWith(".tmp"))).toEqual([]);
  });

  it("手改文件后读不动时保留内存里那份（不让一个逗号把服务打死）", () => {
    const root = dir();
    const store = SettingsStore.open(root, {});
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    writeFileSync(settingsPath(root), "{ 这不是 JSON", "utf8");
    (store as unknown as { reloadFromDisk: () => void }).reloadFromDisk();
    expect(store.get().modelId).toBe("");
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });

  it("手改文件（合法）就地生效，且未知字段只告警不写入", () => {
    const root = dir();
    const store = SettingsStore.open(root, {});
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    writeFileSync(
      settingsPath(root),
      JSON.stringify({ modelId: "hand-edited", nonsense: 1, image: { enabled: true } }),
      "utf8",
    );
    (store as unknown as { reloadFromDisk: () => void }).reloadFromDisk();
    expect(store.get().modelId).toBe("hand-edited");
    expect(store.get().image.enabled).toBe(true);
    expect(store.get().tts.baseUrl).toBe(freshSettings().tts.baseUrl);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("nonsense"));
    warn.mockRestore();
  });
});

describe("设置变化的订阅（就地生效的挂点）", () => {
  it("改了才通知、退了就不通知", () => {
    const store = settingsStoreFor(freshSettings());
    const seen: string[] = [];
    const off = store.subscribe((config) => seen.push(config.modelId));
    store.patch({ modelId: "low" });
    expect(seen).toEqual(["low"]);
    // 值没变 = 不算改动 = 不触发重建
    store.patch({ modelId: "low" });
    expect(seen).toEqual(["low"]);
    off();
    store.patch({ modelId: "medium" });
    expect(seen).toEqual(["low"]);
  });

  it("一个订阅者抛错不影响其他人（设置改失败不该让别的组件收不到）", () => {
    const store = settingsStoreFor(freshSettings());
    const seen: number[] = [];
    store.subscribe(() => {
      throw new Error("boom");
    });
    store.subscribe((config) => seen.push(config.maxTokens));
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    store.patch({ maxTokens: 4096 });
    expect(seen).toEqual([4096]);
    warn.mockRestore();
  });
});
