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
 * 数值是百分比，两个方向都相对舞台高度。**缺省三档（full/normal、half/normal、
 * square/normal）与加表之前的 CSS 完全一致**：存量剧目不许因为升级换站位。
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
 * 其余三档贴头顶（top 是小余量、height 可以超过 100，人物脚下长出画面），
 * 这就是今天全身立绘的画法。竖屏列整体比横屏矮一点，因为竖屏舞台更高更容易塞下。
 */
const STAGE_PRESETS: Record<SpriteFraming, Record<SpriteStature, { landscape: Box; portrait: Box }>> = {
  full: {
    small: { landscape: { top: 68, height: 32 }, portrait: { top: 66, height: 34 } },
    normal: { landscape: { top: 10, height: 132 }, portrait: { top: 8, height: 102 } },
    large: { landscape: { top: 6, height: 168 }, portrait: { top: 5, height: 130 } },
    huge: { landscape: { top: 2, height: 232 }, portrait: { top: 2, height: 178 } },
  },
  half: {
    small: { landscape: { top: 70, height: 30 }, portrait: { top: 68, height: 32 } },
    normal: { landscape: { top: 10, height: 90 }, portrait: { top: 8, height: 92 } },
    large: { landscape: { top: 5, height: 126 }, portrait: { top: 4, height: 118 } },
    huge: { landscape: { top: 0, height: 172 }, portrait: { top: 0, height: 156 } },
  },
  square: {
    small: { landscape: { top: 72, height: 28 }, portrait: { top: 70, height: 30 } },
    normal: { landscape: { top: 10, height: 90 }, portrait: { top: 8, height: 92 } },
    large: { landscape: { top: 4, height: 130 }, portrait: { top: 3, height: 122 } },
    huge: { landscape: { top: 0, height: 184 }, portrait: { top: 0, height: 164 } },
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
): SpriteStagePreset {
  const row = STAGE_PRESETS[framing ?? DEFAULT_SPRITE_FRAMING][stature ?? DEFAULT_SPRITE_STATURE];
  return { landscape: box(row.landscape, stature, anchor), portrait: box(row.portrait, stature, anchor) };
}

function box(raw: Box, stature: SpriteStature | undefined, anchor: ActorAnchor): SpriteStageBox {
  const grounded = (stature ?? DEFAULT_SPRITE_STATURE) === "small";
  const base: SpriteOrigin = grounded ? "bottom center" : "top center";
  const origin: SpriteOrigin = anchor === "center" ? "center" : anchor === "top" ? "top center" : base;
  const top = anchor === "center" ? 50 - raw.height / 2 : anchor === "top" ? 0 : raw.top;
  return { top: round2(top), height: round2(raw.height), origin };
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}
