/**
 * `--selftest`：不启服务，只把「打包后最容易坏的四件事」验一遍。
 *
 * 为什么值得单独留一个开关：双击闪退时用户拿不到任何信息（窗口一闪而过），而打包态坏掉的地方
 * 高度固定——快照里的前端产物、技能库、sharp 的原生库、数据目录能不能写。逐条打印比让用户
 * 描述现象有用得多，也让「在真机上验一遍」有了一个不用模型网关的入口。
 */
import { mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
// 静态 import 而不是 `await import("sharp")`：pkg 的启动器用 vm 编译快照里的模块，
// 那里面没有动态 import 的回调，`import()` 会直接抛「A dynamic import callback was not specified」。
import sharp from "sharp";
import { workshopSkillsDirOf } from "./paths.js";

export async function selfTest(resourceRoot: string, dataRoot: string): Promise<boolean> {
  const checks: [string, () => unknown][] = [
    ["前端产物", () => readFileSync(join(resourceRoot, "apps/web/dist/index.html"), "utf8").length],
    ["工坊技能库", () => readdirSync(workshopSkillsDirOf(import.meta.url)).join(", ")],
    ["随包样例剧目", () => readFileSync(join(resourceRoot, "plays/demo/play.json"), "utf8").length],
    ["数据目录可写", () => writeProbe(dataRoot)],
    [
      "sharp 原生库",
      async () => {
        const png = await sharp({ create: { width: 8, height: 8, channels: 3, background: "#ffffff" } })
          .png()
          .toBuffer();
        return `${png.length} 字节 PNG（libvips ${sharp.versions.vips}）`;
      },
    ],
  ];

  console.log(`[selftest] 资源目录 ${resourceRoot}`);
  console.log(`[selftest] 数据目录 ${dataRoot}`);
  let ok = true;
  for (const [name, check] of checks) {
    try {
      console.log(`[selftest] ✓ ${name}：${await check()}`);
    } catch (error) {
      ok = false;
      console.error(`[selftest] ✗ ${name}：${error instanceof Error ? error.message : String(error)}`);
    }
  }
  console.log(ok ? "[selftest] 全部通过" : "[selftest] 有项目没通过，见上面的 ✗");
  return ok;
}

/** 真写一个文件再删掉——只看目录存在不算数，权限问题正是要在这一步暴露。 */
function writeProbe(dataRoot: string): string {
  mkdirSync(dataRoot, { recursive: true });
  const file = join(dataRoot, ".selftest");
  writeFileSync(file, "ok");
  const content = readFileSync(file, "utf8");
  rmSync(file, { force: true });
  return content === "ok" ? dataRoot : "写进去读不出来";
}
