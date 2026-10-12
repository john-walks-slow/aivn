/**
 * 剧目主题层：把 `plays/<id>/theme.css` 以 <link> 挂在页面上，工坊可写、即时生效。
 *
 * 约定：theme.css 只覆盖 `:root` 上的设计令牌（颜色/圆角/阴影/字族），不改结构。
 * 令牌全集见 app.css 顶部注释——剧目作者照着改颜色即可换皮，不必理解组件。
 * 主题色那两个名字（--accent 管界面、--play-accent 管舞台）见 `ui/playTheme.ts` 的
 * themeCssFor：引擎的默认档与预设档都在 `@layer aivn-defaults` 里，这张表未分层，
 * 所以**深浅两种主题下都是它说了算**。
 */

import { DEFAULT_PLAY_STYLE, styleFromThemeCss, type PlayStyleId } from "./ui/playTheme.js";

let link: HTMLLinkElement | null = null;
let loadSeq = 0;

/** 把本剧的界面风格落到 <html> 的 data-* 上（开始菜单与舞台消息框/选项框同进同出）。 */
export function applyPlayStyle(style: PlayStyleId): void {
  const root = document.documentElement;
  if (style === "atri") {
    delete root.dataset.dialogStyle;
    delete root.dataset.menuStyle;
  } else {
    root.dataset.dialogStyle = style;
    root.dataset.menuStyle = style;
  }
}

/** 挂载或摘除剧目主题。`nonce` 变化即强制重取（工坊改完文件后 +1）。 */
export function applyPlayTheme(playId: string | null, nonce = 0): void {
  const seq = ++loadSeq;
  if (!playId) {
    link?.remove();
    link = null;
    applyPlayStyle(DEFAULT_PLAY_STYLE);
    return;
  }
  const prevPlayId = link?.dataset.playTheme;
  if (!link) {
    link = document.createElement("link");
    link.rel = "stylesheet";
    link.dataset.playTheme = playId;
    document.head.appendChild(link);
  }
  if (prevPlayId !== playId) {
    link.dataset.playTheme = playId;
    applyPlayStyle(DEFAULT_PLAY_STYLE);
  }
  const href = `/api/plays/${encodeURIComponent(playId)}/theme.css?v=${nonce}`;
  // 404 也照样赋值：文件不存在时浏览器静默忽略这一张表，页面走默认主题。
  if (link.getAttribute("href") !== href) link.setAttribute("href", href);

  fetch(href, nonce > 0 ? { cache: "no-store" } : undefined)
    .then((res) => (res.ok ? res.text() : ""))
    .then((css) => {
      if (seq !== loadSeq) return;
      applyPlayStyle(styleFromThemeCss(css));
    })
    .catch(() => {
      if (seq !== loadSeq) return;
      applyPlayStyle(DEFAULT_PLAY_STYLE);
    });
}

/** 工坊改完 theme.css 后重取一次（换 nonce 即绕过缓存）。 */
export function reloadPlayTheme(): void {
  const playId = link?.dataset.playTheme;
  if (playId) applyPlayTheme(playId, Date.now());
}

/** 工坊文件存盘后广播，App 收到即重挂主题表（换皮不必刷新页面）。 */
export const THEME_CHANGED = "aivn:theme-changed";
export function notifyThemeChanged(): void {
  window.dispatchEvent(new Event(THEME_CHANGED));
}
