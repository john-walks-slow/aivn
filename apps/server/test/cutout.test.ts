import sharp from "sharp";
import { describe, expect, it } from "vitest";
import { cutout } from "../src/cutout.js";

/**
 * 合成一张测试图：纯绿底色 + 一个深色人形 + 胸口一块贴近底色的白衬衫（不与边界连通）。
 *
 * 底色必须是**色键色**（这里纯绿 #00FF00）——`cutout` 现在会体检整圈边框量出的底色，
 * 白底/灰底直接报错（那种底色会把角色身上接近白的部分整块判成背景）。
 */
async function synth(width = 240, height = 320): Promise<{ data: Buffer; shirt: [number, number] }> {
  const px = (x: number, y: number): [number, number, number] => {
    if (x > 90 && x < 150 && y > 120 && y < 200) return [246, 246, 248];
    if (y > 40 && y < 280 && x > 60 && x < 180) return [60, 70, 120];
    return [0, 255, 0];
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
 * 色键夹具：纯绿底 + 一块深色人形，人形里埋四块「离底色不同远近」的封闭口袋。
 * 四个都贴不到画面边——纯色键不看连通性，贴不贴边不改变任何事：
 * A 离底色 4 格、B 20 格、C 42 格、D 60 格（走 PNG，JPEG 的色振铃会把摆好的色差搅没）。
 * 容差小到几格时它们都还是「角色身上的浅色」，放宽才一块块被当成底色吃进去。
 */
async function keyedPockets(): Promise<Buffer> {
  const width = 200;
  const height = 300;
  const paint = (x0: number, y0: number, x1: number, y1: number, c: [number, number, number]) => {
    for (let y = y0; y <= y1; y++) {
      for (let x = x0; x <= x1; x++) {
        const o = (y * width + x) * 3;
        raw[o] = c[0];
        raw[o + 1] = c[1];
        raw[o + 2] = c[2];
      }
    }
  };
  const BG: [number, number, number] = [0, 255, 0];
  // 离底色 4 / 20 / 42 / 60 格：只动绿以外的一路，极差就是那个距离
  const raw = Buffer.alloc(width * height * 3).fill(0);
  for (let i = 0; i < width * height; i++) {
    raw[i * 3] = BG[0];
    raw[i * 3 + 1] = BG[1];
    raw[i * 3 + 2] = BG[2];
  }
  paint(40, 20, 160, 280, [40, 50, 80]);
  paint(60, 40, 99, 79, [4, 251, 4]); // A：离底色 4 格
  paint(100, 40, 139, 79, [20, 235, 20]); // B：20 格
  paint(60, 100, 99, 139, [42, 213, 42]); // C：42 格
  paint(100, 100, 139, 139, [60, 195, 60]); // D：60 格
  return sharp(raw, { raw: { width, height, channels: 3 } }).png().toBuffer();
}

/** 人物内部被抠穿的像素数（落在不透明外框之内的全透明像素）。量容差效应时不依赖坐标换算。 */
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

/**
 * 容差用例的夹具是刻意干净的 PNG（见 `keyedPockets`），而 `keySmooth` 是给 JPEG 环纹用的
 * 掩膜降噪前置：高斯会把口袋边缘糊开、四档色差不再逐位可比。这几条只问色键本身，统一关掉降噪。
 */
const NO_SMOOTH = { keySmooth: 0 } as const;

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

  it("与底色同色的封闭块照抠不误——「别撞色」是出图那一步的责任", async () => {
    // 纯绿底 + 深色人形，胸口一块**与底色逐位同色**的封闭矩形：绿衣角色的极端形态。
    // 纯色键不分内外、不看连通性，它就是底色，整块抠掉。想保住它只有一条路——
    // 出图时把底色选成角色身上没有的颜色（playAssets.ts 的 KEY_BACKGROUND）。
    const width = 200;
    const height = 300;
    const BG: [number, number, number] = [0, 255, 0];
    const raw = Buffer.alloc(width * height * 3);
    for (let i = 0; i < width * height; i++) {
      raw[i * 3] = BG[0];
      raw[i * 3 + 1] = BG[1];
      raw[i * 3 + 2] = BG[2];
    }
    const paint = (x0: number, y0: number, x1: number, y1: number, c: [number, number, number]) => {
      for (let y = y0; y <= y1; y++) {
        for (let x = x0; x <= x1; x++) {
          const o = (y * width + x) * 3;
          raw[o] = c[0];
          raw[o + 1] = c[1];
          raw[o + 2] = c[2];
        }
      }
    };
    paint(40, 20, 160, 280, [40, 20, 60]); // 人形
    paint(80, 130, 120, 190, BG); // 与底色逐位同色的封闭块：2501px、封闭
    const data = await sharp(raw, { raw: { width, height, channels: 3 } }).png().toBuffer();

    // 白袜子中心 (100,160) 映射到输出画布（人物外框 + 等比缩放 + 底部居中）
    const box = { x0: 39, y0: 19, x1: 161, y1: 281 };
    const w = box.x1 - box.x0 + 1;
    const h = box.y1 - box.y0 + 1;
    const scale = Math.min(1080 / w, 1920 / h);
    const left = Math.round((1080 - Math.round(w * scale)) / 2);
    const top = 1920 - Math.round(h * scale);
    const x = left + Math.round((100 - box.x0) * scale);
    const y = top + Math.round((160 - box.y0) * scale);

    const result = await cutout(data, { ...NO_SMOOTH });
    expect(await alphaAt(result.data, x, y)).toBe(0);
    // 人形自己没被连坐
    expect(await alphaAt(result.data, left + Math.round(2 * scale), y)).toBe(255);
  });

  it("tolerance 是唯一旋钮：多远的像素算底色全由它定", async () => {
    const data = await keyedPockets();
    // A/B/C/D 分别离底色 4 / 20 / 42 / 60 格，每块 40x40=1600px，都封闭、都贴不到画面边。
    // 紧档只吃 A，松档把 B、C 也吃进去；把容差再放宽一到 D 才轮到它。
    const tight = await interiorHoles((await cutout(data, { tolerance: 8, ...NO_SMOOTH })).data);
    const loose = await interiorHoles((await cutout(data, { tolerance: 48, ...NO_SMOOTH })).data);
    const widest = await interiorHoles((await cutout(data, { tolerance: 64, ...NO_SMOOTH })).data);
    expect(loose - tight).toBeGreaterThan(2000); // B + C 两块
    expect(widest - loose).toBeGreaterThan(1000); // D 一块
  });

  it("图里没有角色时抛错", async () => {
    const blank = await sharp({
      create: { width: 80, height: 80, channels: 3, background: "#f0f2f5" },
    })
      .jpeg()
      .toBuffer();
    await expect(cutout(blank)).rejects.toThrow(/抠底失败/);
  });

  it("边界带的 alpha 是反解出来的真实覆盖率，不是钉死的 128 地板", async () => {
    // 立绘左缘的三段抗锯齿，覆盖率分别 20% / 50% / 80%，深处是实心深色，底是纯绿色键。
    // 旧公式是 max(色差项, dist/2)，而 dist/2 恒等于 0.5 —— 边界带每一像素的 alpha
    // 下限被钉死在 128，深色舞台底上就是一圈白边晕。闭式解 a=(B−I)/(B−F) 给出真实覆盖率。
    //
    // 画布选 400x2120、人形 200x1920：落 1080x1920 时 scale = min(1080/200, 1920/1920) = 1.0，
    // 一点不过重采样。1px 的抗锯齿列经 8x lanczos 会被过冲展宽，单列探针读出来的是核的值
    // 而不是覆盖率（实测同一夹具在 8x 下旧新都读 172），这个尺寸是能测准的前提。
    const width = 400;
    const height = 2120;
    const BG: [number, number, number] = [0, 255, 0];
    const FG: [number, number, number] = [40, 40, 40];
    /** 底色与前景按覆盖率线性混合——模型抗锯齿画出来的就是这条线上的像素。 */
    const mix = (a: number): [number, number, number] =>
      FG.map((v, c) => Math.round(a * v + (1 - a) * BG[c]!)) as [number, number, number];
    const raw = Buffer.alloc(width * height * 3);
    for (let i = 0; i < width * height; i++) {
      raw[i * 3] = BG[0];
      raw[i * 3 + 1] = BG[1];
      raw[i * 3 + 2] = BG[2];
    }
    const bands: { y: number; coverage: number }[] = [
      { y: 200, coverage: 0.2 },
      { y: 800, coverage: 0.5 },
      { y: 1400, coverage: 0.8 },
    ];
    for (let y = 100; y < 2020; y++) {
      for (let x = 100; x < 300; x++) {
        const o = (y * width + x) * 3;
        const coverage = x === 100 ? (bands.find((b) => y >= b.y && y < b.y + 500)?.coverage ?? 1) : 1;
        const [r, g, b] = mix(coverage);
        raw[o] = r;
        raw[o + 1] = g;
        raw[o + 2] = b;
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

  it("色键底（绿底）+ 亮色前景：覆盖率与反解出来的边缘色都对", async () => {
    // 色键底常常在某些通道上比角色**暗**——纯绿 #00FF00 的红、蓝两路就是 0。
    // 覆盖率反解 a=(B−I)/(B−F) 的分母必须带符号：取绝对值会把符号翻过来、解出负数，
    // 被 clamp 成 0 之后整圈带色轮廓会被啃掉（白衬衫/肤色上最明显）。
    // 同一个像素也是 unblend 的试金石：F=(I−(1−a)B)/a，漏掉 I 那一项就会留下压不掉的底色调。
    const width = 400;
    const height = 2120;
    const BG: [number, number, number] = [0, 255, 0];
    const SKIN: [number, number, number] = [245, 215, 190];
    const blend = SKIN.map((v, c) => Math.round(0.5 * v + 0.5 * BG[c]!));
    const raw = Buffer.alloc(width * height * 3);
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const o = (y * width + x) * 3;
        const inside = x >= 101 && x < 300 && y >= 100 && y < 2020;
        // 那条半覆盖列只画在人形里，别一路画到画布上下缘——否则外框会被它撑成整张图高
        const c = x === 100 && y >= 100 && y < 2020 ? blend : inside ? SKIN : BG;
        raw[o] = c[0]!;
        raw[o + 1] = c[1]!;
        raw[o + 2] = c[2]!;
      }
    }
    const result = await cutout(
      await sharp(raw, { raw: { width, height, channels: 3 } }).png().toBuffer(),
    );
    const { data, info } = await sharp(result.data).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    const at = (x: number, y: number) => {
      const o = (y * info.width + x) * info.channels;
      return [data[o]!, data[o + 1]!, data[o + 2]!, data[o + 3]!];
    };
    // 与「反解覆盖率」那条用例同一套尺寸换算：200 宽的人形居中落在 1080 画布的 x 440
    const left = Math.round((1080 - 200) / 2);
    const edge = at(left, 600);
    expect(Math.abs(edge[3]! - 128)).toBeLessThanOrEqual(6);
    // 半覆盖像素反解回前景色，不能残留底色（绿底的 R/B 通道是 0，残留一眼可见）
    for (let c = 0; c < 3; c++) expect(Math.abs(edge[c]! - SKIN[c]!)).toBeLessThanOrEqual(12);
    // 往里是实心前景色，没有被误抠
    const solid = at(left + 20, 600);
    expect(solid[3]).toBe(255);
    for (let c = 0; c < 3; c++) expect(Math.abs(solid[c]! - SKIN[c]!)).toBeLessThanOrEqual(4);
    // 往外是纯底色，全透明
    expect(at(left - 3, 600)[3]).toBe(0);
  });

  it("底色只占边框一圈（描边/晕影）时抛错而不是落半残图", async () => {
    // 色键的底色是从整圈边框量出来的，它必须真是整片底色。模型给画面描了一圈边、
    // 或加了晕影时，量出来的颜色只覆盖边框那一圈，其余全被判成前景 → 报「底色没抠干净」。
    // 边框是纯绿（过得了底色体检），里面是纯品红——两种都是合法色键色，
    // 所以挡住它的只能是「底色没铺满」这条，不是体检那条。
    const width = 200;
    const height = 200;
    const raw = Buffer.alloc(width * height * 3);
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const o = (y * width + x) * 3;
        const onRing = x === 0 || y === 0 || x === width - 1 || y === height - 1;
        raw[o] = onRing ? 0 : 255;
        raw[o + 1] = onRing ? 255 : 0;
        raw[o + 2] = onRing ? 0 : 255;
      }
    }
    // 不走 JPEG：1px 的边框经 JPEG 一抖就和内部糊成灰绿，底色体检会先把它拦下，
    // 那样测的就不是这两条判据了。
    const bordered = await sharp(raw, { raw: { width, height, channels: 3 } }).png().toBuffer();
    await expect(cutout(bordered)).rejects.toThrow(/底色没抠干净/);
  });

  it("底色不是色键色（白底/灰底）时当场抛错，不落一张打穿的立绘", async () => {
    // 这是本仓最贵的一次教训：差分曾经带着**白底**出图（提示词漏了色键底要求），
    // 纯色键于是把角色身上一切接近白的像素（白袜、白衬衫、银发）判成背景，
    // 整张立绘被打成镂空，而且一路静默入库，只有用户肉眼看得出来。
    // 见 docs/issues/261008-sprite-variant-dirty-cutout/。
    const width = 200;
    const height = 300;
    for (const [name, bg] of [
      ["纯白", [255, 255, 255]],
      ["浅灰", [196, 196, 196]],
    ] as const) {
      const raw = Buffer.alloc(width * height * 3);
      for (let i = 0; i < width * height; i++) {
        raw[i * 3] = bg[0];
        raw[i * 3 + 1] = bg[1];
        raw[i * 3 + 2] = bg[2];
      }
      // 深色人形，形状完全正常——问题不在角色，在底色
      for (let y = 20; y < 280; y++) {
        for (let x = 40; x < 160; x++) {
          const o = (y * width + x) * 3;
          raw[o] = 40;
          raw[o + 1] = 50;
          raw[o + 2] = 80;
        }
      }
      const image = await sharp(raw, { raw: { width, height, channels: 3 } }).png().toBuffer();
      await expect(cutout(image), `${name}底应当被体检拦下`).rejects.toThrow(/不是色键色/);
    }
  });

  it("色键底照常放行：纯绿与纯品红都不该被体检误伤", async () => {
    const width = 200;
    const height = 300;
    for (const bg of [
      [0, 255, 0],
      [255, 0, 255],
    ] as const) {
      const raw = Buffer.alloc(width * height * 3);
      for (let i = 0; i < width * height; i++) {
        raw[i * 3] = bg[0];
        raw[i * 3 + 1] = bg[1];
        raw[i * 3 + 2] = bg[2];
      }
      for (let y = 20; y < 280; y++) {
        for (let x = 40; x < 160; x++) {
          const o = (y * width + x) * 3;
          raw[o] = 40;
          raw[o + 1] = 50;
          raw[o + 2] = 80;
        }
      }
      const image = await sharp(raw, { raw: { width, height, channels: 3 } }).png().toBuffer();
      const result = await cutout(image);
      expect(await alphaAt(result.data, 2, 2)).toBe(0);
    }
  });

});

/** 纯绿色键底 + 一个站立人形。fillW/fillH 是人物占格的比例：模型在矮格子里会把人撑得又宽又矮。 */
async function standing(w: number, h: number, fillW = 0.36, fillH = 0.9): Promise<Buffer> {
  const raw = Buffer.alloc(w * h * 3);
  const bw = Math.round(w * fillW);
  const top = Math.round(h * (1 - fillH) / 2);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const o = (y * w + x) * 3;
      const inBody = x > (w - bw) / 2 && x < (w + bw) / 2 && y > top && y < top + Math.round(h * fillH);
      raw[o] = inBody ? 50 : 0;
      raw[o + 1] = inBody ? 60 : 255;
      raw[o + 2] = inBody ? 120 : 0;
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

  it("边缘带里的深色描线不许被反解穿成孔", async () => {
    // 反解带放宽到 8px 之后，带内像素全靠闭式解 a=(B−I)/(B−F)。但抗锯齿渐变带里
    // 常常混着前景自己的深色线条（银发描线、衣褶），观测值会越过 F——覆盖率不可能
    // 超过 100%，那不是覆盖率是实打实的内容，硬解会把它解成 0 直接穿孔。
    // 判据：越过 F 的通道当噪声丢掉（还剩别的通道就继续解），三路都越界才认输。
    const width = 200;
    const height = 300;
    const BG: [number, number, number] = [0, 255, 0];
    const FG: [number, number, number] = [60, 70, 120];
    const raw = Buffer.alloc(width * height * 3);
    for (let i = 0; i < width * height; i++) {
      raw[i * 3] = BG[0];
      raw[i * 3 + 1] = BG[1];
      raw[i * 3 + 2] = BG[2];
    }
    for (let y = 20; y < 280; y++) {
      for (let x = 40; x < 160; x++) {
        const o = (y * width + x) * 3;
        // 前景深色主体，右缘一条 1px 的近黑描线，再往右是 8px 的渐变带（前景 → 底色）
        raw[o] = FG[0];
        raw[o + 1] = FG[1];
        raw[o + 2] = FG[2];
        if (x >= 156) {
          const a = (x - 155) / 9;
          raw[o] = Math.round(FG[0] + (BG[0] - FG[0]) * a);
          raw[o + 1] = Math.round(FG[1] + (BG[1] - FG[1]) * a);
          raw[o + 2] = Math.round(FG[2] + (BG[2] - FG[2]) * a);
        }
        // 描线：比前景还深，覆盖率算出来是负数
        if (x === 155) {
          raw[o] = 20;
          raw[o + 1] = 25;
          raw[o + 2] = 40;
        }
      }
    }
    const image = await sharp(raw, { raw: { width, height, channels: 3 } }).png().toBuffer();
    const result = await cutout(image);
    const { data: out, info } = await sharp(result.data).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    const box = { x0: 40, y0: 20, x1: 159, y1: 279 };
    const scale = Math.min(1080 / (box.x1 - box.x0 + 1), 1920 / (box.y1 - box.y0 + 1));
    const left = Math.round((1080 - Math.round((box.x1 - box.x0 + 1) * scale)) / 2);
    const top = 1920 - Math.round((box.y1 - box.y0 + 1) * scale);
    const alphaAtSource = (sx: number, sy: number): number => {
      const px = Math.round(left + (sx - box.x0) * scale);
      const py = Math.round(top + (sy - box.y0) * scale);
      return out[(py * info.width + px) * info.channels + 3] ?? 0;
    };
    // 描线两侧的主体必须还是实心，不能因为它越界就把整条边吃掉
    expect(alphaAtSource(150, 150)).toBe(255);
    expect(alphaAtSource(130, 150)).toBe(255);
    // 描线自己也不该是全透明
    expect(alphaAtSource(155, 150)).toBeGreaterThan(128);
  });
});

describe("细描边：压在轮廓上的黑色描边必须留住", () => {
  /**
   * 纯绿底 + 浅色人形，边缘只压 **1 像素**深色描边，再走一遍 JPEG（模型回来的就是 JPEG）。
   * 1px 是要害：它比反解带宽（4px）还窄，`foregroundColors` 的 BFS 够不到它，
   * 前景色 F 只能取到描边内侧的填充色。混合模型于是把这个深色描边解成
   * 「覆盖率 0.1 的底色」，`unblend` 再把它整块换成填充色——整圈黑描边消失。
   * 实测（真实立绘）：轮廓内侧 2px 的平均亮度 32 → 187，肉眼就是「描边被抠掉了」。
   */
  async function hairlineOutline(): Promise<Buffer> {
    const w = 200;
    const h = 300;
    const raw = Buffer.alloc(w * h * 3);
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const o = (y * w + x) * 3;
        const inFigure = x >= 60 && x <= 140 && y >= 60 && y <= 240;
        const inCore = x >= 61 && x <= 139 && y >= 61 && y <= 239;
        const c: [number, number, number] = !inFigure ? [0, 255, 0] : inCore ? [235, 235, 240] : [25, 28, 35];
        raw[o] = c[0];
        raw[o + 1] = c[1];
        raw[o + 2] = c[2];
      }
    }
    return sharp(raw, { raw: { width: w, height: h, channels: 3 } }).jpeg({ quality: 92 }).toBuffer();
  }

  it("中线进入人物的头几个不透明像素是描边（深色），不是被换成的填充色", async () => {
    const result = await cutout(await hairlineOutline());
    const { data, info } = await sharp(result.data).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    const y = Math.round(info.height * 0.45);
    const luminance = (x: number): number => {
      const p = (y * info.width + x) * 4;
      return 0.299 * data[p]! + 0.587 * data[p + 1]! + 0.114 * data[p + 2]!;
    };
    const edge: number[] = [];
    for (let x = 0; x < info.width && edge.length < 3; x++) {
      if ((data[(y * info.width + x) * 4 + 3] ?? 0) >= 128) edge.push(x);
    }
    expect(edge).toHaveLength(3);
    const mean = (edge.map(luminance).reduce((a, b) => a + b, 0)) / edge.length;
    // 描边 Lt≈29、填充色 Lt≈236：取中间当门槛，用均值挡掉单像素抖动
    expect(mean).toBeLessThan(120);
  });

  it("边缘仍是灰阶斜坡，没有被压成硬边", async () => {
    const result = await cutout(await hairlineOutline());
    const { data, info } = await sharp(result.data).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    let partial = 0;
    for (let i = 0; i < info.width * info.height; i++) {
      const a = data[i * 4 + 3]!;
      if (a > 8 && a < 248) partial++;
    }
    // 一整圈轮廓的过渡带：数量级在几千，绝不是一个「全有或全无」的硬掩膜
    expect(partial).toBeGreaterThan(500);
  });
});
