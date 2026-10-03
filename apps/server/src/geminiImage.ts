import { fetch as undiciFetch } from "undici";
import {
  IMAGE_ASPECTS,
  IMAGE_SIZES,
  higherTier,
  imageSizeText,
  parseImageSize,
  type GeneratedImage,
  type ImageBackend,
  type ImageRequest,
  type ImageSize,
} from "./imageBackend.js";

/**
 * Gemini 原生生图（`POST {base}/v1beta/models/{model}:generateContent`）。
 * 官方 Gemini API、flow2api、cpa 都认这个形状：提示词与垫图都塞进 `contents[].parts[]`，
 * 画幅与档位走 `generationConfig.imageConfig`（驼峰；网关报错报文里的路径是
 * `generation_config.image_config.aspect_ratio`，同一处）。
 *
 * 铁律——**垫图只在 Gemini 格式下走得通**（`inlineData`，排在提示词之后，与官方示例的
 * `input: [text, image…]` 同序，Gemini 3 系上限 14 张）。OpenAI 的 `images/generations`
 * 没有参考图入参，见 `openaiImage.ts`。
 *
 * 铁律二——**画幅写错不一定报错**。2026-09-29 对本机 flow2api 实测：上游不认的画幅会静默回
 * 一张横图，所以本层只做白名单自校验，真正的兜底在 `PlayAssets.assertCanvas`：画幅不符就报错，
 * 不落盘。cpa 网关（走真 Gemini）则直接 400 并列出合法取值。
 *
 * 铁律三——**档位只能填 `1K / 2K / 4K`**（官方大小写敏感），像素尺寸由 `aspectRatio` 与档位
 * 共同决定，本接口没有「指定 WxH」这个入参。
 *
 * 模型名不做白名单：这里是通用格式，填哪家的模型名由部署方决定。flow2api 那条路的画幅档位写在
 * **模型别名**里（`gemini-3.1-flash-image-portrait-2k` 这种），`imageConfig` 会被忽略——见 README。
 */

export interface GeminiImageOptions {
  baseUrl: string;
  apiKey: string;
  model: string;
  /** `STAGE_IMAGE_SIZE` 原文：档位或字面像素，构造期解析。 */
  size: string;
  timeoutMs: number;
}

interface GeminiPart {
  text?: string;
  inlineData?: { mimeType?: string; data?: string };
  fileData?: { mimeType?: string; fileUri?: string };
}

interface GeminiCandidate {
  content?: { parts?: GeminiPart[] };
  finishReason?: string;
  finishMessage?: string;
}

export class GeminiImageGen implements ImageBackend {
  private readonly fetchImpl: typeof undiciFetch;
  private readonly tier: string;

  constructor(
    private readonly opts: GeminiImageOptions,
    fetchImpl?: typeof undiciFetch,
  ) {
    this.fetchImpl = fetchImpl ?? undiciFetch;
    const spec = parseImageSize(opts.size);
    if (spec.kind !== "tier") {
      throw new Error(
        `Gemini 格式的档位只认 ${IMAGE_SIZES.join(" / ")}，像素尺寸由 aspectRatio × imageSize 决定，` +
          `填不了 ${imageSizeText(spec)}。要按像素出图请换 STAGE_IMAGE_FORMAT=openai。`,
      );
    }
    this.tier = spec.tier;
  }

  /**
   * 档位 = 本次请求的尺寸（剧目覆盖或部署配置）与本次请求下限里更高的那个
   * （立绘要 2K 抠底，背景/CG 跟配置）。
   */
  private tierOf(req: ImageRequest): string {
    const base = req.size ? geminiTier(req.size) : (this.tier as ImageSize);
    return req.minTier ? higherTier(base, req.minTier) : base;
  }

  async generate(req: ImageRequest): Promise<GeneratedImage> {
    const aspectRatio = req.aspectRatio ?? "16:9";
    if (!IMAGE_ASPECTS.includes(aspectRatio)) {
      throw new Error(`画幅（${aspectRatio}）不受支持。可用：${IMAGE_ASPECTS.join(" / ")}`);
    }
    const res = await this.fetchImpl(
      `${this.opts.baseUrl.replace(/\/+$/, "")}/v1beta/models/${encodeURIComponent(req.model ?? this.opts.model)}:generateContent`,
      {
        method: "POST",
        headers: { "x-goog-api-key": this.opts.apiKey, "content-type": "application/json" },
        body: JSON.stringify({
          contents: [{ role: "user", parts: toParts(req) }],
          generationConfig: {
            responseModalities: ["IMAGE"],
            imageConfig: { aspectRatio, imageSize: this.tierOf(req) },
          },
        }),
        signal: AbortSignal.timeout(this.opts.timeoutMs),
      },
    );
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      throw new Error(`Gemini 出图失败 HTTP ${res.status}：${body.slice(0, 300)}`);
    }
    return parseImage(await res.json().catch(() => null));
  }
}

/** 剧目覆盖的尺寸也必须是档位：Gemini 这一侧没有「指定 WxH」这个入参。 */
function geminiTier(raw: string): ImageSize {
  const spec = parseImageSize(raw);
  if (spec.kind !== "tier") {
    throw new Error(
      `Gemini 格式的档位只认 ${IMAGE_SIZES.join(" / ")}，像素尺寸由 aspectRatio × imageSize 决定，` +
        `填不了 ${imageSizeText(spec)}。要按像素出图请把 STAGE_IMAGE_FORMAT 换成 openai。`,
    );
  }
  return spec.tier;
}

/** 提示词在前、垫图在后——垫图的顺序决定它对提示词的约束强度。 */
function toParts(req: ImageRequest): GeminiPart[] {
  const parts: GeminiPart[] = [{ text: req.prompt }];
  for (const ref of req.references ?? []) {
    parts.push({ inlineData: { mimeType: ref.mimeType, data: ref.data.toString("base64") } });
  }
  return parts;
}

/**
 * 三种返回形态要报三种错：网关的取图步骤失败时只给地址不给字节（配置问题），
 * 被内容策略拒绝时只回一句话（用户得知道为什么），混成「响应无图片」会让人查错方向。
 *
 * 被拒但 `parts` 为空时，原因只在 `finishMessage` / `finishReason` / `promptFeedback.blockReason`
 * 里——不带上就等于什么都不说（cpa 实测：「Unable to show the generated image. The model
 * may not…」）。
 */
function parseImage(body: unknown): GeneratedImage {
  const candidate = (body as { candidates?: GeminiCandidate[] } | null)?.candidates?.[0];
  const parts = candidate?.content?.parts;
  if (!Array.isArray(parts)) throw new Error("出图响应里没有 candidates");

  const inline = parts.find((p) => p?.inlineData?.data);
  if (inline?.inlineData?.data) {
    return {
      data: Buffer.from(inline.inlineData.data, "base64"),
      mimeType: inline.inlineData.mimeType ?? "image/jpeg",
    };
  }

  const file = parts.find((p) => p?.fileData?.fileUri);
  if (file?.fileData) {
    throw new Error(`只回了文件地址（${file.fileData.fileUri}）没有图像字节，网关的取图步骤没跑通`);
  }

  const text = parts.find((p) => typeof p?.text === "string")?.text;
  if (text) throw new Error(`未出图：${text.slice(0, 200)}`);

  const why =
    candidate?.finishMessage ??
    candidate?.finishReason ??
    (body as { promptFeedback?: { blockReason?: string } } | null)?.promptFeedback?.blockReason;
  throw new Error(`出图响应里没有图像内容${why ? `：${String(why).slice(0, 200)}` : ""}`);
}
