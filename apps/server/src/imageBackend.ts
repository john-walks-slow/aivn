/**
 * 生图后端契约：把「出一张图」从协议细节里抽出来。
 *
 * 两条调用方共用它——playwriter 的 `preload_asset` 预发射（落 media-cache）与
 * 工坊的 `generate_image`（落静态素材）。协议差异（Gemini 原生 / OpenAI 兼容）收敛在
 * `geminiImage.ts` 与 `openaiImage.ts` 两个实现里，调用方只描述「要一张什么图」。
 */

/**
 * 接受的画幅 = **两款官方接口的交集**。
 *
 * Gemini `imageConfig.aspectRatio` 官方支持 `1:1 / 1:4 / 4:1 / 1:8 / 8:1 / 2:3 / 3:2 / 3:4 / 4:3 /
 * 4:5 / 5:4 / 9:16 / 16:9 / 21:9`（网关回 400 时的报文与之逐字一致），其中 `1:4 / 4:1 / 1:8 /
 * 8:1` 超出 OpenAI `size` 的 1:3–3:1 限制，故不收。本产品实际只用到 `16:9`（背景 / CG）与
 * `9:16`（立绘），其余留给自定义调用方。
 *
 * 上游不认的画幅不一定报错而是静默降级（flow2api 实测），落盘前的兜底是 `PlayAssets.assertCanvas`。
 */
export const IMAGE_ASPECTS = [
  "16:9",
  "9:16",
  "1:1",
  "3:2",
  "2:3",
  "4:3",
  "3:4",
  "5:4",
  "4:5",
  "21:9",
] as const;
export type ImageAspect = (typeof IMAGE_ASPECTS)[number];

/**
 * 出图档位 = Gemini `imageConfig.imageSize` 的官方词汇，**`K` 必须大写**——官方文档原文
 * 「You must use an uppercase 'K' … Lowercase parameters (e.g., 1k) will be rejected」，
 * 写错时网关回 400 `Unsupported image_size '8K'. Supported values are: 1K, 2K, 4K, 512, 512P, 512PX.`
 * （cpa 网关实测；本地网关宽容，小写能过，官方 API 不行）。
 *
 * 语义是**总像素量级**（1K ≈ 1024²、2K ≈ 2048²、4K ≈ 4096²），画幅只决定这块面积怎么摆：
 * 官方分辨率表 16:9 → 1376x768 / 2752x1536 / 5504x3072，1:1 的 1K 正好 1024x1024（cpa 实测
 * 一致）。官方另有 `512`（0.5K，仅 3.1 Flash Image），本配置没开放。
 */
export const IMAGE_SIZES = ["1K", "2K", "4K"] as const;
export type ImageSize = (typeof IMAGE_SIZES)[number];

/**
 * `STAGE_IMAGE_SIZE` 的两种写法：档位（Gemini 的词汇）或字面像素（OpenAI `size` 的词汇）。
 * 两款格式各取所需——Gemini 只认档位，OpenAI 只认 `WxH`。
 */
export type ImageSizeSpec =
  | { kind: "tier"; tier: ImageSize }
  | { kind: "px"; width: number; height: number };

const PIXEL_SIZE = /^(\d{2,5})\s*[x×]\s*(\d{2,5})$/;

/** 档位大小写不敏感——配置里写 `1k` 也认，对外一律发官方的大写形式。 */
export function parseImageSize(raw: string): ImageSizeSpec {
  const value = raw.trim();
  const tier = IMAGE_SIZES.find((size) => size.toLowerCase() === value.toLowerCase());
  if (tier) return { kind: "tier", tier };
  const pixels = PIXEL_SIZE.exec(value);
  if (pixels) return { kind: "px", width: Number(pixels[1]), height: Number(pixels[2]) };
  throw new Error(
    `生图尺寸（${raw}）非法，可填档位 ${IMAGE_SIZES.join(" / ")}（K 大写）或字面像素 1536x1024`,
  );
}

export function imageSizeText(spec: ImageSizeSpec): string {
  return spec.kind === "tier" ? spec.tier : `${spec.width}x${spec.height}`;
}

/** 档位的总像素量级——画幅按比例分这块面积（`1K` → 1024²、`2K` → 2048²、`4K` → 4096²）。 */
export function tierArea(tier: ImageSize): number {
  return Number(tier.slice(0, -1)) ** 2 * 1024 ** 2;
}

export interface ImageRequest {
  prompt: string;
  /**
   * 本次出图用哪个模型 / 什么尺寸：覆盖部署级的 `STAGE_IMAGE_MODEL` / `STAGE_IMAGE_SIZE`。
   *
   * 来自剧目的 `play.json`（`image` 段），由调用方现读现传——一部剧的立绘要 2K 抠底、
   * 另一部的小剧场插图 1K 就够，或者一部走 flow2api 的别名模型、另一部走官方。
   * 不传 = 跟部署配置；格式不认这个值时报错，不静默退回全局（用户改了设置却出成老样子最难查）。
   */
  model?: string;
  size?: string;
  /** 画幅：背景/CG 用 16:9，立绘用 9:16。不给则由实现自取默认。 */
  aspectRatio?: ImageAspect;
  /** 参考图（垫图）：角色一致性的唯一可靠手段，prompt 措辞锁不住脸。 */
  references?: { mimeType: string; data: Buffer }[];
  /**
   * 档位下限，只声明「不能低于这个」，实际档位由后端与配置共同决定（取两者更高）。
   *
   * 立绘要抠底，而抠底的锯齿是模型画在源图轮廓上的——提高源图分辨率是唯一有效的软化手段
   * （形态学平滑实测反而把 1px 缺口从 3385 推到 4419）。所以立绘请求声明 2K 下限，
   * 背景与 CG 不声明，跟着 `STAGE_IMAGE_SIZE` 走。
   */
  minTier?: ImageSize;
}

/** 两个档位取更高的那个（`IMAGE_SIZES` 已按低到高排列）。 */
export function higherTier(a: ImageSize, b: ImageSize): ImageSize {
  return IMAGE_SIZES.indexOf(a) >= IMAGE_SIZES.indexOf(b) ? a : b;
}

export interface GeneratedImage {
  data: Buffer;
  /** 按实际字节类型决定落盘扩展名——PNG 字节装进 .jpg 会让不嗅探的客户端裂图。 */
  mimeType: string;
}

export interface ImageBackend {
  generate(req: ImageRequest): Promise<GeneratedImage>;
}

/** mimeType → 落盘扩展名（只认三种客户端通吃的格式）。 */
export function extOf(mimeType: string): ".jpg" | ".png" | ".webp" {
  if (mimeType === "image/png") return ".png";
  if (mimeType === "image/webp") return ".webp";
  return ".jpg";
}

/** 从图片字节读画幅（PNG 走 IHDR、JPEG 走 SOFn 扫描、WEBP 走 VP8/VP8L 头）。认不出返回 null。 */
export function sizeOfImage(data: Buffer): { width: number; height: number } | null {
  if (data.length > 24 && data.readUInt32BE(0) === 0x89504e47) {
    return { width: data.readUInt32BE(16), height: data.readUInt32BE(20) };
  }
  if (data.length > 4 && data[0] === 0xff && data[1] === 0xd8) {
    for (let i = 2; i + 9 < data.length; ) {
      if (data[i] !== 0xff) {
        i += 1;
        continue;
      }
      const marker = data[i + 1]!;
      // SOF0..SOF15，跳过 DHT(c4) / JPGA(c8) / DAC(cc)
      if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
        return { width: data.readUInt16BE(i + 7), height: data.readUInt16BE(i + 5) };
      }
      i += 2 + data.readUInt16BE(i + 2);
    }
  }
  if (data.length > 30 && data.slice(0, 4).toString("latin1") === "RIFF" && data.slice(8, 12).toString("latin1") === "WEBP") {
    const format = data.slice(12, 16).toString("latin1");
    if (format === "VP8 ") return { width: data.readUInt16LE(26) & 0x3fff, height: data.readUInt16LE(28) & 0x3fff };
    if (format === "VP8L") {
      const bits = data.readUInt32LE(21);
      return { width: (bits & 0x3fff) + 1, height: ((bits >> 14) & 0x3fff) + 1 };
    }
    if (format === "VP8X") return { width: (data.readUIntLE(24, 3) & 0xffffff) + 1, height: (data.readUIntLE(27, 3) & 0xffffff) + 1 };
  }
  return null;
}

/** 实际画幅与请求画幅的容差比（0.12 ≈ 出图服务内部取整误差）。 */
const ASPECT_TOLERANCE = 0.12;

export function aspectMatches(
  size: { width: number; height: number },
  aspect: ImageAspect,
): boolean {
  const [w, h] = aspect.split(":").map(Number);
  if (!w || !h) return true;
  const want = w / h;
  const got = size.width / size.height;
  return Math.abs(got - want) / want <= ASPECT_TOLERANCE;
}
