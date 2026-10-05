import sharp from "sharp";

/**
 * 立绘抠底层：把「单一纯色底 + 角色」的生图原片转成引擎能直接压在场景上的透明 PNG。
 *
 * 为什么必须有这一层：舞台把立绘当 `<img>` 直接叠在背景图上（`StageTheater.tsx`），
 * 不抠底就是一块不透明矩形挂在画面中央。
 *
 * 底色由出图提示词指定成**一个不与角色配色重复的纯色**（`playAssets.ts` 的 `KEY_BACKGROUND`），
 * 所以抠底只按颜色来：离底色够近的像素一律算背景——不分内外、不看连通性、不管面积。
 * 「白衣服白袜子」那类与底色撞色的角色内容由**选底色**这一步挡掉，不再由算法去猜。
 * （2026-10-04 之前是白底 + 滞回阈值 + 连通域筛内外那一套，换成色键底之后整套删掉。）
 *
 * 算法四步：
 * 1. **底色 = 整圈边框的逐通道中位数**。不能用均值（角落水印会拽偏），也不能只取几个角上的
 *    种子点；整圈取中位数实测精确回到模型画的那片底色。
 * 2. **全局色键**：逐通道最大差 ≤ `tolerance` 的像素判成背景。不看连通性是必须的——
 *    底色本来就会出现在人物内部（腋下、腿间的真空隙），按连通性筛会整块漏掉
 *    （实测绿幕原片腿间残留 1477px）。
 * 3. **边缘 alpha 逐像素反解真实覆盖率**：底色 B 已知，合成方程 I = a·F + (1-a)·B 直接给出
 *    a = (B-I)/(B-F)。掩膜边界**两侧**各 `edgeBand` 像素都解一遍：纯底色解出 0，
 *    半覆盖解出中间值，边缘渗进去的底色被 `unblend` 扣掉。没有这一步，深色舞台底上
 *    就是一圈白边晕（旧公式给每圈边界像素垫了 128 的 alpha 地板）。
 * 4. **只留人物、落画布**：裁到人物外框、等比缩放、底部居中放进 9:16 画布，
 *    锚点 [0.5, 1.0]——引擎换表情时角色不会晃动。
 *
 * 反解与限色这两步管的是**颜色**不是抠得多狠：`tolerance` 才是抠得多狠的那个旋钮，
 * 调它会连发丝一起啃掉。想消掉边上的底色残留，走 `spill`，不要去拧 `tolerance`。
 *
 * 抠不出干净结果就抛错，由调用方把原因回给模型重试，不落盘半残图。
 *
 * **调用方必须传原始下载字节，不要先过一遍 sharp 重编码。** 后端回来的是 JPEG 时，
 * 二次编码会重新抖一遍轮廓，误抠面积翻百倍。算法本身没错，错的是喂进来的像素。
 *
 * 已知天花板：源图轮廓上**没有半透明过渡带**（实测 255 直接跳到深色），
 * 所以阶梯状锯齿是模型画出来的，算法无从软化；形态学平滑实测反而加重锯齿。
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
  /** 色键容差：逐通道最大差不超过它的像素一律算背景。调大 = 抠得更狠。 */
  tolerance?: number;
  /**
   * 喂给色键的那份副本的高斯模糊半径。源图是 JPEG，环纹伤的是掩膜的**轮廓形状**，
   * 不是像素颜色——所以色键在一张降噪副本上跑，alpha 仍在原图上解。0 = 不模糊。
   */
  keySmooth?: number;
  /** 反解带宽（像素）：掩膜边界两侧这么宽的像素逐个解覆盖率，更远的像素直接判实心或全透明。 */
  edgeBand?: number;
  /** 限色量：压掉边缘残存的底色。0 = 不限色。默认 20。 */
  spill?: number;
}

/** 抠底调参的默认值。可被单次调用覆盖，也可用环境变量改全局（工坊 agent 出图看情况可调）。 */
export interface CutoutTuning {
  tolerance: number;
  keySmooth: number;
  edgeBand: number;
  spill: number;
}

const CANVAS_HEIGHT = 1920;
const CANVAS_WIDTH = 1080;
const COVERAGE_MIN = 0.02;
const COVERAGE_MAX = 0.97;

function envInt(name: string, fallback: number, min: number, max: number): number {
  const parsed = Number(process.env[name]);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, Math.round(parsed)));
}

function envFloat(name: string, fallback: number, min: number, max: number): number {
  const parsed = Number(process.env[name]);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, parsed));
}

/**
 * 色键容差 48 / 掩膜降噪 0.8 / 反解带 4。
 *
 * 48 是在绿幕原片（底色 141,244,53）上量的拐点：容差不留残留的临界在 40 附近，
 * 再往上（48/56/64）实心残留恒为 0，只是多啃几像素边缘。
 * 底色是「选定的、不与角色撞的颜色」，容差给宽一点才是本意——抠不干净比多啃两像素糟。
 */
export function defaultTuning(): CutoutTuning {
  return {
    tolerance: envInt("STAGE_CUTOUT_TOLERANCE", 48, 0, 128),
    // 0.8：JPEG 环纹让色键在轮廓上啃出缺口。模糊把环纹抹平、轮廓位置几乎不动；
    // 只模糊喂给色键的副本，alpha 与原图颜色一律用原图。
    keySmooth: envFloat("STAGE_CUTOUT_KEY_SMOOTH", 0.8, 0, 8),
    // 4：抗锯齿渐变带连 JPEG 抖动实测 3–5px 宽。带子不够宽，落在带外的渐变像素被
    // 钉成实心 alpha，深色舞台底上就是一圈白块。也不能再放宽：分母小的浅色区
    // 被过度反解，反而解出更多洞。
    edgeBand: envInt("STAGE_CUTOUT_EDGE_BAND", 4, 1, 32),
    // 20：反解只能把覆盖率解准，解不出的那部分仍留着底色（绿幕上表现为绿边）。
    // 限色压的是**颜色**不是 alpha，所以发丝一根不少——调容差会连发丝一起啃掉，
    // 实测容差 48→128 不透明像素掉 2 万、绿残留反而从 2.3 万涨到 3 万。
    spill: envInt("STAGE_CUTOUT_SPILL", 20, 0, 255),
  };
}

export function resolveTuning(override?: Partial<CutoutTuning>): CutoutTuning {
  return { ...defaultTuning(), ...override };
}

export async function cutout(data: Buffer, options: CutoutOptions = {}): Promise<CutoutResult> {
  const canvasHeight = options.canvasHeight ?? CANVAS_HEIGHT;
  const canvasWidth = Math.round((canvasHeight * 9) / 16);
  const { data: rgba, info } = await sharp(data).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const { width, height, channels } = info;
  if (width < 8 || height < 8) throw new Error("图太小，抠底没有意义");

  const tuning = resolveTuning(options);
  // 掩膜与像素分开处理：环纹污染的是掩膜的**形状**（轮廓被啃出几段噪声台阶），
  // 不是像素颜色。所以色键吃一张降噪副本，alpha 与输出颜色一律用原图。
  const keyed =
    tuning.keySmooth > 0
      ? await sharp(rgba, { raw: { width, height, channels } }).blur(tuning.keySmooth).raw().toBuffer()
      : rgba;
  const mask = keyMask(keyed, width, height, channels, tuning.tolerance);
  const coverage = countForeground(mask) / (width * height);
  if (coverage < COVERAGE_MIN || coverage > COVERAGE_MAX) {
    // 带上实测值：只说「几乎整张图」没法判断是底色没抠对还是角色没画出来。
    const pct = (coverage * 100).toFixed(1);
    throw new Error(
      coverage < COVERAGE_MIN
        ? `抠底失败：只认出 ${pct}% 的前景（要求 ≥${COVERAGE_MIN * 100}%），底色可能不是纯色，或者图里根本没有角色`
        : `抠底失败：${pct}% 的像素被判成前景，底色没抠干净（要求 ≤${COVERAGE_MAX * 100}%；要求模型出「单一纯色底、无渐变无投影」，且底色不许与角色配色重复）`,
    );
  }

  const bg = backgroundColor(rgba, mask, channels);
  const { alpha, foreground } = edgeAlpha(rgba, mask, width, height, channels, bg, tuning.edgeBand);
  const out = unblend(rgba, alpha, foreground, width, height, channels, bg, tuning.spill);

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
 * 背景掩膜：1 = 背景，0 = 前景。全局色键，只看颜色。
 *
 * 没有连通域、没有面积阈值：底色是出图时选定的、不与角色撞色的纯色，
 * 所以「贴不贴画面边」不提供任何信息，人物内部的底色同样是底色。
 */
function keyMask(
  rgba: Buffer,
  width: number,
  height: number,
  channels: number,
  tolerance: number,
): Uint8Array {
  const reference = borderMedian(rgba, width, height, channels);
  const mask = new Uint8Array(width * height);
  for (let i = 0; i < mask.length; i++) {
    const o = i * channels;
    const distance = Math.max(
      Math.abs((rgba[o] ?? 0) - reference[0]),
      Math.abs((rgba[o + 1] ?? 0) - reference[1]),
      Math.abs((rgba[o + 2] ?? 0) - reference[2]),
    );
    if (distance <= tolerance) mask[i] = 1;
  }
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

/** chamfer 距离变换：每个像素到最近的 `seedValue` 像素的距离（以 band + 1 为上限）。 */
function bandDistance(
  mask: Uint8Array,
  width: number,
  height: number,
  band: number,
  seedValue: 0 | 1,
): Float32Array {
  const far = band + 1;
  const dist = new Float32Array(width * height).fill(far);
  for (let i = 0; i < mask.length; i++) if (mask[i] === seedValue) dist[i] = 0;

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
 * 掩膜边界**两侧**都解：前景一侧的渐变像素解出 60%、80%；背景一侧被色键吃掉的
 * 半覆盖像素解出真实覆盖率而不是 0——纯底色解出来自然就是 0，边界因此是连续的灰阶斜坡。
 *
 * 反解会移动 α=0.5 的等值线：旧公式里等值线严格等于二值掩膜，轮廓零漂移；
 * 现在等值线跟着真实覆盖率走，实测更贴近模型自己画的线稿。立绘边上的锯齿是模型在
 * 768px 上画的线再被放大到 1080 显出来的，压它只能提高出图分辨率。
 *
 * F 由 `foregroundColors` 沿 BFS 逐像素传播，不能取全局中位数：底色可能与角色某块颜色
 * 接近（选了撞色的底就是这么来的），全局中位数会被拽向底色，B−F → 0，整张图的反解全废。
 * 分母 B−F 也可能接近 0，所以逐通道只保留能分开前景底色的那一路，最差退回距离斜坡。
 */
function edgeAlpha(
  rgba: Buffer,
  mask: Uint8Array,
  width: number,
  height: number,
  channels: number,
  bg: [number, number, number],
  band: number,
): { alpha: Uint8Array; foreground: Int16Array } {
  const distToKey = bandDistance(mask, width, height, band, 1);
  const distToForeground = bandDistance(mask, width, height, band, 0);
  const fg = foregroundColors(rgba, mask, distToKey, width, height, channels, band);
  const alpha = new Uint8Array(width * height);
  for (let i = 0; i < mask.length; i++) {
    const keyed = mask[i] === 1;
    // 离对面够远 = 实心前景或纯底色，不再进解方程
    const distance = keyed ? distToForeground[i]! : distToKey[i]!;
    if (distance >= band) {
      alpha[i] = keyed ? 0 : 255;
      continue;
    }
    const p = i * channels;
    const q = i * 3;
    const ratio = solveAlpha(
      rgba[p] ?? 0,
      rgba[p + 1] ?? 0,
      rgba[p + 2] ?? 0,
      bg,
      [fg[q]!, fg[q + 1]!, fg[q + 2]!],
    );
    if (ratio !== null) alpha[i] = Math.round(255 * ratio);
    else alpha[i] = keyed ? 0 : Math.round(255 * (distance / band));
  }
  return { alpha, foreground: fg };
}

/**
 * 前景色 F：沿 BFS 从最近的「确定前景」像素（离底色 ≥ 带宽）传播过来。
 *
 * 不能用全局中位数：底色与角色某块颜色接近时，中位数会被拽向底色、分母归零，
 * 整张图的反解全废。逐像素取「最近确定前景」才能让深色描边边缘解出描边色、
 * 浅色边缘解出浅色。-1 = 还没访问到。
 */
function foregroundColors(
  rgba: Buffer,
  mask: Uint8Array,
  dist: Float32Array,
  width: number,
  height: number,
  channels: number,
  band: number,
): Int16Array {
  const out = new Int16Array(width * height * 3).fill(-1);
  const queue = new Int32Array(width * height);
  let head = 0;
  let tail = 0;
  for (let i = 0; i < mask.length; i++) {
    if (mask[i] === 1 || dist[i]! < band) continue;
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
  let bestSpan = 0;
  for (let c = 0; c < 3; c++) {
    spans[c] = Math.abs(bg[c]! - fg[c]!);
    if (spans[c]! > bestSpan) bestSpan = spans[c]!;
  }
  if (bestSpan < 2) return null;
  const samples: number[] = [];
  for (let c = 0; c < 3; c++) {
    if (spans[c]! < bestSpan * 0.34) continue;
    // 分母**带符号**（B−F），不能取绝对值：色键底的通道值常常低于前景
    // （绿底 #00FF00 的红蓝两路就比肤色低），取绝对值会把 a 的符号翻过来、
    // 解出负数后被 clamp 成 0，等于把带色的轮廓整圈啃掉。
    samples.push((bg[c]! - observed[c]!) / (bg[c]! - fg[c]!));
  }
  if (samples.length === 0) return null;
  samples.sort((x, y) => x - y);
  const median = samples[samples.length >> 1]!;
  return Math.max(0, Math.min(1, median));
}

/**
 * C = a·F + (1-a)·B 反解出 F，把渗进边缘的底色扣掉。
 *
 * 但反解式在低覆盖率处不可靠：a 越小 k=(1−a)/a 越大，`I + k·(I−B)` 会一路冲出 0–255。
 * 银发压绿幕、a≈0.33 时解出 (668,181,670) → clamp 成 (255,181,255)，整圈轮廓套上**品红光晕**。
 * 所以按覆盖率把两路结果混起来：a 越低越信邻近的实心前景色（`foreground`，反解用的同一个
 * BFS 传播结果），a 越高越信闭式解。混完之后有效增益被压在 1 以内，放大不出去了。
 */
function unblend(
  rgba: Buffer,
  alpha: Uint8Array,
  foreground: Int16Array,
  width: number,
  height: number,
  channels: number,
  bg: [number, number, number],
  spill: number,
): Buffer {
  const out = Buffer.alloc(width * height * 4);
  for (let i = 0; i < alpha.length; i++) {
    const a = alpha[i]!;
    if (a === 0) continue;
    const o = i * channels;
    const q = i * 3;
    const t = smoothstep(0.35, 0.85, a / 255);
    const k = a >= 255 ? 0 : (255 - a) / a;
    for (let c = 0; c < 3; c++) {
      const observed = rgba[o + c] ?? 0;
      // F = (I − (1−a)·B) / a = I + k·(I − B)，k = (1−a)/a。
      // 少了 I 那一项会得到 I − k·B：白底上看着差不多（B≈255 且前景也亮），
      // 换成绿底就是一层压不掉的绿边。
      const solved = clamp255(observed + k * (observed - (bg[c] ?? 0)));
      const neighbor = clamp255(foreground[q + c] ?? observed);
      out[i * 4 + c] = Math.round(t * solved + (1 - t) * neighbor);
    }
    out[i * 4 + 3] = a;
  }
  return despill(out, bg, spill);
}

/**
 * 限色：把还带着底色味道的那一路通道压到「这个像素另两路的较大值 + spill」以内。
 *
 * 反解只能解准覆盖率，解不准的像素颜色里仍然混着底色，直接输出就是一圈绿边（实测 2.3 万像素）。
 * 限色动的是**颜色不是 alpha**，所以发丝一根不少——这是它与调容差的本质区别。
 * 只动底色那一路（bg 的峰值通道）：另两路本来就没被底色染过。
 */
function despill(rgba: Buffer, bg: [number, number, number], spill: number): Buffer {
  if (spill <= 0) return rgba;
  let peak = 0;
  for (let c = 1; c < 3; c++) if (bg[c]! > bg[peak]!) peak = c;
  const rest = [0, 1, 2].filter((c) => c !== peak);
  for (let i = 0; i < rgba.length; i += 4) {
    const limit = Math.max(rgba[i + rest[0]!]!, rgba[i + rest[1]!]!) + spill;
    if (rgba[i + peak]! > limit) rgba[i + peak] = limit;
  }
  return rgba;
}

function clamp255(value: number): number {
  return Math.max(0, Math.min(255, Math.round(value)));
}

/** 两端平滑过渡的阶跃函数：把覆盖率过渡成「信闭式解」的比例。 */
function smoothstep(edge0: number, edge1: number, x: number): number {
  const t = Math.max(0, Math.min(1, (x - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
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
