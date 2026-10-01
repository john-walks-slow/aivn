import { createServer } from "node:http";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { WebSocketServer } from "ws";
import { loadConfig } from "./config.js";
import { PlayLibrary } from "./store.js";
import { AssetLibrary } from "./library.js";
import { PlayHouse } from "./playhouse.js";
import { handleHttp } from "./http.js";
import { settingsFileFor } from "./configApi.js";
import { VoiceCatalogService } from "./voiceCatalog.js";
import { attachTransport } from "./transport.js";
import { WebGate } from "./webAuth.js";
import { serveWebBundle } from "./webStatic.js";

export async function main(): Promise<void> {
  const repoRoot = fileURLToPath(new URL("../../../", import.meta.url));
  const config = loadConfig(process.env, repoRoot);

  const library = new PlayLibrary(config.playsRoot);
  // 素材资源库：跨剧目复用的本地素材目录，用户在本地增删改，这里只读
  const assets = new AssetLibrary(config.libraryRoot);
  const playhouse = new PlayHouse(library, config, assets);
  const settings = settingsFileFor(config, repoRoot);
  const voices = new VoiceCatalogService(config, join(repoRoot, "media-cache/voices.json"));
  // 前端构建产物（pnpm -r build 之后存在）：同端口挂上，公网部署只需要一个入口。
  const webDist = join(repoRoot, "apps/web/dist");

  const gate = new WebGate(config.password);
  const server = createServer((req, res) => {
    if (!gate.allow(req, res)) {
      gate.challenge(res);
      return;
    }
    void (async () => {
      if (await serveWebBundle(req, res, webDist)) return;
      await handleHttp(req, res, library, playhouse, settings, assets, voices);
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

  await new Promise<void>((resolve) => server.listen(config.port, resolve));
  console.log(`[stage-ai] 就绪  http://127.0.0.1:${config.port}  (REST /api/plays, WS /ws?play=<id>)`);
  console.log(
    `[stage-ai] 访问密码 ${gate.open ? "未设置" : "已开启（HTTP Basic + 会话 cookie）"}` +
      `${gate.open ? "——挂到公网前请设 STAGE_PASSWORD" : ""}`,
  );
}

main().catch((error) => {
  console.error("[stage-ai] 启动失败:", error);
  process.exit(1);
});
