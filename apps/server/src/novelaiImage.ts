import { unzipSync } from "fflate";
import sharp from "sharp";
import type { FetchLike } from "@aivn/agent";
import {
  aspectMatches,
  IMAGE_ASPECTS,
  parseImageSize,
  sizeOfImage,
  sniffImageMime,
  tierArea,
  type GeneratedImage,
  type ImageAspect,
  type ImageBackend,
  type ImageRequest,
  type ImageSizeSpec,
} from "./imageBackend.js";
import { envFetch } from "./webImage.js";

/**
 * NovelAI 生图（`POST {base}/ai/generate-image`，`Authorization: Bearer <持久化 API token>`）。
 * 官方主机是 `image.novelai.net`——`api.novelai.net` 对生图回 `model must be a valid enum value`。
 *
 * 铁律一——**响应是一个 ZIP**（`binary/octet-stream`，内含 `image_0.png`），不是图片字节。
 * 解包用已在依赖里的 `fflate`；解不出就报错，不猜字节。
 *
 * 铁律二——**提示词结构按模型代分两套**。V4 / V4.5 / V5 走 `v4_prompt` + `v4_negative_prompt`，
 * 而且**两个必须同时在场**：只给一个不是 400 校验错，是 **500 Internal Server Error**（V5 实测同样
 * 如此，没有 `v5_prompt` 这个结构）。V3 及更早（`nai-diffusion-3` / `nai-diffusion-furry-3`）
 * 走 `prompt` + `uc`。分代只认模型名前缀，不猜能力表。
 *
 * 铁律三——**垫图按「同画幅重绘 vs 跨画幅/多图角色参考」自动分流**：
 * - **同画幅单张垫图**（例如 9:16 立绘定妆照 → 9:16 表情差分）：走 `img2img`（`fitToCanvas`），全代通用且
 *   在 1K 档内属于 Opus 免费档（0 Anlas）。
 * - **跨画幅单张垫图或多张参考图**（例如拿 9:16 立绘垫 16:9 CG、多人 CG、拿异画幅参考图做全身定妆）：
 *   `img2img` 会把 9:16 竖图居中补黑塞进 16:9 画布，导致成图两侧残留大块黑边。V4.5（`nai-diffusion-4-5*`）
 *   改走官方 `director_reference_images`（白底 `1024×1536` 归一化，`action: "generate"`），支持 1~多张参考图
 *   且 16:9 构图完全自由；同时剥掉给多模态 LLM 写的 `"The attached reference images are..."` 尾注，避免扩散
 *   模型看到 `"reference images"` 字面词画出左右分镜设定图。非 V4.5 模型不支持 `director_reference`，多张报错。
 *
 * 铁律四——**画布必须落在 64 的倍数上，单图有像素预算**。官方把单图上限标成 2048x1536
 * （= 3,145,728 像素），档位是 Gemini 的词汇、NovelAI 没有这个概念，本层把 `1K`/`2K`/`4K`
 * 当**目标面积**按画幅展开，再朝预算收缩——于是 `2K` 与 `4K` 都会顶到上限。
 *
 * 采样器 / 步数 / CFG / 负面词取官方站点默认，落成下面的常量：本格式没有对应的设置项，
 * 要调再说。
 */

export interface NovelAiImageOptions {
  baseUrl: string;
  apiKey: string;
  /** NovelAI 模型 id（`nai-diffusion-5-full` / `nai-diffusion-4-5-full` / `nai-diffusion-3` …）。 */
  model: string;
  /** `STAGE_IMAGE_SIZE` 原文：档位或字面像素，构造期解析。 */
  size: string;
  timeoutMs: number;
}

/** 官方单图上限：2048x1536 = 3,145,728 像素（2023 年放开分辨率的官方公告）。 */
const MAX_PIXELS = 3_145_728;
const MAX_SIDE = 2048;
const MIN_SIDE = 64;
/** 宽高都必须是 64 的倍数。 */
const ALIGN = 64;

/** 官方站点默认：采样器 `k_euler_ancestral`、CFG 5、`karras` 噪声表。 */
const SAMPLER = "k_euler_ancestral";
/** 官方默认步数 V4/V4.5 是 28、V5 是 23；统一给 28——都还在 Opus 免费带的「≤28 步」里。 */
const STEPS = 28;
const SCALE = 5;
const NOISE_SCHEDULE = "karras";

/** 图生图强度：0.7 = 保角色身份、允许表情与细节变化（官方：越低越接近原图）。 */
const IMG2IMG_STRENGTH = 0.7;

/**
 * 默认负面词。没有对应的设置项，先给一份通用的：V4+ 读 `v4_negative_prompt`，
 * V3 读 `uc`，两条路都用它。
 */
const NEGATIVE_PROMPT =
  "lowres, bad anatomy, bad hands, extra digits, fewer digits, worst quality, low quality, " +
  "jpeg artifacts, signature, watermark, username, blurry";

export class NovelAiImageGen implements ImageBackend {
  private readonly spec: ImageSizeSpec;
  private readonly fetchImpl: FetchLike;

  constructor(
    private readonly opts: NovelAiImageOptions,
    fetchImpl: FetchLike = envFetch,
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
    const model = req.model?.trim() || this.opts.model;
    const isV45 = /^nai-diffusion-4-5/i.test(model);
    if (refs.length > 1 && !isV45) {
      throw new Error(
        `NovelAI 模型 ${model} 的 img2img 只吃一张垫图（这次给了 ${refs.length} 张）。` +
          "多张参考图请换用 nai-diffusion-4-5-full（支持 director_reference）或 gemini 格式。",
      );
    }

    const canvas = this.canvas(req, aspect);
    const seed = randomSeed();
    const cleanedPrompt = refs.length > 0 ? stripReferenceMeta(req.prompt) : req.prompt;
    const useImg2Img =
      refs.length === 1 && (!isV45 || sameAspect(refs[0]!.data, aspect));

    const parameters: Record<string, unknown> = {
      params_version: paramsVersion(model),
      width: canvas.width,
      height: canvas.height,
      scale: SCALE,
      sampler: SAMPLER,
      steps: STEPS,
      seed,
      n_samples: 1,
      noise_schedule: NOISE_SCHEDULE,
      // 站点默认开：给提示词补 masterpiece, best quality, very aesthetic, absurdres。
      // 我们的提示词由 LLM 现写、不含这类质量词，补上比不补好。
      qualityToggle: true,
      cfg_rescale: 0,
      controlnet_strength: 1,
      dynamic_thresholding: false,
      sm: false,
      sm_dyn: false,
      legacy: false,
      legacy_v3_extend: false,
      prompt: cleanedPrompt,
      negative_prompt: NEGATIVE_PROMPT,
      ...promptStructure(model, cleanedPrompt),
    };
    if (useImg2Img) {
      parameters.image = await fitToCanvas(refs[0]!.data, canvas);
      parameters.strength = IMG2IMG_STRENGTH;
      parameters.noise = 0;
      parameters.extra_noise_seed = seed;
    } else if (refs.length > 0) {
      const encoded = await Promise.all(refs.map((ref) => fitForDirector(ref.data)));
      parameters.director_reference_images = encoded;
      parameters.director_reference_descriptions = encoded.map(() => ({
        caption: { base_caption: "character", char_captions: [] },
        legacy_uc: false,
      }));
      parameters.director_reference_strength_values = encoded.map(() => 1.0);
      parameters.director_reference_secondary_strength_values = encoded.map(() => 0.2);
      parameters.director_reference_information_extracted = encoded.map(() => 1.0);
    }

    const res = await this.fetchImpl(`${this.opts.baseUrl.replace(/\/+$/, "")}/ai/generate-image`, {
      method: "POST",
      headers: { authorization: `Bearer ${this.opts.apiKey}`, "content-type": "application/json" },
      body: JSON.stringify({
        input: cleanedPrompt,
        model,
        action: useImg2Img ? "img2img" : "generate",
        parameters,
      }),
      signal: AbortSignal.timeout(this.opts.timeoutMs),
    });
    if (!res.ok) throw new Error(`NovelAI 出图失败 HTTP ${res.status}：${await errorText(res)}`);
    return unpackImage(Buffer.from(await res.arrayBuffer()));
  }

  /**
   * 画布：字面像素照发（用户点名的尺寸不悄悄改小，越界即报错）；
   * 档位当目标面积按画幅展开（`2K`/`4K` 都会顶到官方单图像素预算）。
   */
  private canvas(req: ImageRequest, aspect: ImageAspect): { width: number; height: number } {
    const spec = req.size ? parseImageSize(req.size) : this.spec;
    if (spec.kind === "px") return literalCanvas(spec.width, spec.height);
    return canvasFor(aspect, tierArea(spec.tier));
  }
}

/** 官方站点：V5 发 4、V4.x 与 V3 发 3（实测该值被上游忽略，照官方填）。 */
function paramsVersion(model: string): number {
  return /^nai-diffusion-5/.test(model.trim()) ? 4 : 3;
}

/** V4 及之后（含 V5）走 `v4_prompt` 结构；V3 与更早（含 furry-3）走 `prompt` + `uc`。 */
function promptStructure(model: string, prompt: string): Record<string, unknown> {
  if (!/^nai-diffusion-(4|5)/.test(model.trim())) return { uc: NEGATIVE_PROMPT };
  const negative = { base_caption: NEGATIVE_PROMPT, char_captions: [] };
  return {
    v4_prompt: {
      caption: { base_caption: prompt, char_captions: [] },
      use_coords: false,
      use_order: true,
    },
    v4_negative_prompt: { caption: { ...negative }, use_coords: false, use_order: false },
  };
}

/**
 * 画布：目标面积按画幅展开，两边对齐 64，单边封顶后再朝单图像素预算收缩。
 * 长边先定、短边跟它算——两边各按面积独立展开会让 21:9 这类极端画幅走形。
 */
export function canvasFor(aspect: ImageAspect, area: number): { width: number; height: number } {
  const [w, h] = aspect.split(":").map(Number) as [number, number];
  const ratio = w / h;
  const target = Math.min(area, MAX_PIXELS);
  let width: number;
  let height: number;
  if (ratio >= 1) {
    width = snap(Math.sqrt(target * ratio));
    height = snap(width / ratio);
  } else {
    height = snap(Math.sqrt(target / ratio));
    width = snap(height * ratio);
  }
  while (width * height > MAX_PIXELS) {
    if (width >= height) width -= ALIGN;
    else height -= ALIGN;
  }
  return { width, height };
}

/** 字面像素：必须已是 64 的倍数且在单边 / 总面积上限内——用户点名了数字，不对就说不对。 */
function literalCanvas(width: number, height: number): { width: number; height: number } {
  if (width % ALIGN !== 0 || height % ALIGN !== 0) {
    throw new Error(
      `NovelAI 的画布宽高必须是 ${ALIGN} 的倍数，填不了 ${width}x${height}` +
        `（最接近的是 ${snap(width)}x${snap(height)}）。`,
    );
  }
  if (
    width < MIN_SIDE ||
    height < MIN_SIDE ||
    width > MAX_SIDE ||
    height > MAX_SIDE ||
    width * height > MAX_PIXELS
  ) {
    throw new Error(
      `生图尺寸 ${width}x${height} 超过 NovelAI 的单图上限（单边 ≤${MAX_SIDE}、总面积 ≤${MAX_PIXELS} 像素）。`,
    );
  }
  return { width, height };
}

const snap = (value: number): number =>
  Math.min(MAX_SIDE, Math.max(MIN_SIDE, Math.round(value / ALIGN) * ALIGN));

/** NovelAI 的种子范围 0–4294967295；不给就每张长得不一样。 */
const randomSeed = (): number => Math.floor(Math.random() * 4_294_967_295);

/**
 * 垫图 → 目标画布的 base64 PNG：等比缩放到画布内、居中、四周补不透明黑。
 * 与 novelai-bridge 的 `fit_image_to_canvas` 同一套（它给这条写的理由就是「上游要求
 * 图生图源图与画布同尺寸」），补黑而不补白是因为白底会被立绘的纯色键抠穿。
 *
 * 已知边界：参考图与画布画幅不同时，那圈黑边会被 img2img 带进成图（黑也照样会被纯色键抠掉，
 * 所以黑发/黑衣会被啃）。立绘差分这条路补边量恒为 0（垫的就是同画幅的 neutral），
 * 只有拿异画幅的外部图当定妆照基准时才会遇到。
 */
async function fitToCanvas(data: Buffer, canvas: { width: number; height: number }): Promise<string> {
  const png = await sharp(data)
    .resize(canvas.width, canvas.height, {
      fit: "contain",
      background: { r: 0, g: 0, b: 0, alpha: 1 },
    })
    .png()
    .toBuffer();
  return png.toString("base64");
}

/**
 * Director Reference（V4.5 精准角色参考）的输入规格：透明立绘先铺白底，等比收进官方标准竖幅 1024×1536。
 */
async function fitForDirector(data: Buffer): Promise<string> {
  const png = await sharp(data)
    .flatten({ background: { r: 255, g: 255, b: 255 } })
    .resize(1024, 1536, {
      fit: "contain",
      background: { r: 255, g: 255, b: 255, alpha: 1 },
    })
    .png()
    .toBuffer();
  return png.toString("base64");
}

function sameAspect(data: Buffer, aspect: ImageAspect): boolean {
  const size = sizeOfImage(data);
  return size !== null && aspectMatches(size, aspect);
}

/**
 * 剥离 `PlayAssets` 为 Gemini 多模态模型追加的 `"The attached reference images are..."` 等元指令：
 * 扩散模型不理解「第几张附件是谁」的自然语言说明，反而会把 `"reference images"` 当成设定图 tag 画出左右分镜。
 */
export function stripReferenceMeta(prompt: string): string {
  return prompt
    .replace(
      /\.\s*(?:The attached reference images are, in this exact order:|Follow the attached reference image\(s\) for visual appearance,|Based on the attached reference image:)[\s\S]*$/i,
      "",
    )
    .replace(
      /(?:Same character as the reference image: identical hairstyle, hair color, eye color, outfit and body type\. Change only the facial expression\.|The same subject as the reference image, in the same pose and same colours\. Change only its state\.)\s*/gi,
      "",
    )
    .trim();
}

/**
 * 响应先当 ZIP 解：里面挑第一个图片条目（`image_0.png`），mime 从字节认，不写死。
 * 不是 ZIP 时退回「整段就是一张图」（上游换端点/走上游流式时可能直接给字节），
 * 字节头也认不出才报错——不猜字节。
 */
function unpackImage(bytes: Buffer): GeneratedImage {
  let files: Record<string, Uint8Array> | null = null;
  try {
    files = unzipSync(new Uint8Array(bytes));
  } catch {
    files = null;
  }
  for (const name of Object.keys(files ?? {}).sort()) {
    if (!/\.(png|jpe?g|webp|gif)$/i.test(name)) continue;
    const data = Buffer.from(files![name]!);
    return { data, mimeType: sniffImageMime(data) ?? "image/png" };
  }
  const direct = sniffImageMime(bytes);
  if (direct) return { data: bytes, mimeType: direct };
  throw new Error(
    files
      ? "NovelAI 的 ZIP 里没有图片条目"
      : `NovelAI 的响应既不是图片也不是 ZIP（${bytes.length} 字节）`,
  );
}

/** 上游报错是 `{statusCode, message}`；取 message，没有就原样截一段。 */
async function errorText(res: { text: () => Promise<string> }): Promise<string> {
  const raw = await res.text().catch(() => "");
  try {
    const parsed = JSON.parse(raw) as { message?: unknown; error?: unknown };
    return String(parsed.message ?? parsed.error ?? raw).slice(0, 200);
  } catch {
    return raw.slice(0, 200);
  }
}
