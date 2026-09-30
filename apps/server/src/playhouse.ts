import type { ServerMessage } from "@stage-ai/core";
import { LineageTree, isVoiceId, parsePlayConfig, type EngineStateSnapshot } from "@stage-ai/core";
import type { PlayLibrary, PlayStore } from "./store.js";
import { withPlayConfigLock } from "./store.js";
import type { AssetLibrary } from "./library.js";
import { PlaywrightOrchestrator, type CarryOver, type OrchestratorRuntimeState } from "./orchestrator.js";
import type { SaveInfo } from "./saves.js";
import type { PlayConfig } from "@stage-ai/core";
import type { ServerConfig } from "./config.js";
import { imagePendingTtlMs } from "./config.js";
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
import { mkdir, writeFile } from "node:fs/promises";
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
  /** 生图资产层（D6）：预发射/manifest；未启用生图则为 undefined。 */
  images?: ImageAssets;
  /** 骨架占位的兜底上界（毫秒）：由生图配置算出，随 hello 下发（见 imagePendingTtlMs）。 */
  assetsTtlMs: number;
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
    assetsTtlMs: runtime.assetsTtlMs,
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
  /** 正在建的周目（key=playId）：同剧目并发的舞台连接共用一棵树，不会各建一棵。 */
  private readonly ensuring = new Map<string, Promise<string>>();
  /** 正在为舞台构建 runtime（key=playId）：同上，并发连接共用一次构建，不会各建一个编排器。 */
  private readonly staging = new Map<string, Promise<PlayRuntime>>();
  /** 演出编排与润色/翻译旁路共用的流式调用入口。 */
  private readonly streamFn: StreamFn;

  constructor(
    private readonly library: PlayLibrary,
    private readonly config: ServerConfig,
    private readonly assetLibrary: AssetLibrary,
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
   * 舞台连接走 {@link stage}，那里才确保有一棵可写的树。
   */
  async get(playId: string): Promise<PlayRuntime> {
    const existing = this.runtimes.get(playId);
    if (existing) return existing;
    // 单飞：装配横跨 readActive / buildRuntime 两个 await，并发的第二个调用者若也往下走
    // 会另装一份 runtime，后 set 的把先 set 的顶掉——先装那份 orchestrator 没人 dispose。
    // 与 stage() 的 staging 表同一个道理，那边保的是周目不重复建，这边保的是 runtime 不重复装。
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
   * 舞台连接用的 runtime：必须挂在某一棵故事树上，剧目一棵都没有时先建一棵。
   * 这是唯一会自动建周目的入口——玩家连上舞台就是在看戏，没树可写。
   *
   * 已经挂在树上的直接返回，不碰磁盘：dispatch 每条客户端消息都会走这里。
   */
  async stage(playId: string): Promise<PlayRuntime> {
    const existing = this.runtimes.get(playId);
    if (existing && existing.save.id) return existing;
    // 单飞：并发来的两条连接（onConnection 与 dispatch 几乎同时）共用一次构建。
    // 少了它，两边都会 buildRuntime，后完成的覆盖先完成的——先建的那份 orchestrator
    // 没人 dispose（内存泄漏），两条连接还各写一份同一个周目。
    const inflight = this.staging.get(playId);
    if (inflight) return inflight;
    const task = this.buildStageRuntime(playId).finally(() => this.staging.delete(playId));
    this.staging.set(playId, task);
    return task;
  }

  /** 把 runtime 换到一棵真实的故事树上（工坊逛出来的无会话那份写不了盘）。 */
  private async buildStageRuntime(playId: string): Promise<PlayRuntime> {
    const saveId = await this.ensureSave(playId);
    const current = this.runtimes.get(playId);
    if (current && current.save.id === saveId) return current;
    if (current) {
      // 等节拍边界：换 runtime 时演出进行中会让这一拍凭空消失
      await current.orchestrator.whenIdle();
      if (this.runtimes.get(playId) !== current) {
        // 等期间已被切档/reload 换掉了，用现成那份
        const fresh = this.runtimes.get(playId);
        if (fresh) return fresh;
      } else {
        current.orchestrator.dispose();
        this.runtimes.delete(playId);
      }
    }
    const runtime = await this.buildRuntime(playId, saveId);
    // 工坊实例不跟着换：换了会把玩家正在进行的对话与线程现场打断（同 reloadAfterWorkshopWrite）
    const merged = current ? { ...runtime, workshop: current.workshop } : runtime;
    this.runtimes.set(playId, merged);
    this.announce(playId, merged);
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

  /**
   * 立绘预发射：preload_asset type="sprite" 后台发起。
   * 复用工坊素材管线（neutral 垫图 + 抠底 + sprites 补写），生成完成后触发 reload
   * 让前端收到更新后的 hello（新 sprites 映射 + A 区角色表更新）。
   */
  private async preloadSprite(
    playId: string,
    store: PlayStore,
    charId: string,
    expression: string,
    prompt: string,
  ): Promise<void> {
    const spriteId = `${charId}:${expression}`;
    if (!this.imageBackend) {
      for (const send of this.clientsFor(playId)) {
        send({ type: "asset_failed", id: spriteId, message: "生图未启用" });
      }
      return;
    }
    try {
      const { WorkshopAssets } = await import("./workshopAssets.js");
      const { PlayFiles } = await import("./playFiles.js");
      const files = new PlayFiles(store);
      const assets = new WorkshopAssets(playId, {
        files,
        store,
        backend: this.imageBackend,
        limiter: this.limiterFor(playId),
        onWrite: () => { /* 不走工坊撤销通道 */ },
      });
      await assets.generate({ kind: "sprite", characterId: charId, expression }, prompt);
      // 生图落 assets/sprites/ 后，reload 让前端收到更新的 hello（新 sprites 映射）
      await this.reload(playId);
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
  private async reloadAfterWorkshopWrite(playId: string): Promise<void> {
    const old = this.runtimes.get(playId);
    if (!old) return;
    // 等节拍边界：演出进行中重建会让这一拍凭空消失
    await old.orchestrator.whenIdle();
    // 等待期间可能已 reload/切档/删除——只在原实例还在位时才替换
    if (this.runtimes.get(playId) !== old) return;
    const fresh = await this.buildRuntime(playId, old.store.saveId, carryOverFrom(old, SETTINGS_UPDATED));
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
      assetNotes: await store.assetMeta(),
      generatedAssets: images?.notes(),
      memory,
      tree,
      engine,
      scene,
      tts: synth ? { synth, concurrency: this.config.tts.concurrency } : undefined,
      onPreloadAsset: (type, prompt, id) => void this.preloadAsset(play.id, type, prompt, id),
      onPreloadSprite: (charId, expression, prompt) => void this.preloadSprite(play.id, store, charId, expression, prompt),
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
      model,
      getApiKey: () => this.config.apiKey,
      emit: (msg) => this.broadcast(play.id, msg),
      onFilesChanged: () => void this.reloadAfterWorkshopWrite(play.id),
      imageBackend: this.imageBackend ?? undefined,
      limiter: this.limiterFor(play.id),
      saves: this.library.saves(play.id),
      saveStore: (saveId) => this.library.saveStore(play.id, saveId),
      assetLibrary: this.assetLibrary,
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
      assetsTtlMs: imagePendingTtlMs(this.config.image),
    };
  }
}
