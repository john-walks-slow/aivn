import { musicConnectionOf, type ServerConfig } from "./config.js";
import { GeminiMusicGen, type MusicBackend } from "./musicBackend.js";

/**
 * 按设置装配音乐后端；`music.enabled=false` 返回 null（工具不注册）。
 *
 * 与生图共用 `createImageBackend` 的形状（按配置开不开装配），但没有 format 分支——
 * 音频只在 Gemini 那一种协议形状上跑，没有第二种可切。
 */
export function createMusicBackend(config: ServerConfig): MusicBackend | null {
  if (!config.music.enabled) return null;
  const { baseUrl, apiKey } = musicConnectionOf(config);
  return new GeminiMusicGen({
    baseUrl,
    apiKey,
    model: config.music.model,
    timeoutMs: config.music.timeoutMs,
  });
}