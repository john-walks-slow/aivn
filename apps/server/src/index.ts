import { createServer } from "node:http";
import { join } from "node:path";
import { WebSocketServer } from "ws";
import { loadBootstrap } from "./config.js";
import { SettingsStore, settingsPath } from "./settingsStore.js";
import { SettingsApi } from "./configApi.js";
import { defaultDataRoot, envFileDir, isPackaged, loadEnvFile, resourceRootOf } from "./paths.js";
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
  const resourceRoot = resourceRootOf(import.meta.url, packaged);
  // exe 旁边的 .env（有就读；没有也照样跑得起来——运行期设置都在设置页里）
  loadEnvFile(envFileDir(process.execPath, resourceRoot, packaged));
  const bootstrap = loadBootstrap(process.env, defaultDataRoot(process.execPath, resourceRoot, packaged));

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

  await new Promise<void>((resolve) => server.listen(bootstrap.port, bootstrap.host, resolve));
  console.log(`[stage-ai] 就绪  http://127.0.0.1:${bootstrap.port}  (REST /api/plays, WS /ws?play=<id>)`);
  console.log(`[stage-ai] 数据目录  ${bootstrap.dataRoot}`);
  console.log(`[stage-ai] 设置文件  ${settingsPath(bootstrap.dataRoot)}（也可以在设置页里改）`);
  if (bootstrap.host === "0.0.0.0") {
    console.log(`[stage-ai] 监听 0.0.0.0：同一局域网的手机/平板打开 http://<本机 IP>:${bootstrap.port} 即可`);
  }
  console.log(
    `[stage-ai] 访问密码 ${gate.open ? "未设置" : "已开启（HTTP Basic + 会话 cookie）"}` +
      `${gate.open ? "——挂到公网前请在设置页里设一个" : ""}`,
  );
}

main().catch((error) => {
  console.error("[stage-ai] 启动失败:", error);
  process.exit(1);
});
