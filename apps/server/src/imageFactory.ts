import type { ServerConfig } from "./config.js";
import type { ImageBackend } from "./imageBackend.js";
import { GeminiImageGen } from "./geminiImage.js";
import { OpenAiImageGen } from "./openaiImage.js";

/**
 * 按**接口格式**装配生图后端；`STAGE_IMAGE_ENABLED=false` 返回 null（预发射只记谱系不发起）。
 *
 * 本层不认识产品名：接的是官方 API、flow2api 还是 cpa 由 `STAGE_IMAGE_BASE_URL` 决定，
 * 格式只描述线上跑的是什么协议形状。两款格式的能力差见 README 的「生图接口格式」。
 */
export function createImageBackend(config: ServerConfig): ImageBackend | null {
  if (!config.image.enabled) return null;
  const shared = {
    baseUrl: config.image.baseUrl,
    apiKey: config.image.apiKey,
    model: config.image.model,
    timeoutMs: config.image.timeoutMs,
  };
  return config.image.format === "gemini"
    ? new GeminiImageGen({ ...shared, size: config.image.size })
    : new OpenAiImageGen({ ...shared, size: config.image.size });
}
