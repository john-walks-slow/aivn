import type { ServerMessage } from "@stage-ai/core";
import { LineageTree, isVoiceId, type EngineStateSnapshot } from "@stage-ai/core";
import type { PlayLibrary, PlayStore } from "./store.js";
import { PlaywrightOrchestrator, type OrchestratorRuntimeState } from "./orchestrator.js";
import type { PlayConfig } from "@stage-ai/core";
import type { ServerConfig } from "./config.js";
import { createCpaProvider } from "./provider.js";
import { createTts } from "./tts.js";
import type { Model, SimpleStreamOptions, TranscriptContext, Api } from "@earendil-works/pi-ai";

export interface PlayRuntime {
  orchestrator: PlaywrightOrchestrator;
  store: PlayStore;
  /** hello 广播的角色名映射。 */
  cast: { id: string; name: string }[];
  /** 该剧目的 WS 客户端发送器集合（transport 注册/注销）。 */
  clients: Set<(msg: ServerMessage) => void>;
  /** 服务端 TTS 能力（配置了可用 key 才开；客户端据此显示语音开关）。 */
  voice: boolean;
}

/** 音色试听固定样本文案（素材管理页「试听」按钮）。 */
const TTS_SAMPLE_TEXT = "你好呀！这就是我的声音，以后请多多指教哦。";

/**
 * 剧目之家：多剧目 runtime 懒加载与生命周期（P2）。
 * 每剧目一个 orchestrator + 广播组；WS 客户端按 playId 路由。
 */
export class PlayHouse {
  private readonly runtimes = new Map<string, PlayRuntime>();
  private readonly provider: ReturnType<typeof createCpaProvider>["provider"];
  private readonly model: ReturnType<typeof createCpaProvider>["model"];
  private readonly tts: ReturnType<typeof createTts>;

  constructor(
    private readonly library: PlayLibrary,
    private readonly config: ServerConfig,
  ) {
    ({ provider: this.provider, model: this.model } = createCpaProvider(config));
    this.tts = createTts(config);
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
    const runtime = await this.createRuntime(store, play, tree, engine, scene, session?.runtime);
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
    const runtime = await this.createRuntime(
      store,
      play,
      new LineageTree(),
      { ...play.initialState },
      play.initialScene,
    );
    this.runtimes.set(playId, runtime);
    return runtime;
  }

  /** 删除剧目：停 runtime + 整目录移除（play.json/素材/会话，不可恢复）。 */
  async deletePlay(playId: string): Promise<void> {
    const runtime = this.runtimes.get(playId);
    if (runtime) {
      runtime.orchestrator.dispose();
      this.runtimes.delete(playId);
    }
    await this.library.remove(playId);
  }

  /** 广播到剧目客户端组。 */
  broadcast(playId: string, msg: ServerMessage): void {
    const runtime = this.runtimes.get(playId);
    if (!runtime) return;
    for (const send of runtime.clients) send(msg);
  }

  /** 音色试听（素材管理页）：合成固定样本，返回 media-cache URL。 */
  async ttsPreview(playId: string, voiceId: string): Promise<string> {
    if (!this.tts) throw new Error("服务端未启用语音（缺少 fish-audio key）");
    if (!isVoiceId(voiceId)) throw new Error("非法音色 id");
    const store = this.library.store(playId);
    const { file } = await this.tts.synthesize(TTS_SAMPLE_TEXT, voiceId, store.mediaDir());
    return `/plays/${playId}/media/tts/${file}`;
  }

  private async createRuntime(
    store: PlayStore,
    play: PlayConfig,
    tree: LineageTree,
    engine: EngineStateSnapshot,
    scene: string,
    restored?: OrchestratorRuntimeState,
  ): Promise<PlayRuntime> {
    const clients = new Set<(msg: ServerMessage) => void>();
    const { provider, model } = this;
    const tts = this.tts;
    // synth 绑定剧目 media-cache 目录与 URL 前缀（hash 缓存去重，重演不烧配额）
    const synth = tts
      ? async (text: string, voiceId: string) => {
          const { file } = await tts.synthesize(text, voiceId, store.mediaDir());
          return { url: `/plays/${play.id}/media/tts/${file}` };
        }
      : undefined;
    const orchestrator = new PlaywrightOrchestrator({
      streamFn: (m: Model<Api>, context: TranscriptContext, options?: SimpleStreamOptions) =>
        provider.stream(m as Model<"openai-completions">, context, options),
      model,
      getApiKey: () => this.config.apiKey,
      play,
      assets: await store.listAssets(),
      tree,
      engine,
      scene,
      tts: synth ? { synth, concurrency: this.config.tts.concurrency } : undefined,
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
      voice: !!synth,
    };
  }
}
