import type {
  AgentTool,
  AgentToolResult,
  Agent,
  AgentMessage,
  StreamFn,
} from "@earendil-works/pi-agent-core";
import { Agent as PiAgent, estimateTokens } from "@earendil-works/pi-agent-core";
import { type Api, type Model, type Static, type TSchema, Type } from "@earendil-works/pi-ai";
import {
  LineageTree,
  StageDslParser,
  type EngineStateSnapshot,
  type LineageEvent,
  type LineageView,
  type MemorySnapshot,
  type PreloadAssetAttrs,
  type SequencedEvent,
  type StageEvent,
  type StopPayload,
  type PromptQueueItem,
  type SpriteFraming,
  type ReadPos,
  type ParserWarning,
  type ParserWarningType,
} from "@stage-ai/core";
import type { ServerMessage } from "@stage-ai/core";
export type { ReadPos } from "@stage-ai/core";
import { createAgentKit, type AgentKit } from "./agentkit/kit.js";
import type { ModelStop } from "./agentkit/deps.js";
import type { Exa } from "./exa.js";
import type { ImageAssets } from "./imageAssets.js";
import type { PlayAssets } from "./playAssets.js";
import { buildSystemPrompt, renderStateSection, type AssetManifest, type AssetNotes, type GeneratedNote } from "./prompt.js";
import { lineageToBeats, lineageToEvents, stopFromEvent, type RebuiltBeat } from "./rebuild.js";
import {
  EPOCH_SUMMARY_SYSTEM,
  measureContext,
  pickCutIndex,
  renderSeed,
  renderTranscript,
  splitSummary,
  withSeed,
  type EpochSummary,
} from "./compaction.js";
import { completeText } from "./llm.js";
import { HistoryRecorder, type HistoryBeat } from "./history.js";
import type { AgentSettings, PlayConfig } from "@stage-ai/core";
import type { PlayMemory } from "./memory.js";
import { VoicePipeline, type TtsSynthFn } from "./voice.js";
import type { PendingJobs } from "./pendingJobs.js";

/** 重建接力保留预算（token）：接住最近几轮就够，更早的细节走 archive 检索。 */
const CARRY_OVER_TOKENS = 8000;

/** 阅读位置落盘的最小间隔（毫秒）：位置随时更新，盘不用跟着逐字写。 */
const READ_PERSIST_MS = 1500;

/** 解析告警回灌的条数上限：再往上只是稀释真正的指令，而问题类型本来就那么几种。 */
const MAX_FEEDBACK_WARNINGS = 8;

/** 告警类型 → 模型看得懂的说法（英文枚举名对它没有诊断价值）。 */
const WARNING_LABELS: Record<ParserWarningType, string> = {
  orphan_text: "DSL 之外的散文",
  unknown_tag: "不存在的标签",
  malformed_tag: "写坏的标签",
  mismatched_close: "对不上的闭合标签",
  auto_closed: "没闭合就被自动收束",
  nested_wrap: "嵌套的台词块",
  legacy_tag: "已经改成工具调用的旧标签",
};

/** 解析告警去重限量后转成人话：一轮最多回灌这么多条。 */
function describeBeatWarnings(warnings: readonly ParserWarning[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const { type, detail } of warnings) {
    const line = `${WARNING_LABELS[type]}：${detail}`;
    if (seen.has(line)) continue;
    seen.add(line);
    out.push(line);
    if (out.length >= MAX_FEEDBACK_WARNINGS) break;
  }
  return out;
}

/**
 * 自修正回灌块。
 *
 * 模型输出不合 DSL 时，解析器把不合法的部分丢了——但它不知道丢了什么，下一轮照旧
 * 犯同样的错，演出就一直缺内容。这里把「上一轮哪里被丢了」讲清楚，让它自己改。
 * 只讲位置和症状，不复述原文（复述会把上一轮的坏输出又塞回上下文一遍）。
 */
function renderBeatWarnings(warnings: readonly string[]): string {
  return [
    "【上一轮输出的问题】（下面是上一轮你的输出中被解析器丢弃或改写的地方）",
    ...warnings.map((w) => `- ${w}`),
    "这一轮请只输出符合 DSL 的标签内容，不要输出 DSL 之外的散文；" +
      "已经演出的内容不要重写，只从断掉的地方接着写。",
  ].join("\n");
}

export type PlayerAction =
  | { kind: "choice"; optionIndex: number }
  | { kind: "free"; text: string }
  | { kind: "continue" }
  | { kind: "prompt"; text: string };

/** 选项索引已解析为文本的玩家操作（continue 不是玩家说的话，不在其列）。 */
export type ResolvedAction =
  | { kind: "choice"; text: string }
  | { kind: "free"; text: string }
  | { kind: "prompt"; text: string };

export interface OrchestratorOptions {
  streamFn: StreamFn;
  model: Model<Api>;
  /** LLM 网关 API key（pi Agent 的 getApiKey 通道）。 */
  getApiKey: () => string | undefined;
  play: PlayConfig;
  /** 素材清单（A 区注入：可用 bg/bgm/sfx/立绘差分 id）。 */
  assets?: AssetManifest;
  /** 素材描述（stem → 一句画面说明，来自 assets/manifest.json；挂在清单 id 后面）。 */
  assetNotes?: AssetNotes;
  /** 已生成图清单（playwriter 自己 preload 出来的资产；避免换个 id 重画）。 */
  generatedAssets?: GeneratedNote[];
  /** 剧目记忆（D7 三层：always/index 注入 A 区，archive 供检索）。 */
  memory: PlayMemory;
  tree: LineageTree;
  engine: EngineStateSnapshot;
  scene: string;
  /** 服务端消息出口（transport 广播）。 */
  onServerMessage: (msg: ServerMessage) => void;
  /** 行级谱系事件落盘钩子（每次 append 后调用）。 */
  onLineageEvent?: (event: LineageEvent) => void;
  /** 会话落盘钩子（beat 收束时调用）；返回 Promise 时 whenIdle 会等它落地。 */
  persist: () => void | Promise<void>;
  /** 服务器重启恢复：上次会话的运行态（事件缓冲/轮号/停止点）。 */
  restored?: OrchestratorRuntimeState;
  /** 服务器重启恢复：已落盘的剧作家历史（不回灌的话，下一次落盘就把重启前的历史清成空白）。 */
  restoredHistory?: HistoryBeat[];
  /** 语音管线合成函数（无则本剧目无声：hello.voice=false）。 */
  tts?: { synth: TtsSynthFn; concurrency?: number };
  /** 在生成的事（右上角 pending 面板）：剧作家的轮次记在这儿。 */
  pending?: PendingJobs;
  /**
   * 生图能力（未启用时整段不给：工具回不可用，也不会往时间线上摆永远等不到的骨架）。
   * bg/cg 落 media-cache 运行时缓存，立绘与临时角色落 assets/（与工坊同一个 PlayAssets）。
   */
  imageTools?: {
    playAssets?: PlayAssets;
    images?: ImageAssets;
    /** 后台发起 bg/cg：宿主负责 asset_ready / asset_failed 广播（工具不等图）。 */
    kick: (type: "bg" | "cg", prompt: string, id: string) => void;
    /** 后台发起立绘：同上的失败广播。characterName 供角色表里还没有的角色自动建 stub。 */
    kickSprite: (
      charId: string,
      expression: string,
      prompt: string,
      characterName?: string,
      framing?: SpriteFraming,
    ) => void;
    /** 这个 id 的背景/插图是不是已经在 assets/ 里（工坊导入的静态素材）——有就不烧配额。 */
    hasStaticAsset: (type: "bg" | "cg", id: string) => boolean;
    /** 联网检索（配了 key 才注册 web_search）。 */
    exa?: Exa;
  };
  /**
   * 写角色设定钩子：write_memory file="characters/<id>" 时调用。
   * 负责落盘 always/characters/<id>.md 并 upsert play.json stub。
   */
  onWriteCharacter?: (charId: string, content: string) => Promise<void>;
  /** 纪元压缩阈值（窗口占比）与保留预算；不传则只增不减到模型自己报错。 */
  compaction?: {
    contextWindow: number;
    triggerRatio: number;
    keepRecentTokens: number;
  };
  /**
   * 单轮超时（毫秒）。网关挂住时 provider 既不报错也不收流，编排器会一直等下去，
   * 舞台表现为「剧作家正在落笔…」永远不结束。超点即 abort 这一轮，按轮失败收束。
   * 不传 = 不设上限。
   */
  beatTimeoutMs?: number;
  /** 重建接力：A 区变了（工坊改了创作口径/设定）时携带的对话尾，见 carryOver。 */
  seed?: CarryOver;
  /**
   * 剧作家的 agent 设置（play.json 的 agents.playwriter）：模型由宿主解析成 opts.model 传进来，
   * 这里只用思考档位与工具开关。缺省即「思考 off、工具全开」。
   */
  agents?: AgentSettings;
}

/**
 * 重建接力包：工坊/素材改动触发 runtime 重建时，把旧对话体的最近一段带过去。
 * A 区（systemPrompt）是只读的，换 A 区只能重建 Agent——不接力就是每改一次设定失忆一次。
 */
export interface CarryOver {
  messages: AgentMessage[];
  note: string;
}

/** 编排器运行态（随 session.json 持久化，重启后恢复重放与续演）。 */
export interface OrchestratorRuntimeState {
  events: SequencedEvent[];
  beatNo: number;
  lastStop: StopPayload | null;
  /** 事件缓冲代号（P6）：结构性操作会自增，客户端据此识别「缓冲已整段重放」。 */
  epoch: number;
  /** 阅读位置：老档没有这个字段，缺省即从头读（跳到缓冲末尾的老行为）。 */
  readPos?: ReadPos | null;
}

interface OpenLine {
  kind: "say" | "narrate" | "thought";
  id?: string;
  text: string;
  attrs: Record<string, string>;
  /** 该行首事件（say_start 等）的 seq：客户端 ScriptLine.seq 同尺，谱系↔剧本行的锚。 */
  seq: number;
}

/**
 * Playwriter 编排器：pi Agent 流式输出 → StageDslParser → IR 事件（seq）→ 广播；
 * 谱系行级聚合 + 快照；beat 生命周期（start → 流式 → stop/no_stop 收束）。
 *
 * 三区装配：A 区 = system prompt（固定）；B 区 = 逐轮追加的 user 消息
 * （【状态】+【导演注】?+【玩家表态】，Active State 进 user 消息保证 KV 前缀稳定）。
 */
export class PlaywrightOrchestrator {
  private agent: Agent;
  private readonly parser: StageDslParser;
  private readonly opts: OrchestratorOptions;
  private readonly events: SequencedEvent[] = [];
  private seq = 0;
  private beatNo = 0;
  private busy = false;
  private pendingStop: StopPayload | null = null;
  /** 最近一次停止点（choice 输入解析选项文本用）。 */
  private lastStop: StopPayload | null = null;
  private openLine: OpenLine | null = null;
  private autostarted = false;
  private disposed = false;
  /** 一轮正在开（纪元压缩等前置步骤未完）：对外等同 busy，防止并发 beginBeat。 */
  private beatPending = false;
  /** 等待「编排器空闲」的挂起者（工坊写盘要在轮边界重建 runtime，不打断进行中的演出）。 */
  private idleWaiters: (() => void)[] = [];
  /** 最近一次会话落盘任务：重建 runtime 前必须等它落地，否则可能读到写了一半的 session.json。 */
  private pendingPersist: Promise<void> | null = null;
  /** 旁路补全（纪元摘要）的中断源：dispose 时一并掐断在飞请求。 */
  private readonly signalController = new AbortController();
  /** 语音预取管线（D5）：say 行 → 分句 → TTS 预取 → audio_ready。 */
  private readonly voice: VoicePipeline | null;
  /** 本轮内 pi agent 的流错误（message_end.errorMessage）；每轮重置。 */
  private beatError: string | null = null;
  /** 这一轮是被我们自己的超时掐断的：provider 随之报的是 AbortError，不是根因。 */
  private beatTimedOut = false;
  /** 本轮内产出的舞台事件数（空轮检测）。 */
  private beatEvents = 0;
  /** 本轮台词文本（archive 切片摘要来源）。 */
  private beatLines: string[] = [];
  /** 上一轮 DSL 解析告警（已转成人话）：下一轮回灌给模型自修正，见 renderBeatWarnings。 */
  private beatWarnings: string[] = [];
  /** 本 turn 调用了 beat_done → 轮在此收束（普通工具轮次不算边界，否则记忆查询会撕裂轮）。 */
  private beatClosed = false;
  /** always/state 活跃状态文件内容（谱系级，随快照走；write_memory 工具维护）。 */
  private stateFiles: Record<string, string> = {};
  /** 当前分支已走过的纪元摘要 id（谱系级，随快照走；纪元压缩时追加）。 */
  private arcIds: string[] = [];
  /** 待注入的插一句（演出中收到，等这一轮收束再兑现）。不落盘：重启后队列不复活。 */
  private pending: PromptQueueItem[] = [];
  /** 本轮在 pending 面板上的那一条（收束时销掉）：剧作家正在写的那一轮。 */
  private pendingBeatJob: (() => void) | null = null;
  private pendingSeq = 0;
  /** 链尾悬空的用户输入（分岔落在一次表态上时截下来的）：并进下一轮，不造空 assistant 轮次。 */
  private trailingInputs: string[] = [];
  private unsubscribeAgent: (() => void) | null = null;
  /** 事件缓冲代号（P6）：分岔/跳转/编辑/重写后整段重放并自增，客户端据此丢弃旧 seq 认知。 */
  private epoch = 0;
  /** 玩家读到哪儿（seq + 已显示字数）：随 session.json 落盘，刷新后据此回到原处。 */
  private readPos: ReadPos | null = null;
  /** 阅读位置的落盘节流：打字机逐字报位置，不能逐字写盘。 */
  private readPersistTimer: ReturnType<typeof setTimeout> | null = null;
  /** 已写入 JSONL 的谱系事件数：直接改动树的操作（编辑/重写）在此增量补推。 */
  private loggedEvents = 0;
  /** 剧作家历史累积器（思考/原始 DSL/工具调用；随 session.json 落盘，只读对外）。 */
  private readonly historyRecorder: HistoryRecorder;
  /** 统一基座装好的工具（一次构造，纪元压缩重建 Agent 时复用同一份）。 */
  private readonly kit: AgentKit;

  constructor(opts: OrchestratorOptions) {
    this.opts = opts;
    this.historyRecorder = new HistoryRecorder(opts.restoredHistory);
    this.parser = new StageDslParser((event) => this.onStageEvent(event));
    if (opts.restored) {
      // 恢复会话：活跃状态文件与纪元摘要从路径最近快照回填（谱系级记忆）
      const snapshot = opts.tree.latestSnapshotOnPath(opts.tree.leafId);
      this.stateFiles = snapshot?.memory.state ?? {};
      this.arcIds = [...(snapshot?.memory.arcs ?? [])];
      // 已有事件早已落过 JSONL，不重复补推
      this.loggedEvents = opts.tree.export().events.length;
    }
    this.kit = createAgentKit({
      role: "playwriter",
      playId: opts.play.id,
      disabled: new Set(opts.agents?.disabledTools ?? []),
      thinking: opts.agents?.thinking,
      engine: opts.engine,
      characterIds: new Set(opts.play.characters.map((c) => c.id)),
      memory: opts.memory,
      tree: opts.tree,
      stateFiles: this.stateFiles,
      arcIds: () => this.arcIds,
      writeCharacter: opts.onWriteCharacter,
      emitStop: (stop) => this.emitStop(stop),
      emitPreload: (attrs) => this.onStageEvent({ kind: "preload_asset", ...attrs }),
      playAssets: opts.imageTools?.playAssets,
      kick: opts.imageTools?.kick ?? (() => {}),
      kickSprite: opts.imageTools?.kickSprite ?? (() => {}),
      statusOf: (id) => opts.imageTools?.images?.statusOf(id) ?? "none",
      hasStaticAsset: opts.imageTools?.hasStaticAsset ?? (() => false),
      exa: opts.imageTools?.exa,
    });
    this.agent = this.buildAgent(opts.seed ? withSeed(opts.seed.messages, opts.seed.note) : []);
    this.voice = opts.tts
      ? new VoicePipeline({
          synth: opts.tts.synth,
          voiceOf: (charId) => opts.play.characters.find((c) => c.id === charId)?.voiceId,
          emit: (event) =>
            this.send(
              event.state === "ready" && event.url
                ? { type: "audio_ready", seq: event.seq, phrase: event.phrase, url: event.url }
                : { type: "audio_pending", seq: event.seq, phrase: event.phrase },
            ),
          concurrency: opts.tts.concurrency,
          pending: opts.pending,
        })
      : null;
    if (opts.restored) {
      // 恢复会话：回填事件缓冲与轮状态，autostart 视为已完成（续演不重开开场）
      this.events.push(...opts.restored.events);
      this.seq = this.events.at(-1)?.seq ?? 0;
      this.beatNo = opts.restored.beatNo;
      this.lastStop = opts.restored.lastStop;
      this.epoch = opts.restored.epoch ?? 0;
      this.readPos = opts.restored.readPos ?? null;
      this.autostarted = true;
    }
  }

  /**
   * 构建并接管一个 pi Agent 实例（纪元压缩会重建——A 区变了不能只换 messages）。
   * 退订旧实例、重订新实例、装上批次收束兜底，都收在这里。
   */
  private buildAgent(messages: AgentMessage[]): Agent {
    const opts = this.opts;
    this.unsubscribeAgent?.();
    const agent = new PiAgent({
      streamFn: opts.streamFn,
      getApiKey: opts.getApiKey,
      initialState: {
        systemPrompt: buildSystemPrompt({
          play: opts.play,
          assets: opts.assets,
          notes: opts.assetNotes,
          generated: opts.generatedAssets,
          memory: opts.memory,
          arcIds: this.arcIds,
          canImage: this.kit.can.image,
          canSearch: this.kit.can.search,
        }),
        model: opts.model,
        thinkingLevel: this.kit.thinking,
        tools: this.kit.tools,
        messages,
      },
    });
    // 批次收束兜底：pi 仅在「批内全部工具结果都 terminate」时收束 turn，模型若把 beat_done
    // 与记忆工具同批调用，terminate 会被吞掉导致本轮继续空转——此时按 beat_done 显式收束 run。
    agent.finishTurn = async (turn) => {
      const calls = turn.message.content.filter((c) => c.type === "toolCall");
      if (!calls.some((c) => c.name === "beat_done")) return undefined;
      this.beatClosed = true;
      return calls.length > 1 ? { action: "end" as const } : undefined;
    };
    this.unsubscribeAgent = agent.subscribe((event) => void this.onAgentEvent(event));
    this.agent = agent;
    return agent;
  }

  /** 运行态快照（session.json 持久化，重启后恢复重放与续演）。 */
  get runtimeState(): OrchestratorRuntimeState {
    return {
      events: this.events,
      beatNo: this.beatNo,
      lastStop: this.lastStop,
      epoch: this.epoch,
      readPos: this.readPos,
    };
  }

  /** 玩家读到哪儿（hello 下发；null = 没记过）。 */
  get readingPos(): ReadPos | null {
    return this.readPos;
  }

  /**
   * 记录阅读位置。播放头一动就报一次，落盘做节流——
   * 打字机是逐字的，逐字落盘会把 session.json 写成一串 IO。
   * 回退/分岔后 seq 不在新分支上也没关系：客户端只在恢复时用一次，对不上就退回末尾。
   */
  setReadPos(pos: ReadPos | null): void {
    const prev = this.readPos;
    if (prev?.seq === pos?.seq && prev?.len === pos?.len) return;
    this.readPos = pos;
    this.scheduleReadPersist();
  }

  /** 当前缓冲代号（hello/rebase 携带，客户端识别结构性操作）。 */
  get currentEpoch(): number {
    return this.epoch;
  }

  /**
   * 剧作家 session 历史（只读）：按轮分组，条目为注入的 user 原文 / 思考 / 原始 DSL / 工具调用。
   * 与 `agent.state.messages` 不同源——对话体会被纪元压缩砍掉重建，这里是边跑边攒的独立账本。
   * 随 session 落盘，REST `/api/plays/:id/history` 读它。
   */
  get history(): HistoryBeat[] {
    return this.historyRecorder.snapshot();
  }

  /**
   * 重建接力：把对话体的最近一段切出来交给新实例。
   * A 区（systemPrompt）是只读的，工坊改了创作口径/设定就只能重建 Agent——不接力就等于每改一次失忆一次。
   * 切点与纪元压缩同原则：落点必是 user 消息，工具调用对不被劈开；预算取压缩保留预算的一小截，
   * 够接住最近几轮即可，更早的细节本就逐轮落进 archive，search_archive 检索得回来。
   */
  carryOver(note: string): CarryOver | null {
    const messages = this.agent.state.messages;
    if (messages.length < 2) return null;
    const { scale } = measureContext(messages);
    let tokens = 0;
    let cut = messages.length;
    while (cut > 1 && tokens < CARRY_OVER_TOKENS) {
      cut -= 1;
      tokens += estimateTokens(messages[cut]!) * scale;
    }
    while (cut < messages.length && messages[cut]?.role !== "user") cut += 1;
    // 落在末尾：没有可接力的完整轮次（空轮 / 只有 system）
    if (cut >= messages.length) return null;
    return { messages: messages.slice(cut), note };
  }

  /** 引擎状态（只读视图）：状态检查与同刻性断言用。 */
  get engineState(): NonNullable<PlayConfig["initialState"]> {
    return this.opts.engine;
  }

  /** 丢弃：断订阅、中断当前流与旁路补全、停语音管线（多剧目/重开时回收）。 */
  dispose(): void {
    this.disposed = true;
    this.unsubscribeAgent?.();
    this.agent.abort();
    this.signalController.abort();
    this.voice?.dispose();
    // 这一层的活儿（轮次、以及随本实例一起被丢掉的预发射）没人再收尾，
    // 不清就永远挂在玩家面板上——runtime 重建/切档都走这一个出口。
    this.pendingBeatJob?.();
    this.pendingBeatJob = null;
    this.opts.pending?.clearAll();
    this.flushIdleWaiters(); // 挂起的重建请求不得悬着
  }

  /** 空闲时立刻兑现，否则等到下一个轮边界（工坊热改 premise 不能腰斩进行中的演出）。 */
  whenIdle(): Promise<void> {
    if (this.disposed) return Promise.resolve();
    if (!this.engaged) return this.pendingPersist ?? Promise.resolve();
    return new Promise((resolve) => this.idleWaiters.push(resolve));
  }

  /** 记下落盘任务（finishBeat/压缩后调用），whenIdle 据此等到磁盘落地。 */
  private persist(): void {
    if (this.readPersistTimer) {
      clearTimeout(this.readPersistTimer);
      this.readPersistTimer = null;
    }
    this.pendingPersist = Promise.resolve(this.opts.persist()).catch((error: unknown) => {
      console.warn(`[stage-ai] 会话落盘失败: ${error instanceof Error ? error.message : String(error)}`);
    });
  }

  /** 阅读位置专用节流落盘：一行读完再等一拍，避免把每轮落盘次数拉成百倍。 */
  private scheduleReadPersist(): void {
    if (this.readPersistTimer) return;
    this.readPersistTimer = setTimeout(() => {
      this.readPersistTimer = null;
      this.persist();
    }, READ_PERSIST_MS);
  }

  private flushIdleWaiters(): void {
    const waiters = this.idleWaiters.splice(0);
    if (waiters.length === 0) return;
    // 等落盘落地再唤醒：重建 runtime 会 loadSession，读到写了一半的文件＝丢进度
    void (this.pendingPersist ?? Promise.resolve()).then(() => {
      for (const resolve of waiters) resolve();
    });
  }

  /** 语音控制（客户端 tts_control）：enabled=总开关，paused=背压暂停预取。 */
  setTtsState(state: { enabled?: boolean; paused?: boolean }): void {
    if (state.enabled !== undefined) this.voice?.setEnabled(state.enabled);
    if (state.paused !== undefined) this.voice?.setPaused(state.paused);
  }

  private send(msg: ServerMessage): void {
    if (!this.disposed) this.opts.onServerMessage(msg);
  }

  get started(): boolean {
    return this.autostarted;
  }

  get isBusy(): boolean {
    return this.busy;
  }

  /** 对外可接收新输入的空闲判据：一轮开窗中（busy）或正在开新一轮（纪元压缩等前置）。 */
  private get engaged(): boolean {
    return this.busy || this.beatPending;
  }

  get lastSeq(): number {
    return this.seq;
  }

  get currentScene(): string {
    return this.opts.scene;
  }

  /** 重连恢复：stopped 态重发 beat_end 载荷；演出进行中/未开局返回 null。 */
  get stoppedReplay(): {
    type: "beat_end";
    beatId: string;
    reason: "stop" | "no_stop";
    stop?: StopPayload;
  } | null {
    // 判据只有「开没开演」（autostarted 会随恢复的会话一起置位）。曾经还挂着
    // `beatNo === 0`，把「挂载点落在第 0 拍内」误当成「还没开演」——快照只在每拍收束时
    // 写，第 0 拍内没有快照，stateAt 的 turn 回落 0，于是停止点重放被吞掉，
    // 玩家刷新后停在 stopped 却没有面板可点。
    if (this.busy || !this.autostarted) return null;
    return {
      type: "beat_end",
      beatId: `beat-${this.beatNo}`,
      reason: this.lastStop ? "stop" : "no_stop",
      stop: this.lastStop ?? undefined,
    };
  }

  /** 这棵树还没开演过：没有周目内容，等玩家自己按「开演」。 */
  get fresh(): boolean {
    return !this.autostarted && this.beatNo === 0;
  }

  /** 开演第一轮。空树不会自己开——玩家在舞台上按「开演」才走这一步。 */
  start(): void {
    if (!this.fresh || this.engaged) return;
    this.autostarted = true;
    void this.beginBeat(this.opts.play.opening);
  }

  /** 玩家操作 → 下一轮。插一句在演出中排进待注入队列，其余动作必须 idle。 */
  async playerAction(action: PlayerAction): Promise<void> {
    // 插一句是唯一支持演出中投递的输入：它在轮边界统一兑现，不打断进行中的这一轮。
    // engaged 覆盖纪元压缩窗口（压缩期间 busy 仍为 false，但 Agent 随时可能被重建，
    // 并发 beginBeat 会打架），此时也只排队——不投进即将被替换的实例。
    if (action.kind === "prompt") {
      const text = action.text.trim();
      if (!text) return;
      const item: PromptQueueItem = {
        id: `pq-${this.pendingSeq += 1}`,
        text,
        beatNo: this.beatNo,
        status: "pending",
      };
      this.pending.push(item);
      this.broadcastPromptQueue();
      if (this.engaged) return;
      this.beatPending = true; // 先占位：deliverPrompts 前的空档不放行 whenIdle
      await this.deliverPrompts([item]);
      return;
    }
    if (this.engaged) {
      this.send({
        type: "error",
        message: "演出进行中，请等待当前轮结束",
        recoverable: true,
      });
      return;
    }
    // 「继续」不是玩家说的话：它不占【用户输入】段，也不落谱系节点（没有可分岔的锚点）
    let resolved: ResolvedAction | null = null;
    if (action.kind === "continue") {
      resolved = null;
    } else if (action.kind === "choice") {
      const option = this.lastStop?.options?.[action.optionIndex];
      if (!option) {
        this.send({
          type: "error",
          message: `无效的选项索引: ${action.optionIndex}`,
          recoverable: true,
        });
        return;
      }
      resolved = { kind: "choice", text: `（选择了：${option.text}）` };
    } else {
      resolved = action;
    }
    if (!this.autostarted) {
      this.autostarted = true;
      // 开场这一句同样落谱系：否则它只活在对话体里，玩家在轮内分岔就再也找不回来
      if (resolved) this.appendLineage("prompt", { payload: { input: resolved.text } });
      const inputs = resolved ? [resolved.text] : [];
      await this.beginBeat(`${this.opts.play.opening}\n\n${this.renderPromptTurn(inputs)}`);
      return;
    }
    if (!resolved) {
      await this.beginBeat(this.renderPromptTurn([]));
      return;
    }
    await this.deliverPrompts([{ id: "", text: resolved.text, beatNo: this.beatNo, status: "pending" }]);
  }

  /**
   * 兑现一批插一句：落谱系 → 开始新一轮。
   *
   * 谱系节点在**注入时**才落（排队期间玩家还能改还能撤），且挂在开新一轮之前——
   * 它是这一轮的第一条输入节点，锚点分岔从这里起就等于「从这句话重演」。
   * 已落笔的旧批次在这里出列：它在面板上显示过「已落笔」，新一轮开始时就不该再占位。
   * 收束后的排队兑现由 beginBeat 的 onBeatSettled 统一接管，本方法不重复。
   */
  private async deliverPrompts(items: readonly PromptQueueItem[]): Promise<void> {
    this.pending = this.pending.filter((item) => item.status === "pending");
    for (const item of items) this.appendLineage("prompt", { payload: { input: item.text } });
    for (const item of items) {
      item.status = "sent";
      item.sentBeatNo = this.beatNo + 1;
    }
    this.broadcastPromptQueue();
    await this.beginBeat(this.renderPromptTurn(items.map((item) => item.text)));
  }

  /** 本轮收束后的收尾：先兑现排队输入（保持 engaged），没有才放行 whenIdle。 */
  private onBeatSettled(): void {
    this.send({ type: "beat_settled" });
    // 只取还没落笔的：已注入的那批不能再来一遍，否则同一句话会进两次谱系
    const items = this.pending.filter((item) => item.status === "pending");
    if (items.length === 0) {
      // 队列空了就把已落笔的那批也带走：面板写的是「接下来要说的话」，
      // 没有下一句时它就该消失，不能把上一轮的回执永远挂在右上角。
      if (this.pending.length > 0) {
        this.pending = [];
        this.broadcastPromptQueue();
      }
      this.flushIdleWaiters();
      return;
    }
    this.beatPending = true; // 先占位再放行：engaged 不能在「这一轮完了但下一轮没开」的缝里掉下去
    void this.deliverPrompts(items);
  }

  /** 改一条还没落笔的排队输入。找不到就是客户端状态过期——回错，不静默吞。 */
  editPending(id: string, text: string): void {
    const trimmed = text.trim();
    if (!trimmed) throw new Error("不能为空");
    const item = this.pending.find((entry) => entry.id === id && entry.status === "pending");
    if (!item) throw new Error("这一条已经不在队列里了");
    item.text = trimmed;
    this.broadcastPromptQueue();
  }

  /** 撤掉一条还没落笔的排队输入。 */
  deletePending(id: string): void {
    if (!this.pending.some((entry) => entry.id === id && entry.status === "pending")) {
      throw new Error("这一条已经不在队列里了");
    }
    this.pending = this.pending.filter((entry) => entry.id !== id);
    this.broadcastPromptQueue();
  }

  private broadcastPromptQueue(): void {
    this.send({ type: "prompt_queue", items: this.pending });
  }

  /** 重连重放：seq 之后的缓冲事件。 */
  eventsAfter(lastSeq: number): SequencedEvent[] {
    return this.events.filter((e) => e.seq > lastSeq);
  }

  // —— 谱系四原语：跳转 / 分岔 / 编辑 / 插一句，彼此正交，可自由组合 ——

  /** 路线树视图（全量节点含废弃分支）；前端「路线」视图与 REST 共用。 */
  lineageView(): LineageView {
    return this.opts.tree.describe();
  }

  /**
   * 跳转：世界线挂到目标节点并重建上下文。活的、废弃的都走这一条——废弃节点也跳得进去，
   * 只是跳过去意味着当前剧情作废（历史全部保留）。不重新生成，玩家落到哪就从哪继续。
   */
  async jumpTo(nodeId: string): Promise<void> {
    this.guardIdle();
    this.rebaseAt(nodeId, "已跳到这里", { mark: false });
  }

  /**
   * 分岔：从任意节点开新分支。
   *
   * `resume: true` = 分岔后立刻续演（用户说的「重来」）：目标节点之后的内容整段截断，
   * 挂载点后紧接一个 fork 标记事件，续演内容挂它之下。中间不设停止点——等价于玩家在
   * 上一轮末尾按了「继续」，零点击。
   */
  async forkTo(nodeId: string, opts?: { resume?: boolean }): Promise<void> {
    this.guardIdle();
    if (!opts?.resume) {
      this.rebaseAt(nodeId, "已从此处开新分支");
      return;
    }
    // rebaseAt 同步完成（含 recordFork），beginBeat 同步置 beatPending：
    // 整个 fork+续演是一步，中间没有让 engaged 掉下去的空档。
    this.rebaseAt(nodeId, "重演这一轮", { resume: true });
    await this.beginBeat(this.renderPromptTurn([]));
  }

  /**
   * 原地编辑：当前分支该行文本替换。
   *
   * 纯原地——不重放、不分岔、不回滚引擎状态、不动停止点：改一句台词就是改这一句，
   * 剧情接着原样往下演。后续生成以新文本为上下文（对话体原地换掉那一行）。
   * 引擎状态不回滚：改台词不等于撤销已经算出的好感度/旗标，那才叫分岔。
   */
  editLine(nodeId: string, newText: string): void {
    this.guardIdle();
    const text = newText.trim();
    if (!text) throw new Error("台词不能为空");
    const target = this.opts.tree.get(nodeId);
    this.opts.tree.recordEdit(nodeId, text);
    this.flushLineageLog();
    this.buildAgent(this.renderBeats(this.rebuildBeats(this.opts.tree.materialize()).beats));
    // seq 是这一行在舞台缓冲里的身份：客户端靠它就地换字，不必整段重放
    const seq = target?.payload?.seq;
    this.send({
      type: "line_edited",
      nodeId,
      text,
      ...(typeof seq === "number" ? { seq } : {}),
    });
  }

  /**
   * 导演生图：在**点下这一刻**的位置落一个 cg 节点（加 seq → 广播 → 落谱系，与模型
   * 写 `<cg id>` 同一条路），图到不到货都先把位置钉住。
   *
   * 为什么不等图到了再落：谱系是 append-only 的树，新节点挂的是当时的叶子。图要一分多钟，
   * 那时玩家多半已经往下演了几拍——「生成完插进去」插到的会是「玩到哪儿了」，不是请求的那一刻。
   * 这与剧作家的预发射同构：骨架先占位，到货再原地填。
   */
  directorCg(id: string): void {
    this.onStageEvent({ kind: "cg", id });
  }

  /** 导演生图的上下文：当前这条世界线上最近几句说出口的话，加当前场景。 */
  recentScript(limit = 12): { lines: string[]; scene: string } {
    const chain = this.opts.tree.chainEvents(this.opts.tree.leafId);
    const lines: string[] = [];
    for (let i = chain.length - 1; i >= 0 && lines.length < limit; i -= 1) {
      const event = chain[i]!;
      if (event.kind !== "say" && event.kind !== "narrate" && event.kind !== "thought") continue;
      const text = event.text?.trim();
      if (text) lines.push(text);
    }
    return { lines: lines.reverse(), scene: this.opts.scene };
  }

  private guardIdle(): void {
    if (this.engaged) throw new Error("演出进行中，请等待当前轮结束");
  }

  /**
   * 上下文重建（P6 transformContext 的执行点）：调用方已把挂载点摆好，这里只管按
   * 目标节点重放出「引擎状态 + 记忆快照 + 客户端事件缓冲 + LLM 对话轮次」，
   * 一次突变完成即回到 append-only 稳态。
   *
   * 动词只负责「树该长什么样」（jumpTo / recordEdit / recordFork），世界线重建是同一件事，
   * 所以收在这里，不再各自传 nodeId。
   *
   * 保持同刻铁律：旧分支的活跃状态、剧情线引用与 archive 检索范围一并回退，
   * 兄弟/废弃分支的往事不可召回（防剧透）。
   *
   * `resume: true` 时不停在这个停止点：挂载点落在轮中的节点也照样续演——
   * 轮首锚点由客户端算出（见计划 §7.2），服务端不需要知道「轮边界」这件事。
   */
  private rebaseAt(nodeId: string, note: string, opts?: { resume?: boolean; mark?: boolean }): void {
    this.guardIdle();
    const tree = this.opts.tree;
    const chain = tree.materialize(nodeId);
    const { beats, trailingInputs } = this.rebuildBeats(chain);
    this.restoreBranchState(nodeId);
    // 分岔必落标记：分岔不留痕等于没发生过。跳转反过来——它只挪世界线，不宣称这条线岔过。
    if (opts?.mark === false) tree.jumpTo(nodeId);
    else tree.recordFork(nodeId);
    // 链尾悬空的表态（分岔落在一次输入上）并进下一轮，不造空 assistant 轮次
    this.trailingInputs = trailingInputs;
    // 历史跟着分支回退：不在新路径上的轮（兄弟与废弃分支）、以及被轮中截断砍掉后半的那一轮，
    // 都已经不属于这一场了（铁律：分岔/跳转随分支走，防剧透同一原则）
    this.historyRecorder.rebaseTo(tree.pathSet(), this.beatNo);
    this.events.length = 0;
    this.events.push(...lineageToEvents(chain));
    this.seq = this.events.at(-1)?.seq ?? 0;
    this.openLine = null;
    this.pendingStop = null;
    this.restoreStopPoint(chain, opts?.resume === true);
    this.buildAgent(this.renderBeats(beats));
    this.epoch += 1;
    this.send({
      type: "rebase",
      epoch: this.epoch,
      leafId: tree.leafId,
      events: [...this.events],
      ...(this.lastStop ? { stop: this.lastStop } : {}),
      reason: this.lastStop ? "stop" : "no_stop",
      // resume=true 的重建（重演这一轮）后面紧跟着一轮新内容，不能说成「已演完」
      ...(opts?.resume ? { resuming: true } : {}),
      note,
    });
    this.persist();
  }

  /** 某节点路径上的分支状态：引擎/场景/活跃状态文件/剧情线引用（纯计算，不改现场）。 */
  private stateAt(nodeId: string | null): {
    engine: NonNullable<PlayConfig["initialState"]>;
    scene: string;
    stateFiles: Record<string, string>;
    arcIds: string[];
  } {
    const chain = this.opts.tree.chainEvents(nodeId);
    const snapshot = this.opts.tree.latestSnapshotOnPath(nodeId);
    const base = snapshot?.engine ?? this.opts.play.initialState;
    let scene = this.opts.play.initialScene;
    for (const event of chain) {
      if (event.kind === "scene") scene = event.payload?.attrs?.bg || scene;
    }
    return {
      engine: { turn: base.turn, affinity: { ...base.affinity }, flags: { ...base.flags } },
      scene,
      stateFiles: { ...(snapshot?.memory.state ?? {}) },
      arcIds: [...(snapshot?.memory.arcs ?? [])],
    };
  }

  /** 分支状态回退：把 nodeId 路径上的状态整体装回现场（跳转/分岔/编辑/重写共用）。 */
  private restoreBranchState(nodeId: string | null): void {
    const state = this.stateAt(nodeId);
    const engine = this.opts.engine;
    engine.turn = state.engine.turn;
    engine.affinity = { ...state.engine.affinity };
    engine.flags = { ...state.engine.flags };
    // 原地换内容而不是换对象：write_memory 工具闭包持有的是这个对象，
    // 换引用的话分岔之后记忆工具会写到一个没人再读的对象上去（状态区再也不更新）。
    for (const key of Object.keys(this.stateFiles)) delete this.stateFiles[key];
    Object.assign(this.stateFiles, state.stateFiles);
    this.arcIds = [...state.arcIds];
    this.beatNo = engine.turn;
    this.opts.scene = state.scene;
  }

  /**
   * 停止点恢复：停在 stop/beat_end 边界 → 还原该停止点（choice 选项原样回到面板）；
   * 停在轮中（写一半被打断）→ 给一个 pause 停止点，玩家按「继续」重开一轮。
   * 注意 pause 只在这一条路径上出现，无 stop 的收尾永远走 null → 一个普通的「继续」。
   *
   * `resume`（分岔后立刻续演）时一律清空：分岔的语义就是「不等玩家选，接着演」。
   */
  private restoreStopPoint(chain: readonly LineageEvent[], resume = false): void {
    const last = chain.at(-1);
    if (resume || !last) {
      this.lastStop = null;
      return;
    }
    if (last.kind === "stop") {
      this.lastStop = stopFromEvent(last);
      return;
    }
    if (last.kind === "beat_end") {
      // 只在本轮内找停止点：全链 findLast 会把上一轮的 stop 复活到无停止点收尾的档里，
      // 玩家看到的就不是一个正常出口，而是隔了一轮就作废的旧选项
      const prevBoundary = chain.slice(0, -1).findLastIndex((event) => event.kind === "beat_end");
      const stop = chain.slice(prevBoundary + 1).findLast((event) => event.kind === "stop");
      this.lastStop = stop ? stopFromEvent(stop) : null;
      return;
    }
    this.lastStop = { stopType: "pause" };
  }

  /** 谱系链 → 对话轮次素材（链尾悬空的输入单列，不凑空轮次）。 */
  private rebuildBeats(chain: readonly LineageEvent[]): {
    beats: RebuiltBeat[];
    trailingInputs: string[];
  } {
    const names: Record<string, string> = {};
    for (const character of this.opts.play.characters) names[character.id] = character.name;
    return lineageToBeats(chain, names, this.opts.play.opening);
  }

  /** 对话轮次 → LLM 消息（历史轮的玩家原话与已演出脚本，状态不进历史轮次）。 */
  private renderBeats(beats: readonly RebuiltBeat[]): AgentMessage[] {
    const now = Date.now();
    const messages: AgentMessage[] = [];
    beats.forEach((beat, index) => {
      const at = now + index;
      messages.push({ role: "user", content: beat.user, timestamp: at });
      messages.push({
        role: "assistant",
        content: [{ type: "text", text: beat.assistant }],
        api: this.opts.model.api,
        provider: this.opts.model.provider,
        model: this.opts.model.id,
        usage: {
          input: 0,
          output: 0,
          cacheRead: 0,
          cacheWrite: 0,
          totalTokens: 0,
          cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
        },
        stopReason: "stop",
        timestamp: at,
      });
    });
    return messages;
  }

  private snapshotEngine(): EngineStateSnapshot {
    const engine = this.opts.engine;
    return {
      ...engine,
      affinity: { ...engine.affinity },
      flags: { ...engine.flags },
    };
  }

  private snapshotMemory(): MemorySnapshot {
    return { state: { ...this.stateFiles }, arcs: [...this.arcIds] };
  }

  /**
   * 一轮 user 消息 = 【状态】+ N 条【用户输入】。
   *
   * 「插一句」是唯一的输入通道：选项、自由输入、插一句都是同一段原文，区别只在
   * 玩家是答了引擎的问题还是自己开了口——因此这里不再有「玩家表态 / 导演注」的身份
   * 分流，也不再有「重写 / 重新演绎」这类要引擎替玩家开口的话。
   *
   * 链尾悬空的用户输入（分岔落在一次表态上）排在本轮最前面：模型照旧看得见上一次
   * 说了什么，但不必造一条空 assistant 轮次。
   */
  private renderPromptTurn(texts: readonly string[]): string {
    const inputs = [...this.trailingInputs, ...texts];
    this.trailingInputs = [];
    // 上一轮的解析告警只在这里用一次：这一轮发出去就作废，免得旧问题反复骚扰
    const warnings = this.beatWarnings;
    this.beatWarnings = [];
    const sections = [
      `【状态】\n${renderStateSection(this.opts.engine, this.opts.scene, this.stateFiles)}`,
    ];
    if (warnings.length > 0) sections.push(renderBeatWarnings(warnings));
    for (const text of inputs) sections.push(`【用户输入】\n${text}`);
    if (inputs.length > 0) {
      sections.push(
        "（以上是用户发来的内容。若以「OOC」开头，那是给导演的指示：据此调整接下来的" +
          "演出方向，不要复述或回应这段指示本身。否则是其中某个角色（可能就是主角，" +
          "也可能是别人）的行动、话语或心理：照字面意思演成该角色的言行，涉及主角的" +
          "决定性动作时给出停止点。两种都不要在剧本中复述这段文字本身。）",
      );
      // 引擎上次是不是在等玩家回答——与发消息的人是谁无关，选项答非所问也算
      if (!this.busy && this.lastStop && this.lastStop.stopType !== "pause") {
        sections.push(
          "（用户是在未作回应的情况下直接发来上面这段的。若其中已包含某个角色的行动或" +
            "话语就直接演；否则继续演出，并在合适时机再给出回应机会。）",
        );
      }
    }
    return sections.join("\n\n");
  }

  private async beginBeat(userText: string): Promise<void> {
    this.beatPending = true;
    // 网关挂住是看不见的故障：provider 既不抛错也不收流，await 会永远挂着。
    // 到点直接 abort 这一轮，让 finishBeat 的空轮护栏收成一次可重试的失败。
    const deadline = this.opts.beatTimeoutMs;
    const timer =
      deadline && deadline > 0
        ? setTimeout(() => {
            this.beatTimedOut = true;
            this.beatError = `剧作家这一轮超过 ${Math.round(deadline / 1000)} 秒没有动静，已中断`;
            this.agent.abort();
          }, deadline)
        : null;
    try {
      // 纪元边界：轮与轮之间是唯一允许突变 A 区/对话体的时刻（空前缀缓存豁免）
      await this.maybeCompactEpoch();
      if (this.disposed) return;
      // B 区注入原文入史：状态区/导演注/玩家表态是拼出来的文本，谱系里只留得下玩家的那一句
      this.historyRecorder.addUser(this.beatNo + 1, userText, this.opts.tree.leafId);
      this.startBeatWindow();
      await this.agent.prompt(userText);
      await this.agent.waitForIdle();
    } catch (error) {
      // prompt 抛错（网络/中断）：记入 beatError，由 finishBeat 的空轮护栏统一收束
      this.beatError = error instanceof Error ? error.message : String(error);
    } finally {
      if (timer) clearTimeout(timer);
      // prompt 异常路径可能不发 agent_end：兜底收束（正常路径 busy 已被 finishBeat 清零）
      if (this.busy) this.finishBeat();
      this.beatPending = false;
      if (!this.busy) this.onBeatSettled();
    }
  }

  /**
   * 纪元压缩：对话体涨到窗口预算（默认 60%）时，把早期轮次压成一张 arcs 摘要卡并重建 Agent。
   * - 摘要失败/无可压段：只告警不动对话体——压缩是优化不是正确性前提，不做降级；
   * - 切掉的原文早已逐轮落进 archive，检索层（search_archive）照常命中。
   */
  private async maybeCompactEpoch(): Promise<void> {
    const compaction = this.opts.compaction;
    if (!compaction || this.disposed) return;
    const messages = this.agent.state.messages;
    const budget = Math.floor(compaction.contextWindow * compaction.triggerRatio);
    // 触发判定与切尾点同尺：scale 由 provider 实测 usage 标定（中文下 chars/4 严重低估）
    const { tokens: used, scale } = measureContext(messages);
    if (used <= budget) return;
    const cut = pickCutIndex(messages, compaction.keepRecentTokens, scale);
    if (cut === 0) return;
    const head = messages.slice(1, cut);
    const tail = messages.slice(cut);
    const summary = await this.summarizeEpoch(head);
    if (!summary) return;
    const { oneLiner, body } = summary;
    // 摘要请求在飞：期间可能已 reload/切档重建/dispose——此时重建 Agent 等于僵尸复活
    if (this.disposed) return;
    const epochNo = this.arcIds.length + 1;
    // arcId 带谱系叶：分岔后两条支路各自压缩不会互相覆盖同名卡
    const arcId = `epoch-${this.opts.tree.leafId ?? "root"}-${epochNo}`;
    try {
      await this.opts.memory.appendArc({
        id: arcId,
        title: `纪元 ${epochNo}｜截至第 ${this.beatNo} 轮`,
        summary: oneLiner,
        detail: body,
      });
    } catch (error) {
      console.warn(
        `[stage-ai] 纪元压缩跳过（摘要落盘失败）: ${error instanceof Error ? error.message : String(error)}`,
      );
      return;
    }
    if (this.disposed) return;
    this.arcIds = [...this.arcIds, arcId];
    this.buildAgent(withSeed(tail, renderSeed(epochNo, this.beatNo, body)));
    console.log(
      `[stage-ai] 纪元 ${epochNo} 压缩完成：${used} tok → 保留 ${tail.length}/${messages.length} 条消息，arc=${arcId}`,
    );
    this.persist();
  }

  /** 生成纪元摘要；失败只告警并返回 null（压缩是优化不是正确性前提，不阻断本轮开轮）。 */
  private async summarizeEpoch(head: readonly AgentMessage[]): Promise<EpochSummary | null> {
    try {
      const summary = await completeText(
        {
          streamFn: this.opts.streamFn,
          model: this.opts.model,
          getApiKey: this.opts.getApiKey,
          signal: this.signalController.signal,
        },
        EPOCH_SUMMARY_SYSTEM,
        renderTranscript(head),
      );
      return splitSummary(summary);
    } catch (error) {
      console.warn(
        `[stage-ai] 纪元压缩跳过（摘要生成失败）: ${error instanceof Error ? error.message : String(error)}`,
      );
      return null;
    }
  }

  /** 轮窗口记账（开轮与 turn_start 续窗共用）。 */
  private startBeatWindow(): void {
    this.busy = true;
    this.beatNo += 1;
    this.beatError = null;
    this.beatTimedOut = false;
    this.beatEvents = 0;
    this.beatLines = [];
    this.beatClosed = false;
    this.opts.engine.turn = this.beatNo;
    // 面板上的「正在写第 N 轮」：一轮最长 240s，没有这一条玩家只能对着静止的舞台等
    this.pendingBeatJob?.();
    this.pendingBeatJob = this.opts.pending?.begin({
      id: `beat:${this.beatNo}`,
      kind: "beat",
      label: `第 ${this.beatNo} 轮`,
    }) ?? null;
    this.send({ type: "beat_start", beatId: `beat-${this.beatNo}` });
    this.send({
      type: "lineage",
      leafId: this.opts.tree.leafId ?? "",
      turn: this.opts.tree.leafId ? (this.opts.tree.get(this.opts.tree.leafId)?.turn ?? 0) : 0,
    });
  }

  private async onAgentEvent(
    event: Parameters<Parameters<Agent["subscribe"]>[0]>[0],
  ): Promise<void> {
    if (event.type === "message_update" && event.assistantMessageEvent.type === "text_delta") {
      this.parser.feed(event.assistantMessageEvent.delta);
    } else if (event.type === "message_end" && event.message.role === "assistant") {
      // pi agent 的 provider 失败不抛异常，而是 assistant message 带 errorMessage 正常收束——捕获之
      // 超时是我们主动 abort 的，随之而来的 AbortError 只是症状，保留说人话的那条
      if (event.message.errorMessage && !this.beatTimedOut) this.beatError = event.message.errorMessage;
      // 完整 assistant 消息：思考块与 toolCall 只在这里出现（流式增量拿不全），入史趁早
      if (this.busy) {
        this.historyRecorder.addAssistantMessage(this.beatNo, event.message, this.opts.tree.leafId);
      }
      this.parser.endMessage();
    } else if (event.type === "turn_start") {
      // 一个 run 里可能拆成多个 turn（工具批次收束后继续）：每个新 turn 重开轮窗
      if (!this.busy || this.beatClosed) this.startBeatWindow();
    } else if (event.type === "turn_end") {
      // 只在真实边界（beat_done）收束：同一轮内的记忆工具轮次（turn_end）必须继续流动
      if (this.beatClosed) this.finishBeat();
    } else if (event.type === "agent_end") {
      // 正常路径已在 turn_end 收束；此处兜底异常/中止路径（幂等）
      this.finishBeat();
    }
  }

  private finishBeat(): void {
    if (!this.busy) return;
    this.busy = false;
    this.pendingBeatJob?.();
    this.pendingBeatJob = null;
    // 告警要在 resetBeat 之前取走：解析器不替我们记，丢了就再也拼不出「上一轮哪里被丢了」
    this.beatWarnings = describeBeatWarnings(this.parser.takeWarnings());
    this.parser.resetBeat();
    let stop = this.pendingStop;
    this.pendingStop = null;
    // 空轮护栏：生成失败/零产出不得静默伪装成正常收束——显式 error + pause 停止点给玩家重试入口
    // （这一轮没有自然收尾，给不了出口，只能让玩家按「继续」重开一轮）
    if (this.beatEvents === 0 && !stop) {
      this.send({
        type: "error",
        message: `本轮生成失败：${this.beatError ?? "模型未产出任何剧本内容"}`,
        recoverable: true,
      });
      stop = { stopType: "pause" };
    } else if (this.beatError) {
      this.send({
        type: "error",
        message: `本轮生成中断：${this.beatError}`,
        recoverable: true,
      });
    }
    this.beatError = null;
    this.lastStop = stop;
    this.appendLineage("beat_end", {
      // seq 锚点：前端按它把行级事件切成一轮一张卡，且能精确跳到轮首行
      payload: { reason: stop ? "stop" : "no_stop", seq: this.seq },
    });
    // 谱系快照随 beat 收束保存（分岔/续演恢复用）：活跃状态文件 + arcs 引用（谱系级记忆）
    const engine = this.opts.engine;
    const memory: MemorySnapshot = {
      state: { ...this.stateFiles },
      arcs: [...this.arcIds],
    };
    // 克隆后再存：快照按节点留档，存引用会被后续轮的原地修改污染（分岔恢复必须拿到当轮真值）
    this.opts.tree.saveSnapshot(
      {
        ...engine,
        affinity: { ...engine.affinity },
        flags: { ...engine.flags },
      },
      memory,
    );
    // archive 逐轮切片（D7 第三层）：本轮台词全文，entryId = 谱系叶（防剧透过滤键）
    void this.opts.memory
      .appendArchive({
        entryId: this.opts.tree.leafId ?? "",
        turn: this.beatNo,
        at: Date.now(),
        summary: this.beatLines.join("\n").slice(0, 800),
      })
      .catch((error: unknown) =>
        console.warn(
          `[stage-ai] archive 切片写入失败: ${error instanceof Error ? error.message : String(error)}`,
        ),
      );
    this.send({
      type: "beat_end",
      beatId: `beat-${this.beatNo}`,
      reason: stop ? "stop" : "no_stop",
      stop: stop ?? undefined,
    });
    this.persist();
  }

  private appendLineage(
    kind: LineageEvent["kind"],
    opts: { text?: string; payload?: LineageEvent["payload"] },
  ): LineageEvent {
    const event = this.opts.tree.append(kind, opts);
    this.opts.onLineageEvent?.(event);
    this.loggedEvents += 1;
    return event;
  }

  /** 直接改动谱系树的操作（编辑/重写）不经过 append：事后按游标补推 JSONL。 */
  private flushLineageLog(): void {
    const all = this.opts.tree.export().events;
    for (let i = this.loggedEvents; i < all.length; i += 1) this.opts.onLineageEvent?.(all[i]!);
    this.loggedEvents = all.length;
  }

  private onStageEvent(event: StageEvent): void {
    this.seq += 1;
    this.beatEvents += 1;
    const sequenced: SequencedEvent = { seq: this.seq, event };
    this.events.push(sequenced);
    this.send({ type: "events", events: [sequenced] });
    this.accumulateLineage(event, this.seq);
    this.feedVoice(event, this.seq);
  }

  /**
   * beat_done 交出的停止点 → stop IR 事件。
   *
   * 走的是与解析器产出完全同一条管道（加 seq → 广播 → 落谱系）：停止点在时间线上是可见的，
   * 停止点重放、回看与分岔都靠谱系里那条 stop 事件，所以它不能是「工具的一个副作用」，
   * 只能是「工具产出的一种事件」。选项数由 schema 的 minItems 兜住，这里不再兜第二手。
   */
  private emitStop(stop: ModelStop): void {
    this.onStageEvent({
      kind: "stop",
      stopType: stop.stopType,
      ...(stop.options ? { options: stop.options } : {}),
      ...(stop.placeholder ? { placeholder: stop.placeholder } : {}),
    });
  }

  /** 语音管线喂入（D5）：say 三段事件 → 分句预取。narrate/thought 不配音。 */
  private feedVoice(event: StageEvent, seq: number): void {
    if (!this.voice) return;
    switch (event.kind) {
      case "say_start":
        this.voice.lineStart(seq, event.id);
        return;
      case "say_text":
        this.voice.feedText(event.delta);
        return;
      case "say_end":
        this.voice.lineEnd();
        return;
      default:
        return;
    }
  }

  /** StageEvent 流 → 行级谱系事件聚合（say 三段 → 一行）。 */
  private accumulateLineage(event: StageEvent, seq: number): void {
    switch (event.kind) {
      case "say_start":
        this.openLine = {
          kind: "say",
          id: event.id,
          text: "",
          attrs: { id: event.id, ...(event.mood ? { mood: event.mood } : {}), ...(event.name ? { name: event.name } : {}) },
          seq,
        };
        return;
      case "narrate_start":
        this.openLine = { kind: "narrate", text: "", attrs: {}, seq };
        return;
      case "thought_start":
        this.openLine = {
          kind: "thought",
          id: event.id,
          text: "",
          attrs: { id: event.id },
          seq,
        };
        return;
      case "say_text":
      case "narrate_text":
      case "thought_text":
        if (this.openLine) this.openLine.text += event.delta;
        return;
      case "say_end":
      case "narrate_end":
      case "thought_end": {
        const line = this.openLine;
        this.openLine = null;
        if (line) {
          this.appendLineage(line.kind, {
            text: line.text,
            payload: { attrs: line.attrs, seq: line.seq },
          });
          this.beatLines.push(line.text.slice(0, 200));
        }
        return;
      }
      case "scene": {
        if (event.bg) this.opts.scene = event.bg;
        const attrs = pick(event, ["bg", "bgm", "ambient", "transition", "bgm_volume", "ambient_volume"]);
        for (const key of Object.keys(attrs)) if (attrs[key] === "") delete attrs[key];
        // 音频属性的空串在流式里是「停」（director 的 STOP_AUDIO 认 ""），但谱系里空串会被
        // 上面这行删掉，重放时读成 undefined = 「保持当前」——刷新一下音乐又响起来。
        // 所以归一化成 none：显式停止在谱系里必须是实打实的非空值。
        for (const key of ["bgm", "ambient"] as const) {
          if (event[key] !== undefined && String(event[key]).trim() === "") attrs[key] = "none";
        }
        this.appendLineage("scene", { payload: { seq, attrs } });
        return;
      }
      case "actor":
        this.appendLineage("actor", {
          payload: {
            seq,
            attrs: {
              id: event.id,
              ...pick(event, ["pos", "expression", "action"]),
            },
          },
        });
        return;
      case "sfx":
        this.appendLineage("sfx", {
          payload: { seq, attrs: { src: event.src, ...(event.volume !== undefined ? { volume: String(event.volume) } : {}) } },
        });
        return;
      case "preload_asset":
        // 只记时间线上的位置（骨架占位、谱系回放）。**发起生图是 generate_image 工具的事**：
        // 工具已经判过「静态优先 / 已在飞 / 已排队」，在这里再发起一次就是两套决策打架。
        this.appendLineage("preload", {
          payload: {
            seq,
            attrs: { type: event.type, prompt: event.prompt, id: event.id },
          },
        });
        return;
      case "cg":
        this.appendLineage("cg", {
          payload: { seq, attrs: { id: event.id, ...pick(event, ["caption"]) } },
        });
        return;
      case "stop":
        this.pendingStop = {
          stopType: event.stopType,
          options: event.options,
          placeholder: event.placeholder,
        };
        this.appendLineage("stop", {
          payload: {
            seq,
            stopType: event.stopType,
            ...(event.options ? { options: event.options } : {}),
            ...(event.placeholder ? { placeholder: event.placeholder } : {}),
            // attrs 是客户端唯一能看到的那份，字段名与服务端 payload 顶层保持一致
            attrs: { stopType: event.stopType },
          },
        });
        return;
    }
  }
}

function pick(source: object, keys: string[]): Record<string, string> {
  const event = source as Record<string, unknown>;
  const out: Record<string, string> = {};
  for (const key of keys) {
    const value = event[key];
    if (value !== undefined) out[key] = String(value);
  }
  return out;
}
