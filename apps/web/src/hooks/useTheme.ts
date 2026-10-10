import { useEffect } from "react";

const STORAGE_KEY_PREFIX = "aivn:";
const UI_MODE_KEY = STORAGE_KEY_PREFIX + "ui-theme-mode";
const ACCENT_KEY = STORAGE_KEY_PREFIX + "accent";
const ACCENT_CUSTOM_KEY = STORAGE_KEY_PREFIX + "accent-custom";

/** 偏好：system=跟系统当场算，light/dark=写死。 */
export type ThemeMode = "system" | "light" | "dark";

/** 界面主题默认跟系统（白天纸面、夜里暗纸）。 */
export const DEFAULT_UI_MODE: ThemeMode = "system";

/** 本标签页改偏好时由设置页广播：storage 事件只发到别的标签页。 */
export const THEME_MODE_CHANGED = "aivn:theme-mode-changed";
export const ACCENT_CHANGED = "aivn:accent-changed";

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
  // 舞台恒深色：画面衬底本来就该压住背景图的亮部，跟系统走会在亮系统下读成白底空画布。
  // 2026-10-10 起设置项下线（舞台主题不再是用户可选项），属性照写——
  // 浅色那套令牌与选择器还在 stage.css / app.css 里，等「舞台要不要保留明暗概念」定了再删。
  root.dataset.stageTheme = "dark";
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
const INK_LIGHT = "#ffffff";
const INK_DARK = "#0e1a1b";

function channel(v: number): number {
  const s = v / 255;
  return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
}

/** 相对亮度；认不出的写法回 null（宁可回落到白字，也别把颜色改坏）。 */
export function luminance(hex: string): number | null {
  const m = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(hex.trim());
  const group = m?.[1];
  if (!group) return null;
  const raw = group.length === 3 ? group.split("").map((c) => c + c).join("") : group;
  return (
    0.2126 * channel(parseInt(raw.slice(0, 2), 16)) +
    0.7152 * channel(parseInt(raw.slice(2, 4), 16)) +
    0.0722 * channel(parseInt(raw.slice(4, 6), 16))
  );
}

function contrast(a: number, b: number): number {
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
}

/**
 * 自定义主色的配套墨色。预设色是成对的（`--accent` + `--accent-ink` 一起给），
 * 自己挑的只有一个色——不给它配墨色，浅色主色上就是白字（实测 1.41:1，等于看不见）。
 * 取白字与深字里更清楚的那个。
 */
export function readableInk(hex: string): string {
  const lum = luminance(hex);
  const dark = luminance(INK_DARK) ?? 0;
  if (lum === null) return INK_LIGHT;
  return contrast(lum, 1) >= contrast(lum, dark) ? INK_LIGHT : INK_DARK;
}

export function applyAccent(): void {
  const root = document.documentElement;
  const { id, custom } = readAccent();
  root.dataset.accent = id;
  if (id === "custom") {
    root.style.setProperty("--accent", custom);
    root.style.setProperty("--accent-ink", readableInk(custom));
  } else {
    root.style.removeProperty("--accent");
    root.style.removeProperty("--accent-ink");
  }
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
