/**
 * 舞台摆位预设：把「取景 × 体量 × 对齐」算成一条落位——图上沿离舞台顶多远、图多高、
 * 缩放与运镜绕哪个点转。
 *
 * 表放在 core，因为它是**引擎的视觉契约**：生图提示词要按取景措辞、工坊要显示体量档、
 * 舞台要按同一组数摆位。表只留在 web 一侧的话，服务端与提示词就无从知道「巨大」是什么。
 *
 * 两列（横屏 / 竖屏）而不是一个响应式公式：手机竖屏时舞台更窄更高，同一个人物要占更多
 * 高度才不至于缩成一条。这两列由 web 一次算成 CSS 变量，媒体查询按宽高比挑一列——
 * 方向判定留在 CSS 里，组件不必监听 resize。
 *
 * 数值是百分比，两个方向都相对舞台高度。
 */

import type { ActorAnchor } from "../dsl/spec.js";
import {
  DEFAULT_SPRITE_FRAMING,
  DEFAULT_SPRITE_STATURE,
  type SpriteFraming,
  type SpriteStature,
} from "./framing.js";

/** 缩放与运镜的锚点。`bottom center` = 贴地（小东西放大时脚不离地），`top center` = 头顶稳定。 */
export type SpriteOrigin = "top center" | "bottom center" | "center";

export interface SpriteStageBox {
  /** 图上沿相对舞台顶的百分比。 */
  top: number;
  /** 图高相对舞台高的百分比。 */
  height: number;
  origin: SpriteOrigin;
}

export interface SpriteStagePreset {
  landscape: SpriteStageBox;
  portrait: SpriteStageBox;
}

interface Box {
  top: number;
  height: number;
}

/**
 * 取景 × 体量 → 舞台基准。
 *
 * `small` 那三行的不变式是 top + height = 100：小东西**贴舞台底**，放大时脚不离地。
 * 其余三档贴头顶（height 可以超过 100，人物脚下长出画面），这就是今天全身立绘的画法。
 *
 * 头顶那一档留白（top）统一比 261004 建表时**下移了 8**：立绘图本身顶到画幅上沿，
 * 10% 的留白读出来就是「脑袋贴着天花板」，横竖屏都一样。竖屏列整体比横屏矮一点，
 * 因为竖屏舞台更高更容易塞下。
 */
const STAGE_PRESETS: Record<SpriteFraming, Record<SpriteStature, { landscape: Box; portrait: Box }>> = {
  full: {
    small: { landscape: { top: 68, height: 32 }, portrait: { top: 66, height: 34 } },
    normal: { landscape: { top: 18, height: 132 }, portrait: { top: 16, height: 102 } },
    large: { landscape: { top: 14, height: 168 }, portrait: { top: 13, height: 130 } },
    huge: { landscape: { top: 10, height: 232 }, portrait: { top: 10, height: 178 } },
  },
  half: {
    small: { landscape: { top: 70, height: 30 }, portrait: { top: 68, height: 32 } },
    normal: { landscape: { top: 18, height: 90 }, portrait: { top: 16, height: 92 } },
    large: { landscape: { top: 13, height: 126 }, portrait: { top: 12, height: 118 } },
    huge: { landscape: { top: 8, height: 172 }, portrait: { top: 8, height: 156 } },
  },
  square: {
    small: { landscape: { top: 72, height: 28 }, portrait: { top: 70, height: 30 } },
    normal: { landscape: { top: 18, height: 90 }, portrait: { top: 16, height: 92 } },
    large: { landscape: { top: 12, height: 130 }, portrait: { top: 11, height: 122 } },
    huge: { landscape: { top: 8, height: 184 }, portrait: { top: 8, height: 164 } },
  },
};

/**
 * 算一台主体的落位。缺省对齐是 `bottom`（脚踩地 / 落地）。
 *
 * 对齐只改纵轴与原点，不改高度：`center` 是悬空物（把盒子居中），`top` 是垂下物
 * （从舞台顶挂下来）。
 */
export function spriteStagePreset(
  framing?: SpriteFraming,
  stature?: SpriteStature,
  anchor: ActorAnchor = "bottom",
  figureTop?: number,
  figureHeight?: number,
): SpriteStagePreset {
  const row = STAGE_PRESETS[framing ?? DEFAULT_SPRITE_FRAMING][stature ?? DEFAULT_SPRITE_STATURE];
  return {
    landscape: box(row.landscape, stature, anchor, figureTop, figureHeight),
    portrait: box(row.portrait, stature, anchor, figureTop, figureHeight),
  };
}

/** 立绘画布高（抠图产物的固定高度，见 packages/agent 的 cutout.ts）。figureTop / figureHeight 都是相对它的像素数。 */
const SPRITE_CANVAS_HEIGHT = 1920;

/**
 * `figureTop` = 人物头顶相对立绘画布上沿的像素数（抠图产物；缺省 0 = 头顶就贴画布上沿）。
 *
 * 图片盒的上沿在人物头顶**之上** figureTop 那么远，要让头顶落回 preset 声明的位置，
 * 盒子就得**往上推**等量——推量按盒子自身高度等比缩放。
 *
 * 推出来的 top 为负是正确结果，不夹到 0：盒子本就可以伸到舞台顶以上，被裁掉的是盒内
 * 空白、不是人物；夹到 0 反而把头顶又推回下面去。脏数据只在这一步收口：非有限数、
 * 非正数、超过画布高的一律当 0（= 旧行为）。
 */
function headroom(height: number, figureTop: number | undefined): number {
  if (figureTop === undefined || !Number.isFinite(figureTop) || figureTop <= 0) return 0;
  return (Math.min(figureTop, SPRITE_CANVAS_HEIGHT) / SPRITE_CANVAS_HEIGHT) * height;
}

/** 补偿倍数的上界：图里的人物再小也不许把盒子撑到天上（脏数据兜底）。 */
const MAX_FIGURE_SCALE = 4;

/**
 * `figureHeight` = 人物在立绘画布上的实际像素高（抠图产物；缺省或非法 = 1.0，逐位退回旧行为）。
 *
 * 同一档体量声明的是**人物在台上多高**，而盒高要乘上「画布高 / 人物像素高」才兑现得了：
 * 人物只占画布 1132/1920 时，同样的盒高只能渲染出六成的高度（vxn 那类宽度先卡的图就是
 * 这样矮下去的）。缺字段的老素材保持原样，不做静默放大。
 */
function figureScale(figureHeight: number | undefined): number {
  if (figureHeight === undefined || !Number.isFinite(figureHeight) || figureHeight <= 0) return 1;
  return Math.min(SPRITE_CANVAS_HEIGHT / figureHeight, MAX_FIGURE_SCALE);
}

function box(
  raw: Box,
  stature: SpriteStature | undefined,
  anchor: ActorAnchor,
  figureTop: number | undefined,
  figureHeight: number | undefined,
): SpriteStageBox {
  const grounded = (stature ?? DEFAULT_SPRITE_STATURE) === "small";
  const base: SpriteOrigin = grounded ? "bottom center" : "top center";
  const origin: SpriteOrigin = anchor === "center" ? "center" : anchor === "top" ? "top center" : base;
  // 先按人物实际占比把高度补回 preset 声明的观感，落位再用补过的高度算——
  // 两处共用同一个 height：任何一处偷用原始 raw.height，人物与头顶就错开。
  const height = round2(raw.height * figureScale(figureHeight));
  let top: number;
  if (anchor === "center") top = 50 - height / 2;
  else if (anchor === "top") top = 0;
  else if (grounded) top = 100 - height; // 贴地的小东西：脚不离地（top + height = 100）
  else top = raw.top - headroom(height, figureTop);
  return { top: round2(top), height, origin };
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}
