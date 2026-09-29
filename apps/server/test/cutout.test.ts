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

/** 纯色底 + 一个站立人形。fillW/fillH 是人物占格的比例：模型在矮格子里会把人撑得又宽又矮。 */
async function standing(w: number, h: number, fillW = 0.36, fillH = 0.9): Promise<Buffer> {
  const raw = Buffer.alloc(w * h * 3);
  const bw = Math.round(w * fillW);
  const top = Math.round(h * (1 - fillH) / 2);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const o = (y * w + x) * 3;
      const inBody = x > (w - bw) / 2 && x < (w + bw) / 2 && y > top && y < top + Math.round(h * fillH);
      raw[o] = inBody ? 50 : 245;
      raw[o + 1] = inBody ? 60 : 245;
      raw[o + 2] = inBody ? 120 : 245;
    }
  }
  return sharp(raw, { raw: { width: w, height: h, channels: 3 } }).jpeg().toBuffer();
}

describe("人物高度：不同格子制式下必须一致", () => {
  it("2x1 切出的格子和 2x2 切出的格子，人物都落到满高 1920", async () => {
    // 同一张 768x1376 原片，切 2x1 得 384x1376，切 2x2 得 384x688。
    // 这是同一个角色分两批出差分的情况——人物高度必须一样，否则舞台上忽高忽矮。
    const tall = await cutout(await standing(384, 1376));
    const short = await cutout(await standing(384, 688));
    expect(tall.figureHeight).toBe(1920);
    expect(short.figureHeight).toBe(1920);
    expect(tall.figureHeight).toBe(short.figureHeight);
  });

  it("模型把人画得比格子小也一样落到满高（缩放看的是外框，不是格子）", async () => {
    const small = await cutout(await standing(384, 688));
    const smaller = await cutout(await standing(160, 300));
    expect(small.figureHeight).toBe(smaller.figureHeight);
    expect(smaller.figureHeight).toBe(1920);
  });

  it("格制式选错导致外框太胖时，人物会矮下来——这正是砍掉 2x3 的理由", async () => {
    // 2x3 的单格是 384x458，模型在这种矮格子里只能把人物撑满整格，长宽比超过画布的 0.5625，
    // 缩放变成宽度先卡，人物矮一大截。断言这个数会掉下来，把砍掉 2x3 的结论钉在测试里。
    const cramped = await cutout(await standing(384, 458, 0.95, 0.98));
    const tall = await cutout(await standing(384, 1376));
    expect(tall.figureHeight).toBe(1920);
    expect(cramped.figureHeight).toBeLessThan(tall.figureHeight * 0.8);
  });
});
