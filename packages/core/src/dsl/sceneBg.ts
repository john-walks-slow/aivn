/**
 * `<scene bg="…">` 的取值分类：素材 id，还是纯色场。
 *
 * 纯色场（黑场 / 白场 / 任意色）不新造语法机制——`bg` 的语义本来就是「这一刻的底」，
 * 与 Ren'Py 把 `Solid` 当一张具名图（`scene black`）的惯例一致。于是：
 *
 *   - 保留色名 `black` / `white`（大小写不敏感）——需求点名的黑场/白场；
 *   - 十六进制字面量 `#rgb` / `#rrggbb`——覆盖黄昏橙、血红这类演出常用纯色；
 *   - 其余一律当素材 id，走 `assets/backgrounds/<id>` 查表（行为不变）。
 *
 * 解析与谱系不感知纯色：`attrs.bg` 原样存 `"black"`/`"#1a1a2e"`，重放与回看自然带上；
 * 只有渲染层需要在这里分流。
 */

/** 保留色名 → 规范色值。写死一张小表，不做任意 CSS 关键字识别。 */
const COLOR_NAMES: Readonly<Record<string, string>> = {
  black: "#000000",
  white: "#ffffff",
};

/** CSS 十六进制色：3 位或 6 位（不认带 alpha 的 4/8 位——那是素材色的语法，不是背景演出词）。 */
const HEX_RE = /^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i;

export type SceneBg =
  | { kind: "color"; color: string }
  | { kind: "asset"; id: string }
  | null;

export function resolveSceneBg(bg: string | undefined): SceneBg {
  if (bg === undefined) return null;
  const value = bg.trim();
  if (value === "") return null;
  const named = COLOR_NAMES[value.toLowerCase()];
  if (named !== undefined) return { kind: "color", color: named };
  if (HEX_RE.test(value)) return { kind: "color", color: value };
  return { kind: "asset", id: value };
}
