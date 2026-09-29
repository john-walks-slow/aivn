import sharp from "sharp";

/**
 * 立绘表情 sheet：一次调用出一整套差分。
 *
 * 为什么有两条范式：单图 2x3 表情面板裁切，同一次推理里角色的发色/瞳色/服装/光照天然一致，
 * 一张图 15s 出 6 张；而「拿定妆照当垫图」只改表情描述词，细节和表情张力更足，但每张要单独调
 * （实测 100–140s/张）。所以 sheet 出全套打底，垫图留给高分辨率精修和后续新增差分——
 * 用户已经有一套表情了，今天临时想再加第七个，不可能为了它重出一整张 sheet。
 */

/** 一张 sheet 最多几格。2x3 面板在 9:16 原图上切下来每格只有 384x458，放大到 1080x1920 是 2.8 倍插值——所以这只是「不至于挤成一团」的上限，不是画质推荐值。真要高清就少出几格，或者改走垫图。 */
export const SHEET_MAX = 6;

export interface SheetCell {
  data: Buffer;
  width: number;
  height: number;
}

export interface SheetPromptInput {
  /** 角色外观描述（发色、瞳色、服装、体型）。 */
  character: string;
  /** 差分名，从左到右、从上到下依次对应。 */
  expressions: string[];
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
  const { character, expressions } = input;
  // 必须和 sliceSheet 走同一个 gridFor：提示词说的网格跟切格用的网格对不上，
  // 模型会照提示词画，切的时候就会切出半个表情或者凭空丢掉空格。
  const { cols, rows } = gridFor(expressions.length);
  const style = input.style ? `${input.style}. ` : "";
  return [
    `A ${cols}x${rows} character expression sheet of the same character, arranged in a neat grid.`,
    `Character: ${character}.`,
    `All panels show the exact same character: identical hairstyle, hair color, eye color, outfit, body type, pose and camera angle. Only the facial expression changes.`,
    `Row 1 left to right, then row 2 left to right, the ${expressions.length} panels are: ${expressions.join(", ")}.`,
    `Full body, front-facing standing pose, vertical portrait composition, ${style}plain solid pure white background, no text, no labels, no borders, no shadow, no gradient.`,
  ].join(" ");
}

/** 2x3 面板怎么摆。行数上限 3。 */
export function gridFor(count: number): { cols: number; rows: number } {
  if (count <= 2) return { cols: count, rows: 1 };
  return { cols: 2, rows: Math.ceil(count / 2) };
}

/**
 * 切格。返回的格子按「从左到右、从上到下」排列，与提示词里的约定一致。
 * 格子边长不齐（模型没按网格出图）时按整除取，边缘余数并进最后一格，避免切出半个表情。
 */
export async function sliceSheet(data: Buffer, count: number): Promise<SheetCell[]> {
  const { cols, rows } = gridFor(count);
  const meta = await sharp(data).metadata();
  const width = meta.width ?? 0;
  const height = meta.height ?? 0;
  if (width < cols * 16 || height < rows * 16) throw new Error(`面板图太小（${width}x${height}），切不出 ${cols}x${rows} 格`);
  const cellW = Math.floor(width / cols);
  const cellH = Math.floor(height / rows);
  const cells: SheetCell[] = [];
  for (let i = 0; i < count; i++) {
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
