import { createServer } from "node:http";
import { join } from "node:path";
import { WebSocketServer } from "ws";
import { loadBootstrap } from "./config.js";
import { USAGE, UsageError, parseLaunchArgs } from "./cli.js";
import { SettingsStore, settingsPath } from "./settingsStore.js";
import { SettingsApi } from "./configApi.js";
import { resolveHost } from "./lanAccess.js";
import { defaultDataRoot, envFileDir, isPackaged, loadEnvFile, resourceRootOf } from "./paths.js";
import { selfTest } from "./selftest.js";
import { exitWhenStdinCloses, lanAddresses, listenWithFallback, openBrowser } from "./startup.js";
import { PlayLibrary } from "./store.js";
import { AssetLibrary } from "./library.js";
import { PlayHouse } from "./playhouse.js";
import { handleHttp } from "./http.js";
import { VoiceCatalogService } from "./voiceCatalog.js";
import { attachTransport } from "./transport.js";
import { WebGate } from "./webAuth.js";
import { serveWebBundle } from "./webStatic.js";

export async function main(): Promise<void> {
  const packaged = isPackaged();
  const options = parseLaunchArgs(process.argv.slice(2));
  if (options.help) {
    console.log(USAGE);
    return;
  }
  const resourceRoot = resourceRootOf(import.meta.url, packaged);
  // exe 旁边的 .env（有就读；没有也照样跑得起来——运行期设置都在设置页里）
  loadEnvFile(envFileDir(process.execPath, resourceRoot, packaged));
  const bootstrap = loadBootstrap(process.env, defaultDataRoot(process.execPath, resourceRoot, packaged), {
    port: options.port,
    host: options.host,
    dataRoot: options.dataDir,
  });

  if (options.selftest) {
    if (!(await selfTest(resourceRoot, bootstrap.dataRoot))) process.exitCode = 1;
    return;
  }

  // 设置：第一次启动把旧 .env 迁成 data/settings.json，此后它就是运行期设置的唯一真相源
  const store = SettingsStore.open(bootstrap.dataRoot, process.env);
  const config = new SettingsApi(store, bootstrap);

  const library = new PlayLibrary(join(bootstrap.dataRoot, "plays"));
  // 素材资源库：跨剧目复用的本地素材目录，用户在本地增删改，这里只读
  const assets = new AssetLibrary(join(bootstrap.dataRoot, "library"));
  const voices = new VoiceCatalogService(store, join(bootstrap.dataRoot, "media-cache/voices.json"));
  const playhouse = new PlayHouse(library, store, assets, voices);
  // 前端构建产物（pnpm -r build 之后存在）：同端口挂上，公网部署只需要一个入口。
  const webDist = join(resourceRoot, "apps/web/dist");

  const gate = new WebGate(store);
  const server = createServer((req, res) => {
    if (!gate.allow(req, res)) {
      gate.challenge(res);
      return;
    }
    void (async () => {
      if (await serveWebBundle(req, res, webDist)) return;
      await handleHttp(req, res, library, playhouse, config, assets, voices);
    })();
  });
  const wss = new WebSocketServer({ noServer: true });
  attachTransport(wss, playhouse);

  server.on("upgrade", (req, socket, head) => {
    // 闸门要先于路径判断：只挡 HTTP 不挡 upgrade，剧目内容照样从 /ws 全推出去。
    // 握手没有响应头可种 cookie，所以这一路只认已有会话（或浏览器自动补的 Basic）。
    if (!gate.allow(req)) {
      socket.write('HTTP/1.1 401 Unauthorized\r\nWWW-Authenticate: Basic realm="aivn"\r\n\r\n');
      socket.destroy();
      return;
    }
    const url = new URL(req.url ?? "/", "http://localhost");
    if (url.pathname !== "/ws") {
      socket.destroy();
      return;
    }
    wss.handleUpgrade(req, socket, head, (ws) => wss.emit("connection", ws, req));
  });

  const initialHost = resolveHost(bootstrap.host, store.get().lanAccess);
  let port = await listenWithFallback(server, bootstrap.port, initialHost);
  if (bootstrap.port !== 0 && port !== bootstrap.port) {
    console.log(`[aivn] 端口 ${bootstrap.port} 被占用，改用 ${port}`);
  }
  // 实际端口写回 bootstrap：设置页的只读回显与 lanUrls 读的是同一个对象
  bootstrap.port = port;

  const logLan = (host: string): void => {
    if (host !== "0.0.0.0") return;
    for (const address of lanAddresses()) console.log(`[aivn] 局域网  http://${address}:${port}`);
  };

  const local = `http://127.0.0.1:${port}`;
  console.log(`[aivn] 就绪  ${local}  (REST /api/plays, WS /ws?play=<id>)`);
  logLan(initialHost);

  /**
   * 「允许局域网访问」开关改了就地重绑监听地址，**端口不动**（桌面窗口与已打开的页面都在这个端口上）。
   *
   * 升级后的 WS 连接挂在同一个 socket 上，不先掐掉它们 `server.close()` 的回调永远不来；
   * 本机页面因此会掉一次 WS，客户端自己会重连。
   *
   * 这次保存请求的连接正走在「还没回完」的状态里，close() 不会碰它，得等它自己空下来——
   * 实测那样要卡住三秒。所以留一个短延时兜底：响应早就发出去了，届时强制收掉所有连接。
   */
  let activeHost = initialHost;
  let rebinding = false;
  let queuedHost: string | null = null;
  const applyHost = (target: string): void => {
    if (target === activeHost) return;
    if (rebinding) {
      queuedHost = target;
      return;
    }
    rebinding = true;
    activeHost = target;
    for (const client of wss.clients) client.terminate();
    const force = setTimeout(() => server.closeAllConnections(), 100);
    server.close(() => {
      clearTimeout(force);
      void listenWithFallback(server, port, target)
        .then((actual) => {
          if (actual !== port) {
            console.warn(`[aivn] 重绑时端口 ${port} 被占用，改用 ${actual}`);
            port = actual;
            bootstrap.port = actual;
          }
          console.log(`[aivn] 监听地址已改为 ${target}:${port}（页面会自动重连）`);
          logLan(target);
        })
        .catch((error) => console.error("[aivn] 重绑监听地址失败:", error))
        .finally(() => {
          rebinding = false;
          const next = queuedHost;
          queuedHost = null;
          if (next !== null) applyHost(next);
        });
    });
  };
  store.subscribe((next) => applyHost(resolveHost(bootstrap.host, next.lanAccess)));

  console.log(`[aivn] 数据目录  ${bootstrap.dataRoot}`);
  console.log(`[aivn] 设置文件  ${settingsPath(bootstrap.dataRoot)}（也可以在设置页里改）`);
  console.log(
    `[aivn] 访问密码 ${gate.open ? "未设置" : "已开启（HTTP Basic + 会话 cookie）"}` +
      `${gate.open ? "——挂到公网前请在设置页里设一个" : ""}`,
  );

  // 桌面壳拉起的实例：壳子一走（哪怕被强杀）stdin 管道就断，这里跟着收摊，
  // 不留一个后台服务占着端口、下次启动又和新的自己抢同一份 data/。
  if (options.exitOnStdinClose) {
    exitWhenStdinCloses(process.stdin, () => {
      console.log("[aivn] 父进程已退出，收工");
      server.close();
      process.exit(0);
    });
  }

  // 打包版默认开浏览器（双击 exe 的人期待的就是「打开就能玩」）；开发态不抢焦点，--open 可显式打开
  if (options.open ?? packaged) openBrowser(local);
}

main().catch((error) => {
  if (error instanceof UsageError) {
    console.error(`[aivn] ${error.message}\n\n${USAGE}`);
    process.exit(2);
  }
  console.error("[aivn] 启动失败:", error);
  process.exit(1);
});
