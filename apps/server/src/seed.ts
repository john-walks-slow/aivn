/**
 * 随包样例剧目的解包。
 *
 * 打包后的 `plays/demo` 躺在只读快照里，用户的数据目录是另一处；第一次启动时把样例拷过去，
 * 双击 exe 的人才有东西可看（否则打开就是一座空剧场，还得先自己造一个剧目）。
 *
 * 只在数据目录里**一个剧目都没有**时拷——用户删掉样例是明确的态度，不该每次启动又给他放回来。
 */
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";

/**
 * 自己走一遍目录树，不用 `cpSync`：pkg 的虚拟文件系统里 `readdir` / `stat` / `readFile` 都能用，
 * 但 `cpSync` 内部那套调用会 ENOENT（实测：文件读得到，`cpSync` 直接报目录不存在）。
 */
function copyTree(source: string, target: string): void {
  mkdirSync(target, { recursive: true });
  for (const name of readdirSync(source)) {
    const from = join(source, name);
    const to = join(target, name);
    if (statSync(from).isDirectory()) copyTree(from, to);
    else writeFileSync(to, readFileSync(from));
  }
}

/** 返回解开的目标目录；没什么可做时返回 null。 */
export function seedDemoPlays(dataRoot: string, resourceRoot: string): string | null {
  const source = join(resourceRoot, "plays", "demo");
  if (!existsSync(join(source, "play.json"))) return null;

  const playsRoot = join(dataRoot, "plays");
  if (existsSync(playsRoot) && readdirSync(playsRoot, { withFileTypes: true }).some((e) => e.isDirectory())) {
    return null;
  }

  const target = join(playsRoot, "demo");
  copyTree(source, target);
  return target;
}
