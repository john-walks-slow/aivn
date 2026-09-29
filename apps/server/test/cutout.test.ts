import sharp from "sharp";
import { describe, expect, it } from "vitest";
import { cutout } from "../src/cutout.js";

/** 合成一张测试图：浅灰底 + 一个深色人形 + 胸口一块贴近底色的白衬衫（不与边界连通）。 */
async function synth(width = 240, height = 320): Promise<{ data: Buffer; shirt: [number, number] }> {
  const px = (x: number, y: number): [number, number, number] => {
    if (x > 90 && x < 150 && y > 120 && y < 200) return [246, 246, 248];
    if (y > 40 && y < 280 && x > 60 && x < 180) return [60, 70, 120];
    return [240, 242, 245];
  };
  const raw = Buffer.alloc(width * height * 3);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const [r, g, b] = px(x, y);
      const o = (y * width + x) * 3;
      raw[o] = r;
      raw[o + 1] = g;
      raw[o + 2] = b;
    }
  }
  return {
    data: await sharp(raw, { raw: { width, height, channels: 3 } }).jpeg().toBuffer(),
    shirt: [120, 160],
  };
}

async function alphaAt(data: Buffer, x: number, y: number): Promise<number> {
  const { data: raw, info } = await sharp(data).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  return raw[(y * info.width + x) * info.channels + 3] ?? 0;
}

describe("cutout", () => {
  it("把纯色底抠成透明并落到 9:16 画布", async () => {
    const { data } = await synth();
    const result = await cutout(data);
    expect(result.width).toBe(1080);
    expect(result.height).toBe(1920);
    const meta = await sharp(result.data).metadata();
    expect(meta.format).toBe("png");
    expect(meta.hasAlpha).toBe(true);
    // 角落是底，应当完全透明
    expect(await alphaAt(result.data, 2, 2)).toBe(0);
    expect(result.coverage).toBeGreaterThan(0.05);
    expect(result.coverage).toBeLessThan(0.95);
  });

  it("不与边界连通的白衬衫保持不透明（连通域保护）", async () => {
    const { data, shirt } = await synth();
    const result = await cutout(data);
    // 衬衫在原图坐标 (120,160) → 裁到人物外框后等比缩放并底部居中
    const box = { x0: 59, y0: 39, x1: 180, y1: 280 };
    const w = box.x1 - box.x0 + 1;
    const h = box.y1 - box.y0 + 1;
    const scale = Math.min(1080 / w, 1920 / h);
    const left = Math.round((1080 - Math.round(w * scale)) / 2);
    const top = 1920 - Math.round(h * scale);
    const x = left + Math.round((shirt[0]! - box.x0) * scale);
    const y = top + Math.round((shirt[1]! - box.y0) * scale);
    expect(await alphaAt(result.data, x, y)).toBe(255);
  });

  it("底色不干净时抛错而不是落半残图", async () => {
    // 满图杂乱花纹（模型没给纯色底时会这样）：没有一块区域贴近边界种子色，flood fill 啃不动，
    // 前景占比冲到 97% 以上 → 报「底色没抠干净」
    const width = 120;
    const height = 160;
    const raw = Buffer.alloc(width * height * 3);
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const o = (y * width + x) * 3;
        raw[o] = (x * 37) % 256;
        raw[o + 1] = (y * 53) % 256;
        raw[o + 2] = ((x + y) * 97) % 256;
      }
    }
    const busy = await sharp(raw, { raw: { width, height, channels: 3 } }).jpeg().toBuffer();
    await expect(cutout(busy)).rejects.toThrow(/底色没抠干净/);
  });

  it("图里没有角色时抛错", async () => {
    const blank = await sharp({
      create: { width: 80, height: 80, channels: 3, background: "#f0f2f5" },
    })
      .jpeg()
      .toBuffer();
    await expect(cutout(blank)).rejects.toThrow(/抠底失败/);
  });
});
