import { fetch as undiciFetch } from "undici";
import type { FetchLike } from "@aivn/agent";
import type { ServerConfig } from "./config.js";
import type { ImageBackend } from "./imageBackend.js";
import { GeminiImageGen } from "./geminiImage.js";
import { ModelsLabImageGen } from "./modelslabImage.js";
import { OpenAiImageGen } from "./openaiImage.js";

/**
 * 按**接口格式**装配生图后端；`STAGE_IMAGE_ENABLED=false` 返回 null（预发射只记谱系不发起）。
 *
 * 本层不认识产品名：接的是官方 API、flow2api 还是 cpa 由 `STAGE_IMAGE_BASE_URL` 决定，
 * 格式只描述线上跑的是什么协议形状。三款格式的能力差见 README 的「生图接口格式」。
 *
 * 协议实现在 `@aivn/agent`，这里只做服务端自己的接线：fetch 用 undici（与抽包前一致）。
 * 包缺省走全局 fetch，代理由需要它的宿主自己烘进来——服务端这边生图地址是本机网关，不配代理。
 */
const fetchImpl: FetchLike = (url, init) => undiciFetch(url, init);

export function createImageBackend(config: ServerConfig): ImageBackend | null {
  if (!config.image.enabled) return null;
  const shared = {
    baseUrl: config.image.baseUrl,
    apiKey: config.image.apiKey,
    model: config.image.model,
    timeoutMs: config.image.timeoutMs,
  };
  if (config.image.format === "gemini") return new GeminiImageGen({ ...shared, size: config.image.size }, fetchImpl);
  if (config.image.format === "modelslab") return new ModelsLabImageGen({ ...shared, size: config.image.size }, fetchImpl);
  return new OpenAiImageGen({ ...shared, size: config.image.size }, fetchImpl);
}
