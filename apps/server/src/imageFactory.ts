import { imageConfigFor, type ServerConfig } from "./config.js";
import type { ImageBackend, ImageBackends, ImageKind } from "./imageBackend.js";
import { GeminiImageGen } from "./geminiImage.js";
import { ModelsLabImageGen } from "./modelslabImage.js";
import { ComfyUiImageGen } from "./comfyuiImage.js";
import { NovelAiImageGen } from "./novelaiImage.js";
import { OpenAiImageGen } from "./openaiImage.js";
import { retryingFetch } from "./imageRetry.js";
import { envFetch } from "./webImage.js";

/**
 * 按**接口格式**装配生图后端；`image.enabled=false` 返回 null（预发射只记谱系不发起）。
 *
 * 本层不认识产品名：接的是官方 API、flow2api 还是 cpa 由 `image.baseUrl` 决定，
 * 格式只描述线上跑的是什么协议形状。五款格式的能力差见 README 的「生图接口格式」。
 *
 * **逐类目各一份实例**（背景 / CG / 立绘）：类目可以覆盖接口格式、地址、Key、模型、档位与超时
 * （见 `config.ts` 的 `imageConfigFor`），所以每类自己装一个后端，而不是一个实例被三类共用。
 *
 * 协议实现在 `@aivn/agent`，这里只做服务端自己的接线：统一走 `envFetch`（`HTTPS_PROXY` / `HTTP_PROXY`
 * 对外部地址生效，本机 `127.0.0.1` / `localhost` 始终直连）。
 */
export function createImageBackends(config: ServerConfig): ImageBackends | null {
  if (!config.image.enabled) return null;
  return {
    background: createBackend(config, "background"),
    cg: createBackend(config, "cg"),
    sprite: createBackend(config, "sprite"),
  };
}

function createBackend(config: ServerConfig, kind: ImageKind): ImageBackend {
  const { format, baseUrl, apiKey, model, size, timeoutMs, retryIntervalMs, retryWindowMs } =
    imageConfigFor(config, kind);
  const options = { baseUrl, apiKey, model, size, timeoutMs };
  // 重试包在 fetch 外面（不在这五款协议实现里）：一次出图内部的多个请求各自享有同一条策略。
  const fetchImpl = retryingFetch(envFetch, { intervalMs: retryIntervalMs, windowMs: retryWindowMs });
  if (format === "gemini") return new GeminiImageGen(options, fetchImpl);
  if (format === "modelslab") return new ModelsLabImageGen(options, fetchImpl);
  if (format === "comfyui") return new ComfyUiImageGen(options, fetchImpl);
  if (format === "novelai") return new NovelAiImageGen(options, fetchImpl);
  return new OpenAiImageGen(options, fetchImpl);
}
