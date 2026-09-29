/**
 * 生图后端契约：把「出一张图」从协议细节里抽出来。
 *
 * 两条调用方共用它——playwriter 的 `preload_asset` 预发射（落 media-cache）与
 * 工坊的 `generate_asset`（落静态素材）。cpa 只能文生图，flow2api 支持垫图与画幅，
 * 差异收敛在各实现里，调用方只描述「要一张什么图」。
 */

/** flow2api 接受的画幅。写错不会报错而是静默降级，故配置处要先自校验。 */
export const IMAGE_ASPECTS = ["16:9", "9:16", "1:1", "4:3", "3:4"] as const;
export type ImageAspect = (typeof IMAGE_ASPECTS)[number];

export const IMAGE_SIZES = ["1k", "2k", "4k"] as const;
export type ImageSize = (typeof IMAGE_SIZES)[number];

export interface ImageRequest {
  prompt: string;
  /** 画幅：背景/CG 用 16:9，立绘用 9:16。不给则由实现自取默认。 */
  aspectRatio?: ImageAspect;
  /** 参考图（垫图）：角色一致性的唯一可靠手段，prompt 措辞锁不住脸。 */
  references?: { mimeType: string; data: Buffer }[];
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
