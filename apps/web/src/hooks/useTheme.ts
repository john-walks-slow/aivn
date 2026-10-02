import { useEffect } from "react";

/**
 * 主题偏好：UI（纸面）与舞台（画面）各存一个，互不影响——
 * 有人想夜里看剧本但界面要亮着（比如边播边查资料），这两个必须能分开调。
 *
 * 只存「偏好」不存「结果」：存 system/light/dark 三态，实际用哪个由系统偏好当场算。
 * 存结果的话，系统在日/夜之间切换时页面不会跟着变。
 */
export type ThemeMode = "system" | "light" | "dark";

export const UI_THEME_KEY = "stage-ai:ui-theme-mode";
export const STAGE_THEME_KEY = "stage-ai:stage-theme-mode";

/** 设置页改完用这个事件通知本标签页——storage 事件只跨标签页发，同页改同页收不到。 */
export const THEME_CHANGE_EVENT = "stage-ai:theme-change";

const isMode = (v: string | null): v is ThemeMode => v === "system" || v === "light" || v === "dark";

export function readThemeMode(key: string): ThemeMode {
  const v = localStorage.getItem(key);
  return isMode(v) ? v : "system";
}

/** 写盘并广播：调用方不必自己记得 dispatch，漏了就变成「点了没反应」。 */
export function writeThemeMode(key: string, mode: ThemeMode): void {
  localStorage.setItem(key, mode);
  window.dispatchEvent(new Event(THEME_CHANGE_EVENT));
}

const resolve = (mode: ThemeMode, prefersDark: boolean): "light" | "dark" =>
  mode === "system" ? (prefersDark ? "dark" : "light") : mode;

/**
 * 把两个偏好解析成实际亮暗，写到 <html> 的 data-* 上。
 * 配色本身在 app.css 的 `html[data-ui-theme=…]` / `html[data-stage-theme=…]` 里，
 * JS 只负责决定「现在是哪个」，不负责决定「长什么样」——
 * 这样剧目主题（theme.css 覆盖 :root 变量）依然是唯一能整体换皮的入口。
 */
function applyThemes(): void {
  const prefersDark = window.matchMedia("(prefers-color-scheme: dark)").matches;
  const html = document.documentElement;
  html.dataset.uiTheme = resolve(readThemeMode(UI_THEME_KEY), prefersDark);
  html.dataset.stageTheme = resolve(readThemeMode(STAGE_THEME_KEY), prefersDark);
}

/** 在 App 挂载时调一次，之后三个来源的变化都会自动跟上。 */
export function useTheme(): void {
  useEffect(() => {
    applyThemes();

    // 每次都从 localStorage 重读：闭包里存一份的话，设置页改完广播过来的
    // 还是挂载时那份快照，表现为「下拉框切了、界面不动」。
    const onChange = (): void => applyThemes();

    // 同标签页（设置页改的）
    window.addEventListener(THEME_CHANGE_EVENT, onChange);
    // 其它标签页（localStorage 变了）
    window.addEventListener("storage", onChange);
    // 系统日/夜切换：只有偏好为「跟随系统」时才会真的改变结果，但重算成本可忽略
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    mq.addEventListener("change", onChange);

    return () => {
      window.removeEventListener(THEME_CHANGE_EVENT, onChange);
      window.removeEventListener("storage", onChange);
      mq.removeEventListener("change", onChange);
    };
  }, []);
}