import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { ServerConfig } from "../src/config.js";
import { SettingsFile, mask } from "../src/configApi.js";

function fixture(env: string): { file: SettingsFile; envPath: string; keysPath: string } {
  const dir = mkdtempSync(join(tmpdir(), "stage-config-"));
  const envPath = join(dir, ".env");
  writeFileSync(envPath, env, "utf8");
  const keysPath = join(dir, "tts-keys.json");
  writeFileSync(keysPath, JSON.stringify(["fish-key-one", "fish-key-two"]), "utf8");
  const config = {
    port: 8787,
    playsRoot: dir,
    modelId: "low",
    modelBase: "deepseek-chat",
    baseUrl: "http://127.0.0.1:9999/v1",
    apiKey: "sk-secret-value-1234",
    maxTokens: 32768,
    contextWindow: 131072,
    compactRatio: 0.75,
    keepRecentTokens: 12000,
    image: {
      enabled: true,
      format: "gemini",
      baseUrl: "http://127.0.0.1:38000",
      apiKey: "flow-secret-9876",
      model: "gemini-3.1-flash-image",
      size: "2k",
      concurrency: 2,
      timeoutMs: 180000,
      reference: "neutral",
    },
    tts: { enabled: true, keysPath, proxy: "", baseUrl: "https://api.fish.audio", concurrency: 3 },
  } as unknown as ServerConfig;
  return { file: new SettingsFile(envPath, config), envPath, keysPath };
}

describe("设置面板后端", () => {
  it("读：凭据只回掩码，附存在位", () => {
    const { file } = fixture("STAGE_MODEL_ID=low\n");
    const view = file.read();
    expect(view.model.apiKey).toBe("sk-s••••1234");
    expect(view.model.apiKeySet).toBe(true);
    expect(view.model.modelId).toBe("low");
    expect(view.tts.keyCount).toBe(2);
    expect(JSON.stringify(view)).not.toContain("sk-secret-value-1234");
  });

  it("写：只改被改的键，注释与无关键原样保留", () => {
    const { file, envPath } = fixture(
      ["# stage-ai 网关", "STAGE_MODEL_ID=low", "STAGE_API_KEY=sk-secret-value-1234", ""].join("\n"),
    );
    const changed = file.write({ model: { modelId: "medium", maxTokens: 16384 } as never });
    expect(changed).toEqual(["STAGE_MODEL_ID", "STAGE_MAX_TOKENS"]);

    const env = readFileSync(envPath, "utf8");
    expect(env).toContain("# stage-ai 网关");
    expect(env).toContain("STAGE_MODEL_ID=medium");
    expect(env).toContain("STAGE_MAX_TOKENS=16384");
    expect(env).toContain("STAGE_API_KEY=sk-secret-value-1234");
  });

  it("写：回传掩码 = 不改；清空 = 显式清除凭据", () => {
    const { file, envPath } = fixture("STAGE_API_KEY=sk-secret-value-1234\n");
    expect(file.write({ model: { apiKey: "sk-s••••1234" } as never })).toEqual([]);
    expect(readFileSync(envPath, "utf8")).toContain("STAGE_API_KEY=sk-secret-value-1234");

    expect(file.write({ model: { apiKey: "sk-brand-new-key-9999" } as never })).toEqual(["STAGE_API_KEY"]);
    expect(readFileSync(envPath, "utf8")).toContain("STAGE_API_KEY=sk-brand-new-key-9999");

    expect(file.write({ model: { apiKey: "" } as never })).toEqual(["STAGE_API_KEY"]);
    expect(readFileSync(envPath, "utf8")).toContain("STAGE_API_KEY=\n");
  });

  it("读：以磁盘 .env 为准（保存后回读看到新值，不是启动时的旧内存配置）", () => {
    const { file } = fixture("STAGE_MODEL_ID=low\n");
    file.write({ model: { modelId: "medium" } as never });
    expect(file.read().model.modelId).toBe("medium");
  });

  it("写：非法数值直接报错，不落半个文件", () => {
    const { file, envPath } = fixture("STAGE_MODEL_ID=low\n");
    expect(() => file.write({ model: { maxTokens: 0 } as never })).toThrow(/正整数/);
    expect(() => file.write({ model: { compactRatio: 1.5 } as never })).toThrow(/0 到 1/);
    expect(readFileSync(envPath, "utf8")).toBe("STAGE_MODEL_ID=low\n");
  });

  it("写：值没变就不算改动，也不重写文件", () => {
    const { file, envPath } = fixture("STAGE_MODEL_ID=low\n");
    expect(file.write({ model: { modelId: "low" } as never })).toEqual([]);
    expect(readFileSync(envPath, "utf8")).toBe("STAGE_MODEL_ID=low\n");
  });

  it("TTS keys：整体覆盖为 JSON 数组，读取容错", () => {
    const { file, keysPath } = fixture("");
    file.writeTtsKeys(["k1", "k2", "k3"]);
    expect(JSON.parse(readFileSync(keysPath, "utf8"))).toEqual(["k1", "k2", "k3"]);
    expect(file.readTtsKeys()).toEqual(["k1", "k2", "k3"]);

    writeFileSync(keysPath, JSON.stringify({ keys: ["a", "b"] }), "utf8");
    expect(file.readTtsKeys()).toEqual(["a", "b"]);
    writeFileSync(keysPath, "not json", "utf8");
    expect(file.readTtsKeys()).toEqual([]);
  });

  it("掩码：短密钥不露头尾，空值为空串", () => {
    expect(mask("abcdefghijklmnop")).toBe("abcd••••mnop");
    expect(mask("short")).toBe("••••");
    expect(mask("")).toBe("");
  });

  it("生图面：格式 / 地址 / 档位读写同构，凭据同样只回掩码", () => {
    const { file, envPath } = fixture("STAGE_IMAGE_FORMAT=gemini\nSTAGE_IMAGE_SIZE=1k\n");
    const view = file.read();
    expect(view.image.format).toBe("gemini");
    expect(view.image.size).toBe("1k");
    expect(view.image.apiKey).toBe("flow••••9876");
    expect(view.image.model).toBe("gemini-3.1-flash-image");
    expect(JSON.stringify(view)).not.toContain("flow-secret-9876");

    // 掩码回传 = 不改；新值才写
    expect(file.write({ image: { apiKey: view.image.apiKey } as never })).toEqual([]);
    expect(file.write({ image: { size: "4k" } as never })).toEqual(["STAGE_IMAGE_SIZE"]);
    expect(file.write({ image: { format: "openai" } as never })).toEqual(["STAGE_IMAGE_FORMAT"]);
    expect(file.write({ image: { apiKey: "brand-new-image-key" } as never })).toEqual(["STAGE_IMAGE_API_KEY"]);
    expect(readFileSync(envPath, "utf8")).toContain("STAGE_IMAGE_API_KEY=brand-new-image-key");
  });
});
