#!/usr/bin/env node
/**
 * 打包成单文件 exe（`@yao-pkg/pkg`）。
 *
 * 为什么要 esbuild 先过一道：pkg 打包的是 CommonJS 入口，而我们的服务是 ESM 源码（`type: module`、
 * 工作区包 `@aivn/core` 直接 import TS 构建产物）。esbuild 把整张依赖图（含工作区包）收成一个
 * CJS 文件，pkg 只需要面对一个入口 + 一个真的要动态加载的原生模块（sharp）。
 *
 * 快照里的目录结构按仓库布局摆放（`apps/web/dist`、`apps/server/skills`、`plays/demo`），
 * 因为 `apps/server/src/paths.ts` 就是这么算路径的——打包态与开发态的差别只有根在哪里。
 *
 * 用法：
 *   node scripts/build-exe.mjs                        # 打当前平台的 exe（本地验证用）
 *   node scripts/build-exe.mjs --target node22-win-x64  # 打 Windows x64
 *   node scripts/build-exe.mjs --skip-build --skip-zip  # 只重跑打包（调试构建链时用）
 */
import { execFileSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { build as esbuild } from "esbuild";
import { zipSync } from "fflate";
import { writeChecksum } from "./packaging/checksum.mjs";

const require = createRequire(import.meta.url);
const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

const argv = process.argv.slice(2);
const flag = (name) => argv.includes(`--${name}`);
const value = (name, fallback) => {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 ? argv[i + 1] : fallback;
};

const rootPkg = JSON.parse(readFileSync(join(repoRoot, "package.json"), "utf8"));
const serverPkg = JSON.parse(readFileSync(join(repoRoot, "apps/server/package.json"), "utf8"));
const sharpVersion = serverPkg.dependencies.sharp.replace(/^[\^~]/, "");

const hostTarget = `node22-${process.platform === "win32" ? "win" : process.platform}-${process.arch}`;
const target = value("target", hostTarget);
const [, nodeMajor, targetOs, targetCpu] = /^node(\d+)-(win|linux|macos|darwin)-(x64|arm64)$/.exec(target) ?? [];
if (!nodeMajor) throw new Error(`--target 不认：${target}（形如 node22-win-x64）`);
const exeSuffix = targetOs === "win" ? ".exe" : "";

const buildDir = join(repoRoot, "build");
const stageDir = join(buildDir, "exe");
const exePath = join(buildDir, `${rootPkg.name}${exeSuffix}`);
const zipPath = join(buildDir, `${rootPkg.name}-${rootPkg.version}-${targetOs}-${targetCpu}.zip`);

const step = (message) => console.log(`\n[build-exe] ${message}`);

step(`目标 ${target}（宿主 ${hostTarget}）`);

if (!flag("skip-build")) {
  step("构建工作区（pnpm -r build）");
  execFileSync("pnpm", ["-r", "build"], { cwd: repoRoot, stdio: "inherit", shell: process.platform === "win32" });
}

if (!existsSync(join(repoRoot, "apps/web/dist/index.html"))) {
  throw new Error("apps/web/dist 不存在：先跑一次 pnpm -r build 再打包（前端产物要进快照）");
}

step("清空并铺设打包目录");
rmSync(stageDir, { recursive: true, force: true });
mkdirSync(join(stageDir, "dist"), { recursive: true });

step("esbuild 把服务收成一个 CJS 入口（sharp 留在外面，它是原生模块）");
await esbuild({
  entryPoints: [join(repoRoot, "apps/server/dist/index.js")],
  outfile: join(stageDir, "dist/index.cjs"),
  bundle: true,
  platform: "node",
  format: "cjs",
  target: `node${nodeMajor}`,
  external: ["sharp"],
  // 打包后没有模块 URL 可言，`import.meta.url` 换成指向 exe 自己路径的垫片；
  // paths.ts 靠它算出「快照根」，所以这个替换必须留。
  define: { "import.meta.url": "__importMetaUrl" },
  banner: { js: 'const __importMetaUrl = require("url").pathToFileURL(__filename).href;' },
  logLevel: "info",
});

step("按仓库相对路径摆好随包资源");
for (const rel of ["apps/web/dist", "apps/server/skills", "plays/demo"]) {
  cpSync(join(repoRoot, rel), join(stageDir, rel), { recursive: true });
}

step(`装 sharp@${sharpVersion}（${targetOs}-${targetCpu}，原生模块必须与目标平台一致）`);
writeFileSync(
  join(stageDir, "package.json"),
  `${JSON.stringify(
    {
      name: rootPkg.name,
      version: rootPkg.version,
      description: rootPkg.description,
      license: rootPkg.license ?? "MIT",
      bin: "dist/index.cjs",
      pkg: {
        scripts: ["dist/**/*.cjs"],
        // pkg 只能静态看出 `require("sharp")`；sharp 真正要靠运行时按平台拼出来的
        // `@img/sharp-<平台>` 得用 assets 显式带上（它里面有 .node 与 libvips 的动态库）。
        assets: [
          "apps/web/dist/**/*",
          "apps/server/skills/**/*",
          "plays/demo/**/*",
          "node_modules/sharp/**/*",
          "node_modules/@img/**/*",
        ],
        targets: [target],
      },
    },
    null,
    2,
  )}\n`,
);

const npmArgs = ["install", "--no-save", "--no-audit", "--no-fund", `sharp@${sharpVersion}`];
if (targetOs !== (process.platform === "win32" ? "win" : process.platform) || targetCpu !== process.arch) {
  npmArgs.push(`--os=${targetOs === "win" ? "win32" : targetOs}`, `--cpu=${targetCpu}`, "--force");
}
// Windows 上 npm 是 npm.cmd，Node 从 20 起不允许不带 shell 直接 spawn 批处理（会 EINVAL）
const onWindows = process.platform === "win32";
execFileSync(onWindows ? "npm.cmd" : "npm", npmArgs, { cwd: stageDir, stdio: "inherit", shell: onWindows });

step("pkg 产出单文件 exe");
const pkgManifest = require("@yao-pkg/pkg/package.json");
const pkgBin = join(
  dirname(require.resolve("@yao-pkg/pkg/package.json")),
  typeof pkgManifest.bin === "string" ? pkgManifest.bin : pkgManifest.bin.pkg,
);
const pkgArgs = [stageDir, "--target", target, "--output", exePath];
// 交叉构建时 pkg 造不出目标平台的 V8 字节码（要用目标平台的 Node 跑一遍），只能直接带源码；
// 正式发布在 GitHub Actions 的 windows-latest 上打，那时宿主就是目标，字节码照常生成。
if (target !== hostTarget) pkgArgs.push("--no-bytecode", "--public", "--fallback-to-source");
execFileSync(process.execPath, [pkgBin, ...pkgArgs], {
  cwd: repoRoot,
  stdio: "inherit",
});
const size = (readFileSync(exePath).length / 1024 / 1024).toFixed(1);
step(`${exePath}（${size} MB）`);

if (!flag("skip-zip")) {
  step("组装 zip");
  const folder = rootPkg.name;
  const readme = readFileSync(join(repoRoot, "scripts/packaging/exe-readme.txt"), "utf8")
    .replaceAll("{{name}}", rootPkg.name)
    .replaceAll("{{version}}", rootPkg.version);
  const files = {
    [`${folder}/README.txt`]: new TextEncoder().encode(readme),
    [`${folder}/${rootPkg.name}${exeSuffix}`]: new Uint8Array(readFileSync(exePath)),
  };
  const license = join(repoRoot, "LICENSE");
  if (existsSync(license)) files[`${folder}/LICENSE`] = new Uint8Array(readFileSync(license));
  const zip = zipSync(files, { level: 6 });
  writeFileSync(zipPath, zip);
  const { digest, megabytes } = writeChecksum(zipPath);
  step(`${zipPath}（${megabytes} MB）`);
  console.log(`[build-exe] sha256  ${digest}`);
}
