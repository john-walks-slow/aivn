import sharp from "sharp";

/**
 * 立绘表情 sheet：一次调用出一整套差分。
 *
 * 和「拿定妆照当垫图」是互补的两条路：sheet 里角色的发色/瞳色/服装/光照天然一致，一张图出好几张；
 * 垫图只改表情描述词，细节和表情张力更足，但每张单独调。所以 sheet 出整套打底，垫图留给高分辨率
 * 精修和后续新增差分——用户已经有一套表情了，今天临时想再加第七个，不可能为了它重出一整张 sheet。
 */

/** 一次面板排布好之后的结果。提示词和切格共用它，两边不可能再对不上。 */
export interface SheetPlan {
  /** 实际要画的差分名（含补位的 neutral），从左到右、从上到下。 */
  expressions: string[];
  cols: number;
  rows: number;
}

/**
 * 标准制式：2 列 × 1 行 = 2 格，2 列 × 2 行 = 4 格。只有这两种。
 *
 * 为什么列数钉死 2：9:16 原图 768x1376，2 列时单格宽 384。列数越多单格越窄，模型画不出表情。
 *
 * 为什么行数不超过 2——这是立绘质量的硬天花板，跟缩放无关，跟「脸画不画得清」有关：
 * 全身像头身比约 1:7.5，头部像素 = 人物高 ÷ 7.5。
 *   2x1 单格 384x1376 → 头约 183px，够；
 *   2x2 单格 384x688  → 头约  92px，勉强；
 *   2x3 单格 384x458  → 头约  61px，笑了跟没笑看不出差别。
 * 另外 2x3 的单格 384x458 长宽比 0.838 超过画布的 9/16=0.5625，抠底等比缩放时变成宽度先卡，
 * 人物只到 1287px 高，比 2x2 版本的矮三分之一——同一角色两种身高。
 */
const FORMAT_2X1 = { cols: 2, rows: 1, cells: 2 };
const FORMAT_2X2 = { cols: 2, rows: 2, cells: 4 };

/** 一次面板最多几格（= 最大制式）。超了要分多次调用。 */
export const SHEET_MAX = FORMAT_2X2.cells;

/** 补位用的差分名，按顺序挑第一个用户没点名的，免得出现两个 neutral。 */
const FILLER = ["neutral", "calm", "serious", "soft"];

/**
 * 把用户要的差分补齐到标准制式。
 *
 * 补位是必须的：格子空着不给名字，模型会自己发挥，把整张面板的画风带偏。补出来的名字对每个角色
 * 都有用（neutral 是定妆照，后面还能当垫图锚点），不亏。FILLER 四个名字够补满最大制式。
 */
export function planSheet(requested: string[]): SheetPlan {
  const expressions = [...new Set(requested.map((name) => name.trim()).filter(Boolean))];
  if (expressions.length === 0) throw new Error("至少要给一个差分名");
  if (expressions.length > SHEET_MAX) {
    throw new Error(`一次最多 ${SHEET_MAX} 个差分（收到 ${expressions.length} 个）：格子制式最大 2x2，再多模型在单格里画不清脸。分两次调用。`);
  }
  const format = expressions.length <= FORMAT_2X1.cells ? FORMAT_2X1 : FORMAT_2X2;
  const used = new Set(expressions.map((name) => name.toLowerCase()));
  while (expressions.length < format.cells) {
    const filler = FILLER.find((name) => !used.has(name));
    if (!filler) throw new Error("内部错误：补位名用尽，格子制式和 FILLER 对不上");
    expressions.push(filler);
    used.add(filler);
  }
  return { expressions, cols: format.cols, rows: format.rows };
}

export interface SheetCell {
  data: Buffer;
  width: number;
  height: number;
}

export interface SheetPromptInput {
  /** 角色外观描述（发色、瞳色、服装、体型）。 */
  character: string;
  /** planSheet 排好的制式。 */
  plan: SheetPlan;
  /** 画风锚点（可选）。不给就是「跟随用户描述」。 */
  style?: string;
}

/**
 * 面板提示词。要求点：
 * - 明确网格与「从左到右、从上到下」的对应关系，否则模型自由排列，切出来对不上差分名；
 * - 同一角色、同一姿势、同一机位，只改表情——sheet 的全部价值就在这里；
 * - 纯色底，否则逐格抠底会失败。
 */
export function sheetPrompt(input: SheetPromptInput): string {
  const { character, plan } = input;
  const { cols, rows, expressions } = plan;
  const style = input.style ? `${input.style}. ` : "";
  const cells = `${cols * rows} cells`;
  const order = ["Row 1", "Row 2"].slice(0, rows).join(", then ");
  return [
    `A ${cols}x${rows} character expression sheet of the same character, divided into ${cells} by thin invisible lines.`,
    `Character: ${character}.`,
    `Every cell shows the exact same character: identical hairstyle, hair color, eye color, outfit, body type, standing pose and camera angle. Every figure is full body, feet on the bottom edge of its cell, head at the same height in every cell. Only the facial expression differs.`,
    `${order} left to right, the ${cells} show these expressions in order: ${expressions.join(", ")}.`,
    `Do not draw any grid lines, borders, labels or text. Plain solid pure white background, no shadow, no gradient. ${style}`,
  ].join(" ");
}

/**
 * 切格。返回的格子按「从左到右、从上到下」排列，与提示词里的约定一致。
 * 格子边长不齐（模型没按网格出图）时按整除取，边缘余数并进最后一格，避免切出半个表情。
 */
export async function sliceSheet(data: Buffer, plan: SheetPlan): Promise<SheetCell[]> {
  const { cols, rows, expressions } = plan;
  const meta = await sharp(data).metadata();
  const width = meta.width ?? 0;
  const height = meta.height ?? 0;
  if (width < cols * 16 || height < rows * 16) throw new Error(`面板图太小（${width}x${height}），切不出 ${cols}x${rows} 格`);
  const cellW = Math.floor(width / cols);
  const cellH = Math.floor(height / rows);
  const cells: SheetCell[] = [];
  for (let i = 0; i < expressions.length; i++) {
    const c = i % cols;
    const r = Math.floor(i / cols);
    const left = c * cellW;
    const top = r * cellH;
    const w = c === cols - 1 ? width - left : cellW;
    const h = r === rows - 1 ? height - top : cellH;
    const buffer = await sharp(data).extract({ left, top, width: w, height: h }).png().toBuffer();
    cells.push({ data: buffer, width: w, height: h });
  }
  return cells;
}
