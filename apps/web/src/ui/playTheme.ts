/**
 * 剧目主题色：一部剧一个色，写进 `plays/<id>/theme.css`。
 *
 * 为什么走 theme.css 而不是 play.json 的新字段：换皮机制早就有了（`src/theme.ts` 把这张表
 * 以 <link> 挂上，工坊可写、即时生效），而主题色本质就是「覆盖 --accent 那几个令牌」。
 * 界面、舞台台词条、快捷菜单、选肢、路线图、回顾流水全都从 --accent 派生，
 * 所以改了这一个值，整部剧的蓝色就一起换掉，不必给每个组件开一个字段。
 */

/** theme.css 里回读色值的锚点。选择器生成的文件都带这一行，读的时候不必解析 CSS。 */
const MARK = "/* aivn-play-accent:";

/** 可选主题色。都是压得住深底、也读得清浅底的中间明度，偏冷雅致，不抢画面。 */
export interface PlayAccent {
  id: string;
  label: string;
  hex: string;
}

export const PLAY_ACCENTS: readonly PlayAccent[] = [
  { id: "deepsea", label: "深海", hex: "#1b5aa6" },
  { id: "sky", label: "天青", hex: "#2b7fb8" },
  { id: "lake", label: "湖绿", hex: "#2f7f6f" },
  { id: "moss", label: "苔绿", hex: "#4a6f45" },
  { id: "wisteria", label: "紫藤", hex: "#6a5599" },
  { id: "sakura", label: "樱粉", hex: "#c2557f" },
  { id: "amber", label: "琥珀", hex: "#a97526" },
  { id: "crimson", label: "绯红", hex: "#9b3b4f" },
];

export const DEFAULT_PLAY_ACCENT = PLAY_ACCENTS[0]!.hex;

function hexToRgb(hex: string): { r: number; g: number; b: number } | null {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return null;
  const n = Number.parseInt(m[1]!, 16);
  return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
}

function rgbToHsl(r: number, g: number, b: number): { h: number; s: number; l: number } {
  const rn = r / 255;
  const gn = g / 255;
  const bn = b / 255;
  const max = Math.max(rn, gn, bn);
  const min = Math.min(rn, gn, bn);
  const l = (max + min) / 2;
  if (max === min) return { h: 0, s: 0, l };
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h: number;
  if (max === rn) h = ((gn - bn) / d + (gn < bn ? 6 : 0)) / 6;
  else if (max === gn) h = ((bn - rn) / d + 2) / 6;
  else h = ((rn - gn) / d + 4) / 6;
  return { h: h * 360, s, l };
}

/** 同一色相的浅底版（界面上的 chip / 选中底），深色界面上不适用，所以给的是浅纸面用的一档。 */
function softOf(hex: string): string {
  const rgb = hexToRgb(hex);
  if (!rgb) return "#eef3f9";
  const { h, s } = rgbToHsl(rgb.r, rgb.g, rgb.b);
  return `hsl(${Math.round(h)} ${Math.round(Math.min(1, s) * 42)}% 96%)`;
}

/** 生成整份 theme.css。`hex` 为空 = 回到默认主题（写一份空表，等于不覆盖）。 */
export function themeCssFor(hex: string | null): string {
  if (!hex) {
    return `/* 默认主题：不覆盖任何令牌，界面与舞台走引擎自己的主题蓝。 */\n`;
  }
  const rgb = hexToRgb(hex);
  if (!rgb) return "";
  const { h, s, l } = rgbToHsl(rgb.r, rgb.g, rgb.b);
  // 舞台底色深，主题色要提一档明度才立得住；亮色界面用原色。同一个色相，两档明度。
  const stageHex = `hsl(${Math.round(h)} ${Math.round(s * 100)}% ${Math.round(Math.min(72, l * 100 + 10))}%)`;
  return `${MARK} ${hex} */

/* 本剧的主题色。由工坊「剧目 → 主题色」写入，手改也生效。
   界面与画面共用同一个色相：改这里，台词条 / 快捷菜单 / 选肢 / 路线图 / 回顾流水一起换。 */
:root {
  --accent: ${hex};
  --accent-ink: #ffffff;
  --accent-soft: ${softOf(hex)};
  --link: ${hex};
  --play-accent: ${hex};
  --play-accent-stage: ${stageHex};
}
`;
}

/** 从 theme.css 正文里回读主题色；没有标记或文件为空 = 默认主题。 */
export function accentFromThemeCss(css: string | null | undefined): string | null {
  if (!css) return null;
  const marked = css.indexOf(MARK);
  if (marked >= 0) {
    const m = /#?[0-9a-f]{6}/i.exec(css.slice(marked + MARK.length, marked + MARK.length + 24));
    if (m) return m[0].startsWith("#") ? m[0] : `#${m[0]}`;
  }
  // 手写的表没有标记：退一步找第一条 --accent
  const plain = /--accent:\s*(#[0-9a-f]{6})/i.exec(css);
  return plain?.[1] ?? null;
}

/** 色板里最接近这个色的那一枚（用来把色板选中态对上）；不在色板里就返 null。 */
export function accentIdOf(hex: string | null): string | null {
  if (!hex) return null;
  const target = hex.trim().toLowerCase();
  return PLAY_ACCENTS.find((a) => a.hex.toLowerCase() === target)?.id ?? null;
}
