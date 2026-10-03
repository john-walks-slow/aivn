/**
 * 启动期与操作系统打交道的那点事：抢端口、开浏览器、报局域网地址。
 *
 * 放在单独一个文件里，是因为它们都**只在进程启动时发生一次**，与运行期的设置/播出无关；
 * 混进 `index.ts` 会让那条「组装依赖 → 起服务」的主线被平台分支淹没。
 */
import { spawn } from "node:child_process";
import type { Server } from "node:http";
import { networkInterfaces } from "node:os";

/**
 * 从 `port` 起找一个能听的端口并返回实际端口。
 *
 * 双击 exe 的用户没法改端口也不该被迫懂端口：默认端口被别的程序占了就往后让一位，
 * 并让调用方把「实际用的是哪个口」打出来——静默换口才是真的坑。
 */
export async function listenWithFallback(server: Server, port: number, host: string, span = 20): Promise<number> {
  for (let candidate = port; candidate < port + span; candidate++) {
    try {
      await new Promise<void>((resolve, reject) => {
        const onError = (error: NodeJS.ErrnoException) => {
          server.off("listening", onListening);
          reject(error);
        };
        const onListening = () => {
          server.off("error", onError);
          resolve();
        };
        server.once("error", onError);
        server.once("listening", onListening);
        server.listen(candidate, host);
      });
      return candidate;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EADDRINUSE") throw error;
    }
  }
  throw new Error(`端口 ${port}–${port + span - 1} 都被占用，用 --port 指定一个空闲端口`);
}

/** 本机在局域网里的 IPv4 地址（优先 192.168/10./172.16–31 这些私网段）。 */
export function lanAddresses(): string[] {
  const privateFirst: string[] = [];
  const others: string[] = [];
  for (const list of Object.values(networkInterfaces())) {
    for (const info of list ?? []) {
      if (info.internal || info.family !== "IPv4") continue;
      (isPrivateV4(info.address) ? privateFirst : others).push(info.address);
    }
  }
  return [...new Set([...privateFirst, ...others])];
}

/** 10/8、172.16/12、192.168/16 三段私网地址。 */
function isPrivateV4(address: string): boolean {
  const [a = 0, b = 0] = address.split(".").map(Number);
  return a === 10 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168);
}

/**
 * 用系统默认浏览器打开一个地址。
 *
 * 打不开就算了：headless 环境（CI、容器）里报一句日志继续跑，不能因为开不了浏览器就让服务起不来。
 */
export function openBrowser(url: string): void {
  const [command, args] =
    process.platform === "win32"
      ? ["cmd", ["/c", "start", "", url]] // start 是 cmd 内建命令；第一个空参数是它要的「窗口标题」
      : process.platform === "darwin"
        ? ["open", [url]]
        : ["xdg-open", [url]];
  try {
    const child = spawn(command, args, { detached: true, stdio: "ignore" });
    child.on("error", (error) => console.warn(`[stage-ai] 没打开浏览器（${error.message}），请手动访问 ${url}`));
    child.unref();
  } catch (error) {
    console.warn(`[stage-ai] 没打开浏览器（${String(error)}），请手动访问 ${url}`);
  }
}
