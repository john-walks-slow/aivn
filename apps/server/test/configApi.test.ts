import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { ServerConfig } from "../src/config.js";
import { SettingsFile, mask } from "../src/configApi.js";

function fixture(env: string): { file: SettingsFile; envPath: string } {
  const dir = mkdtempSync(join(tmpdir(), "stage-config-"));
  const envPath = join(dir, ".env");
  writeFileSync(envPath, env, "utf8");
  const config = {
    port: 8787,
    playsRoot: dir,
    modelId: "low",
    modelBase: "deepseek-chat",
    models: [],
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
    tts: { enabled: true, keys: ["fish-key-one", "fish-key-two"], proxy: "", baseUrl: "https://api.fish.audio", concurrency: 3 },
    exa: { enabled: true, keys: ["exa-key-one"], baseUrl: "https://api.exa.ai", proxy: "", timeoutMs: 20000 },
  } as unknown as ServerConfig;
  return { file: new SettingsFile(envPath, config), envPath };
}

describe("设置面板后端", () => {
  it("读：凭据只回掩码，附存在位", () => {
    const { file } = fixture("STAGE_MODEL_ID=low\nSTAGE_TTS_KEYS=fish-key-one, fish-key-two\n");
    const view = file.read();
    expect(view.model.apiKey).toBe("sk-s••••1234");
    expect(view.model.apiKeySet).toBe(true);
    expect(view.model.modelId).toBe("low");
    expect(view.tts.keyCount).toBe(2);
    expect(view.tts.masked).toEqual(["fish••••-one", "fish••••-two"]);
    // 明文永不出服务端：面板输入框恒空，留空即「保持不变」
    expect(view.tts.keys).toBe("");
    expect(JSON.stringify(view)).not.toContain("sk-secret-value-1234");
    expect(JSON.stringify(view)).not.toContain("fish-key-one");
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

  it("支持的模型清单：面板输入什么就原样存什么（文本形态往返，解析在启动时做）", () => {
    const listed = fixture("STAGE_MODEL_ID=low\nSTAGE_MODELS=low, high\n");
    expect(listed.file.read().model.models).toBe("low, high");

    const { file, envPath } = fixture("STAGE_MODEL_ID=low\n");
    expect(file.read().model.models).toBe("");
    expect(file.write({ model: { models: "low, high" } as never })).toEqual(["STAGE_MODELS"]);
    expect(readFileSync(envPath, "utf8")).toContain("STAGE_MODELS=low, high");
    expect(file.read().model.models).toBe("low, high");
    // 清空 = 回到「不限制」，也是一个真改动
    expect(file.write({ model: { models: "" } as never })).toEqual(["STAGE_MODELS"]);
    expect(readFileSync(envPath, "utf8")).toContain("STAGE_MODELS=\n");
  });

  it("多把 key：走同一个保存入口，留空=不改，填入=整组替换", () => {
    const { file, envPath } = fixture("STAGE_TTS_KEYS=old-1, old-2\n");

    // 面板回传的空串（输入框没动）不该擦掉已存的 key
    expect(file.write({ tts: { keys: "" } as never })).toEqual([]);
    expect(file.write({ tts: { keys: "   " } as never })).toEqual([]);
    expect(readFileSync(envPath, "utf8")).toContain("STAGE_TTS_KEYS=old-1, old-2");

    // 填入即整组替换，归一化成逗号分隔存回 .env
    expect(file.write({ tts: { keys: "new-1, new-2 , new-3" } as never })).toEqual(["STAGE_TTS_KEYS"]);
    expect(readFileSync(envPath, "utf8")).toContain("STAGE_TTS_KEYS=new-1,new-2,new-3");
    expect(file.read().tts.keyCount).toBe(3);
  });

  it("联网检索面与语音面同构：开关/端点/超时/密钥都可改", () => {
    const { file, envPath } = fixture("STAGE_EXA_KEYS=exa-key-one\n");
    expect(file.read().exa.keyCount).toBe(1);
    expect(file.read().exa.masked).toEqual(["exa-••••-one"]);

    expect(file.write({ exa: { enabled: false, timeoutMs: 30000, keys: "e1,e2" } as never })).toEqual([
      "STAGE_EXA_ENABLED",
      "STAGE_EXA_TIMEOUT_MS",
      "STAGE_EXA_KEYS",
    ]);
    const env = readFileSync(envPath, "utf8");
    expect(env).toContain("STAGE_EXA_ENABLED=false");
    expect(env).toContain("STAGE_EXA_TIMEOUT_MS=30000");
    expect(env).toContain("STAGE_EXA_KEYS=e1,e2");
  });

  it("掩码：短密钥不露头尾，空值为空串", () => {
    expect(mask("abcdefghijklmnop")).toBe("abcd••••mnop");
    expect(mask("short")).toBe("••••");
    expect(mask("")).toBe("");
  });

  it("生图面：格式 / 地址 / 档位读写同构，凭据同样只回掩码；档位写回时归一化成官方大写", () => {
    const { file, envPath } = fixture("STAGE_IMAGE_FORMAT=gemini\nSTAGE_IMAGE_SIZE=1k\n");
    const view = file.read();
    expect(view.image.format).toBe("gemini");
    // 读是照抄 .env 原文（面板照实显示）；归一化发生在服务端装配与写回两处
    expect(view.image.size).toBe("1k");
    expect(view.image.apiKey).toBe("flow••••9876");
    expect(view.image.model).toBe("gemini-3.1-flash-image");
    expect(JSON.stringify(view)).not.toContain("flow-secret-9876");

    // 掩码回传 = 不改；新值才写
    expect(file.write({ image: { apiKey: view.image.apiKey } as never })).toEqual([]);
    expect(file.write({ image: { size: "4k" } as never })).toEqual(["STAGE_IMAGE_SIZE"]);
    expect(readFileSync(envPath, "utf8")).toContain("STAGE_IMAGE_SIZE=4K");
    expect(file.write({ image: { size: "1536x1024" } as never })).toEqual(["STAGE_IMAGE_SIZE"]);
    expect(readFileSync(envPath, "utf8")).toContain("STAGE_IMAGE_SIZE=1536x1024");
    expect(() => file.write({ image: { size: "huge" } as never })).toThrow(/STAGE_IMAGE_SIZE/);
    expect(file.write({ image: { format: "openai" } as never })).toEqual(["STAGE_IMAGE_FORMAT"]);
    expect(file.write({ image: { apiKey: "brand-new-image-key" } as never })).toEqual(["STAGE_IMAGE_API_KEY"]);
    expect(readFileSync(envPath, "utf8")).toContain("STAGE_IMAGE_API_KEY=brand-new-image-key");
  });
});
