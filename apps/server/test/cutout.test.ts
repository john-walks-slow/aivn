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

/**
 * 抠底三个旋钮的专用夹具：纯白底 + 一块深色人形，人形上摆三个「底色口袋」，
 * 各自只被一个旋钮决定（走 PNG，JPEG 的色振铃会把摆好的几格色差搅没）：
 * - A 离底色 4 格、带一条 1px 颈连到外面 → **weak** 够大才被带走（3 邻域漫延不进 4 格外）
 * - B 离底色 4 格、封闭 → **strong** 够小才被点着（强阈值是全局的，不看连通性）
 * - C 就是底色、40x40=1600px 封闭 → **minHole** 说它算不算洞（贴不到画面边）
 * 人形 40..160 × 20..280，三个口袋都深埋在里面。
 */
async function knobsScene(): Promise<Buffer> {
  const width = 200;
  const height = 300;
  const paint = (raw: Buffer, x0: number, y0: number, x1: number, y1: number, c: [number, number, number]) => {
    for (let y = y0; y <= y1; y++) {
      for (let x = x0; x <= x1; x++) {
        const o = (y * width + x) * 3;
        raw[o] = c[0];
        raw[o + 1] = c[1];
        raw[o + 2] = c[2];
      }
    }
  };
  const raw = Buffer.alloc(width * height * 3).fill(255);
  const NEAR: [number, number, number] = [251, 251, 252];
  paint(raw, 40, 20, 160, 280, [40, 50, 80]);
  paint(raw, 90, 100, 110, 120, NEAR);
  paint(raw, 111, 110, 180, 110, [255, 255, 255]);
  paint(raw, 90, 160, 110, 180, NEAR);
  paint(raw, 60, 210, 100, 250, [255, 255, 255]);
  return sharp(raw, { raw: { width, height, channels: 3 } }).png().toBuffer();
}

/** 人物内部被抠穿的像素数（落在不透明外框之内的全透明像素）。量旋钮效应时不依赖坐标换算。 */
async function interiorHoles(data: Buffer): Promise<number> {
  const { data: raw, info } = await sharp(data).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const alpha = (x: number, y: number): number => raw[(y * info.width + x) * info.channels + 3] ?? 0;
  let minX = info.width;
  let maxX = -1;
  let minY = info.height;
  let maxY = -1;
  for (let y = 0; y < info.height; y++) {
    for (let x = 0; x < info.width; x++) {
      if (alpha(x, y) > 0) {
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
  }
  let holes = 0;
  for (let y = minY; y <= maxY; y++) {
    for (let x = minX; x <= maxX; x++) if (alpha(x, y) === 0) holes++;
  }
  return holes;
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

  it("边界带的 alpha 是反解出来的真实覆盖率，不是钉死的 128 地板", async () => {
    // 立绘左缘的三段抗锯齿，覆盖率分别 20% / 50% / 80%，深处是实心深色，底是纯白。
    // 旧公式是 max(色差项, dist/2)，而 dist/2 恒等于 0.5 —— 边界带每一像素的 alpha
    // 下限被钉死在 128，深色舞台底上就是一圈白边晕。闭式解 a=(B−I)/(B−F) 给出真实覆盖率。
    //
    // 画布选 400x2120、人形 200x1920：落 1080x1920 时 scale = min(1080/200, 1920/1920) = 1.0，
    // 一点不过重采样。1px 的抗锯齿列经 8x lanczos 会被过冲展宽，单列探针读出来的是核的值
    // 而不是覆盖率（实测同一夹具在 8x 下旧新都读 172），这个尺寸是能测准的前提。
    const width = 400;
    const height = 2120;
    const raw = Buffer.alloc(width * height * 3).fill(255);
    const bands: { y: number; coverage: number; value: number }[] = [
      { y: 200, coverage: 0.2, value: 212 },
      { y: 800, coverage: 0.5, value: 148 },
      { y: 1400, coverage: 0.8, value: 83 },
    ];
    for (let y = 100; y < 2020; y++) {
      for (let x = 100; x < 300; x++) {
        const o = (y * width + x) * 3;
        const v = x === 100 ? (bands.find((b) => y >= b.y && y < b.y + 500)?.value ?? 40) : 40;
        raw[o] = v;
        raw[o + 1] = v;
        raw[o + 2] = v;
      }
    }
    const result = await cutout(await sharp(raw, { raw: { width, height, channels: 3 } }).png().toBuffer());

    // scale 恒等于 1，人形 200 宽居中落在 1080 画布的 x 440..639，底对齐
    const left = Math.round((1080 - 200) / 2);
    const measured: number[] = [];
    for (const band of bands) {
      const edge = await alphaAt(result.data, left, band.y);
      measured.push(edge);
      // 真实覆盖率就是 B 和 I 线性插值出来的那个值
      expect(Math.abs(edge - Math.round(255 * band.coverage))).toBeLessThanOrEqual(2);
      // 旧实现在这三档全返回 255：128 地板 + 色差项顶满，深色底上就是那圈白边晕
      expect(edge).toBeLessThan(255);
      // 往里一列就是实心
      expect(await alphaAt(result.data, left + 1, band.y)).toBe(255);
      // 往外一列是底色，全透明
      expect(await alphaAt(result.data, left - 1, band.y)).toBe(0);
    }
    // 覆盖率越高 alpha 越高，且三档落在不同的 alpha 上（不是同一个值）
    expect(measured).toEqual([...measured].sort((a, b) => a - b));
    expect(new Set(measured).size).toBe(3);
  });

  it("底色不干净时抛错而不是落半残图", async () => {
    // 满图杂乱花纹（模型没给纯色底时会这样）：没有一块区域贴近边界种子色，漫延啃不动，
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

  it("weak 是严厉度的旋钮：贴着底色但差了几格的口袋，够大才连着颈被带走", async () => {
    const data = await knobsScene();
    // 口袋 A 离底色 4 格：weak=2 漫延进不去，weak=8 进得去（同一张图、只改这一个参数）
    const tight = await interiorHoles((await cutout(data, { weak: 2, minHole: 0 })).data);
    const loose = await interiorHoles((await cutout(data, { weak: 8, minHole: 0 })).data);
    expect(loose - tight).toBeGreaterThan(10_000);
  });

  it("strong 是另一个旋钮：它管「谁是种子」，不看连通性——封闭口袋只由它点得着", async () => {
    const data = await knobsScene();
    // 口袋 B 离底色 4 格且封闭，与外部底色没有任何通路。strong 是全局判据：
    // 1 ⇒ 它连种子都不算，没人去动它；8 ⇒ 它被点着、漫延成一整块，再由 minHole=0 判成洞
    const unseeded = await interiorHoles((await cutout(data, { strong: 1, minHole: 0 })).data);
    const seeded = await interiorHoles((await cutout(data, { strong: 8, minHole: 0 })).data);
    expect(seeded - unseeded).toBeGreaterThan(10_000);
  });

  it("minHole 是第三个旋钮：抠到哪算背景，色差阈值说了不算", async () => {
    const data = await knobsScene();
    // 口袋 C 就是底色、1600px、贴不到画面边 ⇒ 算不算洞只看 minHole
    const holed = await interiorHoles((await cutout(data, { minHole: 200 })).data);
    const filled = await interiorHoles((await cutout(data, { minHole: 8000 })).data);
    expect(holed - filled).toBeGreaterThan(50_000);
  });

  it("弱阈值不得低于强阈值：否则滞后退化成单阈值，参数直接说谎", async () => {
    const data = await knobsScene();
    const clamped = await cutout(data, { strong: 4, weak: 1 });
    expect(clamped.data.equals((await cutout(data, { strong: 4, weak: 4 })).data)).toBe(true);
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
