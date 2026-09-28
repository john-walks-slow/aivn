import { fileURLToPath } from "node:url";
import { WebSocketServer } from "ws";
import type { Api, Model, SimpleStreamOptions, TranscriptContext } from "@earendil-works/pi-ai";
import type { ServerMessage } from "@stage-ai/core";
import { LineageTree } from "@stage-ai/core";
import { loadConfig } from "./config.js";
import { createCpaProvider } from "./provider.js";
import { PlaywrightOrchestrator } from "./orchestrator.js";
import { PlayStore } from "./store.js";
import { attachHub } from "./transport.js";

export async function main(): Promise<void> {
  const repoRoot = fileURLToPath(new URL("../../../", import.meta.url));
  const config = loadConfig(process.env, repoRoot);
  const store = new PlayStore(config.playDir);
  const play = await store.loadPlay();

  const { provider, model } = createCpaProvider(config);
  const streamFn = (m: Model<Api>, context: TranscriptContext, options?: SimpleStreamOptions) =>
    provider.stream(m as Model<"openai-completions">, context, options);

  const session = await store.loadSession();
  const tree = new LineageTree();
  if (session) tree.load(session.store);
  const engine = session?.engine ?? { ...play.initialState };
  const scene = session?.scene ?? play.initialScene;

  let sink: (msg: ServerMessage) => void = () => {};
  const orchestrator = new PlaywrightOrchestrator({
    streamFn,
    model,
    getApiKey: () => config.apiKey,
    play,
    tree,
    engine,
    scene,
    onServerMessage: (msg) => sink(msg),
    onLineageEvent: (event) => void store.appendEvent(event),
    persist: () => void store.saveSession(tree, engine, orchestrator.currentScene),
  });

  const wss = new WebSocketServer({ port: config.port });
  attachHub(
    orchestrator,
    wss,
    (fn) => {
      sink = fn;
    },
    play.characters.map(({ id, name }) => ({ id, name })),
  );

  console.log(`[stage-ai] 剧目《${play.title}》就绪  ws://127.0.0.1:${config.port}`);
}

main().catch((error) => {
  console.error("[stage-ai] 启动失败:", error);
  process.exit(1);
});
