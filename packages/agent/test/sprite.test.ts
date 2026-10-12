import sharp from "sharp";
import { describe, expect, it } from "vitest";
import { prepareSprite } from "../src/index.js";

/**
 * 一张纯色键底的原片：绿底 + 居中一块人物。人物只占画布高的 70%，四周留白——
 * 归一化之后它必须被缩到 95% 并贴到底部。
 */
async function keyed(width = 300, height = 400): Promise<Buffer> {
  const figure = await sharp({
    create: { width: Math.round(width * 0.5), height: Math.round(height * 0.7), channels: 3, background: "#3c4678" },
  })
    .png()
    .toBuffer();
  return sharp({ create: { width, height, channels: 3, background: "#00ff00" } })
    .composite([{ input: figure, left: Math.round(width * 0.25), top: Math.round(height * 0.1) }])
    .png()
    .toBuffer();
}

/** 一张已经抠好的透明 PNG：人物 240×500 贴在 400×600 的画布上（左 80 / 上 40）。 */
async function cutPng(): Promise<Buffer> {
  const figure = await sharp({
    create: { width: 240, height: 500, channels: 4, background: { r: 60, g: 70, b: 120, alpha: 1 } },
  })
    .png()
    .toBuffer();
  return sharp({ create: { width: 400, height: 600, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } })
    .composite([{ input: figure, left: 80, top: 40 }])
    .png()
    .toBuffer();
}

async function alphaBounds(data: Buffer): Promise<{ top: number; height: number; canvasWidth: number }> {
  const { data: raw, info } = await sharp(data).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const { width, height, channels } = info;
  let top = height;
  let bottom = -1;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if ((raw[(y * width + x) * channels + 3] ?? 0) > 8) {
        if (y < top) top = y;
        if (y > bottom) bottom = y;
      }
    }
  }
  return { top, height: bottom - top + 1, canvasWidth: width };
}

describe("prepareSprite：立绘入库前的归一化", () => {
  it("纯色键底原片：去底 + 落成该取景的画布 + 5% 顶留白", async () => {
    const prepared = await prepareSprite(await keyed(), { framing: "half" });
    expect(prepared.keyed).toBe(true);
    expect([prepared.width, prepared.height]).toEqual([1440, 1920]);
    expect(prepared.figureHeight).toBe(1824);
    expect(prepared.figureTop).toBe(96);
    // 外框按「alpha 非零」量（`foregroundBounds`），而抗锯齿让最上沿几行接近全透明：
    // 用「肉眼可见」的阈值数量出来的顶会低几像素，这不是摆位误差。
    const bounds = await alphaBounds(prepared.data);
    expect(bounds.top).toBeGreaterThanOrEqual(96);
    expect(bounds.top).toBeLessThanOrEqual(104);
    expect(bounds.height).toBeGreaterThan(1810);
    expect(bounds.height).toBeLessThanOrEqual(1824);
  });

  it("已经抠好的透明 PNG：不抠底，但画布与指标照归一（自带留白被重排掉）", async () => {
    const prepared = await prepareSprite(await cutPng(), { framing: "full" });
    expect(prepared.keyed).toBe(false);
    expect([prepared.width, prepared.height]).toEqual([1080, 1920]);
    expect(prepared.figureTop).toBe(96);
    expect(prepared.figureHeight).toBe(1824);
    // 幂等：拿归一化的产物再跑一遍，两个指标一格不差——入库与抠底两条路叠着走也不会越摆越小
    const again = await prepareSprite(prepared.data, { framing: "full" });
    expect([again.figureTop, again.figureHeight]).toEqual([96, 1824]);
  });

  it("画布比跟着取景走，不给取景就按缺省全身", async () => {
    const png = await cutPng();
    const square = await prepareSprite(png, { framing: "square" });
    expect([square.width, square.height]).toEqual([1920, 1920]);
    const fallback = await prepareSprite(png);
    expect([fallback.width, fallback.height]).toEqual([1080, 1920]);
  });

  it("透明像素里还留着原来的绿底色（只写 alpha、没清 RGB）：按「已经抠好」收，不再抠第二遍", async () => {
    // 这不是编出来的边界：很多抠图工具只写 alpha，透明像素的 RGB 还是原来那层绿幕——
    // 拿边框 RGB 一量就是「纯绿底」，照原片再抠一次会把主体上接近底色的地方一起啃掉。
    const { data, info } = await sharp(await cutPng()).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    for (let i = 0; i < info.width * info.height; i++) {
      if (data[i * info.channels + 3] !== 0) continue;
      data[i * info.channels] = 0;
      data[i * info.channels + 1] = 255;
      data[i * info.channels + 2] = 0;
    }
    const greenBehind = await sharp(data, {
      raw: { width: info.width, height: info.height, channels: info.channels },
    })
      .png()
      .toBuffer();

    const prepared = await prepareSprite(greenBehind, { framing: "full" });
    expect(prepared.keyed).toBe(false);
    expect([prepared.figureTop, prepared.figureHeight]).toEqual([96, 1824]);
  });

  it("不透明底图带一点半透明噪点：不当成抠好的图（那个底会整块铺满画布）", async () => {
    const { data, info } = await sharp({ create: { width: 200, height: 300, channels: 3, background: "#f4f4f4" } })
      .png()
      .ensureAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true });
    data[3] = 200; // 一个半透明像素：全图的 0.0017%
    const noisy = await sharp(data, { raw: { width: info.width, height: info.height, channels: info.channels } })
      .png()
      .toBuffer();
    await expect(prepareSprite(noisy, { framing: "half" })).rejects.toThrow(/成片的透明区域/);
  });

  it("既不是色键底、也没有透明像素的图直接报错（说清两种合法输入）", async () => {
    const opaque = await sharp({ create: { width: 200, height: 300, channels: 3, background: "#f4f4f4" } })
      .png()
      .toBuffer();
    await expect(prepareSprite(opaque, { framing: "half" })).rejects.toThrow(/透明 PNG/);
    // 纯白底不是色键色（通道极差 0），所以「白底原片」也不收——它本来就抠不干净
    await expect(prepareSprite(opaque, { framing: "half" })).rejects.toThrow(/色键色要求/);
  });
});
