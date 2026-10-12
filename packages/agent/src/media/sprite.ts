/**
 * 立绘入库前的**归一化**：把一张立绘图准备成「该取景的画布 + 固定顶留白 + 人物 95%」的透明 PNG，
 * 并回传两个落位指标（`figureTop` / `figureHeight`）。
 *
 * 为什么要有这一层：立绘能不能在舞台上摆正，靠的是一个不变量——
 * **画布比跟着该差分的 `framing`、顶部留白固定、人物缩到画布高的 95%**，指标落进素材表，
 * 舞台据此把头顶钉回 preset 的位置。这个不变量原先由六条写口各自负责（入库、抠底、资源库导入、
 * 素材页上传…），只有两条做对了，于是同一个剧里不同差分的头顶会漂——修一条补一条是补不完的。
 * 现在它是**入库流水线自带的一步**（`adoptDraft` / `registerAsset`），宿主不必记得。
 *
 * 两种合法输入，按「这张图是什么」分岔，不做静默降级：
 * - **已经抠好的透明 PNG**（资源库条目、用户上传、上一次抠底的产物）→ 只重排画布；
 * - **纯色键底的原片**（生图直出，整张不透明）→ `cutout()`：去底 + 归一化。
 *
 * **判据是先看透明、再看底色**，不是反过来：透明 PNG 的透明像素里往往还留着原来那层底色的
 * RGB（很多工具只写 alpha、不清 RGB），拿边框 RGB 一量就是「纯绿底」，于是被当成原片再抠一遍——
 * 主体上与被抠掉的那块颜色相近的地方会跟着丢。所以只要这张图**成片地透**，它就是已经抠好的。
 *
 * 归一化的算法只有一份：两条支路共用 `placeOnCanvas()`。
 */
import { spriteAspectRatio, type SpriteFraming } from "@aivn/core";
import sharp from "sharp";
import {
  cutout,
  isKeyBackground,
  placeOnCanvas,
  probeKeyBackground,
  SPRITE_CANVAS_HEIGHT,
  SPRITE_TOP_PADDING,
  type CutoutTuning,
} from "./cutout.js";

export interface PreparedSprite {
  /** 归一化之后的透明 PNG（恒为 `画布高 × aspectRatio` 的画布）。 */
  data: Buffer;
  width: number;
  height: number;
  /** 人物头顶到画布上沿的像素数。 */
  figureTop: number;
  /** 人物在画布上的实际像素高。 */
  figureHeight: number;
  /** 这张图走的是哪条支路：`true` = 色键原片（做了去底），`false` = 已经抠好的 PNG（只重排画布）。 */
  keyed: boolean;
  /** 前景像素占比（体检用：抠底那支是掩膜算的，重排那支按 alpha 数）。 */
  coverage?: number;
}

/** 「这张图已经是抠好的」的透明像素占比下限：0.5%。抠出来的图总有大片透明（主体外框），
 * 而不透明底图上的零星半透明像素（抗锯齿、阴影、编码噪声）远达不到这个量——用占比而不是
 * 「有没有一个alpha<250」，才不会把一张带噪点的底图当成抠好的图收进来。 */
const CUT_TRANSPARENCY_MIN = 0.005;

export interface PrepareSpriteOptions {
  /** 该差分的取景：决定画布比。不给按缺省（全身 9:16）。 */
  framing?: SpriteFraming;
  canvasHeight?: number;
  topPadding?: number;
  /** 去底那五个旋钮（只影响色键那一支）。 */
  tuning?: Partial<CutoutTuning>;
}

/**
 * 把一张立绘图归一化成可入库的透明 PNG。无论输入是原片还是已抠好的 PNG，产出的画布、留白与
 * 指标口径完全一致——「同一个主体的所有差分头顶同高」由它一处保证。
 */
export async function prepareSprite(bytes: Buffer, options: PrepareSpriteOptions = {}): Promise<PreparedSprite> {
  const canvasHeight = options.canvasHeight ?? SPRITE_CANVAS_HEIGHT;
  const topPadding = options.topPadding ?? SPRITE_TOP_PADDING;
  const aspectRatio = spriteAspectRatio(options.framing);
  const canvasWidth = Math.round(canvasHeight * aspectRatio);

  const { data: rgba, info } = await sharp(bytes).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const { width, height, channels } = info;
  if (width < 8 || height < 8) throw new Error("图太小，立绘入库没有意义");

  const alpha = alphaChannel(rgba, width, height, channels);
  const transparent = transparentFraction(alpha);
  if (transparent >= CUT_TRANSPARENCY_MIN) {
    const placed = await placeOnCanvas(rgba, width, height, alpha, { canvasWidth, canvasHeight, topPadding });
    // 体检项与抠底那支口径一致（前景像素占比）。这里不设上下限：紧贴着人物裁出来的透明 PNG
    // 是合法输入，拿抠底那条「底色没量对」的判据去卡它只会误伤。
    return { ...placed, keyed: false, coverage: 1 - transparent };
  }

  const border = probeKeyBackground(rgba, width, height, channels);
  if (isKeyBackground(border)) {
    const cut = await cutout(bytes, { canvasHeight, aspectRatio, topPadding, ...options.tuning });
    return {
      data: cut.data,
      width: cut.width,
      height: cut.height,
      figureTop: cut.figureTop,
      figureHeight: cut.figureHeight,
      keyed: true,
      coverage: cut.coverage,
    };
  }

  throw new Error(
    "立绘入库前要归一化，但这张图既不是纯色键底的原片，也没有成片的透明区域：" +
      `边框量出来的底色是 (${border.color.join(", ")})、通道极差只有 ${border.spread}（色键色要求 ≥ 96），` +
      `整张图也只有 ${(transparent * 100).toFixed(2)}% 的像素是透明的（不足 0.5%）。` +
      "给两种输入之一——带单一纯色底（默认纯绿 #00FF00，绿色系主体换纯品红 #FF00FF）的**原片**，" +
      "或者已经抠好底的**透明 PNG**。",
  );
}

/** 取出 alpha 通道（`ensureAlpha()` 之后它恒是最后一通道）。 */
function alphaChannel(rgba: Buffer, width: number, height: number, channels: number): Uint8Array {
  const alpha = new Uint8Array(width * height);
  const at = channels - 1;
  for (let i = 0; i < alpha.length; i++) alpha[i] = rgba[i * channels + at] ?? 0;
  return alpha;
}

/** 透明像素占比（alpha < 250 算透明：全 255 = 不透明，哪怕带 alpha 通道）。 */
function transparentFraction(alpha: Uint8Array): number {
  let transparent = 0;
  for (const value of alpha) if (value < 250) transparent++;
  return transparent / alpha.length;
}
