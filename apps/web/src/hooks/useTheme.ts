import { useEffect } from "react";

const STORAGE_KEY_PREFIX = "stage-ai:";
const UI_MODE_KEY = STORAGE_KEY_PREFIX + "ui-theme-mode";
const STAGE_MODE_KEY = STORAGE_KEY_PREFIX + "stage-theme-mode";

// Default mode: follow system
const DEFAULT_MODE: "system" | "light" | "dark" = "system";

// Light palette for UI (纸面)
const uiLight: Record<string, string> = {
  "--bg": "#f5f1e8",
  "--panel": "#fffcf5",
  "--panel-2": "#ede7da",
  "--ink": "#23201c",
  "--ink-soft": "#5b5348",
  "--ink-faint": "#9a9081",
  "--line": "#ded5c4",
  "--accent": "#9b3b4f",
  "--accent-ink": "#fff7f3",
  "--accent-soft": "#f4e3e2",
  "--link": "#2f5d7c",
};

// Dark palette for UI (纸面)
const uiDark: Record<string, string> = {
  "--bg": "#121212",
  "--panel": "#1e1e1e",
  "--panel-2": "#2a2a2a",
  "--ink": "#e0e0e0",
  "--ink-soft": "#b0b0b0",
  "--ink-faint": "#808080",
  "--line": "#404040",
  "--accent": "#ff6b6b",
  "--accent-ink": "#000000",
  "--accent-soft": "rgba(255,107,107,0.2)",
  "--link": "#6ecff6",
};

// Light palette for Stage (画面)
const stageLight: Record<string, string> = {
  "--stage-bg": "#fdfdfd",
  "--dialog-bg": "linear-gradient(178deg, rgb(250 250 250 / 0.8), rgb(240 240 240 / 0.9))",
  "--dialog-line": "rgb(200 200 200 / 0.6)",
  "--dialog-ink": "#23201c",
  "--dialog-ink-soft": "#5b5348",
  "--dialog-ink-thought": "#a9a6c4",
  "--dialog-shadow": "0 10px 30px rgb(0 0 0 / 0.2)",
  "--stage-radius": "10px",
  "--nameplate-bg": "#fffcf5",
  "--nameplate-ink": "#23201c",
  "--nameplate-line": "var(--accent)", // will be resolved later via UI accent
  "--sprite-dim": "0.55",
  "--choice-bg": "rgb(24 21 23 / 0.92)",
  "--choice-line": "rgb(238 226 204 / 0.4)",
  "--choice-ink": "#f2ebde",
  "--choice-active-bg": "rgb(155 59 79 / 0.55)",
  "--choice-scrim": "linear-gradient(180deg, transparent 24%, rgb(10 8 10 / 0.55))",
  "--shadow": "0 6px 18px rgb(34 24 16 / 0.16)",
};

// Dark palette for Stage (画面) – current values
const stageDark: Record<string, string> = {
  "--stage-bg": "#17130f",
  "--dialog-bg": "linear-gradient(178deg, rgb(28 24 25 / 0.9), rgb(17 15 17 / 0.94))",
  "--dialog-line": "rgb(238 226 204 / 0.55)",
  "--dialog-ink": "#f2ebde",
  "--dialog-ink-soft": "#c6bba9",
  "--dialog-ink-thought": "#a9a6c4",
  "--dialog-shadow": "0 10px 30px rgb(0 0 0 / 0.45)",
  "--stage-radius": "10px",
  "--nameplate-bg": "#fffcf5",
  "--nameplate-ink": "#23201c",
  "--nameplate-line": "var(--accent)",
  "--sprite-dim": "0.55",
  "--choice-bg": "rgb(24 21 23 / 0.92)",
  "--choice-line": "rgb(238 226 204 / 0.4)",
  "--choice-ink": "#f2ebde",
  "--choice-active-bg": "rgb(155 59 79 / 0.55)",
  "--choice-scrim": "linear-gradient(180deg, transparent 24%, rgb(10 8 10 / 0.55))",
  "--shadow": "0 6px 18px rgb(34 24 16 / 0.16)",
};

/**
 * 根据 mode 和系统偏好返回实际使用的亮/暗。
 */
function getActualMode(mode: "system" | "light" | "dark", prefersDark: boolean): "light" | "dark" {
  if (mode === "system") return prefersDark ? "dark" : "light";
  return mode;
}

/**
 * 将颜色对象写入 :root 的 CSS 自定义属性。
 */
function applyThemeVariables(vars: Record<string, string>): void {
  const root = document.documentElement.style;
  for (const [key, value] of Object.entries(vars)) {
    root.setProperty(key, value);
  }
}

/**
 * 读取本地存储中的模式；若不存在或无效则返回默认值。
 */
function getStoredMode(key: string): "system" | "light" | "dark" {
  const val = localStorage.getItem(key);
  if (val === "system" || val === "light" || val === "dark") return val as any;
  return DEFAULT_MODE;
}

/**
 * 保存模式到本地存储。
 */
function setStoredMode(key: string, mode: "system" | "light" | "dark"): void {
  localStorage.setItem(key, mode);
}

/**
 * 自定义 Hook：在组件中使用以启用主题系统。
 * 它会读取本地存储中的 UI 舞台分别模式，
 * 根据系统偏好（可变）计算实际亮/暗，
 * 并把对应的颜色变量写入 :root。
 */
export function useTheme() {
  useEffect(() => {
    // 读取存储的模式
    const uiMode = getStoredMode(UI_MODE_KEY) as "system" | "light" | "dark";
    const stageMode = getStoredMode(STAGE_MODE_KEY) as "system" | "light" | "dark";

    // 媒体查询：系统偏好
    const prefersDarkMatch = window.matchMedia("(prefers-color-scheme: dark)");
    const getPrefersDark = () => prefersDarkMatch.matches;

    // 应用主题的函数
    const applyTheme = () => {
      const prefersDark = getPrefersDark();
      const actualUiMode = getActualMode(uiMode, prefersDark);
      const actualStageMode = getActualMode(stageMode, prefersDark);

      // 选择对应的调色板
      const uiVars = actualUiMode === "light" ? uiLight : uiDark;
      const stageVars = actualStageMode === "light" ? stageLight : stageDark;

      // 合并后写入 :root
      const allVars = { ...uiVars, ...stageVars };
      applyThemeVariables(allVars);
    };

    // 初始应用
    applyTheme();

    // 监听存储变化（其他标签页的改动）
    const handleStorage = (e: StorageEvent) => {
      if (e.key === UI_MODE_KEY || e.key === STAGE_MODE_KEY) {
        applyTheme();
      }
    };
    window.addEventListener("storage", handleStorage);

    // 监听系统偏好变化
    const handlePrefersChange = () => applyTheme();
    prefersDarkMatch.addEventListener("change", handlePrefersChange);

    // 清理
    return () => {
      window.removeEventListener("storage", handleStorage);
      prefersDarkMatch.removeEventListener("change", handlePrefersChange);
    };
  }, []);
}