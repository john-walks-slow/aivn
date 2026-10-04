#!/usr/bin/env node
/**
 * 打 Windows 桌面版（Tauri 安装包）与免安装 zip。
 *
 * 一次跑完的链路：
 *
 *   1. `scripts/build-exe.mjs` 先产服务端单文件 exe 与免安装 zip（同一趟 pkg，两个交付物）；
 *   2. 那份 exe 按 Tauri 的命名规矩铺到 `apps/desktop/src-tauri/binaries/`，
 *      名字必须带目标三元组后缀（`externalBin` 就是按这个找文件的）；
 *   3. `tauri build` 把它当 sidecar 打进去，产出 NSIS 安装包；
 *   4. 安装包收到 `build/`，与 zip 放在一起，顺便报 sha256。
 *
 * **只能在 Windows 上跑**：Tauri 不能交叉编译到 Windows（要 MSVC 工具链与 WebView2），
 * 而"在 Linux 上把 Windows 的壳编出来"没有 canonical 做法。发布走
 * `.github/workflows/release.yml` 的 windows-latest，与这里同一条命令。
 *
 * 用法：
 *   node scripts/build-desktop.mjs
 *   node scripts/build-desktop.mjs --skip-build     # 复用已有的 apps/*\/dist（调试打包链时用）
 */
import { execFileSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, statSync, unlinkSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { writeChecksum } from "./packaging/checksum.mjs";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const desktopDir = join(repoRoot, "apps/desktop");
const tauriDir = join(desktopDir, "src-tauri");
const buildDir = join(repoRoot, "build");
const onWindows = process.platform === "win32";
const step = (message) => console.log(`\n[build-desktop] ${message}`);

if (!onWindows) {
  throw new Error(
    "桌面版只能在 Windows 上打（Tauri 不支持交叉编译到 Windows）。" +
      "要在本机验证服务端，请跑 `node scripts/build-exe.mjs`。",
  );
}

const rootPkg = JSON.parse(readFileSync(join(repoRoot, "package.json"), "utf8"));
assertVersionsAgree(rootPkg.version);

step("打服务端 exe 与免安装 zip");
execFileSync(process.execPath, [join(repoRoot, "scripts/build-exe.mjs"), ...(process.argv.includes("--skip-build") ? ["--skip-build"] : [])], {
  cwd: repoRoot,
  stdio: "inherit",
});

const triple = hostTriple();
const sidecar = join(tauriDir, "binaries", `aivn-server-${triple}.exe`);
step(`铺 sidecar → ${sidecar}`);
mkdirSync(dirname(sidecar), { recursive: true });
copyFileSync(join(buildDir, "aivn.exe"), sidecar);
step(`sidecar ${(statSync(sidecar).size / 1024 / 1024).toFixed(1)} MB`);

step("tauri build（NSIS 安装包）");
execFileSync("pnpm", ["exec", "tauri", "build"], {
  cwd: desktopDir,
  stdio: "inherit",
  // Windows 上 pnpm 是 pnpm.cmd，Node 20 起不带 shell 直接 spawn 批处理会 EINVAL
  shell: onWindows,
});

const nsisDir = join(tauriDir, "target/release/bundle/nsis");
const installer = readdirSync(nsisDir)
  .filter((name) => name.endsWith(".exe"))
  .map((name) => join(nsisDir, name))
  .find((path) => path.includes(rootPkg.version));
if (!installer) throw new Error(`${nsisDir} 下没找到 ${rootPkg.version} 的安装包`);

const destination = join(buildDir, `aivn-${rootPkg.version}-x64-setup.exe`);
copyFileSync(installer, destination);
// 打完就撤掉 sidecar：147MB 的副本留在源码树里，下一次 tauri build 会以为它是最新的
unlinkSync(sidecar);

for (const file of [destination, join(buildDir, `aivn-${rootPkg.version}-win-x64.zip`)]) {
  if (!existsSync(file)) continue;
  const { digest, megabytes } = writeChecksum(file);
  console.log(`[build-desktop] ${file}（${megabytes} MB）\n[build-desktop] sha256  ${digest}`);
}

/**
 * 三处版本号必须一致：根 package.json（zip 名与 exe 版本）、tauri.conf.json（安装包名与
 * 应用版本）、Cargo.toml（写进 exe 资源段）。漂了的话装出来的东西说不清是哪个版本。
 */
function assertVersionsAgree(expected) {
  const conf = JSON.parse(readFileSync(join(tauriDir, "tauri.conf.json"), "utf8"));
  const cargo = /^version\s*=\s*"([^"]+)"/m.exec(readFileSync(join(tauriDir, "Cargo.toml"), "utf8"))?.[1];
  const mismatched = [
    ["tauri.conf.json", conf.version],
    ["Cargo.toml", cargo],
  ].filter(([, version]) => version !== expected);
  if (mismatched.length > 0) {
    const detail = mismatched.map(([file, version]) => `${file} 是 ${version}`).join("、");
    throw new Error(`版本号不一致：根 package.json 是 ${expected}，${detail}。三处要一起改。`);
  }
}

/** `externalBin` 的文件名后缀必须与目标三元组对上，别手写。 */
function hostTriple() {
  try {
    return execFileSync("rustc", ["--print", "host-tuple"], { encoding: "utf8" }).trim();
  } catch {
    return "x86_64-pc-windows-msvc";
  }
}
