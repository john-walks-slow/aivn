import sharp from "sharp";
import { describe, expect, it } from "vitest";
import {
  aspectMatches,
  extOf,
  higherTier,
  imageSizeText,
  mimeForExt,
  parseImageSize,
  sizeOfImage,
  sniffImageMime,
} from "../src/index.js";

/** 用 sharp 现造一张真图——字节层的判据要拿真字节喂，手搓的头容易把实现抄成测试。 */
async function image(format: "png" | "jpeg" | "webp", width: number, height: number): Promise<Buffer> {
  return sharp({ create: { width, height, channels: 3, background: "#336699" } })
    .toFormat(format)
    .toBuffer();
}

describe("生图契约：尺寸参数", () => {
  it("档位大小写不敏感，字面像素认 x/×", () => {
    expect(parseImageSize("2k")).toEqual({ kind: "tier", tier: "2K" });
    expect(parseImageSize(" 1536×1024 ")).toEqual({ kind: "px", width: 1536, height: 1024 });
    expect(() => parseImageSize("8K")).toThrow(/生图尺寸「8K」非法/);
    expect(imageSizeText({ kind: "tier", tier: "4K" })).toBe("4K");
    expect(imageSizeText({ kind: "px", width: 1, height: 2 })).toBe("1x2");
  });

  it("档位取更高的那个", () => {
    expect(higherTier("1K", "2K")).toBe("2K");
    expect(higherTier("4K", "2K")).toBe("4K");
    expect(higherTier("2K", "2K")).toBe("2K");
  });
});

describe("生图契约：字节层", () => {
  it("从真字节认类型，不认扩展名也不认 content-type", async () => {
    expect(sniffImageMime(await image("png", 4, 4))).toBe("image/png");
    expect(sniffImageMime(await image("jpeg", 4, 4))).toBe("image/jpeg");
    expect(sniffImageMime(await image("webp", 4, 4))).toBe("image/webp");
    expect(sniffImageMime(Buffer.from("not an image at all"))).toBeNull();
    expect(extOf("image/png")).toBe(".png");
    expect(extOf("image/webp")).toBe(".webp");
    expect(extOf("image/gif")).toBe(".jpg");
  });

  it("从真字节读画幅（PNG 走 IHDR、JPEG 走 SOFn、WEBP 走 VP8/VP8L/VP8X）", async () => {
    expect(sizeOfImage(await image("png", 7, 11))).toEqual({ width: 7, height: 11 });
    expect(sizeOfImage(await image("jpeg", 13, 5))).toEqual({ width: 13, height: 5 });
    expect(sizeOfImage(await image("webp", 9, 3))).toEqual({ width: 9, height: 3 });
    expect(sizeOfImage(Buffer.from("not an image at all"))).toBeNull();
  });

  it("mime ↔ 扩展名互认，IMAGE_EXTS 里的都认得出", () => {
    expect(mimeForExt(".PNG")).toBe("image/png");
    expect(mimeForExt(".jpeg")).toBe("image/jpeg");
    expect(mimeForExt(".webp")).toBe("image/webp");
    expect(mimeForExt(".gif")).toBe("image/gif");
    expect(mimeForExt(".bmp")).toBeNull();
  });

  it("画幅比对留 12% 容差（出图服务内部会取整），离谱的直接不认", () => {
    expect(aspectMatches({ width: 1360, height: 768 }, "16:9")).toBe(true);
    expect(aspectMatches({ width: 768, height: 1360 }, "9:16")).toBe(true);
    expect(aspectMatches({ width: 1024, height: 1024 }, "16:9")).toBe(false);
    expect(aspectMatches({ width: 1, height: 1 }, "16:9")).toBe(false);
  });
});
