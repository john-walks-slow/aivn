/**
 * `<title>` 卡片的底色与字色：取值校验 + 渲染前的分流。
 *
 * 与 `<scene bg>` 的纯色场同构——解析与谱系只原样存字符串，颜色在这里才变成真颜色。
 * 缺省是**黑底白字**：卡片的默认观感必须是模型能预判的（它看不到舞台皮肤的 `--title-ink`），
 * 想要「叠在场景上的透明文字」就显式写 `bg="none"`。
 */

import { contrastInk, parseColorValue } from "./color.js";

/** 缺省底色：黑场。 */
export const TITLE_BG_DEFAULT = "black";

/** 显式透明：卡片不铺底（字色缺省回舞台皮肤 `--title-ink`，投影保留）。 */
export const TITLE_BG_NONE = "none";

/** 卡片底色：色名 / 十六进制 / `none`。IR 与谱系原样存这个字符串。 */
export type TitleBg = string;

/** 卡片字色：色名 / 十六进制。缺省（不写）时按底色取对比色。 */
export type TitleInk = string;

/** `bg` 取值：色名 / 十六进制 / `none`。 */
export function isTitleBg(value: unknown): value is string {
  return typeof value === "string" && (isTransparent(value) || parseColorValue(value) !== null);
}

/** `ink` 取值：色名 / 十六进制（没有 none——透明底的字色缺省走舞台皮肤）。 */
export function isTitleInk(value: unknown): value is string {
  return typeof value === "string" && parseColorValue(value) !== null;
}

export interface TitleStyle {
  /** 卡片底色；null = 透明（不铺底）。 */
  background: string | null;
  /** 字色；null = 用舞台皮肤令牌 `--title-ink`。 */
  ink: string | null;
}

/**
 * 底色 + 字色 → 渲染用的两个色值。
 *
 * - `bg` 缺省或非法 → 黑底；`bg="none"` → 透明。
 * - `ink` 给了就用它；没给时，实色底取对比色（黑底白字 / 白底黑字 / 深色 `#hex` 配白字），
 *   透明底返回 null（交回舞台皮肤的 `--title-ink`）。
 */
export function resolveTitleStyle(bg?: string, ink?: string): TitleStyle {
  const explicitInk = ink !== undefined ? parseColorValue(ink) : null;
  if (bg !== undefined && isTransparent(bg)) return { background: null, ink: explicitInk };
  const color = (bg !== undefined ? parseColorValue(bg) : null) ?? parseColorValue(TITLE_BG_DEFAULT)!;
  return { background: color, ink: explicitInk ?? contrastInk(color) };
}

function isTransparent(value: string): boolean {
  return value.trim().toLowerCase() === TITLE_BG_NONE;
}
