import sharp from "sharp";

/**
 * 立绘抠底层：把「纯色底 + 角色」的生图原片转成引擎能直接压在场景上的透明 PNG。
 *
 * 为什么必须有这一层：舞台把立绘当 `<img>` 直接叠在背景图上（`StageTheater.tsx`），
 * 不抠底就是一块不透明矩形挂在画面中央。demo 剧目里的立绘全是 32bit RGBA，
 * 工坊出的图若不带 alpha，等于把剧目资产约定改坏了。
 *
 * 算法五步，每步都对着 2026-09-29 柚子社四角色真图（768x1376 纯白底）量过：
 * 1. **底色 = 整圈边框的逐通道中位数**。不能用均值（角落水印会拽偏），
 *    也不能只取几个角上的种子点——两个角各自被角色/描边污染时，中位数会落在两个白之间
 *   的 `(253,255,254)` 这种假色上，于是容差怎么调都抠不动（实测阈值 1 只抠掉 0.3%）。
 *   整圈取中位数后三张图都精确回到 `RGB(255,255,255)`。
 * 2. **全局色键**，不是邻接比色。邻接比色每步拿上一个像素当基准，会沿长路径逐格漂移，
 *   漂移版实测把前景吃到 0.1~2.2%，直接触发「几乎整张图都被判成背景」。
 * 3. **滞后阈值**：强阈值（默认 1/255）确定「一定是底色」的种子，从种子沿 8 邻域
 *   在弱阈值（默认 8/255）内漫延。孤立的白衬衫/眼白碰不到种子就保住，
 *   轮廓上那圈压缩出来的近白杂边则跟着底色一起走——单阈值做不到这个分离。
 *   实测 2D 图上贴边近白残留 3605px → 13px，代价是 16px（0.003%）误抠。
 * 4. **连通域筛背景**：只有贴画面边、或面积 ≥ `minHole` 的块算真背景。
 *   面积小的填回前景——眼白高光、牙缝靠这条救回来，而发丝间/袖腋下的真空隙
 *   （实测 9951 / 9941px）照抠。`minHole` 调小 = 抠得更狠。
 * 5. **只留最大前景连通域**，再落画布：裁到人物外框、等比缩放、底部居中放进 9:16 画布，
 *   锚点 [0.5, 1.0]——引擎换表情时角色不会晃动。
 *
 * 抠不出干净结果就抛错，由调用方把原因回给模型重试，不落盘半残图。
 *
 * **调用方必须传原始下载字节，不要先过一遍 sharp 重编码。** 后端回来的是 JPEG 时，
 * 二次编码会重新抖一遍轮廓：同一张图误抠从 0.003%（16px）涨到 0.455%（2107px）。
 * 算法本身没错，错的是喂进来的像素。
 *
 * 已知天花板：源图轮廓上**没有半透明过渡带**（实测 255 直接跳到深色），
 * 所以阶梯状锯齿是模型画出来的，算法无从软化；形态学平滑实测反而把 1px 缺口从 3385 推到 4419。
 * 真要解只有提高出图分辨率。
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

/** 抠底调参。数值都是 0–255 的通道色差，不是比例——比色时直接用整数比较。 */
export interface CutoutOptions {
  /** 目标画布高（宽按 9:16 推）。 */
  canvasHeight?: number;
  /** 强阈值：与底色的通道差小于它就算「确定是底色」，点着它当漫延种子。调大 = 抠得更狠。 */
  strong?: number;
  /** 弱阈值：种子沿 8 邻域在此范围内漫延。调大 = 顺着轮廓多啃几像素，毛边更干净。 */
  weak?: number;
  /** 背景连通域小于此面积就填回前景。调大 = 抠得更保守（眼白高光会被护回来）。 */
  minHole?: number;
}

/** 抠底调参的默认值。可被单次调用覆盖，也可用环境变量改全局（工坊 agent 出图看情况可调）。 */
export interface CutoutTuning {
  strong: number;
  weak: number;
  minHole: number;
}

const CANVAS_HEIGHT = 1920;
const CANVAS_WIDTH = 1080;
/** 距背景这么远以内的像素进反解，更远的直接算实心。 */
const FG_DIST = 2;
const COVERAGE_MIN = 0.02;
const COVERAGE_MAX = 0.97;

function envInt(name: string, fallback: number, min: number, max: number): number {
  const parsed = Number(process.env[name]);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, Math.round(parsed)));
}

/** 强 1 / 弱 8 / 洞 200：2D 平涂图上 0.003% 误抠、贴边近白残留 13px。弱阈值再往上就啃和服了（12 → 0.968%）。 */
export function defaultTuning(): CutoutTuning {
  return {
    // 1 不是 0：底色带一格压缩噪点时，0 会让一个种子都点不着，直接报「底色没抠干净」
    strong: envInt("STAGE_CUTOUT_STRONG", 1, 0, 32),
    weak: envInt("STAGE_CUTOUT_WEAK", 8, 0, 64),
    minHole: envInt("STAGE_CUTOUT_MIN_HOLE", 200, 0, 100_000),
  };
}

/** 单次覆盖与全局默认合并；弱阈值不得低于强阈值，否则滞后退化成单阈值。 */
export function resolveTuning(override?: Partial<CutoutTuning>): CutoutTuning {
  const base = defaultTuning();
  const merged = { ...base, ...override };
  return { ...merged, weak: Math.max(merged.strong, merged.weak) };
}

export async function cutout(data: Buffer, options: CutoutOptions = {}): Promise<CutoutResult> {
  const canvasHeight = options.canvasHeight ?? CANVAS_HEIGHT;
  const canvasWidth = Math.round((canvasHeight * 9) / 16);
  const { data: rgba, info } = await sharp(data).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const { width, height, channels } = info;
  if (width < 8 || height < 8) throw new Error("图太小，抠底没有意义");

  const tuning = resolveTuning(options);
  const mask = backgroundMask(rgba, width, height, channels, tuning);
  const coverage = countForeground(mask) / (width * height);
  if (coverage < COVERAGE_MIN || coverage > COVERAGE_MAX) {
    // 带上实测值：只说「几乎整张图」没法判断是底色没抠对还是角色没画出来。
    const pct = (coverage * 100).toFixed(1);
    throw new Error(
      coverage < COVERAGE_MIN
        ? `抠底失败：只认出 ${pct}% 的前景（要求 ≥${COVERAGE_MIN * 100}%），底色可能不是纯色，或者图里根本没有角色`
        : `抠底失败：${pct}% 的像素被判成前景，底色没抠干净（要求 ≤${COVERAGE_MAX * 100}%；要求模型出「纯白纯色底、无渐变无投影」）`,
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
 * 背景掩膜：1 = 背景，0 = 前景。全局色键 + 滞后阈值漫延 + 连通域筛除。
 * 显式栈而非递归——百万像素的图递归会爆栈。
 */
function backgroundMask(
  rgba: Buffer,
  width: number,
  height: number,
  channels: number,
  tuning: CutoutTuning,
): Uint8Array {
  const total = width * height;
  const reference = borderMedian(rgba, width, height, channels);
  const { strong, weak, minHole } = tuning;

  const distance = new Uint8Array(total);
  for (let i = 0; i < total; i++) {
    const o = i * channels;
    distance[i] = Math.max(
      Math.abs((rgba[o] ?? 0) - reference[0]),
      Math.abs((rgba[o + 1] ?? 0) - reference[1]),
      Math.abs((rgba[o + 2] ?? 0) - reference[2]),
    );
  }

  // 强种子做漫延起点，弱集限制漫延范围；两者都不贴边就谁也吃不掉谁。
  const spread = new Uint8Array(total);
  const stack: number[] = [];
  for (let i = 0; i < total; i++) {
    if (distance[i]! > strong) continue;
    spread[i] = 1;
    stack.push(i);
  }
  while (stack.length > 0) {
    const i = stack.pop()!;
    const x = i % width;
    const y = (i - x) / width;
    const visit = (nx: number, ny: number) => {
      if (nx < 0 || ny < 0 || nx >= width || ny >= height) return;
      const ni = ny * width + nx;
      if (spread[ni] === 1 || distance[ni]! > weak) return;
      spread[ni] = 1;
      stack.push(ni);
    };
    visit(x + 1, y);
    visit(x - 1, y);
    visit(x, y + 1);
    visit(x, y - 1);
    visit(x + 1, y + 1);
    visit(x - 1, y + 1);
    visit(x + 1, y - 1);
    visit(x - 1, y - 1);
  }

  // 贴边或够大的块才是真背景；小块（眼白高光、牙缝）填回前景。
  const components = label(spread, width, height);
  const touchesEdge = new Uint8Array(components.sizes.length);
  for (let x = 0; x < width; x++) {
    touchesEdge[components.labels[x]!] = 1;
    touchesEdge[components.labels[(height - 1) * width + x]!] = 1;
  }
  for (let y = 0; y < height; y++) {
    touchesEdge[components.labels[y * width]!] = 1;
    touchesEdge[components.labels[y * width + width - 1]!] = 1;
  }
  const mask = new Uint8Array(total);
  for (let i = 0; i < total; i++) {
    if (spread[i] !== 1) continue;
    const id = components.labels[i]!;
    if (touchesEdge[id] === 1 || components.sizes[id]! >= minHole) mask[i] = 1;
  }

  keepLargestForeground(mask, width, height);
  return mask;
}

/** 整圈边框（上/下两行 + 左/右两列）的逐通道中位数。 */
function borderMedian(
  rgba: Buffer,
  width: number,
  height: number,
  channels: number,
): [number, number, number] {
  const ring: number[] = [];
  for (let x = 0; x < width; x++) ring.push(x, (height - 1) * width + x);
  for (let y = 0; y < height; y++) ring.push(y * width, y * width + width - 1);
  // 中位数而非均值：模型偶尔在角落留一小撮描边或水印，均值会被它拽偏。
  return [0, 1, 2].map((c) => {
    const sorted = ring.map((i) => rgba[i * channels + c] ?? 0).sort((a, b) => a - b);
    return sorted[sorted.length >> 1] ?? 0;
  }) as [number, number, number];
}

interface Components {
  labels: Int32Array;
  sizes: number[];
}

/** 4 连通域标号。labels 里 -1 表示不属于任何块。 */
function label(mask: Uint8Array, width: number, height: number): Components {
  const total = width * height;
  const labels = new Int32Array(total).fill(-1);
  const sizes: number[] = [];
  const stack = new Int32Array(total);
  for (let start = 0; start < total; start++) {
    if (mask[start] !== 1 || labels[start] !== -1) continue;
    const id = sizes.length;
    let top = 0;
    stack[top++] = start;
    labels[start] = id;
    let size = 0;
    while (top > 0) {
      const i = stack[--top]!;
      size++;
      const x = i % width;
      if (x + 1 < width && mask[i + 1] === 1 && labels[i + 1] === -1) {
        labels[i + 1] = id;
        stack[top++] = i + 1;
      }
      if (x > 0 && mask[i - 1] === 1 && labels[i - 1] === -1) {
        labels[i - 1] = id;
        stack[top++] = i - 1;
      }
      if (i + width < total && mask[i + width] === 1 && labels[i + width] === -1) {
        labels[i + width] = id;
        stack[top++] = i + width;
      }
      if (i >= width && mask[i - width] === 1 && labels[i - width] === -1) {
        labels[i - width] = id;
        stack[top++] = i - width;
      }
    }
    sizes.push(size);
  }
  return { labels, sizes };
}

/** 前景可能散成碎块（噪点、孤立的发梢），只留最大的一块，其余当背景。 */
function keepLargestForeground(mask: Uint8Array, width: number, height: number): void {
  const total = width * height;
  const foreground = new Uint8Array(total);
  for (let i = 0; i < total; i++) foreground[i] = mask[i] === 1 ? 0 : 1;
  const components = label(foreground, width, height);
  let main = -1;
  for (let id = 0; id < components.sizes.length; id++) {
    if (main < 0 || components.sizes[id]! > components.sizes[main]!) main = id;
  }
  if (main < 0) return;
  for (let i = 0; i < total; i++) {
    if (foreground[i] === 1 && components.labels[i] !== main) mask[i] = 1;
  }
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

/** chamfer 距离变换：每个前景像素到最近背景像素的距离（以 FG_DIST + 1 为上限）。 */
function distanceToBackground(mask: Uint8Array, width: number, height: number): Float32Array {
  const far = FG_DIST + 1;
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
 * 边缘 alpha = 逐像素反解出来的真实覆盖率。
 *
 * 底色 B 已知，合成方程 I = a·F + (1-a)·B 直接给出 a = (B-I)/(B-F)。
 * 这是纯色平涂底这个前提下的闭式解（文献里叫 color unmixing），不需要 trimap、不需要 GPU。
 *
 * 为什么非解不可：旧公式是 max(色差项, dist/INTERIOR)，而 dist/2 在边界带上恒等于 0.5，
 * 等于给每一圈边界像素垫了 128 的 alpha 地板。深色舞台底上那一圈半透明的边色
 * 就是一圈白边晕（用户实机看出来的主要瑕疵）。反解把这圈解成真实覆盖率——20% 就是 51，
 * 95% 就是 242——晕自然消失，边缘也变成连续的灰阶斜坡。
 *
 * 反解会移动 α=0.5 的等值线：旧公式里等值线严格等于二值掩膜，轮廓零漂移
 * （实测几何粗糙度 0.487，与源图逐位相同）；现在等值线跟着真实覆盖率走，
 * 实测 2d-a 0.487 / 60 0.474 / 61 0.457，源图分别是 0.487 / 0.482 / 0.459。
 * 也就是说**新的更贴近模型自己画的线稿**，而不是更毛——立绘边上的锯齿是模型在
 * 768px 上画的线再被 1.406 倍放大到 1080 显出来的，压它只能提高出图分辨率。
 *
 * F 由 `foregroundColors` 沿 BFS 逐像素传播，不能取全局中位数：立绘有白衣，
 * 白衣最外圈恰好就是白底，环带中位数被拽向底色，B−F → 0，整张图的反解全废
 * （实测毛刺不降反升 13%）。分母 B−F 也可能接近 0（白发压在白底上），
 * 所以逐通道只保留能分开前景底色的那一路，最差退回距离斜坡。
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
  const fg = foregroundColors(rgba, mask, dist, width, height, channels);
  const alpha = new Uint8Array(width * height);
  for (let i = 0; i < mask.length; i++) {
    if (mask[i] === 1) continue;
    // 离背景够远 = 实心，直接 255，不再进解方程（白发、皮肤这些亮色也保得住）
    if (dist[i]! >= FG_DIST) {
      alpha[i] = 255;
      continue;
    }
    const p = i * channels, q = i * 3;
    const ratio = solveAlpha(
      rgba[p] ?? 0,
      rgba[p + 1] ?? 0,
      rgba[p + 2] ?? 0,
      bg,
      [fg[q]!, fg[q + 1]!, fg[q + 2]!],
    );
    alpha[i] = ratio === null ? Math.round(255 * (dist[i]! / FG_DIST)) : Math.round(255 * ratio);
  }
  return alpha;
}

/**
 * 前景色 F：沿 BFS 从最近的「确定前景」像素（离背景 ≥ FG_DIST）传播过来。
 *
 * 不能用全局中位数：立绘有白衣，而白衣最外圈恰好就是白底，环带中位数会被拽向白底，
 * 分母 B−F 归零、整张图的反解全废。逐像素取「最近确定前景」才能让白衬衫边缘解出白、
 * 发梢边缘解出深色。-1 = 还没访问到。
 */
function foregroundColors(
  rgba: Buffer,
  mask: Uint8Array,
  dist: Float32Array,
  width: number,
  height: number,
  channels: number,
): Int16Array {
  const out = new Int16Array(width * height * 3).fill(-1);
  const queue = new Int32Array(width * height);
  let head = 0;
  let tail = 0;
  for (let i = 0; i < mask.length; i++) {
    if (dist[i]! < FG_DIST) continue;
    const p = i * channels;
    const q = i * 3;
    out[q] = rgba[p] ?? 0;
    out[q + 1] = rgba[p + 1] ?? 0;
    out[q + 2] = rgba[p + 2] ?? 0;
    queue[tail++] = i;
  }
  const visit = (i: number): void => {
    if (out[i * 3]! >= 0) return;
    const from = queue[head]! * 3;
    out[i * 3] = out[from]!;
    out[i * 3 + 1] = out[from + 1]!;
    out[i * 3 + 2] = out[from + 2]!;
    queue[tail++] = i;
  };
  while (head < tail) {
    const i = queue[head]!;
    const x = i % width;
    const y = (i - x) / width;
    if (x > 0) visit(i - 1);
    if (x < width - 1) visit(i + 1);
    if (y > 0) visit(i - width);
    if (y < height - 1) visit(i + width);
    head++;
  }
  return out;
}

/**
 * 闭式解 a = (B−I)/(B−F)。返回 0..1 的**比例**（调用方负责乘 255）。
 *
 * 只用能分开前景底色的通道：B 和 F 几乎同色的那一路分母太小，除出来的 α 噪声极大。
 * 三路都还能用就取中位数挡单通道离群。B−F 全体都小到没有意义时返回 null，让调用方退回距离斜坡。
 */
function solveAlpha(
  r: number,
  g: number,
  b: number,
  bg: [number, number, number],
  fg: [number, number, number],
): number | null {
  const observed = [r, g, b];
  const spans = [0, 0, 0];
  let best = -1;
  let bestSpan = 0;
  for (let c = 0; c < 3; c++) {
    spans[c] = Math.abs(bg[c]! - fg[c]!);
    if (spans[c]! > bestSpan) {
      bestSpan = spans[c]!;
      best = c;
    }
  }
  if (best < 0 || bestSpan < 2) return null;
  const samples: number[] = [];
  for (let c = 0; c < 3; c++) {
    if (spans[c]! < bestSpan * 0.34) continue;
    samples.push((bg[c]! - observed[c]!) / spans[c]!);
  }
  if (samples.length === 0) return null;
  samples.sort((x, y) => x - y);
  const median = samples[samples.length >> 1]!;
  return Math.max(0, Math.min(1, median));
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
