import sharp from "sharp";

/**
 * 立绘抠底层：把「纯色底 + 角色」的生图原片转成引擎能直接压在场景上的透明 PNG。
 *
 * 为什么必须有这一层：舞台把立绘当 `<img>` 直接叠在背景图上（`StageTheater.tsx`），
 * 不抠底就是一块不透明矩形挂在画面中央。demo 剧目里的立绘全是 32bit RGBA，
 * 工坊出的图若不带 alpha，等于把剧目资产约定改坏了。
 *
 * 算法（资产管线 worktree 已用 Python 验证过同一套做法，这里落成 TS，省掉 Python 运行时）：
 * 1. **边缘 flood fill** 判背景：从四边种子色出发容差漫延。比色键（要模型出绿幕）稳——
 *    模型的"纯色底"常带轻微渐变和压缩噪点，色键会啃掉角色身上的高光。
 * 2. **连通域保护**：背景只能从边界往里吃，不连通的区域一律保留。角色身上的白衬衫、牙齿、
 *    眼白即使颜色接近背景也不会被打穿——这正是全局二值化抠图在立绘上的经典硬伤。
 * 3. **边缘 alpha**：越靠近背景越透明（按与底色的色差），离背景够远的**内部像素一律不透明**，
 *    否则白衬衫会被自己的颜色吃掉。两条取最大值。
 * 4. **unpremultiply 去白边**：半透明边缘像素按 C = a·F + (1-a)·B 反解出 F，把渗进去的底色扣掉。
 *    不做这步，角色站在暗调场景上会镶一圈亮边。
 * 5. **落画布**：裁到人物外框、等比缩放、底部居中放进 9:16 画布，锚点 [0.5, 1.0]——
 *    引擎换表情时角色不会晃动。
 *
 * 抠不出干净结果就抛错，由调用方把原因回给模型重试，不落盘半残图。
 */

export interface CutoutResult {
  data: Buffer;
  width: number;
  height: number;
  /** 前景像素占比。过低说明底色判错（整张被判成背景），过高说明底没抠干净。 */
  coverage: number;
  /**
   * 人物落在画布上的实际高度。**同一个角色不管出自哪一批差分，这个值都必须一样**——
   * 不一样就说明那批的面板格子太矮，模型只能把人物画矮了。低于画布高就说明格制式选错了。
   */
  figureHeight: number;
}

export interface CutoutOptions {
  /** 目标画布高（宽按 9:16 推）。 */
  canvasHeight?: number;
  /** 与种子色的最大通道差，0–1。 */
  tolerance?: number;
}

const CANVAS_HEIGHT = 1920;
const CANVAS_WIDTH = 1080;
const TOLERANCE = 0.16;
/** 与底色的色差小于此值即视为全透明。 */
const EDGE = 0.12;
/** 距背景这么远以内的像素算「边缘」，更远的算「内部」。 */
const INTERIOR = 2;
const COVERAGE_MIN = 0.02;
const COVERAGE_MAX = 0.97;

export async function cutout(data: Buffer, options: CutoutOptions = {}): Promise<CutoutResult> {
  const canvasHeight = options.canvasHeight ?? CANVAS_HEIGHT;
  const canvasWidth = Math.round((canvasHeight * 9) / 16);
  const { data: rgba, info } = await sharp(data).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const { width, height, channels } = info;
  if (width < 8 || height < 8) throw new Error("图太小，抠底没有意义");

  const mask = backgroundMask(rgba, width, height, channels, options.tolerance ?? TOLERANCE);
  const coverage = countForeground(mask) / (width * height);
  if (coverage < COVERAGE_MIN || coverage > COVERAGE_MAX) {
    throw new Error(
      coverage < COVERAGE_MIN
        ? "抠底失败：几乎整张图都被判成背景（底色可能不是纯色，或者图里根本没有角色）"
        : "抠底失败：底色没抠干净，角色四周还剩一圈背景（要求模型出「纯白或纯绿纯色底、无渐变无投影」）",
    );
  }

  const bg = backgroundColor(rgba, mask, channels);
  const alpha = edgeAlpha(rgba, mask, width, height, channels, bg);
  const out = unblend(rgba, alpha, width, height, channels, bg);

  const box = foregroundBounds(alpha, width, height);
  if (!box) throw new Error("抠底失败：没有找到角色轮廓");
  const figure = await sharp(out, { raw: { width, height, channels: 4 } })
    .extract(box)
    .png()
    .toBuffer();
  // 缩放：等比塞进画布，哪个维度先卡住就由哪个决定人物大小。
  // 因此「人物最终多高」取决于外框的长宽比——外框越胖，人物越矮。
  // 单格制式（2 列 × ≤2 行）保证外框比 ≤ 0.558 < 画布的 0.5625，高度永远先卡，
  // 人物恒为满高；一旦用 2x3 这种矮格，外框比 0.838 就会反过来由宽度卡，高度掉到 1287。
  const scale = Math.min(canvasWidth / box.width, canvasHeight / box.height);
  const scaled = await sharp(figure)
    .resize({
      width: Math.max(1, Math.round(box.width * scale)),
      height: Math.max(1, Math.round(box.height * scale)),
      fit: "fill",
      background: "#00000000",
    })
    .png()
    .toBuffer();
  const meta = await sharp(scaled).metadata();
  const canvas = await sharp({
    create: { width: canvasWidth, height: canvasHeight, channels: 4, background: "#00000000" },
  })
    .composite([
      {
        input: scaled,
        left: Math.round((canvasWidth - (meta.width ?? canvasWidth)) / 2),
        top: canvasHeight - (meta.height ?? canvasHeight),
      },
    ])
    .png()
    .toBuffer();

  return {
    data: canvas,
    width: canvasWidth,
    height: canvasHeight,
    coverage,
    figureHeight: Math.round(box.height * scale),
  };
}

/**
 * 背景掩膜：1 = 背景，0 = 前景。从四边种子色出发做容差 flood fill。
 * 显式栈而非递归——百万像素的图递归会爆栈。
 */
function backgroundMask(
  rgba: Buffer,
  width: number,
  height: number,
  channels: number,
  tolerance: number,
): Uint8Array {
  const mask = new Uint8Array(width * height);
  const limit = Math.round(tolerance * 255);
  const stack: number[] = [];

  const near = (i: number, r: number, g: number, b: number): boolean => {
    const o = i * channels;
    return (
      Math.abs((rgba[o] ?? 0) - r) <= limit &&
      Math.abs((rgba[o + 1] ?? 0) - g) <= limit &&
      Math.abs((rgba[o + 2] ?? 0) - b) <= limit
    );
  };

  for (const [x, y] of borderPoints(width, height)) {
    const i = y * width + x;
    const o = i * channels;
    const r = rgba[o] ?? 0;
    const g = rgba[o + 1] ?? 0;
    const b = rgba[o + 2] ?? 0;
    if (mask[i] === 1 || !near(i, r, g, b)) continue;
    mask[i] = 1;
    stack.push(i);
  }

  while (stack.length > 0) {
    const i = stack.pop()!;
    const x = i % width;
    const y = (i - x) / width;
    const o = i * channels;
    const r = rgba[o] ?? 0;
    const g = rgba[o + 1] ?? 0;
    const b = rgba[o + 2] ?? 0;
    const visit = (nx: number, ny: number) => {
      if (nx < 0 || ny < 0 || nx >= width || ny >= height) return;
      const ni = ny * width + nx;
      if (mask[ni] === 1 || !near(ni, r, g, b)) return;
      mask[ni] = 1;
      stack.push(ni);
    };
    visit(x + 1, y);
    visit(x - 1, y);
    visit(x, y + 1);
    visit(x, y - 1);
  }
  return mask;
}

function borderPoints(width: number, height: number): Array<[number, number]> {
  const midX = Math.floor(width / 2);
  const midY = Math.floor(height / 2);
  return [
    [0, 0],
    [midX, 0],
    [width - 1, 0],
    [0, midY],
    [width - 1, midY],
    [0, height - 1],
    [midX, height - 1],
    [width - 1, height - 1],
  ];
}

function countForeground(mask: Uint8Array): number {
  let n = 0;
  for (const v of mask) if (v === 0) n++;
  return n;
}

/** 底色估计：被判为背景的像素取均值。 */
function backgroundColor(rgba: Buffer, mask: Uint8Array, channels: number): [number, number, number] {
  let r = 0;
  let g = 0;
  let b = 0;
  let n = 0;
  for (let i = 0; i < mask.length; i++) {
    if (mask[i] !== 1) continue;
    const o = i * channels;
    r += rgba[o] ?? 0;
    g += rgba[o + 1] ?? 0;
    b += rgba[o + 2] ?? 0;
    n++;
  }
  return n === 0 ? [255, 255, 255] : [r / n, g / n, b / n];
}

/** chamfer 距离变换：每个前景像素到最近背景像素的距离（以 INTERIOR 为上限）。 */
function distanceToBackground(mask: Uint8Array, width: number, height: number): Float32Array {
  const far = INTERIOR + 1;
  const dist = new Float32Array(width * height).fill(far);
  for (let i = 0; i < mask.length; i++) if (mask[i] === 1) dist[i] = 0;

  const diag = Math.SQRT2;
  const relax = (i: number, j: number, cost: number) => {
    const d = dist[j]! + cost;
    if (d < dist[i]!) dist[i] = d;
  };
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = y * width + x;
      if (x > 0) relax(i, i - 1, 1);
      if (y > 0) relax(i, i - width, 1);
      if (x > 0 && y > 0) relax(i, i - width - 1, diag);
      if (x < width - 1 && y > 0) relax(i, i - width + 1, diag);
    }
  }
  for (let y = height - 1; y >= 0; y--) {
    for (let x = width - 1; x >= 0; x--) {
      const i = y * width + x;
      if (x < width - 1) relax(i, i + 1, 1);
      if (y < height - 1) relax(i, i + width, 1);
      if (x < width - 1 && y < height - 1) relax(i, i + width + 1, diag);
      if (x > 0 && y < height - 1) relax(i, i + width - 1, diag);
    }
  }
  return dist;
}

/**
 * 边缘 alpha = 色差项 与 内部项 取大：
 * - 色差项：越接近底色越透明，负责抗锯齿边缘的柔和过渡；
 * - 内部项：离背景够远就是实心，否则白衬衫会被自己的颜色吃掉。
 */
function edgeAlpha(
  rgba: Buffer,
  mask: Uint8Array,
  width: number,
  height: number,
  channels: number,
  bg: [number, number, number],
): Uint8Array {
  const dist = distanceToBackground(mask, width, height);
  const alpha = new Uint8Array(width * height);
  for (let i = 0; i < mask.length; i++) {
    if (mask[i] === 1) continue;
    const o = i * channels;
    const colorDist =
      (Math.abs((rgba[o] ?? 0) - bg[0]) +
        Math.abs((rgba[o + 1] ?? 0) - bg[1]) +
        Math.abs((rgba[o + 2] ?? 0) - bg[2])) /
      (3 * 255);
    const byColor = Math.min(1, colorDist / EDGE);
    const byInterior = Math.min(1, dist[i]! / INTERIOR);
    alpha[i] = Math.round(255 * Math.max(byColor, byInterior));
  }
  return alpha;
}

/** C = a·F + (1-a)·B 反解出 F，把渗进边缘的底色扣掉。 */
function unblend(
  rgba: Buffer,
  alpha: Uint8Array,
  width: number,
  height: number,
  channels: number,
  bg: [number, number, number],
): Buffer {
  const out = Buffer.alloc(width * height * 4);
  for (let i = 0; i < alpha.length; i++) {
    const a = alpha[i]!;
    if (a === 0) continue;
    const o = i * channels;
    const k = a >= 255 ? 0 : (255 - a) / a;
    for (let c = 0; c < 3; c++) {
      const observed = rgba[o + c] ?? 0;
      out[i * 4 + c] = Math.max(0, Math.min(255, Math.round(observed - k * (bg[c] ?? 0))));
    }
    out[i * 4 + 3] = a;
  }
  return out;
}

/** 人物外框（alpha > 0 的范围），留 1px 余量免得削掉描边。 */
function foregroundBounds(
  alpha: Uint8Array,
  width: number,
  height: number,
): { left: number; top: number; width: number; height: number } | null {
  let left = width;
  let top = height;
  let right = -1;
  let bottom = -1;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (alpha[y * width + x] === 0) continue;
      if (x < left) left = x;
      if (x > right) right = x;
      if (y < top) top = y;
      if (y > bottom) bottom = y;
    }
  }
  if (right < 0) return null;
  const pad = 1;
  left = Math.max(0, left - pad);
  top = Math.max(0, top - pad);
  right = Math.min(width - 1, right + pad);
  bottom = Math.min(height - 1, bottom + pad);
  return { left, top, width: right - left + 1, height: bottom - top + 1 };
}
