import { defaultFetch, type FetchLike } from "../http.js";

/**
 * 音乐生成后端（Gemini 原生形状）——两个宿主共用一份。
 *
 * **只有一种协议形状**：音频模型只在 `/v1beta/models/{model}:generateContent` 这条路上，
 * 出声的方式与出图完全一致（`contents[].parts[]` 送提示词，`inlineData` 接产物）。
 * 本机 flow2api 同时挂着图片与 `flow-music-*` 音频模型，走的是同一个网关同一个端点，
 * 所以这里不设 format 枚举——没有第二种形状可切。
 *
 * 铁律（全部为 2026-10-04 对本机 flow2api 的实测）：
 * - 返回的是 `audio/mp4`（M4A 容器，AAC 48kHz 立体声），**不是 mp3**。
 *   落盘扩展名跟着响应的 mime 走，写死 `.mp3` 会让浏览器按错误的 codec 播。
 * - 一首 ~175s 的曲子要跑 ~84s，比出图慢一档；超时由调用方按配置给足。
 * - 产物是 base64，一次 ~2.9MB：响应体别设上限截断，也别走流式拼接（那是视频的形状）。
 * - **上游固定给 ~176s，没有任何时长入参**，所以「要循环」只能靠提示词表达。
 */

export interface MusicRequest {
  prompt: string;
  /** 本次生成用哪个模型（覆盖后端配置里的）。 */
  model?: string;
}

export interface GeneratedMusic {
  /** 音频字节。 */
  bytes: Buffer;
  /** 容器格式 → 落盘扩展名（`.m4a` / `.mp3` / `.ogg` / `.wav`，按响应 mime 定）。 */
  ext: string;
  mimeType: string;
}

export interface MusicBackend {
  generate(req: MusicRequest): Promise<GeneratedMusic>;
}

export interface GeminiMusicOptions {
  baseUrl: string;
  /** 不给就不带鉴权头（本机网关常常不校验）。 */
  apiKey?: string;
  model: string;
  timeoutMs: number;
}

interface GeminiPart {
  text?: string;
  inlineData?: { mimeType?: string; data?: string };
}

interface GeminiResponse {
  candidates?: { content?: { parts?: GeminiPart[] }; finishReason?: string; finishMessage?: string }[];
}

/** 容器 → 落盘扩展名。认不出来的一律 `.m4a`：`audio/mp4` 是实测的常态，且它一定落盘成可播的文件。 */
export const MUSIC_EXT_BY_MIME: Record<string, string> = {
  "audio/mp4": ".m4a",
  "audio/m4a": ".m4a",
  "audio/mpeg": ".mp3",
  "audio/mp3": ".mp3",
  "audio/ogg": ".ogg",
  "audio/wav": ".wav",
  "audio/x-wav": ".wav",
  "audio/wave": ".wav",
};

export class GeminiMusicGen implements MusicBackend {
  private readonly fetchImpl: FetchLike;

  constructor(
    private readonly opts: GeminiMusicOptions,
    fetchImpl: FetchLike = defaultFetch,
  ) {
    this.fetchImpl = fetchImpl;
  }

  async generate(req: MusicRequest): Promise<GeneratedMusic> {
    const model = req.model?.trim() || this.opts.model;
    const headers: Record<string, string> = { "content-type": "application/json" };
    if (this.opts.apiKey) headers["x-goog-api-key"] = this.opts.apiKey;
    const res = await this.fetchImpl(
      `${this.opts.baseUrl.replace(/\/+$/, "")}/v1beta/models/${encodeURIComponent(model)}:generateContent`,
      {
        method: "POST",
        headers,
        body: JSON.stringify({ contents: [{ role: "user", parts: [{ text: req.prompt }] }] }),
        signal: AbortSignal.timeout(this.opts.timeoutMs),
      },
    );
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      throw new Error(`音乐生成失败 HTTP ${res.status}：${body.slice(0, 300)}`);
    }
    return parseMusic((await res.json().catch(() => null)) as GeminiResponse | null, model);
  }
}

/**
 * 从响应里取出那段音频。
 *
 * 没有产物时报上游给的原因，不报「解析失败」——同一个错还有 `finishReason` 与 `finishMessage`
 * 两处原文，安全拦截（`finishReason: "SAFETY"`）往往**只有前者**，丢掉它等于把唯一线索扔了。
 */
export function parseMusic(payload: unknown, model: string): GeneratedMusic {
  const typed = payload as GeminiResponse | null;
  const parts = typed?.candidates?.[0]?.content?.parts ?? [];
  for (const part of parts) {
    const inline = part.inlineData;
    if (!inline?.data) continue;
    const mimeType = inline.mimeType || "audio/mp4";
    return {
      bytes: Buffer.from(inline.data, "base64"),
      mimeType,
      ext: MUSIC_EXT_BY_MIME[mimeType] ?? ".m4a",
    };
  }
  const reason = typed?.candidates?.[0];
  const detail = [reason?.finishReason, reason?.finishMessage?.trim()].filter(Boolean).join("：");
  throw new Error(
    `音乐生成没有返回音频（模型 ${model}${detail ? `：${detail}` : ""}）。` +
      "音频模型要挂对（flow2api：flow-music-lyria-3.5 / flow-music-lyria-3-pro / musicfx）。",
  );
}
