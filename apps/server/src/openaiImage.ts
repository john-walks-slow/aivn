import { fetch as undiciFetch } from "undici";
import {
  IMAGE_SIZES,
  type GeneratedImage,
  type ImageAspect,
  type ImageBackend,
  type ImageRequest,
  type ImageSize,
} from "./imageBackend.js";

/**
 * OpenAI 格式生图（`POST {base}/v1/images/generations`）：官方 OpenAI、各种兼容网关
 * （cpa、one-api 系）都认这个形状——`{model, prompt, size, n}` 进去，
 * `data[0].b64_json` 或 `data[0].url` 出来（远端 url 由本层下载成字节）。
 *
 * **不吃垫图**：这个接口没有参考图入参，`ImageRequest.references` 一概拒绝而不是静默丢弃——
 * 丢了就是「差分不像本人」这种看不出来的错。要垫图请把 `STAGE_IMAGE_FORMAT` 换成 gemini。
 */

/** undici 的 Response 与全局同名类型不兼容（FormData/File 分叉）：直接用取回的返回类型。 */
type UpstreamResponse = Awaited<ReturnType<typeof undiciFetch>>;

export interface OpenAiImageOptions {
  baseUrl: string;
  apiKey: string;
  model: string;
  size: ImageSize;
  timeoutMs: number;
}

export class OpenAiImageGen implements ImageBackend {
  /** fetch 注入点：默认 undici，测试可替身。 */
  constructor(
    private readonly opts: OpenAiImageOptions,
    private readonly fetchImpl: typeof undiciFetch = undiciFetch,
  ) {
    if (!IMAGE_SIZES.includes(opts.size)) {
      throw new Error(`STAGE_IMAGE_SIZE（${opts.size}）非法。可用：${IMAGE_SIZES.join(" / ")}`);
    }
  }

  async generate(req: ImageRequest): Promise<GeneratedImage> {
    if (req.references?.length) {
      throw new Error(
        "OpenAI 格式的 /v1/images/generations 没有参考图入参，垫图发不出去。" +
          "要垫图请把 STAGE_IMAGE_FORMAT 换成 gemini。",
      );
    }
    const res = await this.fetchImpl(`${this.opts.baseUrl.replace(/\/+$/, "")}/v1/images/generations`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${this.opts.apiKey}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model: this.opts.model,
        prompt: req.prompt,
        size: canvasFor(req.aspectRatio ?? "16:9", this.opts.size),
        n: 1,
      }),
      signal: AbortSignal.timeout(this.opts.timeoutMs),
    });
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      throw new Error(`OpenAI 格式出图失败 HTTP ${res.status}：${body.slice(0, 300)}`);
    }
    return parseImage(await res.json().catch(() => null), this.fetchImpl, this.opts.timeoutMs);
  }
}

/** 档位 = 短边像素。 */
const SHORT_EDGE: Record<ImageSize, number> = { "1k": 1024, "2k": 2048, "4k": 4096 };

/**
 * 画幅 + 档位 → OpenAI 的 `size` 字段（`WxH`）。
 * 短边取档位像素，长边按比例算并对齐到 16 的倍数——`assertCanvas` 用 12% 容差校验画幅，
 * 对齐误差在 0.5% 以内。
 */
export function canvasFor(aspect: ImageAspect, size: ImageSize): string {
  const [w, h] = aspect.split(":").map(Number) as [number, number];
  const short = SHORT_EDGE[size];
  const long = Math.round(((short * Math.max(w, h)) / Math.min(w, h)) / 16) * 16;
  return w >= h ? `${long}x${short}` : `${short}x${long}`;
}

async function parseImage(
  body: unknown,
  fetchImpl: typeof undiciFetch,
  timeoutMs: number,
): Promise<GeneratedImage> {
  const first = (body as { data?: { b64_json?: string; url?: string }[] } | null)?.data?.[0];
  if (first?.b64_json) {
    return { data: Buffer.from(first.b64_json, "base64"), mimeType: mimeTypeOf(first.b64_json) };
  }
  if (first?.url) {
    const img = await fetchImpl(first.url, { signal: AbortSignal.timeout(timeoutMs) });
    if (!img.ok) throw new Error(`生图下载失败 HTTP ${img.status}`);
    return {
      data: Buffer.from(await img.arrayBuffer()),
      mimeType: img.headers.get("content-type")?.split(";")[0] ?? "image/jpeg",
    };
  }
  const message = (body as { error?: { message?: string } } | null)?.error?.message;
  throw new Error(`生图响应无图片数据${message ? `：${message.slice(0, 200)}` : ""}`);
}

/** base64 头部字节认 PNG/WebP，其余按 JPEG。 */
function mimeTypeOf(b64: string): string {
  if (b64.startsWith("iVBORw0KGgo")) return "image/png";
  if (b64.startsWith("UklGR")) return "image/webp";
  return "image/jpeg";
}
