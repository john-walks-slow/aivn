import type { ServerMessage } from "@stage-ai/core";
import { LineageTree, isVoiceId, type EngineStateSnapshot } from "@stage-ai/core";
import type { PlayLibrary, PlayStore } from "./store.js";
import { PlaywrightOrchestrator, type CarryOver, type OrchestratorRuntimeState } from "./orchestrator.js";
import type { SaveInfo } from "./saves.js";
import type { PlayConfig } from "@stage-ai/core";
import type { ServerConfig } from "./config.js";
import { createCpaProvider } from "./provider.js";
import { createTts } from "./tts.js";
import { createImageBackend } from "./imagegen.js";
import type { ImageBackend } from "./imageBackend.js";
import { createExa, type Exa } from "./exa.js";
import { ImageAssets } from "./imageAssets.js";
import { Limiter } from "./limiter.js";
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
  /** 当前挂着的存档（周目）——id 与档名。改名就地改这里，hello 才不会带旧名。 */
  save: { id: string; name: string };
  /** hello 广播的角色名映射。 */
  cast: { id: string; name: string }[];
  /** 服务端 TTS 能力（配置了可用 key 才开；客户端据此显示语音开关）。 */
  voice: boolean;
  /** 语音合成闭包（含语音语言翻译）：ttsPreview 复用同路径。 */
  synth?: (text: string, voiceId: string) => Promise<{ url: string }>;
  /** 生图资产层（D6）：预发射/manifest；未启用生图则为 undefined。 */
  images?: ImageAssets;
}

/** hello 载荷（transport 连接建立与 runtime 重建续接共用）。 */
export function helloPayload(playId: string, runtime: PlayRuntime): ServerMessage {
  return {
    type: "hello",
    sessionId: playId,
    lastSeq: runtime.orchestrator.lastSeq,
    cast: runtime.cast,
    voice: runtime.voice,
    assets: runtime.images?.snapshot(),
    epoch: runtime.orchestrator.currentEpoch,
    idle: !runtime.orchestrator.isBusy,
    saveId: runtime.save.id,
    saveName: runtime.save.name,
  };
}

/** 音色试听固定样本文案（素材管理页「试听」按钮）。 */
const TTS_SAMPLE_TEXT = "你好呀！这就是我的声音，以后请多多指教哦。";

/** 工坊改了剧目文件（创作口径/premise/记忆卡）后的接力说明。 */
const SETTINGS_UPDATED = [
  "【设定已更新】（在本轮之前，剧目文件被修改过——创作口径或剧目设定已经换新）",
  "以上是刚刚之前已经演出的内容，属于既成事实。请按当前 A 区的最新设定继续往后写，",
  "不要复述、不要重演，也不要质疑新设定。",
].join("\n");

/** play.json / 素材保存后的接力说明。 */
const PLAY_RELOADED = [
  "【剧目资料已更新】（在本轮之前，剧目配置或素材清单被修改过）",
  "以上是刚刚之前已经演出的内容，属于既成事实。请按当前 A 区的最新设定继续往后写，",
  "不要复述、不要重演。",
].join("\n");

/** 从旧编排器取对话尾接力；对话体太短接不住就返回 undefined（新实例从零开始也没丢什么）。 */
function carryOverFrom(runtime: PlayRuntime, note: string): CarryOver | undefined {
  return runtime.orchestrator.carryOver(note) ?? undefined;
}

/**
 * 剧目之家：多剧目 runtime 懒加载与生命周期（P2）。
 * 每剧目一个 orchestrator + 广播组；WS 客户端按 playId 路由。
 */
export class PlayHouse {
  private readonly runtimes = new Map<string, PlayRuntime>();
  /** 已加载的剧目 runtime 数（健康检查用；不触发懒加载）。 */
  get livePlayCount(): number {
    return this.runtimes.size;
  }
  /** 每剧目 WS 客户端发送器集合：与 runtime 生命周期解耦——配置保存重建 runtime 不断连接。 */
  private readonly clientsByPlay = new Map<string, Set<(msg: ServerMessage) => void>>();
  private readonly provider: ReturnType<typeof createCpaProvider>["provider"];
  private readonly model: ReturnType<typeof createCpaProvider>["model"];
  private readonly tts: ReturnType<typeof createTts>;
  private readonly imageBackend: ImageBackend | null;
  /** 工坊联网检索（无 key 为 null：工坊少一个工具）。与 TTS 一样是进程级客户端，不随 runtime 重建。 */
  private readonly exa: Exa | null;
  /**
   * 生图并发闸门，按剧目缓存。
   * 必须挂 PlayHouse 而不是 runtime：reload 只换编排器、复用同一个 WorkshopSession，
   * 挂在 runtime 上的闸门会在换 runtime 时把老 workshop 留在旧闸门上，两个闸门各放 2 张 → 超发。
   */
  private readonly limiters = new Map<string, Limiter>();
  /** 演出编排与润色/翻译旁路共用的流式调用入口。 */
  private readonly streamFn: StreamFn;

  constructor(
    private readonly library: PlayLibrary,
    private readonly config: ServerConfig,
  ) {
    ({ provider: this.provider, model: this.model } = createCpaProvider(config));
    this.tts = createTts(config);
    this.imageBackend = createImageBackend(config);
    this.exa = createExa(config);
    // StreamFn 契约是 SimpleStreamOptions（reasoning 字段）——须接 streamSimple 做换算；
    // 错接完整版 stream 会丢弃 reasoning，thinking 档位全部失效
    this.streamFn = (m, context, options) =>
      this.provider.streamSimple(m as Model<"openai-completions">, context, options);
  }

  /** 取或懒加载剧目 runtime（恢复活动档的既有会话）。 */
  async get(playId: string): Promise<PlayRuntime> {
    const existing = this.runtimes.get(playId);
    if (existing) return existing;
    const saves = this.library.saves(playId);
    // 直连 /ws 而没先建档：兜底建一棵空树，runtime 永远有存档可挂
    const saveId = (await saves.readActive()) ?? (await saves.create()).id;
    const runtime = await this.buildRuntime(playId, saveId);
    this.runtimes.set(playId, runtime);
    return runtime;
  }

  /** 从磁盘构建剧目 runtime（play.json + 指定存档的会话恢复）。 */
  private async buildRuntime(playId: string, saveId: string, seed?: CarryOver): Promise<PlayRuntime> {
    const store = this.library.saveStore(playId, saveId);
    const play = await store.loadPlay();
    const session = await store.loadSession();
    const tree = new LineageTree();
    if (session) tree.load(session.store);
    const engine: EngineStateSnapshot = session?.engine ?? {
      ...play.initialState,
    };
    const scene = session?.scene ?? play.initialScene;
    const save = { id: saveId, name: await this.library.saves(playId).nameOf(saveId) };
    return this.createRuntime(store, play, tree, engine, scene, session?.runtime, save, seed);
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

  /** 剧目级生图闸门（D6 预发射与工坊出图共用，见字段注释）。 */
  private limiterFor(playId: string): Limiter {
    let limiter = this.limiters.get(playId);
    if (!limiter) {
      limiter = new Limiter(this.config.image.concurrency, undefined, `生图:${playId}`);
      this.limiters.set(playId, limiter);
    }
    return limiter;
  }

  /** 剧目配置/素材保存后重建 runtime：play.json 即时生效（音色/主角卡/语音语言/素材清单），活连接续接。 */
  async reload(playId: string): Promise<void> {
    const old = this.runtimes.get(playId);
    if (!old) return;
    const fresh = await this.buildRuntime(playId, old.store.saveId!, carryOverFrom(old, PLAY_RELOADED));
    old.orchestrator.dispose();
    this.runtimes.set(playId, fresh);
    this.announce(playId, fresh);
  }

  /**
   * runtime 重建后向活连接续接：hello 刷新 cast/voice/纪元，停止点重放恢复被中断连接的交互面板。
   * 纪元变化会让客户端丢掉本地 seq 全量重放——换档后正是要这个。
   */
  private announce(playId: string, runtime: PlayRuntime): void {
    const clients = this.clientsByPlay.get(playId);
    if (!clients?.size) return;
    const hello = helloPayload(playId, runtime);
    for (const send of clients) send(hello);
    const replay = runtime.orchestrator.stoppedReplay;
    if (replay) for (const send of clients) send(replay);
  }

  /**
   * 生图预发射（D6）：后台发起，就绪后广播 asset_ready；失败广播 asset_failed 由客户端降级。
   * 编排器不 await——预发射绝不能卡住播放。
   */
  private async preloadAsset(
    playId: string,
    type: "bg" | "cg",
    prompt: string,
    id: string,
  ): Promise<void> {
    const runtime = this.runtimes.get(playId);
    const sender = (msg: ServerMessage) => {
      for (const send of this.clientsFor(playId)) send(msg);
    };
    // 生图未启用：显式说一声，让客户端摘掉骨架占位（静默返回会让占位永久停留）
    if (!runtime?.images) {
      sender({ type: "asset_failed", id, message: "生图未启用" });
      return;
    }
    try {
      const asset = await runtime.images.preload(type, prompt, id);
      sender({ type: "asset_ready", asset });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.warn(`[stage-ai] 生图失败 ${id}: ${message}`);
      sender({ type: "asset_failed", id, message });
    }
  }

  /** 「开始新周目」：建一棵空树并切过去。旧档原封不动——不删任何事件日志。 */
  async createSave(playId: string, name?: string): Promise<SaveInfo> {
    const created = await this.library.saves(playId).create(name);
    await this.switchSave(playId, created.id);
    return created;
  }

  /** 改名：就地改档名标签，不动 id、不动树。 */
  async renameSave(playId: string, saveId: string, name: string): Promise<SaveInfo> {
    const info = await this.library.saves(playId).rename(saveId, name);
    const runtime = this.runtimes.get(playId);
    if (runtime?.save.id === saveId) runtime.save.name = info.name;
    return info;
  }

  /** 删档：删的是当前档时切到最近更新的一档（一档不剩则冷建一棵空树）。 */
  async deleteSave(playId: string, saveId: string): Promise<void> {
    const saves = this.library.saves(playId);
    const wasActive = (await saves.readActive()) === saveId;
    await saves.remove(saveId); // 删的是活动档时，指针已顺延到剩下的第一棵
    if (wasActive) await this.switchSave(playId, (await saves.readActive()) ?? (await saves.create()).id);
  }

  /**
   * 切档：只改活动档指针 + 重建 runtime。
   * 等节拍边界再切——演出进行中换 runtime 会让这一拍凭空消失（与工坊写盘同一条铁律）。
   */
  async switchSave(playId: string, saveId: string): Promise<void> {
    const saves = this.library.saves(playId);
    const old = this.runtimes.get(playId);
    if (!old) {
      await saves.activate(saveId);
      return;
    }
    if (old.save.id === saveId) return;
    await old.orchestrator.whenIdle();
    // 等期间可能已 reload 或被删剧目——只在原实例还在位时才替换
    if (this.runtimes.get(playId) !== old) return;
    await saves.activate(saveId);
    const fresh = await this.buildRuntime(playId, saveId);
    old.orchestrator.dispose();
    this.runtimes.set(playId, fresh);
    this.announce(playId, fresh);
  }

  /** 删除剧目：停 runtime + 整目录移除（play.json/素材/会话，不可恢复）。 */
  async deletePlay(playId: string): Promise<void> {
    const runtime = this.runtimes.get(playId);
    if (runtime) {
      runtime.orchestrator.dispose();
      this.runtimes.delete(playId);
    }
    this.clientsByPlay.delete(playId);
    this.limiters.delete(playId);
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
    // 等待期间可能已 reload/切档/删除——只在原实例还在位时才替换
    if (this.runtimes.get(playId) !== old) return;
    const fresh = await this.buildRuntime(
      playId,
      old.store.saveId!,
      carryOverFrom(old, SETTINGS_UPDATED),
    );
    const runtime = { ...fresh, workshop: old.workshop };
    old.orchestrator.dispose();
    this.runtimes.set(playId, runtime);
    this.announce(playId, runtime);
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
    restored: OrchestratorRuntimeState | undefined,
    save: { id: string; name: string },
    seed?: CarryOver,
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
    // 生图资产层（D6）：manifest 载入既有资产，预发射复用不重生成。
    // 必须在编排器之前就绪——已生成图的 id/prompt 要进 A 区，否则剧作家忘掉自己造过什么。
    const images = this.imageBackend
      ? new ImageAssets(play.id, store, this.imageBackend, this.limiterFor(play.id))
      : undefined;
    if (images) await images.load();
    const orchestrator = new PlaywrightOrchestrator({
      streamFn: this.streamFn,
      model,
      getApiKey: () => this.config.apiKey,
      play,
      assets: await store.listAssets(),
      assetNotes: await store.assetNotes(),
      generatedAssets: images?.notes(),
      memory,
      tree,
      engine,
      scene,
      tts: synth ? { synth, concurrency: this.config.tts.concurrency } : undefined,
      onPreloadAsset: (type, prompt, id) => void this.preloadAsset(play.id, type, prompt, id),
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
        store.saveSession(
          tree,
          engine,
          orchestrator.currentScene,
          orchestrator.runtimeState,
          orchestrator.history,
        ),
      restored,
      // 重启续演：历史从上次落盘回灌，否则第一次落盘就把重启前的记录抹成空白
      restoredHistory: await store.loadHistory(),
      seed,
    });
    // 工坊（D9）：独立实例，与演出互不干扰；写盘后按需重建 runtime（保存即生效）
    const workshop = new WorkshopSession({
      playId: play.id,
      store,
      streamFn: this.streamFn,
      model,
      getApiKey: () => this.config.apiKey,
      emit: (msg) => this.broadcast(play.id, msg),
      onFilesChanged: () => void this.reloadAfterWorkshopWrite(play.id),
      imageBackend: this.imageBackend ?? undefined,
      limiter: this.limiterFor(play.id),
      saves: this.library.saves(play.id),
      saveStore: (saveId) => this.library.saveStore(play.id, saveId),
      exa: this.exa ?? undefined,
    });
    return {
      orchestrator,
      workshop,
      store,
      save,
      cast: play.characters.map(({ id, name }) => ({ id, name })),
      voice: !!synth,
      synth,
      images,
    };
  }
}
