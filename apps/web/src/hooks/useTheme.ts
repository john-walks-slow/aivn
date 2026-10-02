import { useEffect } from "react";

const STORAGE_KEY_PREFIX = "stage-ai:";
const UI_MODE_KEY = STORAGE_KEY_PREFIX + "ui-theme-mode";
const STAGE_MODE_KEY = STORAGE_KEY_PREFIX + "stage-theme-mode";
const ACCENT_KEY = STORAGE_KEY_PREFIX + "accent";
const ACCENT_CUSTOM_KEY = STORAGE_KEY_PREFIX + "accent-custom";

/** 偏好：system=跟系统当场算，light/dark=写死。 */
export type ThemeMode = "system" | "light" | "dark";

/**
 * 两个开关各有各的默认：界面默认跟系统（白天纸面、夜里暗纸），
 * 舞台默认恒深——画面衬底本来就该压住背景图的亮部，跟系统走会在亮系统下读成白底空画布。
 */
export const DEFAULT_UI_MODE: ThemeMode = "system";
export const DEFAULT_STAGE_MODE: ThemeMode = "dark";

/** 本标签页改偏好时由设置页广播：storage 事件只发到别的标签页。 */
export const THEME_MODE_CHANGED = "stage-ai:theme-mode-changed";
export const ACCENT_CHANGED = "stage-ai:accent-changed";

/** 主色预设。custom 用设置页里自己挑的那个颜色（存 ACCENT_CUSTOM_KEY）。 */
export type AccentId = "blue" | "teal" | "green" | "violet" | "wine" | "custom";
export const ACCENT_PRESETS: { id: AccentId; label: string }[] = [
  { id: "blue", label: "冷蓝" },
  { id: "teal", label: "湖蓝" },
  { id: "green", label: "松绿" },
  { id: "violet", label: "紫藤" },
  { id: "wine", label: "酒红" },
];
export const DEFAULT_ACCENT: AccentId = "blue";
export const DEFAULT_ACCENT_CUSTOM = "#3f6b93";

function readMode(key: string, fallback: ThemeMode): ThemeMode {
  const val = localStorage.getItem(key);
  return val === "system" || val === "light" || val === "dark" ? val : fallback;
}

/** system 不落盘成结果，系统切日/夜时页面要跟着变，所以每次都当场算。 */
function actual(mode: ThemeMode, prefersDark: boolean): "light" | "dark" {
  if (mode !== "system") return mode;
  return prefersDark ? "dark" : "light";
}

/**
 * 把当前偏好落到 <html> 的 data-* 上，配色表全在 app.css 的属性选择器里。
 *
 * 为什么不由 JS 写内联 style：剧目换皮（plays/<id>/theme.css）挂的就是 :root 覆盖，
 * 内联优先级更高会把整张主题表压掉，玩家在工坊换的皮静默失效。
 */
export function applyTheme(): void {
  const prefersDark = window.matchMedia("(prefers-color-scheme: dark)").matches;
  const root = document.documentElement;
  root.dataset.uiTheme = actual(readMode(UI_MODE_KEY, DEFAULT_UI_MODE), prefersDark);
  root.dataset.stageTheme = actual(readMode(STAGE_MODE_KEY, DEFAULT_STAGE_MODE), prefersDark);
}

export function setThemeMode(key: string, mode: ThemeMode): void {
  localStorage.setItem(key, mode);
  applyTheme();
  window.dispatchEvent(new Event(THEME_MODE_CHANGED));
}

export function readAccent(): { id: AccentId; custom: string } {
  const raw = localStorage.getItem(ACCENT_KEY);
  const id = (ACCENT_PRESETS.some((p) => p.id === raw) || raw === "custom" ? raw : DEFAULT_ACCENT) as
    | AccentId
    | "custom";
  return { id, custom: localStorage.getItem(ACCENT_CUSTOM_KEY) ?? DEFAULT_ACCENT_CUSTOM };
}

/**
 * 预设色走 app.css 的 [data-accent] 属性选择器；只有「自己挑的颜色」才写内联变量——
 * 剧目换皮挂的是 :root 覆盖，常驻内联会把整张主题表压掉，所以这个例外只给 custom。
 */
export function applyAccent(): void {
  const root = document.documentElement;
  const { id, custom } = readAccent();
  root.dataset.accent = id;
  if (id === "custom") root.style.setProperty("--accent", custom);
  else root.style.removeProperty("--accent");
}

export function setAccent(id: AccentId, custom?: string): void {
  localStorage.setItem(ACCENT_KEY, id);
  if (custom) localStorage.setItem(ACCENT_CUSTOM_KEY, custom);
  applyAccent();
  window.dispatchEvent(new Event(ACCENT_CHANGED));
}

/**
 * 三个变化来源都接上：设置页在本标签页改的、系统偏好切换、其它标签页改的。
 * applyTheme 每次都重读 localStorage，不缓存挂载时的快照——缓存了就是
 * 「下拉框切了、界面不动」。
 */
export function useTheme(): void {
  useEffect(() => {
    applyTheme();
    applyAccent();
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const rerun = (): void => applyTheme();
    media.addEventListener("change", rerun);
    window.addEventListener(THEME_MODE_CHANGED, rerun);
    window.addEventListener(ACCENT_CHANGED, rerun);
    window.addEventListener("storage", rerun);
    return () => {
      media.removeEventListener("change", rerun);
      window.removeEventListener(THEME_MODE_CHANGED, rerun);
      window.removeEventListener(ACCENT_CHANGED, rerun);
      window.removeEventListener("storage", rerun);
    };
  }, []);
}
