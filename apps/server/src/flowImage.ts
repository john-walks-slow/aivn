import { fetch as undiciFetch } from "undici";
import {
  IMAGE_ASPECTS,
  IMAGE_SIZES,
  type GeneratedImage,
  type ImageAspect,
  type ImageBackend,
  type ImageRequest,
  type ImageSize,
} from "./imageBackend.js";

/**
 * flow2api 出图客户端：Google Flow 逆向网关的 Gemini 原生端点。
 *
 * 铁律——**必须传别名模型名**（`gemini-3.1-flash-image` 这类）：flow2api 靠模型名里的
 * 画幅后缀做路由，收到完整模型名时 `generationConfig` 被**完全忽略**（`model_resolver.py`）。
 *
 * 铁律二——**画幅只有 16:9 / 9:16 可靠**。2026-09-29 对本机网关实测（imageSize=2k）：
 * `16:9`→1376x768 ✅、`9:16`→768x1376 ✅、`3:4`→1200x896 ❌、`4:3`→1200x896 ❌
 * （gemini-3.1-flash-image 与 gemini-3.0-pro-image 表现一致）。解析器把 `3:4` 正确翻成
 * `three-four` 内部模型名，上游却不认，于是静默回一张横图——**不报错**。所以本层只做
 * 白名单自校验，真正的兜底在 `WorkshopAssets.assertCanvas`：画幅不符就报错，不落盘。
 */

/** 已确认支持出图的别名（`GET /v1/models/aliases`；注意别名不在 `GET /v1beta/models` 里）。 */
const IMAGE_ALIASES = new Set([
  "gemini-3.1-flash-image",
  "gemini-3.0-pro-image",
  "imagen-4.0-generate-preview",
]);

export interface FlowImageOptions {
  baseUrl: string;
  apiKey: string;
  /** 别名模型名，构造期校验。 */
  model: string;
  size: ImageSize;
  timeoutMs: number;
}

interface GeminiPart {
  text?: string;
  inlineData?: { mimeType?: string; data?: string };
  fileData?: { mimeType?: string; fileUri?: string };
}

export class Flow2ApiImageGen implements ImageBackend {
  private readonly fetchImpl: typeof undiciFetch;

  constructor(
    private readonly opts: FlowImageOptions,
    fetchImpl?: typeof undiciFetch,
  ) {
    this.fetchImpl = fetchImpl ?? undiciFetch;
    if (!IMAGE_ALIASES.has(opts.model)) {
      throw new Error(
        `STAGE_FLOW_MODEL（${opts.model}）不是受支持的别名模型名。可用：${[...IMAGE_ALIASES].join(" / ")}` +
          "。传完整模型名会让 flow2api 忽略 imageConfig，画幅被模型名钉死。",
      );
    }
    if (!IMAGE_SIZES.includes(opts.size)) {
      throw new Error(
        `STAGE_FLOW_SIZE（${opts.size}）非法。可用：${IMAGE_SIZES.join(" / ")}`,
      );
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
      throw new Error(`flow2api 出图失败 HTTP ${res.status}：${body.slice(0, 300)}`);
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
  if (!Array.isArray(parts)) throw new Error("flow2api 响应里没有 candidates");

  const inline = parts.find((p) => p?.inlineData?.data);
  if (inline?.inlineData?.data) {
    return {
      data: Buffer.from(inline.inlineData.data, "base64"),
      mimeType: inline.inlineData.mimeType ?? "image/jpeg",
    };
  }

  const file = parts.find((p) => p?.fileData?.fileUri);
  if (file?.fileData) {
    throw new Error(
      `flow2api 只回了文件地址（${file.fileData.fileUri}）没有图像字节，网关的取图步骤没跑通`,
    );
  }

  const text = parts.find((p) => typeof p?.text === "string")?.text;
  if (text) throw new Error(`flow2api 未出图：${text.slice(0, 200)}`);

  throw new Error("flow2api 响应里没有图像内容");
}
