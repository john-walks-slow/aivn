import { describe, expect, it } from "vitest";
import { resolveCpaModel, supportedModels, type GatewayModel } from "../src/provider.js";
import type { ServerConfig } from "../src/config.js";

const GATEWAY: GatewayModel[] = [
  { id: "high", name: "high" },
  { id: "low", name: "low" },
  { id: "vision", name: "vision" },
];

describe("支持清单收窄网关模型清单", () => {
  it("不配清单：网关全量原样放行（老行为不变）", () => {
    expect(supportedModels(GATEWAY, [])).toBe(GATEWAY);
  });

  it("配了清单：只留点名的，且按配置里的顺序排（不是字母序）", () => {
    expect(supportedModels(GATEWAY, ["vision", "low"]).map((m) => m.id)).toEqual(["vision", "low"]);
  });

  it("清单里的 id 网关没有：点名报错，不静默丢（下拉里摆一个发不出去的模型更坑）", () => {
    expect(() => supportedModels(GATEWAY, ["low", "gpt-9"])).toThrow(/gpt-9/);
  });
});

const config = {
  modelId: "default-model",
  modelBase: "deepseek/deepseek-flash",
  baseUrl: "http://127.0.0.1:9999/v1",
  maxTokens: 8192,
} as unknown as ServerConfig;

describe("cpa 模型解析", () => {
  it("api 恒为 OpenAI 兼容面：内置目录里的 gemini-* 带的是 google-generative-ai", () => {
    // 模型下拉里的选项都来自网关清单，不限于 OpenAI 内置模型。跟着内置目录继承 api 的后果是
    // 在页面上能选中、点保存后每轮都报「Provider cpa has no API implementation」。
    for (const id of ["gemini-3-flash", "claude-sonnet-4-6", "some/model-not-in-catalog"]) {
      expect(resolveCpaModel(config, id).api).toBe("openai-completions");
    }
  });

  it("继承的是上下文与思考档位这类与协议无关的元数据", () => {
    const gemini = resolveCpaModel(config, "gemini-3-flash");
    expect(gemini.id).toBe("gemini-3-flash");
    expect(gemini.provider).toBe("cpa");
    expect(gemini.baseUrl).toBe(config.baseUrl);
    expect(gemini.maxTokens).toBe(config.maxTokens);
    expect(gemini.contextWindow).toBeGreaterThan(0);
  });

  it("不选模型时就是默认模型", () => {
    expect(resolveCpaModel(config, undefined).id).toBe(config.modelId);
    expect(resolveCpaModel(config, config.modelId).id).toBe(config.modelId);
  });
});