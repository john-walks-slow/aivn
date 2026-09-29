/**
 * 剧目主题层：把 `plays/<id>/theme.css` 以 <link> 挂在页面上，工坊可写、即时生效。
 *
 * 约定：theme.css 只覆盖 `:root` 上的设计令牌（颜色/圆角/阴影/字族），不改结构。
 * 令牌全集见 app.css 顶部注释——剧目作者照着改颜色即可换皮，不必理解组件。
 */

let link: HTMLLinkElement | null = null;

/** 挂载或摘除剧目主题。`nonce` 变化即强制重取（工坊改完文件后 +1）。 */
export function applyPlayTheme(playId: string | null, nonce = 0): void {
  if (!playId) {
    link?.remove();
    link = null;
    return;
  }
  if (!link) {
    link = document.createElement("link");
    link.rel = "stylesheet";
    link.dataset.playTheme = playId;
    document.head.appendChild(link);
  }
  if (link.dataset.playTheme !== playId) link.dataset.playTheme = playId;
  const href = `/api/plays/${encodeURIComponent(playId)}/theme.css?v=${nonce}`;
  // 404 也照样赋值：文件不存在时浏览器静默忽略这一张表，页面走默认主题。
  if (link.getAttribute("href") !== href) link.setAttribute("href", href);
}

/** 工坊改完 theme.css 后重取一次（换 nonce 即绕过缓存）。 */
export function reloadPlayTheme(): void {
  const playId = link?.dataset.playTheme;
  if (playId) applyPlayTheme(playId, Date.now());
}

/** 工坊文件存盘后广播，App 收到即重挂主题表（换皮不必刷新页面）。 */
export const THEME_CHANGED = "stage-ai:theme-changed";
export function notifyThemeChanged(): void {
  window.dispatchEvent(new Event(THEME_CHANGED));
}
