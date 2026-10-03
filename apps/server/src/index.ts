import { createServer } from "node:http";
import { join } from "node:path";
import { WebSocketServer } from "ws";
import { loadBootstrap } from "./config.js";
import { USAGE, UsageError, parseLaunchArgs } from "./cli.js";
import { SettingsStore, settingsPath } from "./settingsStore.js";
import { SettingsApi } from "./configApi.js";
import { defaultDataRoot, envFileDir, isPackaged, loadEnvFile, resourceRootOf } from "./paths.js";
import { seedDemoPlays } from "./seed.js";
import { selfTest } from "./selftest.js";
import { lanAddresses, listenWithFallback, openBrowser } from "./startup.js";
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

  // 双击 exe 的人打开就是一座空剧场，所以第一次启动先把随包的样例剧目解开
  const seeded = seedDemoPlays(bootstrap.dataRoot, resourceRoot);
  if (seeded) console.log(`[stage-ai] 已把随包样例剧目解到 ${seeded}`);

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
      socket.write('HTTP/1.1 401 Unauthorized\r\nWWW-Authenticate: Basic realm="stage-ai"\r\n\r\n');
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

  const port = await listenWithFallback(server, bootstrap.port, bootstrap.host);
  if (port !== bootstrap.port) console.log(`[stage-ai] 端口 ${bootstrap.port} 被占用，改用 ${port}`);

  const local = `http://127.0.0.1:${port}`;
  console.log(`[stage-ai] 就绪  ${local}  (REST /api/plays, WS /ws?play=<id>)`);
  if (bootstrap.host === "0.0.0.0") {
    for (const address of lanAddresses()) console.log(`[stage-ai] 局域网  http://${address}:${port}`);
  }
  console.log(`[stage-ai] 数据目录  ${bootstrap.dataRoot}`);
  console.log(`[stage-ai] 设置文件  ${settingsPath(bootstrap.dataRoot)}（也可以在设置页里改）`);
  console.log(
    `[stage-ai] 访问密码 ${gate.open ? "未设置" : "已开启（HTTP Basic + 会话 cookie）"}` +
      `${gate.open ? "——挂到公网前请在设置页里设一个" : ""}`,
  );

  // 打包版默认开浏览器（双击 exe 的人期待的就是「打开就能玩」）；开发态不抢焦点，--open 可显式打开
  if (options.open ?? packaged) openBrowser(local);
}

main().catch((error) => {
  if (error instanceof UsageError) {
    console.error(`[stage-ai] ${error.message}\n\n${USAGE}`);
    process.exit(2);
  }
  console.error("[stage-ai] 启动失败:", error);
  process.exit(1);
});
