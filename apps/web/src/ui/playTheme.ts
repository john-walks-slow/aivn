/**
 * 剧目主题色：一部剧一个色，写进 `plays/<id>/theme.css`。
 *
 * 为什么走 theme.css 而不是 play.json 的新字段：换皮机制早就有了（`src/theme.ts` 把这张表
 * 以 <link> 挂上，工坊可写、即时生效），而主题色本质就是「覆盖 --accent 那几个令牌」。
 * 界面（--accent：库/标题/周目/工坊/设置）与舞台（--play-accent：台词条、快捷菜单、选肢、
 * 名牌、模态窗）各读一个名字，理由见 themeCssFor 里那段注释。
 */

import { readableInk } from "../hooks/useTheme.js";

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

/** 认得出 `#rrggbb` 才生成表；认不出就当没有这一档（不拿脏值去拼 CSS）。 */
function isHexColor(hex: string): boolean {
  return /^#?[0-9a-f]{6}$/i.test(hex.trim());
}

/**
 * 深色界面那一档：往白里提两成二。
 * 纸面档的主题色都是「中间明度」（压得住暖黑当底、又要读得清纸面），拿它去当**字**压在暖黑上
 * 只有 3:1 上下——引擎自己的深色档（#1b5aa6 → #4a9fe0）也是这么提的。
 * 0.78 是量出来的：色板八档提完落在 5.9:1 以上（纸面档最差的一档是 4.7:1）。
 */
function liftForDark(hex: string): string {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return hex;
  const n = Number.parseInt(m[1]!, 16);
  const chan = (v: number): string =>
    Math.round(v * 0.78 + 255 * 0.22)
      .toString(16)
      .padStart(2, "0");
  return `#${chan((n >> 16) & 255)}${chan((n >> 8) & 255)}${chan(n & 255)}`;
}

/** 生成整份 theme.css。`hex` 为空 = 回到默认主题（写一份空表，等于不覆盖）。 */
export function themeCssFor(hex: string | null): string {
  if (!hex) {
    return `/* 默认主题：不覆盖任何令牌，界面与舞台走引擎自己的主题蓝。 */\n`;
  }
  if (!isHexColor(hex)) return "";
  const ink = readableInk(hex);
  const dark = liftForDark(hex);
  const darkInk = readableInk(dark);
  return `${MARK} ${hex} */

/* 本剧的主题色。由工坊「剧目 → 主题色」写入，手改也生效。
   台词条 / 快捷菜单 / 选肢 / 路线图 / 回顾流水 / 标题画面全都从它派生。
   每个色两套值（纸面档 / 暖黑档），同一个色相：界面与舞台按当前的深浅各取一套。
   四个名字各管一层：
     --accent            界面读的——引擎的默认档与预设档都在 @layer aivn-defaults 里，
                         未分层的这张表永远压过它们（深浅哪一档都是）；
     --play-accent       舞台读的——舞台根 .stage-root 自己也声明了 --accent，从 :root
                         继承下来的值进不去，只能另起一个名字接。漏了它的后果是
                         「界面换了色、舞台还是引擎蓝」；
     --play-accent-dark  舞台·暖黑那一档（纸面档压在暖黑上做字读不清，见 liftForDark）。
   --accent-soft（界面的淡底）刻意不在这里给：它没有「某个色」这层含义，
   是「纸面上 vs 暖黑上」两种配比，由 app.css 从当前那一档主色现推。 */
:root {
  --accent: ${hex};
  --accent-ink: ${ink};
  --link: ${hex};
  --play-accent: ${hex};
  --play-accent-ink: ${ink};
}

html[data-ui-theme="dark"] {
  --accent: ${dark};
  --accent-ink: ${darkInk};
  --link: ${dark};
  --play-accent-dark: ${dark};
  --play-accent-dark-ink: ${darkInk};
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
