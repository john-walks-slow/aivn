import { fetch as undiciFetch } from "undici";
import {
  IMAGE_ASPECTS,
  IMAGE_SIZES,
  type GeneratedImage,
  type ImageBackend,
  type ImageRequest,
  type ImageSize,
} from "./imageBackend.js";

/**
 * Gemini 原生生图（`POST {base}/v1beta/models/{model}:generateContent`）。
 * 官方 Gemini API、flow2api、cpa 都认这个形状：提示词与垫图都塞进 `contents[].parts[]`，
 * 画幅与档位走 `generationConfig.imageConfig`。
 *
 * 铁律——**垫图只在 Gemini 格式下走得通**（`inlineData`）。OpenAI 的 `images/generations`
 * 没有参考图入参，见 `openaiImage.ts`。
 *
 * 铁律二——**画幅写错不一定报错**。2026-09-29 对本机 flow2api 实测（imageSize=2k）：
 * `16:9`→1376x768 ✅、`9:16`→768x1376 ✅、`3:4`→1200x896 ❌、`4:3`→1200x896 ❌
 * （gemini-3.1-flash-image 与 gemini-3.0-pro-image 表现一致）。上游不认的画幅会静默回一张
 * 横图，所以本层只做白名单自校验，真正的兜底在 `PlayAssets.assertCanvas`：画幅不符就报错，不落盘。
 *
 * 模型名不做白名单：这里是通用格式，填哪家的模型名由部署方决定（flow2api 那条路要填别名而不是
 * 完整模型名，否则 imageConfig 被忽略——见 README）。
 */

export interface GeminiImageOptions {
  baseUrl: string;
  apiKey: string;
  model: string;
  size: ImageSize;
  timeoutMs: number;
}

interface GeminiPart {
  text?: string;
  inlineData?: { mimeType?: string; data?: string };
  fileData?: { mimeType?: string; fileUri?: string };
}

export class GeminiImageGen implements ImageBackend {
  private readonly fetchImpl: typeof undiciFetch;

  constructor(
    private readonly opts: GeminiImageOptions,
    fetchImpl?: typeof undiciFetch,
  ) {
    this.fetchImpl = fetchImpl ?? undiciFetch;
    if (!IMAGE_SIZES.includes(opts.size)) {
      throw new Error(`STAGE_IMAGE_SIZE（${opts.size}）非法。可用：${IMAGE_SIZES.join(" / ")}`);
    }
  }

  async generate(req: ImageRequest): Promise<GeneratedImage> {
    const aspectRatio = req.aspectRatio ?? "16:9";
    if (!IMAGE_ASPECTS.includes(aspectRatio)) {
      throw new Error(`画幅（${aspectRatio}）不受支持。可用：${IMAGE_ASPECTS.join(" / ")}`);
    }
    const res = await this.fetchImpl(
      `${this.opts.baseUrl.replace(/\/+$/, "")}/v1beta/models/${encodeURIComponent(this.opts.model)}:generateContent`,
      {
        method: "POST",
        headers: { "x-goog-api-key": this.opts.apiKey, "content-type": "application/json" },
        body: JSON.stringify({
          contents: [{ role: "user", parts: toParts(req) }],
          generationConfig: {
            responseModalities: ["IMAGE"],
            imageConfig: { aspectRatio, imageSize: this.opts.size },
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
 */
function parseImage(body: unknown): GeneratedImage {
  const parts = (body as { candidates?: { content?: { parts?: GeminiPart[] } }[] } | null)
    ?.candidates?.[0]?.content?.parts;
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

  throw new Error("出图响应里没有图像内容");
}
