#!/usr/bin/env node
/**
 * 生成应用图标。
 *
 * 唯一的手写源是 `apps/desktop/icon.svg`；跑一次这个脚本会生成
 * `apps/desktop/icon.png`（1024，tauri icon 的输入）、`apps/desktop/src-tauri/icons/` 全套
 * （含 Windows 的 .ico）以及网页端的 `apps/web/public/favicon.ico`。
 *
 * 产物都是提交进仓库的：图标是设计资产不是构建产物，装一次就知道长什么样，不该每次构建重画。
 * 改了 SVG 才需要重跑（命令见 README「改图标」一段）。
 *
 * 为什么用 sharp 而不是装一整套 ImageMagick/librsvg CLI：服务端本来就依赖 sharp，
 * 它自带的 libvips 就能栅格化 SVG，少一个系统依赖。
 */
import { execFileSync } from "node:child_process";
import { copyFileSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const desktopDir = join(repoRoot, "apps/desktop");
// sharp 装在 apps/server 下（工作区不提升依赖），按包名解析而不是按路径猜
const require = createRequire(join(repoRoot, "apps/server/package.json"));
const sharp = require("sharp");

const source = readFileSync(join(desktopDir, "icon.svg"));
const png = await sharp(source).resize(1024, 1024).png().toBuffer();
writeFileSync(join(desktopDir, "icon.png"), png);
console.log(`[icon] apps/desktop/icon.png（${(png.length / 1024).toFixed(1)} KB）`);

execFileSync("pnpm", ["exec", "tauri", "icon", "icon.png"], {
  cwd: desktopDir,
  stdio: "inherit",
  // Windows 上 pnpm 是 pnpm.cmd，Node 20 起不带 shell 直接 spawn 批处理会 EINVAL
  shell: process.platform === "win32",
});

// 桌面端用不到这两个平台，留着只会让人以为我们也发手机版
for (const dir of ["android", "ios"]) {
  rmSync(join(desktopDir, "src-tauri/icons", dir), { recursive: true, force: true });
}

// 浏览器里打开的也是同一个应用，标签页不该是一张白纸
const webPublic = join(repoRoot, "apps/web/public");
mkdirSync(webPublic, { recursive: true });
copyFileSync(join(desktopDir, "src-tauri/icons/icon.ico"), join(webPublic, "favicon.ico"));
console.log("[icon] apps/web/public/favicon.ico");
