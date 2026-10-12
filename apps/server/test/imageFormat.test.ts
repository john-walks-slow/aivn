import { describe, expect, it } from "vitest";
import { ComfyUiImageGen, GeminiImageGen, ModelsLabImageGen, OpenAiImageGen } from "@aivn/agent";
import { applyPatch, freshSettings } from "../src/config.js";
import { IMAGE_FORMATS } from "../src/imageBackend.js";
import { createImageBackends } from "../src/imageFactory.js";
import { NovelAiImageGen } from "../src/novelaiImage.js";

/** 后端实例上的构造参数（`imageFactory` 装配时按格式各给一份）。 */
const optionsOf = (backend: unknown): unknown => (backend as { opts: unknown }).opts;

describe("生图后端的装配（按接口格式）", () => {
  it("comfyui 是可选格式，装配出来的是 ComfyUI 原生后端", () => {
    expect(IMAGE_FORMATS).toContain("comfyui");

    const { next } = applyPatch(freshSettings(), {
      image: { enabled: true, format: "comfyui", baseUrl: "http://127.0.0.1:8188", model: "sd_xl_base_1.0.safetensors" },
    });
    const backends = createImageBackends(next)!;
    expect(backends.background).toBeInstanceOf(ComfyUiImageGen);
    expect(backends.cg).toBeInstanceOf(ComfyUiImageGen);
    // 逐类目覆盖照旧：立绘可以走另一家
    const mixed = applyPatch(next, { image: { kinds: { sprite: { format: "gemini" } } } }).next;
    const mixedBackends = createImageBackends(mixed)!;
    expect(mixedBackends.sprite).toBeInstanceOf(GeminiImageGen);
    expect(mixedBackends.background).toBeInstanceOf(ComfyUiImageGen);
  });

  it("其余四种格式的装配没被带偏", () => {
    const at = (format: "gemini" | "openai" | "modelslab" | "novelai") =>
      createImageBackends(applyPatch(freshSettings(), { image: { enabled: true, format } }).next)!.background;
    expect(at("gemini")).toBeInstanceOf(GeminiImageGen);
    expect(at("openai")).toBeInstanceOf(OpenAiImageGen);
    expect(at("modelslab")).toBeInstanceOf(ModelsLabImageGen);
    expect(at("novelai")).toBeInstanceOf(NovelAiImageGen);
  });

  // 白盒读实例上的构造参数：装配这一段是「配置 → 后端」的唯一接缝，
  // 想从外部行为验它就得真发请求（那是本机网络，不是一个单测该干的事）
  it("地址 / 模型 / 尺寸 / 超时逐项落到实例上，逐类目覆盖与归一化照旧", () => {
    const { next } = applyPatch(freshSettings(), {
      image: {
        enabled: true,
        format: "comfyui",
        baseUrl: "http://127.0.0.1:8188/",
        apiKey: "test-key",
        model: "sd_xl_base_1.0.safetensors",
        size: "2k",
        timeoutMs: 300_000,
        kinds: { sprite: { format: "gemini", model: "gemini-3.0-pro-image", timeoutMs: 600_000 } },
      },
    });

    const backends = createImageBackends(next)!;
    expect(optionsOf(backends.background)).toEqual({
      baseUrl: "http://127.0.0.1:8188", // 尾斜杠在设置层就削掉了，格式实现按需自己拼路径
      apiKey: "test-key",
      model: "sd_xl_base_1.0.safetensors",
      size: "2K", // 档位归一化成官方大写
      timeoutMs: 300_000,
    });
    // 只改覆盖项：其余字段回落基础那份
    expect(optionsOf(backends.sprite)).toEqual({
      baseUrl: "http://127.0.0.1:8188",
      apiKey: "test-key",
      model: "gemini-3.0-pro-image",
      size: "2K",
      timeoutMs: 600_000,
    });
  });
});
