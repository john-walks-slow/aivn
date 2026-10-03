/**
 * 运行期路径：同一份代码要跑在「仓库里开发」与「打包后的 exe」两种形态里，差别只有两处。
 *
 * - **只读资源**（前端构建产物、技能库、样例剧目）跟着代码走：仓库里是 `<repo>/apps/web/dist`
 *   这样的路径，打包后是 pkg 虚拟快照里的同一批文件（快照根就是仓库根）。
 * - **数据**（剧目、素材库、缓存、settings.json）必须落在用户看得见、能备份的地方：
 *   打包后是 **exe 同级的 `data/`**。写进快照是写不进去的，写进 `%APPDATA%` 则用户找不到自己的剧本。
 */
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

/** 是否跑在 pkg 打出来的单文件里。 */
export function isPackaged(): boolean {
  return (process as { pkg?: unknown }).pkg !== undefined;
}

/**
 * 只读资源根。
 *
 * 开发时入口是 `<repo>/apps/server/dist/index.js`，往上三层是仓库根；
 * 打包后入口是 `<快照>/dist/index.cjs`，上一层就是快照根（快照内保持仓库的相对结构）。
 */
export function resourceRootOf(metaUrl: string, packaged = isPackaged()): string {
  return fileURLToPath(new URL(packaged ? "../" : "../../../", metaUrl));
}

/** 数据根默认位置：打包后是 exe 同级的 `data/`，开发时就是仓库根（plays/ 一直在那儿）。 */
export function defaultDataRoot(execPath: string, resourceRoot: string, packaged = isPackaged()): string {
  return packaged ? join(dirname(execPath), "data") : resourceRoot;
}

/** `.env` 放哪儿：打包后放 exe 旁边（用户看得见），开发时是仓库根。 */
export function envFileDir(execPath: string, resourceRoot: string, packaged = isPackaged()): string {
  return packaged ? dirname(execPath) : resourceRoot;
}

/**
 * 工坊技能库（`read_skill` 读的那些 `SKILL.md`）。
 *
 * 开发时入口是 `<repo>/apps/server/dist/skills.js`，往回一层就是同模块的 `apps/server/skills`；
 * 打包后入口在 `<快照>/dist/index.cjs`，得从快照根接上仓库里的相对路径。
 */
export function workshopSkillsDirOf(metaUrl: string, packaged = isPackaged()): string {
  return packaged
    ? join(resourceRootOf(metaUrl, true), "apps", "server", "skills")
    : join(dirname(fileURLToPath(metaUrl)), "..", "skills");
}

/**
 * 读一份 `.env`，读不到就当没有。
 *
 * 开发脚本用 `node --env-file=../../.env` 做同一件事；exe 没有命令行前缀可用，于是自己读一次——
 * 想改端口或数据目录的人只需要在 exe 旁边放一个 `.env`，不必学会设环境变量。
 * 运行期设置（网关、密钥、生图…）不走这里，它们只认 `data/settings.json`。
 */
export function loadEnvFile(dir: string): string | null {
  const file = join(dir, ".env");
  if (!existsSync(file)) return null;
  try {
    process.loadEnvFile(file);
    return file;
  } catch (error) {
    console.warn(
      `[stage-ai] ${file} 读取失败（${error instanceof Error ? error.message : String(error)}），继续用当前环境变量`,
    );
    return null;
  }
}
