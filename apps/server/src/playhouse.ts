import type { ServerMessage } from "@stage-ai/core";
import { LineageTree, isVoiceId, type EngineStateSnapshot } from "@stage-ai/core";
import type { PlayLibrary, PlayStore } from "./store.js";
import { PlaywrightOrchestrator, type OrchestratorRuntimeState } from "./orchestrator.js";
import type { PlayConfig } from "@stage-ai/core";
import type { ServerConfig } from "./config.js";
import { createCpaProvider } from "./provider.js";
import { createTts } from "./tts.js";
import { Translator } from "./translate.js";
import { PlayMemory } from "./memory.js";
import { WorkshopSession } from "./workshopSession.js";
import { completeText } from "./llm.js";
import type { StreamFn } from "@earendil-works/pi-agent-core";
import type { Model } from "@earendil-works/pi-ai";

export interface PlayRuntime {
  orchestrator: PlaywrightOrchestrator;
  /** 工坊（D9）：与演出并行的一条独立 agent 通道，管剧目文件的创建与维护。 */
  workshop: WorkshopSession;
  store: PlayStore;
  /** hello 广播的角色名映射。 */
  cast: { id: string; name: string }[];
  /** 服务端 TTS 能力（配置了可用 key 才开；客户端据此显示语音开关）。 */
  voice: boolean;
  /** 语音合成闭包（含语音语言翻译）：ttsPreview 复用同路径。 */
  synth?: (text: string, voiceId: string) => Promise<{ url: string }>;
}

/** hello 载荷（transport 连接建立与 reload 续接共用）。 */
export function helloPayload(playId: string, runtime: PlayRuntime): ServerMessage {
  return {
    type: "hello",
    sessionId: playId,
    lastSeq: runtime.orchestrator.lastSeq,
    cast: runtime.cast,
    voice: runtime.voice,
  };
}

/** 音色试听固定样本文案（素材管理页「试听」按钮）。 */
const TTS_SAMPLE_TEXT = "你好呀！这就是我的声音，以后请多多指教哦。";

/**
 * 剧目之家：多剧目 runtime 懒加载与生命周期（P2）。
 * 每剧目一个 orchestrator + 广播组；WS 客户端按 playId 路由。
 */
export class PlayHouse {
  private readonly runtimes = new Map<string, PlayRuntime>();
  /** 每剧目 WS 客户端发送器集合：与 runtime 生命周期解耦——配置保存重建 runtime 不断连接。 */
  private readonly clientsByPlay = new Map<string, Set<(msg: ServerMessage) => void>>();
  private readonly provider: ReturnType<typeof createCpaProvider>["provider"];
  private readonly model: ReturnType<typeof createCpaProvider>["model"];
  private readonly tts: ReturnType<typeof createTts>;
  /** 演出编排与润色/翻译旁路共用的流式调用入口。 */
  private readonly streamFn: StreamFn;

  constructor(
    private readonly library: PlayLibrary,
    private readonly config: ServerConfig,
  ) {
    ({ provider: this.provider, model: this.model } = createCpaProvider(config));
    this.tts = createTts(config);
    // StreamFn 契约是 SimpleStreamOptions（reasoning 字段）——须接 streamSimple 做换算；
    // 错接完整版 stream 会丢弃 reasoning，thinking 档位全部失效
    this.streamFn = (m, context, options) =>
      this.provider.streamSimple(m as Model<"openai-completions">, context, options);
  }

  /** 取或懒加载剧目 runtime（恢复既有会话）。 */
  async get(playId: string): Promise<PlayRuntime> {
    const existing = this.runtimes.get(playId);
    if (existing) return existing;
    const runtime = await this.buildRuntime(playId);
    this.runtimes.set(playId, runtime);
    return runtime;
  }

  /** 从磁盘构建剧目 runtime（play.json + 会话恢复）。 */
  private async buildRuntime(playId: string): Promise<PlayRuntime> {
    const store = this.library.store(playId);
    const play = await store.loadPlay();
    const session = await store.loadSession();
    const tree = new LineageTree();
    if (session) tree.load(session.store);
    const engine: EngineStateSnapshot = session?.engine ?? {
      ...play.initialState,
    };
    const scene = session?.scene ?? play.initialScene;
    return this.createRuntime(store, play, tree, engine, scene, session?.runtime);
  }

  /** 剧目 WS 客户端集合（transport 连接注册，懒建）。 */
  clientsFor(playId: string): Set<(msg: ServerMessage) => void> {
    let clients = this.clientsByPlay.get(playId);
    if (!clients) {
      clients = new Set();
      this.clientsByPlay.set(playId, clients);
    }
    return clients;
  }

  /** 剧目配置/素材保存后重建 runtime：play.json 即时生效（音色/主角卡/语音语言/素材清单），活连接续接。 */
  async reload(playId: string): Promise<void> {
    const old = this.runtimes.get(playId);
    if (!old) return;
    const fresh = await this.buildRuntime(playId);
    old.orchestrator.dispose();
    this.runtimes.set(playId, fresh);
    // 续接广播：hello 刷新 cast/voice；停止点重放恢复被中断连接的交互面板
    const clients = this.clientsByPlay.get(playId);
    if (!clients?.size) return;
    const hello = helloPayload(playId, fresh);
    for (const send of clients) send(hello);
    const replay = fresh.orchestrator.stoppedReplay;
    if (replay) for (const send of clients) send(replay);
  }

  /** 「开始游戏」：清会话，重建 runtime（autostart 交由 transport 在客户端注册后触发）。 */
  async startFresh(playId: string): Promise<PlayRuntime> {
    const old = this.runtimes.get(playId);
    if (old) old.orchestrator.dispose();
    await this.library.store(playId).resetSession();
    const runtime = await this.buildRuntime(playId);
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
    this.clientsByPlay.delete(playId);
    await this.library.remove(playId);
  }

  /**
   * 工坊写盘后重建 runtime（保存即生效，P4 铁律）。
   * 与 reload 的区别：工坊会话本身**不能**被重建（不然正在进行的对话与线程现场会被打断），
   * 所以只换编排器、复用同一个 workshop 实例（其 files/threads 直读磁盘，无需刷新）。
   */
  private async reloadAfterWorkshopWrite(playId: string): Promise<void> {
    const old = this.runtimes.get(playId);
    if (!old) return;
    // 等节拍边界：演出进行中重建会让这一拍凭空消失
    await old.orchestrator.whenIdle();
    // 等待期间可能已 reload/startFresh/删除——只在原实例还在位时才替换
    if (this.runtimes.get(playId) !== old) return;
    const fresh = await this.buildRuntime(playId);
    const runtime = { ...fresh, workshop: old.workshop };
    old.orchestrator.dispose();
    this.runtimes.set(playId, runtime);
    const clients = this.clientsByPlay.get(playId);
    if (!clients?.size) return;
    for (const send of clients) send(helloPayload(playId, runtime));
    // 重建后交互面板要恢复：停在停止点上时客户端得重新拿到那一拍的选项
    const replay = runtime.orchestrator.stoppedReplay;
    if (replay) for (const send of clients) send(replay);
  }

  /** 广播到剧目客户端组。 */
  broadcast(playId: string, msg: ServerMessage): void {
    const clients = this.clientsByPlay.get(playId);
    if (clients) for (const send of clients) send(msg);
  }

  /** 音色试听（素材管理页）：经 runtime.synth（含语音语言翻译）合成固定样本。 */
  async ttsPreview(playId: string, voiceId: string): Promise<string> {
    if (!this.tts) throw new Error("服务端未启用语音（缺少 fish-audio key）");
    if (!isVoiceId(voiceId)) throw new Error("非法音色 id");
    const runtime = await this.get(playId);
    if (!runtime.synth) throw new Error("服务端未启用语音（缺少 fish-audio key）");
    const { url } = await runtime.synth(TTS_SAMPLE_TEXT, voiceId);
    return url;
  }

  /** 玩家输入润色（P4）：按主角角色卡口吻改写，保意不加戏。 */
  async polish(playId: string, text: string): Promise<string> {
    const store = this.library.store(playId);
    const play = await store.loadPlay();
    const protagonist = play.protagonist;
    const system = [
      "你是视觉小说的玩家输入润色器，把玩家的原始输入改写成主角会说出的台词。",
      "- 保留原意与全部关键信息，不添加新的动作、剧情或决定",
      "- 保持原文语言与大致长度，口语自然",
      "- 只输出润色后的台词本身，不加引号或任何解释",
      protagonist && (protagonist.name || protagonist.persona)
        ? `\n主角设定：${protagonist.name || "（未命名）"}\n${protagonist.persona}`
        : "\n（未设置主角卡：保留玩家原声，只修顺语句）",
    ].join("\n");
    return completeText(
      {
        streamFn: this.streamFn,
        model: this.model,
        getApiKey: () => this.config.apiKey,
      },
      system,
      text,
    );
  }

  private async createRuntime(
    store: PlayStore,
    play: PlayConfig,
    tree: LineageTree,
    engine: EngineStateSnapshot,
    scene: string,
    restored?: OrchestratorRuntimeState,
  ): Promise<PlayRuntime> {
    const { model } = this;
    const tts = this.tts;
    // 剧目记忆（D7 三层）：craft/premise/index 随 runtime 重建读入（工坊热改走 reload 即时生效）
    const memory = await PlayMemory.load(store);
    // 语音语言翻译（D5）：say 短语 → voiceLanguage 后再入 TTS；失败回退原文，不阻塞演出
    const translator =
      tts && play.voiceLanguage
        ? new Translator(
            {
              streamFn: this.streamFn,
              model,
              getApiKey: () => this.config.apiKey,
            },
            play.voiceLanguage,
          )
        : null;
    // synth 绑定剧目 media-cache 目录与 URL 前缀（hash 缓存去重，重演不烧配额）
    const synth = tts
      ? async (text: string, voiceId: string) => {
          let spoken = text;
          if (translator) {
            try {
              spoken = await translator.translate(text);
            } catch (error) {
              console.warn(
                `[stage-ai] 台词翻译失败（回退原文）: ${error instanceof Error ? error.message : String(error)}`,
              );
            }
          }
          const { file } = await tts.synthesize(spoken, voiceId, store.mediaDir());
          return { url: `/plays/${play.id}/media/tts/${file}` };
        }
      : undefined;
    const orchestrator = new PlaywrightOrchestrator({
      streamFn: this.streamFn,
      model,
      getApiKey: () => this.config.apiKey,
      play,
      assets: await store.listAssets(),
      memory,
      tree,
      engine,
      scene,
      tts: synth ? { synth, concurrency: this.config.tts.concurrency } : undefined,
      compaction: {
        contextWindow: this.config.contextWindow,
        triggerRatio: this.config.compactRatio,
        keepRecentTokens: this.config.keepRecentTokens,
      },
      onServerMessage: (msg) => {
        for (const send of this.clientsFor(play.id)) send(msg);
      },
      onLineageEvent: (event) => void store.appendEvent(event),
      // 透传落盘 Promise：whenIdle 要等它落地，重建 runtime 才敢 loadSession
      persist: (): Promise<void> =>
        store.saveSession(tree, engine, orchestrator.currentScene, orchestrator.runtimeState),
      restored,
    });
    // 工坊（D9）：独立实例，与演出互不干扰；写盘后按需重建 runtime（保存即生效）
    const workshop = new WorkshopSession({
      store,
      streamFn: this.streamFn,
      model,
      getApiKey: () => this.config.apiKey,
      emit: (msg) => this.broadcast(play.id, msg),
      onFilesChanged: () => void this.reloadAfterWorkshopWrite(play.id),
    });
    return {
      orchestrator,
      workshop,
      store,
      cast: play.characters.map(({ id, name }) => ({ id, name })),
      voice: !!synth,
      synth,
    };
  }
}
