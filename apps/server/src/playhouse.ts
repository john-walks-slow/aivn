import type { ServerMessage } from "@stage-ai/core";
import { LineageTree, type EngineStateSnapshot } from "@stage-ai/core";
import type { PlayLibrary, PlayStore } from "./store.js";
import { PlaywrightOrchestrator, type OrchestratorRuntimeState } from "./orchestrator.js";
import type { PlayConfig } from "./play.js";
import type { ServerConfig } from "./config.js";
import { createCpaProvider } from "./provider.js";
import type { Model, SimpleStreamOptions, TranscriptContext, Api } from "@earendil-works/pi-ai";

export interface PlayRuntime {
  orchestrator: PlaywrightOrchestrator;
  store: PlayStore;
  /** hello 广播的角色名映射。 */
  cast: { id: string; name: string }[];
  /** 该剧目的 WS 客户端发送器集合（transport 注册/注销）。 */
  clients: Set<(msg: ServerMessage) => void>;
}

/**
 * 剧目之家：多剧目 runtime 懒加载与生命周期（P2）。
 * 每剧目一个 orchestrator + 广播组；WS 客户端按 playId 路由。
 */
export class PlayHouse {
  private readonly runtimes = new Map<string, PlayRuntime>();
  private readonly provider: ReturnType<typeof createCpaProvider>["provider"];
  private readonly model: ReturnType<typeof createCpaProvider>["model"];

  constructor(
    private readonly library: PlayLibrary,
    private readonly config: ServerConfig,
  ) {
    ({ provider: this.provider, model: this.model } = createCpaProvider(config));
  }

  /** 取或懒加载剧目 runtime（恢复既有会话）。 */
  async get(playId: string): Promise<PlayRuntime> {
    const existing = this.runtimes.get(playId);
    if (existing) return existing;

    const store = this.library.store(playId);
    const play = await store.loadPlay();
    const session = await store.loadSession();
    const tree = new LineageTree();
    if (session) tree.load(session.store);
    const engine: EngineStateSnapshot = session?.engine ?? { ...play.initialState };
    const scene = session?.scene ?? play.initialScene;
    const runtime = this.createRuntime(store, play, tree, engine, scene, session?.runtime);
    this.runtimes.set(playId, runtime);
    return runtime;
  }

  /** 「开始游戏」：清会话，重建 runtime（autostart 交由 transport 在客户端注册后触发）。 */
  async startFresh(playId: string): Promise<PlayRuntime> {
    const old = this.runtimes.get(playId);
    if (old) old.orchestrator.dispose();
    const store = this.library.store(playId);
    const play = await store.loadPlay();
    await store.resetSession();
    const runtime = this.createRuntime(
      store,
      play,
      new LineageTree(),
      { ...play.initialState },
      play.initialScene,
    );
    this.runtimes.set(playId, runtime);
    return runtime;
  }

  /** 广播到剧目客户端组。 */
  broadcast(playId: string, msg: ServerMessage): void {
    const runtime = this.runtimes.get(playId);
    if (!runtime) return;
    for (const send of runtime.clients) send(msg);
  }

  private createRuntime(
    store: PlayStore,
    play: PlayConfig,
    tree: LineageTree,
    engine: EngineStateSnapshot,
    scene: string,
    restored?: OrchestratorRuntimeState,
  ): PlayRuntime {
    const clients = new Set<(msg: ServerMessage) => void>();
    const { provider, model } = this;
    const orchestrator = new PlaywrightOrchestrator({
      streamFn: (m: Model<Api>, context: TranscriptContext, options?: SimpleStreamOptions) =>
        provider.stream(m as Model<"openai-completions">, context, options),
      model,
      getApiKey: () => this.config.apiKey,
      play,
      tree,
      engine,
      scene,
      onServerMessage: (msg) => {
        for (const send of clients) send(msg);
      },
      onLineageEvent: (event) => void store.appendEvent(event),
      persist: () => void store.saveSession(tree, engine, orchestrator.currentScene, orchestrator.runtimeState),
      restored,
    });
    return {
      orchestrator,
      store,
      cast: play.characters.map(({ id, name }) => ({ id, name })),
      clients,
    };
  }
}
