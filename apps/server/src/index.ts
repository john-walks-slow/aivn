import { createServer } from "node:http";
import { fileURLToPath } from "node:url";
import { WebSocketServer } from "ws";
import { loadConfig } from "./config.js";
import { PlayLibrary } from "./store.js";
import { PlayHouse } from "./playhouse.js";
import { handleHttp } from "./http.js";
import { settingsFileFor } from "./configApi.js";
import { attachTransport } from "./transport.js";

export async function main(): Promise<void> {
  const repoRoot = fileURLToPath(new URL("../../../", import.meta.url));
  const config = loadConfig(process.env, repoRoot);

  const library = new PlayLibrary(config.playsRoot);
  const playhouse = new PlayHouse(library, config);
  const settings = settingsFileFor(config, repoRoot);

  const server = createServer((req, res) => {
    void handleHttp(req, res, library, playhouse, settings);
  });
  const wss = new WebSocketServer({ noServer: true });
  attachTransport(wss, playhouse);

  server.on("upgrade", (req, socket, head) => {
    const url = new URL(req.url ?? "/", "http://localhost");
    if (url.pathname !== "/ws") {
      socket.destroy();
      return;
    }
    wss.handleUpgrade(req, socket, head, (ws) => wss.emit("connection", ws, req));
  });

  await new Promise<void>((resolve) => server.listen(config.port, resolve));
  console.log(`[stage-ai] 就绪  http://127.0.0.1:${config.port}  (REST /api/plays, WS /ws?play=<id>)`);
}

main().catch((error) => {
  console.error("[stage-ai] 启动失败:", error);
  process.exit(1);
});
