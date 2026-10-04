import { fetch as undiciFetch } from "undici";
import {
  IMAGE_ASPECTS,
  imageSizeText,
  parseImageSize,
  type GeneratedImage,
  type ImageAspect,
  type ImageBackend,
  type ImageRequest,
} from "./imageBackend.js";

/**
 * ModelsLab 生图（`POST {base}/images/text2img` 与 `/images/img2img`）。
 *
 * 垫图是这个格式存在的理由：**参考图先换成托管链接，再作为 `init_image` 传进去**
 * （`POST {base}/image_editing/base64_to_url` 收 base64 data URI、回一条临时 URL）。
 * `init_image` 只收链接，所以本地字节必须先上传一步——官方那条 `upload_image` 要自备 S3，
 * 免 S3 的路子就是 base64_to_url。
 *
 * 铁律一——**只吃一张垫图**。社区模型的 `img2img` 的 `init_image` 是单值，不是数组
 * （只有 Flux Klein 那个独立端点收数组，最多 4 张）。给了两张以上直接报错，不静默取第一张：
 * 少垫一张不会报错、只会画错人，那种错查不出来。
 *
 * 铁律二——**出图画幅随垫图走，不由我们定**。官方原文「The dimensions of the generated image
 * will be the same as the dimensions of the init_image」，所以图生图这条路不发 `width`/`height`。
 * 请求的画幅与垫图对不上时，兜底是落盘前的 `PlayAssets.assertCanvas`（与 gemini 格式同一道）。
 *
 * 铁律三——**单边上限 1024**（官方文档 width/height「maximum: 1024」，且要被 8 整除）。
 * 档位（`1K`/`2K`/`4K`）是 Gemini 的词汇，ModelsLab 根本没有这个概念，本层把它翻译成
 * 「长边顶到 1024」——于是**立绘要的 2K 在这个服务上拿不到**，1K 档算出来的长边本来就超上限。
 * 想要更高分辨率只能换 gemini 格式。
 *
 * 铁律四——**关掉提示词增强与 NSFW 检查**。`enhance_prompt` 默认 true 会重写提示词，而我们的
 * 提示词是 tag 结构（`masterpiece, best quality, 1girl, …`），改写会打散它；`safety_checker`
 * 默认 false，但文档各端点口径不一致，显式写死。
 */

export interface ModelsLabImageOptions {
  baseUrl: string;
  apiKey: string;
  /** ModelsLab 的 `model_id`（社区模型或自训模型的 id）。 */
  model: string;
  /** `STAGE_IMAGE_SIZE` 原文：档位或字面像素，构造期解析。 */
  size: string;
  timeoutMs: number;
}

/** 单边上限；官方文档写的是 maximum 1024、且宽高都要能被 8 整除。 */
const MAX_SIDE = 1024;
const MIN_SIDE = 256;
const ALIGN = 8;

interface ModelsLabImageBody {
  key: string;
  model_id: string;
  prompt: string;
  width?: number;
  height?: number;
  init_image?: string;
  samples: number;
  enhance_prompt: boolean;
  safety_checker: boolean;
}

export class ModelsLabImageGen implements ImageBackend {
  private readonly spec: ReturnType<typeof parseImageSize>;
  private readonly fetchImpl: typeof undiciFetch;

  constructor(
    private readonly opts: ModelsLabImageOptions,
    fetchImpl: typeof undiciFetch = undiciFetch,
  ) {
    this.spec = parseImageSize(opts.size);
    this.fetchImpl = fetchImpl;
  }

  async generate(req: ImageRequest): Promise<GeneratedImage> {
    const aspect = req.aspectRatio ?? "16:9";
    if (!IMAGE_ASPECTS.includes(aspect)) {
      throw new Error(`画幅（${aspect}）不受支持。可用：${IMAGE_ASPECTS.join(" / ")}`);
    }
    const refs = req.references ?? [];
    if (refs.length > 1) {
      throw new Error(
        `ModelsLab 的 img2img 只吃一张垫图（init_image 是单值），这次给了 ${refs.length} 张。` +
          "多张垫图请把 STAGE_IMAGE_FORMAT 换成 gemini。",
      );
    }

    const body: ModelsLabImageBody = {
      key: this.opts.apiKey,
      model_id: req.model ?? this.opts.model,
      prompt: req.prompt,
      samples: 1,
      enhance_prompt: false,
      safety_checker: false,
    };

    let path = "/images/text2img";
    if (refs.length === 1) {
      path = "/images/img2img";
      body.init_image = await this.host(refs[0]!);
    } else {
      const canvas = this.canvas(req, aspect);
      body.width = canvas.width;
      body.height = canvas.height;
    }

    const res = await this.post(path, body);
    const parsed = await res.json().catch(() => null);
    if (!res.ok) throw new Error(`ModelsLab 出图失败 HTTP ${res.status}：${messageOf(parsed)}`);
    return this.toImage(parsed);
  }

  /** 本地字节 → 官方托管的临时链接（`init_image` 只收链接）。 */
  private async host(ref: { mimeType: string; data: Buffer }): Promise<string> {
    const body = await this.post("/image_editing/base64_to_url", {
      key: this.opts.apiKey,
      init_image: `data:${ref.mimeType};base64,${ref.data.toString("base64")}`,
    });
    const parsed = (await body.json().catch(() => null)) as
      | { status?: string; output?: string[]; message?: string }
      | null;
    if (!body.ok) throw new Error(`垫图上传失败 HTTP ${body.status}：${messageOf(parsed)}`);
    const url = parsed?.output?.[0];
    if (!url) throw new Error(`垫图上传没有拿到托管链接：${messageOf(parsed)}`);
    return url;
  }

  /**
   * 画布：字面像素照发（用户明确指定的，越界就报错，与 openai 格式一致）；
   * 档位按「长边顶到 1024」落地——ModelsLab 没有档位概念，1K 算出来的长边本来就超上限。
   */
  private canvas(req: ImageRequest, aspect: ImageAspect): { width: number; height: number } {
    const spec = req.size ? parseImageSize(req.size) : this.spec;
    if (spec.kind === "px") {
      if (spec.width > MAX_SIDE || spec.height > MAX_SIDE) {
        throw new Error(
          `生图尺寸 ${imageSizeText(spec)} 超过 ModelsLab 单边上限 ${MAX_SIDE}。` +
            `请在设置页把生图尺寸写成 ${canvasFor(aspect)} 或更小的字面像素，或改用 gemini 格式。`,
        );
      }
      return { width: spec.width, height: spec.height };
    }
    const [width, height] = canvasFor(aspect).split("x").map(Number) as [number, number];
    return { width, height };
  }

  private async post(path: string, body: unknown) {
    return this.fetchImpl(`${this.opts.baseUrl.replace(/\/+$/, "")}${path}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(this.opts.timeoutMs),
    });
  }

  /** `status` 三态：success 带 output、processing 要走 webhook/fetch（没接）、error 带原因。 */
  private async toImage(body: unknown): Promise<GeneratedImage> {
    const parsed = body as
      | { status?: string; output?: string[]; message?: string; nsfw_content_detected?: boolean }
      | null;
    if (parsed?.status === "processing") {
      throw new Error(
        "ModelsLab 把这次请求排进了异步队列（status=processing）。本层只接同步返回，" +
          "没接 fetch 轮询与 webhook——请换用同步端点或改用 gemini 格式。",
      );
    }
    if (parsed?.status === "error") throw new Error(`ModelsLab 出图失败：${messageOf(parsed)}`);

    const url = parsed?.output?.[0];
    if (!url) throw new Error(`ModelsLab 出图响应没有图片地址${messageOf(parsed) ? `：${messageOf(parsed)}` : ""}`);

    const img = await this.fetchImpl(url, { signal: AbortSignal.timeout(this.opts.timeoutMs) });
    if (!img.ok) throw new Error(`生图下载失败 HTTP ${img.status}（${url}）`);
    return {
      data: Buffer.from(await img.arrayBuffer()),
      mimeType: img.headers.get("content-type")?.split(";")[0] ?? "image/jpeg",
    };
  }
}

/** 画幅 → 画布：长边顶到单边上限，短边按比例对齐到 8 的倍数。 */
export function canvasFor(aspect: ImageAspect): string {
  const [w, h] = aspect.split(":").map(Number) as [number, number];
  const short = align((MAX_SIDE * Math.min(w, h)) / Math.max(w, h));
  return w >= h ? `${MAX_SIDE}x${short}` : `${short}x${MAX_SIDE}`;
}

const align = (value: number): number =>
  Math.min(MAX_SIDE, Math.max(MIN_SIDE, Math.round(value / ALIGN) * ALIGN));

function messageOf(body: unknown): string {
  return String((body as { message?: string } | null)?.message ?? "").slice(0, 200);
}