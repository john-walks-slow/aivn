#!/usr/bin/env node
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { build as esbuild } from "esbuild";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const outDir = join(repoRoot, "apps/server/assets/standalone");
mkdirSync(outDir, { recursive: true });

console.log("[build-standalone] 正在构建独立离线回放播放器...");

// 1. 构建 JS bundle
const jsResult = await esbuild({
  entryPoints: [join(repoRoot, "apps/web/src/standalone/main.tsx")],
  bundle: true,
  minify: true,
  format: "iife",
  platform: "browser",
  target: ["es2022", "chrome100", "safari15"],
  define: {
    "process.env.NODE_ENV": '"production"',
  },
  write: false,
});

if (jsResult.errors.length > 0) {
  console.error(jsResult.errors);
  process.exit(1);
}

const jsBundle = jsResult.outputFiles[0].text;
writeFileSync(join(outDir, "standalone-player.js"), jsBundle, "utf8");
console.log(`[build-standalone] JS 打包完成: ${(jsBundle.length / 1024).toFixed(1)} KB`);

// 2. 拼接 CSS bundle (包含 stage.css + 基础重置与独立播放器开屏样式)
const stageCss = readFileSync(join(repoRoot, "packages/stage/dist/stage.css"), "utf8");
const extraCss = `
html, body, #root {
  width: 100%;
  height: 100%;
  margin: 0;
  padding: 0;
  overflow: hidden;
  background: #090c12;
  color: #fff;
  font-family: system-ui, -apple-system, "Segoe UI", "PingFang SC", "Noto Sans CJK SC", "Microsoft YaHei", sans-serif;
  user-select: none;
  -webkit-user-select: none;
}

:root {
  --accent: #3b82f6;
  --accent-ink: #ffffff;
  --stage-bg: #090c12;
  --dialog-bg: linear-gradient(180deg, rgba(16, 21, 32, 0.86) 0%, rgba(9, 12, 19, 0.95) 100%);
  --dialog-line: rgba(255, 255, 255, 0.16);
  --dialog-ink: #f8fafc;
  --dialog-ink-soft: #cbd5e1;
  --dialog-ink-thought: #c4b5fd;
  --dialog-ink-faint: rgba(248, 250, 252, 0.55);
  --dialog-bad: #fb7185;
  --dialog-text-shadow: 0 1px 4px rgba(0, 0, 0, 0.7);
  --dir-text-shadow: 0 1px 2px rgba(0, 0, 0, 0.6);
  --dialog-hover: rgba(255, 255, 255, 0.12);
  --dialog-veil: rgba(255, 255, 255, 0.06);
  --dialog-shadow: 0 16px 48px rgba(0, 0, 0, 0.65), 0 0 0 1px rgba(255, 255, 255, 0.08);
  --stage-radius: 12px;
  --nameplate-bg: rgba(255, 255, 255, 0.98);
  --nameplate-ink: #0f172a;
  --nameplate-line: var(--character-color, var(--accent, #3b82f6));
  --sprite-dim: 0.55;
  --choice-bg: linear-gradient(180deg, rgba(22, 28, 42, 0.9) 0%, rgba(13, 17, 26, 0.96) 100%);
  --choice-line: rgba(255, 255, 255, 0.18);
  --choice-ink: #f8fafc;
  --choice-active-bg: color-mix(in srgb, var(--accent) 35%, rgba(22, 28, 42, 0.95));
  --choice-scrim: linear-gradient(180deg, transparent 20%, rgba(8, 10, 16, 0.65) 100%);
  --fade-ms: 220ms;
  --move-ms: 380ms;
  --act-ms: 520ms;
  --type-ms: 35;
  --pause-short-ms: 120;
  --pause-long-ms: 240;
}

.stage-screen {
  position: relative;
  width: 100%;
  height: 100%;
  overflow: hidden;
  background: var(--stage-bg, #090c12);
  display: flex;
  flex-direction: column;
}

.standalone-player .theater-director {
  display: none !important;
}

.standalone-start-screen,
.standalone-loading-screen,
.standalone-error-screen {
  position: fixed;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  background: radial-gradient(circle at center, #1e293b 0%, #020617 100%);
  z-index: 1000;
  padding: 24px;
}

.standalone-title-card,
.standalone-card {
  max-width: 560px;
  width: 100%;
  background: rgba(15, 23, 42, 0.75);
  backdrop-filter: blur(16px);
  -webkit-backdrop-filter: blur(16px);
  border: 1px solid rgba(255, 255, 255, 0.12);
  border-radius: 16px;
  padding: 36px 32px;
  text-align: center;
  box-shadow: 0 20px 40px rgba(0, 0, 0, 0.5);
}

.standalone-play-title {
  margin: 0 0 16px;
  font-size: 28px;
  font-weight: 700;
  color: #fff;
  letter-spacing: 0.5px;
}

.standalone-play-opening {
  margin: 0 0 28px;
  font-size: 14px;
  line-height: 1.7;
  color: #94a3b8;
  text-align: justify;
}

.standalone-start-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  background: #3b82f6;
  color: #fff;
  border: none;
  border-radius: 8px;
  padding: 12px 32px;
  font-size: 16px;
  font-weight: 600;
  cursor: pointer;
  transition: all 0.2s;
  box-shadow: 0 4px 14px rgba(59, 130, 246, 0.4);
}

.standalone-start-btn:hover {
  background: #2563eb;
  transform: translateY(-1px);
}

.standalone-subtext {
  display: block;
  margin-top: 16px;
  font-size: 12px;
  color: #64748b;
}

.standalone-loading-spinner {
  width: 36px;
  height: 36px;
  border: 3px solid rgba(255, 255, 255, 0.15);
  border-top-color: #3b82f6;
  border-radius: 50%;
  animation: standalone-spin 0.8s linear infinite;
  margin-bottom: 16px;
}

@keyframes standalone-spin {
  to { transform: rotate(360deg); }
}

.standalone-toast-banner {
  position: fixed;
  bottom: 80px;
  left: 50%;
  transform: translateX(-50%);
  background: rgba(15, 23, 42, 0.92);
  border: 1px solid rgba(255, 255, 255, 0.18);
  color: #f8fafc;
  padding: 10px 20px;
  border-radius: 8px;
  font-size: 14px;
  backdrop-filter: blur(8px);
  z-index: 999;
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.4);
  animation: standalone-fade-in 0.2s ease-out;
}

@keyframes standalone-fade-in {
  from { opacity: 0; transform: translate(-50%, 8px); }
  to { opacity: 1; transform: translate(-50%, 0); }
}
`;

const cssBundle = stageCss + "\n" + extraCss;
writeFileSync(join(outDir, "standalone-player.css"), cssBundle, "utf8");
console.log(`[build-standalone] CSS 打包完成: ${(cssBundle.length / 1024).toFixed(1)} KB`);
console.log("[build-standalone] 完成！产物位于 apps/server/assets/standalone/");
