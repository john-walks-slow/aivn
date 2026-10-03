import { fetch as undiciFetch } from "undici";
import {
  IMAGE_ASPECTS,
  imageSizeText,
  parseImageSize,
  tierArea,
  type GeneratedImage,
  type ImageAspect,
  type ImageBackend,
  type ImageRequest,
  type ImageSize,
  type ImageSizeSpec,
} from "./imageBackend.js";

/**
 * OpenAI 格式生图（`POST {base}/v1/images/generations`）：官方 OpenAI、各种兼容网关
 * （cpa、one-api 系）都认这个形状——`{model, prompt, size, n}` 进去，
 * `data[0].b64_json` 或 `data[0].url` 出来（远端 url 由本层下载成字节）。
 *
 * `size` 是**字面 `WxH`，不是档位**，而且合法取值按模型分家（官方 SDK 的参数注释原文）：
 * - `gpt-image-2` 系：任意 `WxH`，宽高都要能被 16 整除、画幅在 1:3–3:1、上限 `3840x2160`；
 * - 其余 GPT image 模型（`gpt-image-1` / `-1-mini` / `-1.5`）：只认 `1024x1024` / `1536x1024` /
 *   `1024x1536` 三个标准尺寸与 `auto`；
 * - `dall-e-3`：`1024x1024` / `1792x1024` / `1024x1792`；`dall-e-2`：`256x256` / `512x512` / `1024x1024`。
 * 所以档位（1K/2K/4K）是我们替「支持任意尺寸」的模型算出来的约定；老模型上要真跑通，直接把
 * `STAGE_IMAGE_SIZE` 写成它认的字面尺寸（如 `1536x1024`）。
 *
 * **不吃垫图**：这个接口没有参考图入参，`ImageRequest.references` 一概拒绝而不是静默丢弃——
 * 丢了就是「差分不像本人」这种看不出来的错。OpenAI 那边图生图走的是 multipart 的
 * `/v1/images/edits`（`image[]` 最多 16 张，仅 GPT image 模型），本层没接。要垫图请把
 * `STAGE_IMAGE_FORMAT` 换成 gemini。
 */

/** undici 的 Response 与全局同名类型不兼容（FormData/File 分叉）：直接用取回的返回类型。 */
type UpstreamResponse = Awaited<ReturnType<typeof undiciFetch>>;

export interface OpenAiImageOptions {
  baseUrl: string;
  apiKey: string;
  model: string;
  /** `STAGE_IMAGE_SIZE` 原文：档位或字面像素，构造期解析。 */
  size: string;
  timeoutMs: number;
}

/** gpt-image-2 系的官方上限（长边 / 短边）——档位算出来的尺寸不能越过它。 */
const MAX_LONG_EDGE = 3840;
const MAX_SHORT_EDGE = 2160;

export class OpenAiImageGen implements ImageBackend {
  private readonly spec: ImageSizeSpec;

  /** fetch 注入点：默认 undici，测试可替身。 */
  constructor(
    private readonly opts: OpenAiImageOptions,
    private readonly fetchImpl: typeof undiciFetch = undiciFetch,
  ) {
    this.spec = parseImageSize(opts.size);
  }

  async generate(req: ImageRequest): Promise<GeneratedImage> {
    if (req.references?.length) {
      throw new Error(
        "OpenAI 格式的 /v1/images/generations 没有参考图入参（图生图走 multipart 的 /v1/images/edits，本站没接），" +
          "垫图发不出去。要垫图请把 STAGE_IMAGE_FORMAT 换成 gemini。",
      );
    }
    const aspectRatio = req.aspectRatio ?? "16:9";
    if (!IMAGE_ASPECTS.includes(aspectRatio)) {
      throw new Error(`画幅（${aspectRatio}）不受支持。可用：${IMAGE_ASPECTS.join(" / ")}`);
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
        size: sizeFor(aspectRatio, this.spec),
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

/** 字面尺寸原样发出（部署方自己清楚目标模型认什么）；档位则由本层换算并守住官方上限。 */
function sizeFor(aspect: ImageAspect, spec: ImageSizeSpec): string {
  if (spec.kind === "px") return imageSizeText(spec);
  const size = canvasFor(aspect, spec.tier);
  const [width, height] = size.split("x").map(Number) as [number, number];
  const long = Math.max(width, height);
  const short = Math.min(width, height);
  if (long > MAX_LONG_EDGE || short > MAX_SHORT_EDGE) {
    throw new Error(
      `档位 ${spec.tier} 在 ${aspect} 下算出 ${size}，超过 OpenAI 官方上限 ${MAX_LONG_EDGE}x${MAX_SHORT_EDGE}。` +
        `请把设置页里的生图尺寸写成目标模型认的字面尺寸（如 1536x1024），或改用 gemini 格式。`,
    );
  }
  return size;
}

/**
 * 画幅 + 档位 → OpenAI 的 `size` 字段（`WxH`）。
 *
 * 档位按**总像素量级**落地（与 Gemini 的 `imageSize` 同义），画幅决定这块面积怎么摆：
 * 短边 = √(面积 ÷ 长短边比)，长边按比例算，**两边各自对齐到 16 的倍数**（官方硬性要求）。
 * 16:9 的 1K 因此是 1360x768（官方 Gemini 表是 1376x768，同一量级）；对齐误差在 0.5% 内，
 * 远小于 `assertCanvas` 的 12% 容差。
 */
export function canvasFor(aspect: ImageAspect, tier: ImageSize): string {
  const [w, h] = aspect.split(":").map(Number) as [number, number];
  const ratio = Math.max(w, h) / Math.min(w, h);
  const short = round16(Math.sqrt(tierArea(tier) / ratio));
  const long = round16(short * ratio);
  return w >= h ? `${long}x${short}` : `${short}x${long}`;
}

const round16 = (value: number): number => Math.round(value / 16) * 16;

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
