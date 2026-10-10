/**
 * 纯色值的**最小词表**：色名 `black` / `white` 与十六进制字面量。
 *
 * 两处共用它：`<scene bg>` 的纯色场（sceneBg.ts）与 `<title>` 卡片的底色 / 字色
 * （titleStyle.ts）。词表刻意小——演出层要的是「黑场 / 白场 / 这一抹颜色」，
 * 不是一套 CSS 颜色解析器；写死一张小表，不做任意关键字识别。
 */

/** 保留色名 → 规范色值（大小写不敏感）。 */
export const COLOR_NAMES: Readonly<Record<string, string>> = {
  black: "#000000",
  white: "#ffffff",
};

/** CSS 十六进制色：3 位或 6 位（不认带 alpha 的 4/8 位——那是素材色的语法，不是演出词）。 */
export const COLOR_HEX_RE = /^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i;

/**
 * 色名或十六进制 → 规范色值；不是色就返回 null。
 * 十六进制**原样返回**（`#FFAA00` 不改成小写），色名归一到 `#rrggbb`。
 */
export function parseColorValue(value: string): string | null {
  const trimmed = value.trim();
  const named = COLOR_NAMES[trimmed.toLowerCase()];
  if (named !== undefined) return named;
  return COLOR_HEX_RE.test(trimmed) ? trimmed : null;
}

/**
 * 一块底色上的对比字色：黑底白字、白底黑字。
 *
 * 按 WCAG 相对亮度取阈值——`#1a1a2e` 这类深色也会判成白字，不必枚举色值。
 * 传入非十六进制（调用方已经过滤过）时落回白字。
 */
export function contrastInk(color: string): string {
  return relativeLuminance(color) > 0.35 ? "#000000" : "#ffffff";
}

function relativeLuminance(color: string): number {
  const hex = color.replace("#", "");
  const full = hex.length === 3 ? [...hex].map((ch) => ch + ch).join("") : hex;
  const channel = (at: number): number => {
    const value = Number.parseInt(full.slice(at, at + 2), 16) / 255;
    return value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(0) + 0.7152 * channel(2) + 0.0722 * channel(4);
}
