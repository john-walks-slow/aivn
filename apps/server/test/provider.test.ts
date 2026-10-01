import { describe, expect, it } from "vitest";
import { resolveCpaModel } from "../src/provider.js";
import type { ServerConfig } from "../src/config.js";

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