import type { ServerMessage } from "@stage-ai/core";
import type { VoiceCatalogService } from "./voiceCatalog.js";
import { LineageTree, isVoiceId, parsePlayConfig, type EngineStateSnapshot, type SpriteFraming } from "@stage-ai/core";
import type { PlayLibrary, PlayStore } from "./store.js";
import { withPlayConfigLock } from "./store.js";
import type { AssetLibrary } from "./library.js";
import { AssetRefResolver, characterIdsOf } from "./assetRef.js";
import { PlaywrightOrchestrator, type CarryOver, type OrchestratorRuntimeState } from "./orchestrator.js";
import type { SaveInfo } from "./saves.js";
import type { PlayConfig } from "@stage-ai/core";
import type { ServerConfig } from "./config.js";
import { imagePendingTtlMs } from "./config.js";
import { createCpaProvider, fetchGatewayModels, resolveCpaModel, supportedModels, type GatewayModel } from "./provider.js";
import { createTts } from "./tts.js";
import { createImageBackend } from "./imageFactory.js";
import type { ImageBackend } from "./imageBackend.js";
import { createExa, type Exa } from "./exa.js";
import { readPlayLedgerEntries, type GeneratedLedgerEntry } from "./generatedLedger.js";
import { PlayAssets } from "./playAssets.js";
import { PendingJobs } from "./pendingJobs.js";
import { PlayFiles } from "./playFiles.js";
import { agentToolCatalog, defaultToolsFor } from "./agentkit/kit.js";
import { AGENT_ROLES, type AgentRole } from "./agentkit/role.js";
import { Limiter } from "./limiter.js";
import { Translator } from "./translate.js";
import { PlayMemory } from "./memory.js";
import { WorkshopSession } from "./workshopSession.js";
import { completeText } from "./llm.js";
import type { StreamFn } from "@earendil-works/pi-agent-core";
import type { Model } from "@earendil-works/pi-ai";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

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
  /** 本剧目已生成的 bg/cg（读 assets/generated.json）：重连即恢复可见，不必等下一次预发射。 */
  generated: GeneratedLedgerEntry[];
  /** 在生成的事（每剧目一份，跨 runtime 重建存活）：面板的快照从这里取。 */
  pending: PendingJobs;
  /** 骨架占位的兜底上界（毫秒）：由生图配置算出，随 hello 下发（见 imagePendingTtlMs）。 */
  assetsTtlMs: number;
}

/** hello 载荷（transport 连接建立与 runtime 重建续接共用）。 */
export function helloPayload(playId: string, runtime: PlayRuntime): ServerMessage {
  return {
    type: "hello",
    sessionId: playId,
    lastSeq: runtime.orchestrator.lastSeq,
    fresh: runtime.orchestrator.fresh,
    cast: runtime.cast,
    voice: runtime.voice,
    assets: runtime.generated,
    // 重连即恢复「正在生成」面板：hello 之后不再补发第二条，客户端只认这一份起点
    pendingJobs: runtime.pending.snapshot(),
    assetsTtlMs: runtime.assetsTtlMs,
    epoch: runtime.orchestrator.currentEpoch,
    idle: !runtime.orchestrator.isBusy,
    saveId: runtime.save.id,
    saveName: runtime.save.name,
    readPos: runtime.orchestrator.readingPos ?? undefined,
  };
}

/** 网关模型清单缓存时长：网关上加模型不频繁，但也不能让用户非刷新不可。 */
const GATEWAY_MODELS_TTL_MS = 5 * 60_000;

/** 音色试听固定样本文案（素材管理页「试听」按钮）。 */
const TTS_SAMPLE_TEXT = "你好呀！这就是我的声音，以后请多多指教哦。";

/** 导演生图：把当前这一幕写成一句英文出图提示词的提示词。 */
const CG_PROMPT_SYSTEM = [
  "你是视觉小说的插图提示词写手：把「这一幕演到哪儿了」写成一句英文出图提示词，供 AI 出图模型使用。",
  "- 只输出提示词本身：英文、逗号分隔的画面要素；不加引号、不加解释、不写负面词",
  "- 画面落在当前这一幕上：谁在场、什么动作与表情、什么场景、什么光线与气氛",
  "- 不要出现任何文字、字幕、对话框、分镜格、漫画式的描述",
  "- 有【玩家要求】时以它为准，其余要素都为它服务；没有就照剧情自己构图",
  "- 长度控制在 60 词上下，句首大写",
].join("\n");

/** 出图提示词的最短词数：低于它基本是被截断的半句，不是模型认真写的短提示词。 */
const MIN_CG_PROMPT_WORDS = 15;

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

/** 读一个可选文件：没有就是没有，不是错误。 */
async function readFileOrEmpty(path: string): Promise<string> {
  try {
    return await readFile(path, "utf8");
  } catch {
    return "";
  }
}

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
  /** 在飞的首装（见 get）：并发调用共享同一个 promise，装配完成即摘除。 */
  private readonly building = new Map<string, Promise<PlayRuntime>>();
  /** 已加载的剧目 runtime 数（健康检查用；不触发懒加载）。 */
  get livePlayCount(): number {
    return this.runtimes.size;
  }
  /** 每剧目 WS 客户端发送器集合：与 runtime 生命周期解耦——配置保存重建 runtime 不断连接。 */
  private readonly clientsByPlay = new Map<string, Set<(msg: ServerMessage) => void>>();
  /**
   * 只看已加载的 runtime，不触发懒加载。
   * 观众离场停合成走这里——用 get() 会把 runtime 重新拉回来，凭空占住一份。
   */
  peek(playId: string): PlayRuntime | undefined {
    return this.runtimes.get(playId);
  }
  private readonly provider: ReturnType<typeof createCpaProvider>["provider"];
  private readonly model: ReturnType<typeof createCpaProvider>["model"];
  /** 按剧目解析出来的模型缓存（agents 段选了什么 id → 那个模型对象）。 */
  private readonly modelCache = new Map<string, Model<"openai-completions">>();
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
  /**
   * 剧目级素材生成层（工坊与剧作家共用同一个）。
   * 必须挂 PlayHouse 而不是 runtime：reload 只换编排器，两个 runtime 各建一份的话
   * 同一个目标的在飞去重就失效了（两边同时要同一张图会烧两份配额）。
   */
  private readonly playAssets = new Map<string, PlayAssets>();
  /** 在生成的事的记账处（每剧目一个）：剧作家的轮次、生图、语音合成共用一张表。 */
  private readonly pendingJobs = new Map<string, PendingJobs>();
  /** 排到轮边界的 runtime 重建（剧作家立绘落盘后 play.json 变了）；同剧目串行，避免连着重装。 */
  private readonly pendingRebuilds = new Map<string, Promise<void>>();
  /** 网关模型清单缓存（网关上加了模型要能刷出来，故留了 TTL 而不是永久缓存）。 */
  private gatewayModelsCache: { models: GatewayModel[]; at: number } | null = null;
  /** 正在建的周目（key=playId）：同剧目并发的「开演」共用一棵树，不会各建一棵。 */
  private readonly ensuring = new Map<string, Promise<string>>();
  /** 正在为「开演」换 runtime（key=playId）：同上，并发的开演共用一次构建，不会各装一个编排器。 */
  private readonly staging = new Map<string, Promise<PlayRuntime>>();
  /** 演出编排与润色/翻译旁路共用的流式调用入口。 */
  private readonly streamFn: StreamFn;

  constructor(
    private readonly library: PlayLibrary,
    private readonly config: ServerConfig,
    private readonly assetLibrary: AssetLibrary,
    /** 公共音色库客户端（index.ts 构造时注入）：工坊的 list_voices 走它。没配 TTS 时可以是 undefined。 */
    private readonly voices?: VoiceCatalogService,
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

  /**
   * 取或懒加载剧目 runtime。
   *
   * 剧目还没有任何周目时，runtime 落在**无会话作用域**的操作面上（saveId 为 null）：
   * 逛工坊、读路线、列文件都不该凭空多出一个「第 1 周目」——建不建第一棵树是玩家的动作。
   * 舞台连接走同一份：连上舞台也只读活动档，读不到就落在无会话作用域上，等他在舞台上按
   * 「开演」时才由 {@link begin} 换到真树上。
   */
  async get(playId: string): Promise<PlayRuntime> {
    const existing = this.runtimes.get(playId);
    if (existing) return existing;
    // 单飞：装配横跨 readActive / buildRuntime 两个 await，并发的第二个调用者若也往下走
    // 会另装一份 runtime，后 set 的把先 set 的顶掉——先装那份 orchestrator 没人 dispose。
    // 与 begin() 的 staging 表同一个道理，那边保的是周目不重复建，这边保的是 runtime 不重复装。
    const inflight = this.building.get(playId);
    if (inflight) return inflight;
    const task = this.buildSessionless(playId).finally(() => this.building.delete(playId));
    this.building.set(playId, task);
    return task;
  }

  /** 无会话作用域的装配：只读活动档，读不到就落在 null 上，绝不替玩家建周目。 */
  private async buildSessionless(playId: string): Promise<PlayRuntime> {
    const saveId = await this.library.saves(playId).readActive();
    const runtime = await this.buildRuntime(playId, saveId);
    this.runtimes.set(playId, runtime);
    return runtime;
  }

  /**
   * 「开演」：这一刻才建第一棵故事树，并把 runtime 挪上去。
   *
   * 连上舞台与逛工坊拿到的是同一份 runtime（{@link get}）——没有活动档时它落在无会话作用域上，
   * 而无会话作用域的 PlayStore 写不了盘（会话面直接抛），所以第一轮必须先换到真树上再 start。
   * 已经挂在树上的原样返回：不换树，「继续」进来的每一拍都不该付一次重建的代价。
   */
  async begin(playId: string): Promise<PlayRuntime> {
    const existing = this.runtimes.get(playId);
    if (existing && existing.save.id) return existing;
    // 单飞：同剧目并发的两条「开演」共用一次构建，否则后完成的把先完成的顶掉，
    // 先装出来的那份 orchestrator 没人 dispose（内存泄漏）。
    const inflight = this.staging.get(playId);
    if (inflight) return inflight;
    const task = this.buildStageRuntime(playId).finally(() => this.staging.delete(playId));
    this.staging.set(playId, task);
    return task;
  }

  /** 把 runtime 换到一棵真实的故事树上（无会话作用域那份写不了盘）。 */
  private async buildStageRuntime(playId: string): Promise<PlayRuntime> {
    const saveId = await this.ensureSave(playId);
    const current = this.runtimes.get(playId);
    if (current && current.save.id === saveId) return current;
    let carried: string[] = [];
    if (current) {
      // 等节拍边界：换 runtime 时演出进行中会让这一拍凭空消失
      await current.orchestrator.whenIdle();
      if (this.runtimes.get(playId) !== current) {
        // 等期间已被切档/reload 换掉了，用现成那份
        const fresh = this.runtimes.get(playId);
        if (fresh) return fresh;
      } else {
        // 开演前插的提示只活在旧实例内存里：不接手就跟着 dispose 一起没了
        carried = current.orchestrator.takePendingPrompts();
        current.orchestrator.dispose();
        this.runtimes.delete(playId);
      }
    }
    const runtime = await this.buildRuntime(playId, saveId);
    // 工坊实例不跟着换：换了会把玩家正在进行的对话与线程现场打断（同 reloadAfterWorkshopWrite）
    const merged = current ? { ...runtime, workshop: current.workshop } : runtime;
    this.runtimes.set(playId, merged);
    this.announce(playId, merged);
    for (const text of carried) void merged.orchestrator.playerAction({ kind: "prompt", text });
    return merged;
  }

  /** 活动周目 id，没有就建一棵（并发连接只建一次：同剧目同时来的两个舞台连接共用一棵树）。 */
  private async ensureSave(playId: string): Promise<string> {
    const saves = this.library.saves(playId);
    const active = await saves.readActive();
    if (active) return active;
    const inflight = this.ensuring.get(playId);
    if (inflight) return inflight;
    const task = saves
      .create()
      .then((created) => created.id)
      .finally(() => this.ensuring.delete(playId));
    this.ensuring.set(playId, task);
    return task;
  }

  /** 丢掉 runtime（剧目一个周目都不剩时：回到无会话作用域，等舞台连上再建）。 */
  private async dropRuntime(playId: string): Promise<void> {
    const existing = this.runtimes.get(playId);
    if (!existing) return;
    await existing.orchestrator.whenIdle();
    if (this.runtimes.get(playId) !== existing) return;
    existing.orchestrator.dispose();
    this.runtimes.delete(playId);
  }

  /** 从磁盘构建剧目 runtime（play.json + 指定存档的会话恢复；saveId 为 null = 无会话作用域）。 */
  private async buildRuntime(playId: string, saveId: string | null, seed?: CarryOver): Promise<PlayRuntime> {
    const store = saveId ? this.library.saveStore(playId, saveId) : this.library.store(playId);
    const play = await store.loadPlay();
    const session = await store.loadSession();
    const tree = new LineageTree();
    if (session) tree.load(session.store);
    const engine: EngineStateSnapshot = session?.engine ?? {
      ...play.initialState,
    };
    const scene = session?.scene ?? play.initialScene;
    const save = {
      id: saveId ?? "",
      name: saveId ? await this.library.saves(playId).nameOf(saveId) : "",
    };
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

  /** 在生成的事（首次调用时装配）：一改就整表广播，客户端那边是一块面板，不需要增量协议。 */
  private pendingFor(playId: string): PendingJobs {
    const cached = this.pendingJobs.get(playId);
    if (cached) return cached;
    const jobs = new PendingJobs((snapshot) => {
      this.broadcast(playId, { type: "pending_jobs", jobs: snapshot });
    });
    this.pendingJobs.set(playId, jobs);
    return jobs;
  }

  /** 剧目级素材层（首次调用时装配；未启用生图为 undefined）。 */
  private playAssetsFor(playId: string, store: PlayStore): PlayAssets | undefined {
    if (!this.imageBackend) return undefined;
    const cached = this.playAssets.get(playId);
    if (cached) return cached;
    const assets = new PlayAssets(playId, {
      store,
      files: new PlayFiles(store),
      backend: this.imageBackend,
      limiter: this.limiterFor(playId),
      reference: this.config.image.reference,
      pending: this.pendingFor(playId),
      // 工坊要撤销条与素材气泡，剧作家在拍内预发射一样都不产——按 notify 分流。
      // 事件由工坊会话转发（它知道当前线程号），工坊实例不在时就没有对话流可挂。
      onWrite: (write, notify) => {
        if (notify !== "workshop") return;
        this.runtimes.get(playId)?.workshop.pushWrite(write);
      },
      onAsset: (asset, _replaced, notify) => {
        if (notify !== "workshop") return;
        this.runtimes.get(playId)?.workshop.pushAsset(asset);
      },
      // 剧作家给临时角色生立绘会改 play.json：拍进行中不能腰斩演出，排到轮边界再重建
      onPlayConfigChanged: (notify) => {
        if (notify === "silent") this.rebuildAtBeatBoundary(playId, "剧作家新增了立绘素材");
      },
    });
    this.playAssets.set(playId, assets);
    return assets;
  }

  /** 剧目配置里的模型 id → 模型对象（缓存；缺省是服务端默认模型）。 */
  private modelFor(modelId: string | undefined): Model<"openai-completions"> {
    if (!modelId || modelId === this.config.modelId) return this.model;
    const cached = this.modelCache.get(modelId);
    if (cached) return cached;
    const resolved = resolveCpaModel(this.config, modelId);
    this.modelCache.set(modelId, resolved);
    return resolved;
  }

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
    const fresh = await this.buildRuntime(playId, old.store.saveId ?? null, carryOverFrom(old, PLAY_RELOADED));
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
   *
   * 落点与工坊同一个 PlayAssets：`assets/backgrounds/<id>.jpg` / `assets/cg/<id>.jpg`，
   * 出图 prompt 记进 assets/generated.json。剧目里已有的同名素材不重出（用户导入的图优先）。
   */
  private async preloadAsset(
    playId: string,
    store: PlayStore,
    type: "bg" | "cg",
    prompt: string,
    id: string,
  ): Promise<void> {
    const sender = (msg: ServerMessage) => {
      for (const send of this.clientsFor(playId)) send(msg);
    };
    const assets = this.playAssetsFor(playId, store);
    // 生图未启用：显式说一声，让客户端摘掉骨架占位（静默返回会让占位永久停留）
    if (!assets) {
      sender({ type: "asset_failed", id, message: "生图未启用" });
      return;
    }
    const target = { kind: type === "bg" ? "background" : "cg", name: id } as const;
    const existing = await assets.existingUrl(target);
    if (existing) {
      sender({ type: "asset_ready", asset: { id, type, url: existing } });
      return;
    }
    try {
      const [asset] = await assets.generate(target, prompt, undefined, undefined, { notify: "silent" });
      if (!asset) return;
      sender({ type: "asset_ready", asset: { id, type, url: asset.url } });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.warn(`[stage-ai] 生图失败 ${id}: ${message}`);
      sender({ type: "asset_failed", id, message });
    }
  }

  /**
   * 立绘预发射：generate_image kind="sprite" 后台发起。
   * 走与工坊同一个 PlayAssets（neutral 垫图 + 抠底 + 差分映射补写 + 临时角色注册）。
   * play.json 的改动由 PlayAssets 的 onPlayConfigChanged 排到轮边界重建——拍进行中直接 reload
   * 会把正在进行的这一轮腰斩掉。
   */
  private async preloadSprite(
    playId: string,
    store: PlayStore,
    charId: string,
    expression: string,
    prompt: string,
    characterName?: string,
    framing?: SpriteFraming,
  ): Promise<void> {
    const spriteId = `${charId}:${expression}`;
    const assets = this.playAssetsFor(playId, store);
    if (!assets) {
      for (const send of this.clientsFor(playId)) {
        send({ type: "asset_failed", id: spriteId, message: "生图未启用" });
      }
      return;
    }
    try {
      await assets.generate(
        { kind: "sprite", characterId: charId, expression, framing },
        prompt,
        undefined,
        undefined,
        { notify: "silent", characterName },
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.warn(`[stage-ai] 立绘生图失败 ${spriteId}: ${message}`);
      for (const send of this.clientsFor(playId)) {
        send({ type: "asset_failed", id: spriteId, message });
      }
    }
  }

  /**
   * 写角色设定文件（always/characters/<id>.md）并 upsert play.json stub。
   * write_memory file="characters/<id>" 时由编排器触发。
   */
  private async writeCharacter(store: PlayStore, charId: string, content: string): Promise<void> {
    // 1. 写 always/characters/<id>.md
    const charDir = store.memoryDir("always", "characters");
    const charFile = join(charDir, `${charId}.md`);
    await mkdir(dirname(charFile), { recursive: true });
    await writeFile(charFile, content, "utf8");

    // 2. upsert play.json stub（id + name），已存在则不覆盖
    const nameMatch = /^#\s+(.+)$/m.exec(content);
    const name = nameMatch?.[1]?.trim() ?? charId;
    await withPlayConfigLock(store.dir, async () => {
      const config = await store.loadPlay();
      if (config.characters.some((c) => c.id === charId)) return;
      const updated: PlayConfig = {
        ...config,
        characters: [...config.characters, { id: charId, name, persona: "" }],
      };
      await writeFile(join(store.dir, "play.json"), JSON.stringify(updated, null, 2), "utf8");
    });
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

  /** 删档：删的是当前档时切到最近更新的一档。一棵都不剩就退回无会话作用域——舞台连上时再新建。 */
  async deleteSave(playId: string, saveId: string): Promise<void> {
    const saves = this.library.saves(playId);
    const wasActive = (await saves.readActive()) === saveId;
    await saves.remove(saveId); // 删的是活动档时，指针已顺延到剩下的第一棵
    if (!wasActive) return;
    const next = await saves.readActive();
    if (next) await this.switchSave(playId, next);
    else await this.dropRuntime(playId);
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
  private async reloadAfterWorkshopWrite(playId: string, note: string = SETTINGS_UPDATED): Promise<void> {
    const old = this.runtimes.get(playId);
    if (!old) return;
    // 等节拍边界：演出进行中重建会让这一拍凭空消失
    await old.orchestrator.whenIdle();
    // 等待期间可能已 reload/切档/删除——只在原实例还在位时才替换
    if (this.runtimes.get(playId) !== old) return;
    const fresh = await this.buildRuntime(playId, old.store.saveId, carryOverFrom(old, note));
    const runtime = { ...fresh, workshop: old.workshop };
    old.orchestrator.dispose();
    this.runtimes.set(playId, runtime);
    this.announce(playId, runtime);
  }

  /**
   * 排到轮边界重建 runtime：剧作家侧改 play.json（给临时角色生立绘补写差分映射）时用。
   *
   * 与工坊写盘的区别只有触发时机——都在节拍边界换编排器。必须排队：一轮里出三张立绘就是三次调用，
   * 齐步走会连着重装三份 runtime。
   */
  /**
   * 引用即导入的挂载点。资源库没配就不挂：剧本里未知的 id 仍然只是降级。
   *
   * 角色导入要改 play.json，而拍进行中改 play.json 得排到轮边界——与剧作家给临时角色
   * 生立绘时走的是同一条延迟重建，不另开一条。
   */
  private assetRefResolver(playId: string, store: PlayStore, play: PlayConfig): AssetRefResolver | undefined {
    return new AssetRefResolver({
      playId,
      store,
      library: this.assetLibrary,
      characters: () => characterIdsOf(play),
      onImported: (result) => {
        if (result.kind === "characters") {
          this.rebuildAtBeatBoundary(playId, `剧作家引用了资源库角色 ${result.id}，已导入`);
          return; // 立绘文件已落盘，角色卡要等轮边界重建才进 cast
        }
        // 图像类别才走 asset_ready：客户端那张表只认 bg/cg，音频由 listAssets 的刷新负责
        if (result.kind !== "backgrounds" && result.kind !== "cg") return;
        const file = result.files[0];
        if (!file) return;
        for (const send of this.clientsFor(playId)) {
          send({
            type: "asset_ready",
            asset: { id: result.id, type: result.kind === "cg" ? "cg" : "bg", url: `/plays/${playId}/${file}` },
          });
        }
      },
      warn: (message) => console.warn(`[stage-ai] ${message}`),
    });
  }

  private rebuildAtBeatBoundary(playId: string, note: string): void {
    const previous = this.pendingRebuilds.get(playId) ?? Promise.resolve();
    const next = previous
      .then(() => this.reloadAfterWorkshopWrite(playId, note))
      .catch((error: unknown) =>
        console.warn(
          `[stage-ai] 轮边界重建 runtime 失败: ${error instanceof Error ? error.message : String(error)}`,
        ),
      )
      .finally(() => {
        if (this.pendingRebuilds.get(playId) === next) this.pendingRebuilds.delete(playId);
      });
    this.pendingRebuilds.set(playId, next);
  }

  /**
   * Agent 设置页的数据源：网关模型清单 ∩ `STAGE_MODELS` 支持清单
   * （读不到就报错，不静默退化成默认模型）。
   *
   * 缓存的是**网关原始清单**，收窄在读时做：清单只在启动时定一次，但它只值几行过滤，
   * 而原始清单才是「网关上加了新模型」要重取的那份东西（refresh 打的就是它）。
   */
  async gatewayModels(refresh = false): Promise<{ models: GatewayModel[]; defaultModel: string }> {
    let models: GatewayModel[] | undefined;
    if (!refresh) {
      const cached = this.gatewayModelsCache;
      if (cached && Date.now() - cached.at < GATEWAY_MODELS_TTL_MS) models = cached.models;
    }
    if (!models) {
      models = await fetchGatewayModels(this.config);
      this.gatewayModelsCache = { models, at: Date.now() };
    }
    return { models: supportedModels(models, this.config.models), defaultModel: this.config.modelId };
  }

  /** 工具目录（Agent 设置页的开关清单）。与装配用的是同一份定义。 */
  tools(): { tools: Record<AgentRole, ReturnType<typeof agentToolCatalog>>; defaults: Record<string, string[]> } {
    return {
      // 按角色出：设置页给两张卡各画一排开关，指向一个装不上的工具只会让人以为勾了有用
      tools: {
        playwriter: agentToolCatalog("playwriter"),
        workshop: agentToolCatalog("workshop"),
      },
      // 设置页要按「默认勾选什么」渲染初始态：play.json 没写 tools 时走的就是这份
      defaults: Object.fromEntries(AGENT_ROLES.map((role) => [role, [...defaultToolsFor(role)]])),
    };
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
      "你是视觉小说的玩家输入润色器，把玩家的原始输入改写成主角会说/会做的那一行。",
      "- 保留原意与全部关键信息，不添加新的动作、剧情或决定",
      // 玩家常写成「我伸手拉住她的袖口，说：……」这种动作+台词的混排。曾经提示只说
      // 「只输出台词」，模型就把动作整段裁掉，玩家写的东西无声消失了一半。
      "- 原文里的动作、神态、旁白都要保留，不要因为「只输出台词」而丢掉它们",
      "- 保持原文语言与大致长度，口语自然",
      "- 只输出改写后的那一行本身，不加引号或任何解释",
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

  /**
   * 导演生图：玩家在舞台上点名要一张插图，玩家指令可留空。
   *
   * 顺序是「先写提示词，再落位置，最后发起」——提示词写不出来就什么都没发生，
   * 不会在时间线上留下一个等不到图的空节点。
   */
  async requestCg(playId: string, instruction?: string): Promise<void> {
    const runtime = await this.get(playId);
    if (!this.imageBackend) {
      throw new Error("生图未启用（STAGE_IMAGE_ENABLED=false 或后端缺凭据）");
    }
    const play = await runtime.store.loadPlay();
    const wanted = instruction?.trim() ?? "";
    const { lines, scene } = runtime.orchestrator.recentScript();
    if (lines.length === 0 && !wanted) {
      throw new Error("还没有剧情可画：先演一会儿，或者直接写下想要什么样的图");
    }
    const craft = await readFileOrEmpty(runtime.store.memoryDir("always", "craft.md"));
    const prompt = await this.composeCgPrompt(play, { lines, scene, wanted, craft });
    // 网关偶尔把单发流掐在半路，而且仍然报 finish_reason=stop（实测：78 字符停在 "wearing"，
    // 还有一次只给了 6 字符）。半句提示词出图会整个跑偏，却看起来一切正常——按系统提示里
    // 「60 词上下」的约定验一下长度，不达标就当没写成，让玩家再点一次，
    // 而不是烧一张配额换一张废图。
    if (prompt.split(/\s+/).length < MIN_CG_PROMPT_WORDS) {
      throw new Error("写出来的出图提示词只有半句（模型响应被截断），请再点一次生图");
    }
    const id = `cg_${Date.now().toString(36)}`;
    runtime.orchestrator.directorCg(id);
    void this.preloadAsset(playId, runtime.store, "cg", prompt, id);
  }

  /** 「这一幕演到哪儿了」+ 玩家指令 → 一句英文出图提示词。模型用剧目里剧作家的那个。 */
  private async composeCgPrompt(
    play: PlayConfig,
    ctx: { lines: readonly string[]; scene: string; wanted: string; craft: string },
  ): Promise<string> {
    const user = [
      `【当前场景】${ctx.scene}`,
      `【角色】\n${play.characters.map((c) => `- ${c.name}${c.persona ? `：${c.persona.slice(0, 120)}` : ""}`).join("\n")}`,
      ctx.craft ? `【创作口径】\n${ctx.craft.slice(0, 800)}` : "",
      ctx.lines.length > 0
        ? `【刚才演到的（最新在最后）】\n${ctx.lines.join("\n")}`
        : "【刚才演到的】（还没有台词）",
      ctx.wanted ? `【玩家要求】${ctx.wanted}` : "",
    ]
      .filter(Boolean)
      .join("\n\n");
    const text = await completeText(
      {
        streamFn: this.streamFn,
        model: this.modelFor(play.agents?.playwriter?.model),
        getApiKey: () => this.config.apiKey,
      },
      CG_PROMPT_SYSTEM,
      user,
    );
    const prompt = text
      .trim()
      .replace(/^```[a-z]*\n?/i, "")
      .replace(/\n?```$/, "")
      .trim();
    if (!prompt) throw new Error("写不出出图提示词（模型没有返回内容）");
    return prompt;
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
    // 两个 agent 各按剧目配置解析模型（Agent 页签改的就是 play.json 的 agents 段）；
    // 缺省即服务端默认模型。润色/翻译旁路跟剧作家走——同一段文字两种口吻最怪。
    const model = this.modelFor(play.agents?.playwriter?.model);
    const workshopModel = this.modelFor(play.agents?.workshop?.model);
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
    // 剧目级素材层：工坊与剧作家共用同一个（跨角色在飞去重只烧一份配额）。
    // 站内生成的 bg/cg 也走它，落 assets/——生成图与手传素材在同一个命名空间里。
    const playAssets = this.playAssetsFor(play.id, store);
    const staticAssets = await store.listAssets();
    const generated: GeneratedLedgerEntry[] = await readPlayLedgerEntries(play.id, store);
    const orchestrator = new PlaywrightOrchestrator({
      streamFn: this.streamFn,
      model,
      getApiKey: () => this.config.apiKey,
      play,
      assets: staticAssets,
      assetNotes: await store.assetMeta(),
      generatedAssets: generated,
      memory,
      tree,
      engine,
      scene,
      tts: synth ? { synth, concurrency: this.config.tts.concurrency } : undefined,
      pending: this.pendingFor(play.id),
      agents: play.agents?.playwriter,
      imageTools: playAssets
        ? {
            playAssets,
            kick: (type, prompt, id) => void this.preloadAsset(play.id, store, type, prompt, id),
            kickSprite: (charId, expression, prompt, characterName, framing) =>
              void this.preloadSprite(play.id, store, charId, expression, prompt, characterName, framing),
            exa: this.exa ?? undefined,
          }
        : undefined,
      store,
      assetLibrary: this.assetLibrary,
      assetRefs: this.assetRefResolver(play.id, store, play),
      onWriteCharacter: (charId, content) => this.writeCharacter(store, charId, content),
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
      model: workshopModel,
      getApiKey: () => this.config.apiKey,
      emit: (msg) => this.broadcast(play.id, msg),
      onFilesChanged: () => void this.reloadAfterWorkshopWrite(play.id),
      playAssets,
      saves: this.library.saves(play.id),
      saveStore: (saveId) => this.library.saveStore(play.id, saveId),
      assetLibrary: this.assetLibrary,
      voices: this.voices,
      exa: this.exa ?? undefined,
      agents: play.agents?.workshop,
    });
    return {
      orchestrator,
      workshop,
      store,
      save,
      cast: play.characters.map(({ id, name }) => ({ id, name })),
      voice: !!synth,
      synth,
      generated,
      pending: this.pendingFor(play.id),
      assetsTtlMs: imagePendingTtlMs(this.config.image),
    };
  }
}
