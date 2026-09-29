import type {
  AgentTool,
  AgentToolResult,
  Agent,
  AgentMessage,
  StreamFn,
} from "@earendil-works/pi-agent-core";
import { Agent as PiAgent } from "@earendil-works/pi-agent-core";
import { type Api, type Model, type Static, type TSchema, Type } from "@earendil-works/pi-ai";
import {
  LineageTree,
  StageDslParser,
  type EngineStateSnapshot,
  type LineageEvent,
  type LineageView,
  type MemorySnapshot,
  type SequencedEvent,
  type StageEvent,
  type StopPayload,
} from "@stage-ai/core";
import type { ServerMessage } from "@stage-ai/core";
import { buildSystemPrompt, renderStateSection, type AssetManifest, type AssetNotes, type GeneratedNote } from "./prompt.js";
import { lineageToBeats, lineageToEvents, stopFromEvent } from "./rebuild.js";
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
import type { PlayConfig } from "@stage-ai/core";
import type { PlayMemory } from "./memory.js";
import { VoicePipeline, type TtsSynthFn } from "./voice.js";

/** 生成批次收束工具（D3：交互停止点之后或一幕写完时调用）。 */
const beatDoneParams = Type.Object({}, { additionalProperties: false });

export function createBeatDoneTool(): AgentTool<TSchema> {
  return {
    name: "beat_done",
    label: "结束本节拍",
    description:
      "本节拍演出内容已写完（交互停止点之后，或一幕自然写完）时调用，不与其他工具同批调用",
    parameters: beatDoneParams,
    execute: async () => ({
      content: [{ type: "text", text: "ok" }],
      details: undefined,
      terminate: true,
    }),
  };
}

/** 好感度单次增量上限与值域（引擎校验，模型只可提议）。 */
const AFFINITY_DELTA_CAP = 5;
const AFFINITY_MAX = 100;

/** 记忆工具依赖（D7）：engine 拥有状态真值，stateFiles 随谱系快照走。 */
export interface MemoryToolDeps {
  engine: EngineStateSnapshot;
  characterIds: ReadonlySet<string>;
  memory: PlayMemory;
  tree: LineageTree;
  stateFiles: Record<string, string>;
  /** 当前分支已走过的纪元（谱系级：分岔回旧分支不得读到后世的章节摘要）。 */
  arcIds: () => readonly string[];
}

function textResult(text: string): AgentToolResult {
  return { content: [{ type: "text", text }], details: undefined };
}

const updateStateParams = Type.Object(
  {
    affinity: Type.Optional(Type.Record(Type.String(), Type.Number())),
    flags: Type.Optional(
      Type.Record(Type.String(), Type.Union([Type.String(), Type.Number(), Type.Boolean()])),
    ),
  },
  { additionalProperties: false },
);

const writeMemoryParams = Type.Object(
  {
    file: Type.Union([Type.Literal("scene"), Type.Literal("threads")]),
    content: Type.String({ maxLength: 2000 }),
  },
  { additionalProperties: false },
);

const readMemoryDetailParams = Type.Object(
  { name: Type.String() },
  { additionalProperties: false },
);

const searchArchiveParams = Type.Object(
  {
    query: Type.String({ maxLength: 200 }),
    limit: Type.Optional(Type.Number()),
  },
  { additionalProperties: false },
);

/** playwriter 记忆工具组（D7）：update_state（引擎校验）/ write_memory / read_memory_detail / search_archive。 */
export function createMemoryTools(deps: MemoryToolDeps): AgentTool<TSchema>[] {
  const updateState: AgentTool<typeof updateStateParams> = {
    name: "update_state",
    label: "提议状态更新",
    description:
      "提议更新引擎状态（好感度增量/旗标）。好感度传增量（如 koharu: 2 表示 +2，单次 |增量|≤5，值域 0~100）；旗标传目标值。引擎校验后才生效，【状态】区下轮反映。剧情有实质推进时才调用，不要每拍都调。",
    parameters: updateStateParams,
    execute: async (_toolCallId, params: Static<typeof updateStateParams>) => {
      const { affinity, flags } = params;
      const applied: string[] = [];
      const rejected: string[] = [];
      for (const [charId, delta] of Object.entries(affinity ?? {})) {
        if (!deps.characterIds.has(charId)) {
          rejected.push(`${charId} 不是本剧角色`);
          continue;
        }
        if (!Number.isInteger(delta) || Math.abs(delta) > AFFINITY_DELTA_CAP) {
          rejected.push(`${charId} 增量须为整数且 |Δ|≤${AFFINITY_DELTA_CAP}（收到 ${delta}）`);
          continue;
        }
        const current = deps.engine.affinity[charId] ?? 0;
        const next = Math.max(0, Math.min(AFFINITY_MAX, current + delta));
        deps.engine.affinity[charId] = next;
        applied.push(`${charId} ${delta >= 0 ? "+" : ""}${delta}（${current}→${next}）`);
      }
      for (const [key, value] of Object.entries(flags ?? {})) {
        deps.engine.flags[key] = value;
        applied.push(`旗标 ${key}=${String(value)}`);
      }
      if (applied.length === 0 && rejected.length === 0) return textResult("未提供任何更新。");
      return textResult(
        [
          applied.length > 0 ? `已生效：${applied.join("；")}` : null,
          rejected.length > 0 ? `被拒绝（请修正后重试）：${rejected.join("；")}` : null,
        ]
          .filter(Boolean)
          .join("\n"),
      );
    },
  };

  const writeMemory: AgentTool<typeof writeMemoryParams> = {
    name: "write_memory",
    label: "更新活跃状态文件",
    description:
      "维护活跃状态文件：scene（当前场景/在场人物/时间，一两行）或 threads（当前活跃剧情线与悬念，要点列表）。每拍有实质变化时更新，保持简短——全文会在下轮【状态】区注入。",
    parameters: writeMemoryParams,
    execute: async (_toolCallId, params: Static<typeof writeMemoryParams>) => {
      const { file, content } = params;
      deps.stateFiles[file] = content.trim();
      return textResult(`已更新 ${file}.md。`);
    },
  };

  const readMemoryDetail: AgentTool<typeof readMemoryDetailParams> = {
    name: "read_memory_detail",
    label: "读记忆卡详情",
    description:
      "读取记忆索引中某条卡的完整内容（系统提示词「记忆索引」列表里的名称）。涉及某地点/设定/旧章节时先查再写，避免与既有设定矛盾。",
    parameters: readMemoryDetailParams,
    execute: async (_toolCallId, params: Static<typeof readMemoryDetailParams>) => {
      const { name } = params;
      const arcIds = deps.arcIds();
      const detail = deps.memory.readCard(name, arcIds);
      if (detail) return textResult(detail);
      const available = deps.memory
        .visibleContext(arcIds)
        .map((c) => c.name)
        .join("、");
      return textResult(`未找到「${name}」。可用条目：${available || "（无）"}。`);
    },
  };

  const searchArchive: AgentTool<typeof searchArchiveParams> = {
    name: "search_archive",
    label: "检索历史往事",
    description:
      "全文检索本分支历史演出（过往节拍的剧本切片）。需要回看发生过什么、玩家说过什么时调用；只命中当前分支可见的历史，不会召回其他分支。",
    parameters: searchArchiveParams,
    execute: async (_toolCallId, params: Static<typeof searchArchiveParams>) => {
      const { query, limit } = params;
      const hits = deps.memory.searchArchive(
        query,
        deps.tree.pathSet(),
        Math.max(1, Math.min(10, limit ?? 5)),
      );
      if (hits.length === 0) return textResult("（无命中：当前分支历史中未检索到相关内容）");
      return textResult(hits.map((h) => `【第 ${h.turn} 拍】\n${h.summary}`).join("\n\n"));
    },
  };

  return [updateState, writeMemory, readMemoryDetail, searchArchive];
}

export type PlayerAction =
  | { kind: "choice"; optionIndex: number }
  | { kind: "free"; text: string }
  | { kind: "continue" }
  | { kind: "ooc"; text: string };

/** 选项索引已解析为文本的玩家操作。 */
export type ResolvedAction =
  | { kind: "choice"; text: string }
  | { kind: "free"; text: string }
  | { kind: "continue" }
  | { kind: "ooc"; text: string };

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
  /** 服务器重启恢复：上次会话的运行态（事件缓冲/节拍号/停止点）。 */
  restored?: OrchestratorRuntimeState;
  /** 语音管线合成函数（无则本剧目无声：hello.voice=false）。 */
  tts?: { synth: TtsSynthFn; concurrency?: number };
  /** 生图预发射钩子（D6）：解析到 preload_asset 即后台发起，不占播放；无则只记谱系。 */
  onPreloadAsset?: (type: "bg" | "cg", prompt: string, id: string) => void;
  /** 纪元压缩阈值（窗口占比）与保留预算；不传则只增不减到模型自己报错。 */
  compaction?: {
    contextWindow: number;
    triggerRatio: number;
    keepRecentTokens: number;
  };
}

/** 编排器运行态（随 session.json 持久化，重启后恢复重放与续演）。 */
export interface OrchestratorRuntimeState {
  events: SequencedEvent[];
  beatNo: number;
  lastStop: StopPayload | null;
  /** 事件缓冲代号（P6）：结构性操作会自增，客户端据此识别「缓冲已整段重放」。 */
  epoch: number;
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
 * 谱系行级聚合 + 快照；beat 生命周期（start → 流式 → stop/act_end 收束）。
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
  /** 一拍正在开（纪元压缩等前置步骤未完）：对外等同 busy，防止并发 beginBeat 与 steer 错投。 */
  private beatPending = false;
  /** 等待「编排器空闲」的挂起者（工坊写盘要在拍边界重建 runtime，不打断进行中的演出）。 */
  private idleWaiters: (() => void)[] = [];
  /** 最近一次会话落盘任务：重建 runtime 前必须等它落地，否则可能读到写了一半的 session.json。 */
  private pendingPersist: Promise<void> | null = null;
  /** 旁路补全（纪元摘要）的中断源：dispose 时一并掐断在飞请求。 */
  private readonly signalController = new AbortController();
  /** 语音预取管线（D5）：say 行 → 分句 → TTS 预取 → audio_ready。 */
  private readonly voice: VoicePipeline | null;
  /** 本拍内 pi agent 的流错误（message_end.errorMessage）；每拍重置。 */
  private beatError: string | null = null;
  /** 本拍内产出的舞台事件数（空拍检测）。 */
  private beatEvents = 0;
  /** 本拍台词文本（archive 切片摘要来源）。 */
  private beatLines: string[] = [];
  /** 本 turn 调用了 beat_done → 拍在此收束（普通工具轮次不算边界，否则记忆查询会撕裂节拍）。 */
  private beatClosed = false;
  /** always/state 活跃状态文件内容（谱系级，随快照走；write_memory 工具维护）。 */
  private stateFiles: Record<string, string> = {};
  /** 当前分支已走过的纪元摘要 id（谱系级，随快照走；纪元压缩时追加）。 */
  private arcIds: string[] = [];
  private unsubscribeAgent: (() => void) | null = null;
  /** 事件缓冲代号（P6）：分岔/跳转/编辑/重写后整段重放并自增，客户端据此丢弃旧 seq 认知。 */
  private epoch = 0;
  /** 已写入 JSONL 的谱系事件数：直接改动树的操作（编辑/重写）在此增量补推。 */
  private loggedEvents = 0;

  constructor(opts: OrchestratorOptions) {
    this.opts = opts;
    this.parser = new StageDslParser((event) => this.onStageEvent(event));
    if (opts.restored) {
      // 恢复会话：活跃状态文件与纪元摘要从路径最近快照回填（谱系级记忆）
      const snapshot = opts.tree.latestSnapshotOnPath(opts.tree.leafId);
      this.stateFiles = snapshot?.memory.state ?? {};
      this.arcIds = [...(snapshot?.memory.arcs ?? [])];
      // 已有事件早已落过 JSONL，不重复补推
      this.loggedEvents = opts.tree.export().events.length;
    }
    this.agent = this.buildAgent([]);
    this.voice = opts.tts
      ? new VoicePipeline({
          synth: opts.tts.synth,
          voiceOf: (charId) => opts.play.characters.find((c) => c.id === charId)?.voiceId,
          emit: (ready) => this.send({ type: "audio_ready", ...ready }),
          concurrency: opts.tts.concurrency,
        })
      : null;
    if (opts.restored) {
      // 恢复会话：回填事件缓冲与节拍状态，autostart 视为已完成（续演不重开开场）
      this.events.push(...opts.restored.events);
      this.seq = this.events.at(-1)?.seq ?? 0;
      this.beatNo = opts.restored.beatNo;
      this.lastStop = opts.restored.lastStop;
      this.epoch = opts.restored.epoch ?? 0;
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
        }),
        model: opts.model,
        thinkingLevel: "off",
        tools: [
          createBeatDoneTool(),
          ...createMemoryTools({
            engine: opts.engine,
            characterIds: new Set(opts.play.characters.map((c) => c.id)),
            memory: opts.memory,
            tree: opts.tree,
            stateFiles: this.stateFiles,
            arcIds: () => this.arcIds,
          }),
        ],
        messages,
      },
    });
    // 批次收束兜底：pi 仅在「批内全部工具结果都 terminate」时收束 turn，模型若把 beat_done
    // 与记忆工具同批调用，terminate 会被吞掉导致本拍继续空转——此时按 beat_done 显式收束 run。
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
    };
  }

  /** 当前缓冲代号（hello/rebase 携带，客户端识别结构性操作）。 */
  get currentEpoch(): number {
    return this.epoch;
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
    this.flushIdleWaiters(); // 挂起的重建请求不得悬着
  }

  /** 空闲时立刻兑现，否则等到下一个拍边界（工坊热改 premise 不能腰斩进行中的演出）。 */
  whenIdle(): Promise<void> {
    if (this.disposed) return Promise.resolve();
    if (!this.engaged) return this.pendingPersist ?? Promise.resolve();
    return new Promise((resolve) => this.idleWaiters.push(resolve));
  }

  /** 记下落盘任务（finishBeat/压缩后调用），whenIdle 据此等到磁盘落地。 */
  private persist(): void {
    this.pendingPersist = Promise.resolve(this.opts.persist()).catch((error: unknown) => {
      console.warn(`[stage-ai] 会话落盘失败: ${error instanceof Error ? error.message : String(error)}`);
    });
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

  /** 对外可接收新输入的空闲判据：一拍开窗中（busy）或正在开拍（纪元压缩等前置）。 */
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
    reason: "stop" | "act_end";
    stop?: StopPayload;
  } | null {
    if (this.busy || !this.autostarted || this.beatNo === 0) return null;
    return {
      type: "beat_end",
      beatId: `beat-${this.beatNo}`,
      reason: this.lastStop ? "stop" : "act_end",
      stop: this.lastStop ?? undefined,
    };
  }

  /** 首个客户端连接后开局。 */
  autostart(): void {
    if (this.autostarted || this.engaged) return;
    this.autostarted = true;
    void this.beginBeat(this.opts.play.opening);
  }

  /** 玩家操作 → 下一节拍。busy 中拒绝。开局时玩家表态并入开场指令。 */
  async playerAction(action: PlayerAction): Promise<void> {
    // engaged 覆盖纪元压缩窗口：压缩期间 busy 仍为 false，但 Agent 随时可能被重建，
    // steer 进旧实例会丢消息、并发 beginBeat 会打架——一律按「演出进行中」挡回
    if (action.kind === "ooc" && this.busy) {
      // 原地 OOC（D9）：steer 入队——当前拍收敛后注入【导演注】，agent 立即续写下一拍；不打断进行中的演出
      this.agent.steer({
        role: "user",
        content: this.renderUserTurn(action),
        timestamp: Date.now(),
      });
      this.appendLineage("ooc", { payload: { input: action.text } });
      this.send({ type: "ooc_ack" });
      return;
    }
    if (this.engaged) {
      this.send({
        type: "error",
        message: "演出进行中，请等待当前节拍结束",
        recoverable: true,
      });
      return;
    }
    let resolved: ResolvedAction;
    if (action.kind === "choice") {
      const option = this.lastStop?.options?.[action.optionIndex];
      if (!option) {
        this.send({
          type: "error",
          message: `无效的选项索引: ${action.optionIndex}`,
          recoverable: true,
        });
        return;
      }
      resolved = { kind: "choice", text: option.text };
    } else {
      resolved = action;
    }
    if (!this.autostarted) {
      this.autostarted = true;
      const userText =
        action.kind === "continue"
          ? this.opts.play.opening
          : `${this.opts.play.opening}\n\n${this.renderUserTurn(resolved)}`;
      if (action.kind !== "continue") this.recordPlayerLine(resolved);
      await this.beginBeat(userText);
      return;
    }
    const userText = this.renderUserTurn(resolved);
    this.recordPlayerLine(resolved);
    await this.beginBeat(userText);
  }

  /** 重连重放：seq 之后的缓冲事件。 */
  eventsAfter(lastSeq: number): SequencedEvent[] {
    return this.events.filter((e) => e.seq > lastSeq);
  }

  // —— P6 五动词：跳转 / 分岔 / 重生成 / 编辑 / 导演注，彼此正交，可自由组合 ——

  /** 路线树视图（全量节点含废弃分支）；前端「路线」视图与 REST 共用。 */
  lineageView(): LineageView {
    return this.opts.tree.describe();
  }

  /** 跳转：挂载点移到目标节点并重建上下文（只读回放，不重新生成）。 */

  /** 分岔：从任意节点开新分支（不生成，玩家可在此继续行动或重演）。 */
  async forkTo(nodeId: string): Promise<void> {
    this.rebaseAt(nodeId, "已从此处开新分支");
  }

  /** 原地编辑：当前分支该行文本替换（不开新分支），后续生成以新文本为上下文。 */
  async editLine(nodeId: string, newText: string): Promise<void> {
    this.guardIdle();
    const text = newText.trim();
    if (!text) throw new Error("台词不能为空");
    this.opts.tree.editInPlace(nodeId, text);
    this.flushLineageLog();
    this.rebaseAt(nodeId, "台词已修改", { keepLeaf: true });
  }

  /** 句/段级重写：隐式分岔（旧版留在路线树）+ 立即重新生成（±导演注）。 */
  async rewrite(nodeId: string, granularity: "line" | "beat", instruction?: string): Promise<void> {
    this.guardIdle();
    const chain = this.opts.tree.ancestorChain(nodeId); // 校验节点存在
    const anchor = granularity === "beat" ? this.resolveBeatAnchor(chain, nodeId) : null;
    const targetId = anchor?.anchorId ?? nodeId;
    const recap = anchor?.recap ?? null;
    this.opts.tree.recordRewrite(targetId, granularity, instruction);
    this.flushLineageLog();
    this.rebaseAt(this.opts.tree.leafId!, granularity === "beat" ? "已重写整幕" : "已重写此句", {
      keepLeaf: true,
    });
    await this.beginBeat(this.renderRewriteTurn(instruction, recap, granularity));
  }

  /** 分岔后 OOC 立即重生成：先分岔到此，再注入导演注开拍（与原地 steer 正交）。 */
  async oocAt(nodeId: string, text: string): Promise<void> {
    this.guardIdle();
    const note = text.trim();
    if (!note) throw new Error("导演注不能为空");
    this.rebaseAt(nodeId, "已分岔并注入导演注");
    await this.beginBeat(
      [
        `【状态】\n${renderStateSection(this.opts.engine, this.opts.scene, this.stateFiles)}`,
        this.renderDirectorNote(note, true),
      ].join("\n\n"),
    );
  }

  private guardIdle(): void {
    if (this.engaged) throw new Error("演出进行中，请等待当前节拍结束");
  }

  /**
   * 上下文重建（P6 transformContext 的执行点）：挂载点移到目标节点后，
   * 从谱系事件日志重放出「引擎状态 + 记忆快照 + 客户端事件缓冲 + LLM 对话轮次」，
   * 一次突变完成即回到 append-only 稳态。
   *
   * 保持同刻铁律：旧分支的活跃状态、剧情线引用与 archive 检索范围一并回退，
   * 兄弟/废弃分支的往事不可召回（防剧透）。
   */
  private rebaseAt(nodeId: string, note: string, opts?: { keepLeaf?: boolean }): void {
    this.guardIdle();
    const tree = this.opts.tree;
    if (!opts?.keepLeaf) tree.forkAt(nodeId);
    const chain = tree.chainEvents(tree.leafId);
    this.restoreBranchState(tree.leafId);
    this.events.length = 0;
    this.events.push(...lineageToEvents(chain));
    this.seq = this.events.at(-1)?.seq ?? 0;
    this.openLine = null;
    this.pendingStop = null;
    this.restoreStopPoint(chain);
    this.buildAgent(this.rebuildMessages(chain));
    this.epoch += 1;
    this.send({
      type: "rebase",
      epoch: this.epoch,
      leafId: tree.leafId,
      events: [...this.events],
      ...(this.lastStop ? { stop: this.lastStop } : {}),
      reason: this.lastStop ? "stop" : "act_end",
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
    this.stateFiles = { ...state.stateFiles };
    this.arcIds = [...state.arcIds];
    this.beatNo = engine.turn;
    this.opts.scene = state.scene;
  }

  /**
   * 停止点恢复：停在 stop/beat_end 边界 → 还原该停止点（choice 选项原样回到面板）；
   * 停在拍中 → 给一个 pause 停止点，玩家按「继续」即可重演剩余内容。
   */
  private restoreStopPoint(chain: readonly LineageEvent[]): void {
    const last = chain.at(-1);
    if (!last) {
      this.lastStop = null;
      return;
    }
    if (last.kind === "stop") {
      this.lastStop = stopFromEvent(last);
      return;
    }
    if (last.kind === "beat_end") {
      const stop = chain.findLast((event) => event.kind === "stop");
      this.lastStop = stop ? stopFromEvent(stop) : null;
      return;
    }
    this.lastStop = { stopType: "pause" };
  }

  /** 谱系链 → LLM 对话轮次（历史拍的玩家原话与已演出脚本，状态不进历史轮次）。 */
  private rebuildMessages(chain: readonly LineageEvent[]): AgentMessage[] {
    const names: Record<string, string> = {};
    for (const character of this.opts.play.characters) names[character.id] = character.name;
    const beats = lineageToBeats(chain, names, this.opts.play.opening);
    const now = Date.now();
    const messages: AgentMessage[] = [];
    beats.forEach((beat, index) => {
      const at = now + index;
      messages.push({ role: "user", content: beat.user ?? "", timestamp: at });
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

  /**
   * 整幕重写的截断锚点 = 最后一个 `beat_end` 之后的**第一个事件**（本幕起点）。
   *
   * `recordRewrite` 把挂载点退到 `anchor.parentId`，所以锚点必须落在幕首事件本身：
   * 本幕若以玩家表态开场，锚点落在它身上才能把旧表态一并切出主链（否则历史里
   * 留下孤立表态，重建出 `{user, assistant:""}` 空轮次，且重写轮回灌时双重表态）。
   * 旧表态原话由 recap 带出，在重写轮的 user 消息里回灌。
   */
  private resolveBeatAnchor(
    chain: readonly string[],
    fallbackId: string,
  ): { anchorId: string; recap: string | null } {
    let start = 0;
    for (let i = chain.length - 1; i >= 0; i -= 1) {
      if (this.opts.tree.get(chain[i]!)?.kind === "beat_end") {
        start = i + 1;
        break;
      }
    }
    const anchorId = chain[start] ?? fallbackId;
    const first = this.opts.tree.get(anchorId);
    const recap =
      first && (first.kind === "player" || first.kind === "ooc")
        ? first.payload?.input ?? null
        : null;
    return { anchorId, recap };
  }

  /** 重写轮次的 user 消息：状态 + （回灌玩家原话）+ 导演注或中性重演指令。 */
  private renderRewriteTurn(
    instruction: string | undefined,
    recap: string | null,
    granularity: "line" | "beat",
  ): string {
    const sections = [
      `【状态】\n${renderStateSection(this.opts.engine, this.opts.scene, this.stateFiles)}`,
    ];
    if (recap) sections.push(`【玩家表态】\n${recap}`);
    sections.push(
      instruction
        ? this.renderDirectorNote(instruction, false)
        : `【重写】\n（${
            granularity === "beat" ? "请重新演绎这一幕" : "请重新演绎这句话"
          }；不要复述或回应这条重写指令本身）`,
    );
    return sections.join("\n\n");
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

  private renderUserTurn(action: ResolvedAction): string {
    const sections = [
      `【状态】\n${renderStateSection(this.opts.engine, this.opts.scene, this.stateFiles)}`,
    ];
    if (action.kind === "ooc") {
      // 空闲态发送 = 越过待回应停止点；busy 中 steer 发送则不算（该拍自己的停止点还没到）
      sections.push(this.renderDirectorNote(action.text, !this.busy));
    }
    if (action.kind === "choice") sections.push(`【玩家表态】\n（选择了：${action.text}）`);
    else if (action.kind === "free") sections.push(`【玩家表态】\n${action.text}`);
    else if (action.kind === "continue") sections.push("【玩家表态】\n（继续）");
    return sections.join("\n\n");
  }

  /** 【导演注】块（OOC 与重写 instruction 共用通道）；越过待回应停止点时明示玩家未回应。 */
  private renderDirectorNote(text: string, acrossStop: boolean): string {
    const sections = [
      `【导演注】\n${text}\n（以上为导演指示：据此调整接下来的演出，不要在剧本中复述或回应这段指示本身）`,
    ];
    // 空闲态发送 = 越过了待回应的 free/choice 停止点：明示玩家未回应，防止模型替玩家编造台词。
    // 演出中（steer）发送时玩家早已回应过上一个停止点，不加此声明。
    if (acrossStop && this.lastStop && this.lastStop.stopType !== "pause") {
      sections.push("【玩家表态】\n（玩家本轮未作回应，请继续演出，并在合适时机再给出回应机会）");
    }
    return sections.join("\n\n");
  }

  private recordPlayerLine(action: ResolvedAction): void {
    if (action.kind === "continue") {
      this.appendLineage("player", { payload: { input: "（继续）" } });
    } else {
      this.appendLineage("player", { payload: { input: action.text } });
    }
    if (action.kind === "ooc") {
      this.appendLineage("ooc", { payload: { input: action.text } });
    }
  }

  private async beginBeat(userText: string): Promise<void> {
    this.beatPending = true;
    try {
      // 纪元边界：拍与拍之间是唯一允许突变 A 区/对话体的时刻（空前缀缓存豁免）
      await this.maybeCompactEpoch();
      if (this.disposed) return;
      this.startBeatWindow();
      await this.agent.prompt(userText);
      await this.agent.waitForIdle();
    } catch (error) {
      // prompt 抛错（网络/中断）：记入 beatError，由 finishBeat 的空拍护栏统一收束
      this.beatError = error instanceof Error ? error.message : String(error);
    } finally {
      // prompt 异常路径可能不发 agent_end：兜底收束（正常路径 busy 已被 finishBeat 清零）
      if (this.busy) this.finishBeat();
      this.beatPending = false;
      if (!this.busy) {
        this.send({ type: "beat_settled" });
        this.flushIdleWaiters();
      }
    }
  }

  /**
   * 纪元压缩：对话体涨到窗口预算（默认 60%）时，把早期轮次压成一张 arcs 摘要卡并重建 Agent。
   * - 摘要失败/无可压段：只告警不动对话体——压缩是优化不是正确性前提，不做降级；
   * - 切掉的原文早已逐拍落进 archive，检索层（search_archive）照常命中。
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
    // 摘要请求在飞：期间可能已 reload/startFresh/dispose——此时重建 Agent 等于僵尸复活
    if (this.disposed) return;
    const epochNo = this.arcIds.length + 1;
    // arcId 带谱系叶：分岔后两条支路各自压缩不会互相覆盖同名卡
    const arcId = `epoch-${this.opts.tree.leafId ?? "root"}-${epochNo}`;
    try {
      await this.opts.memory.appendArc({
        id: arcId,
        title: `纪元 ${epochNo}｜截至第 ${this.beatNo} 拍`,
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

  /** 生成纪元摘要；失败只告警并返回 null（压缩是优化不是正确性前提，不阻断本拍开拍）。 */
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

  /** 拍窗口记账（beginBeat 与 steer 续写拍共用）。 */
  private startBeatWindow(): void {
    this.busy = true;
    this.beatNo += 1;
    this.beatError = null;
    this.beatEvents = 0;
    this.beatLines = [];
    this.beatClosed = false;
    this.opts.engine.turn = this.beatNo;
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
      if (event.message.errorMessage) this.beatError = event.message.errorMessage;
      this.parser.endMessage();
    } else if (event.type === "turn_start") {
      // steer 续写拍（D9 原地 OOC）：上一拍已收束，导演注入后 agent 自动续写，由新 turn 开窗
      if (!this.busy || this.beatClosed) this.startBeatWindow();
    } else if (event.type === "turn_end") {
      // 只在真实边界（beat_done）收束：同一拍内的记忆工具轮次（turn_end）必须继续流动
      if (this.beatClosed) this.finishBeat();
    } else if (event.type === "agent_end") {
      // 正常路径已在 turn_end 收束；此处兜底异常/中止路径（幂等）
      this.finishBeat();
    }
  }

  private finishBeat(): void {
    if (!this.busy) return;
    this.busy = false;
    this.parser.resetBeat();
    let stop = this.pendingStop;
    this.pendingStop = null;
    // D3 护栏：choice 无选项 = 交互死路，降级 free stop（parser 侧已有 warning 供回喂）
    if (stop?.stopType === "choice" && (stop.options?.length ?? 0) === 0) {
      stop = {
        stopType: "free",
        placeholder: "（本轮选项生成失败，请自由回应）",
      };
    }
    // 空拍护栏：生成失败/零产出不得静默伪装成正常收束——显式 error + pause 停止点给玩家重试入口
    if (this.beatEvents === 0 && !stop) {
      this.send({
        type: "error",
        message: `本节拍生成失败：${this.beatError ?? "模型未产出任何剧本内容"}`,
        recoverable: true,
      });
      stop = { stopType: "pause" };
    } else if (this.beatError) {
      this.send({
        type: "error",
        message: `本节拍生成中断：${this.beatError}`,
        recoverable: true,
      });
    }
    this.beatError = null;
    this.lastStop = stop;
    this.appendLineage("beat_end", {
      // seq 锚点：前端按它把行级事件切成一拍一张卡，且能精确跳到拍首行
      payload: { reason: stop ? "stop" : "act_end", seq: this.seq },
    });
    // 谱系快照随 beat 收束保存（分岔/续演恢复用）：活跃状态文件 + arcs 引用（谱系级记忆）
    const engine = this.opts.engine;
    const memory: MemorySnapshot = {
      state: { ...this.stateFiles },
      arcs: [...this.arcIds],
    };
    // 克隆后再存：快照按节点留档，存引用会被后续拍的原地修改污染（分岔恢复必须拿到当拍真值）
    this.opts.tree.saveSnapshot(
      {
        ...engine,
        affinity: { ...engine.affinity },
        flags: { ...engine.flags },
      },
      memory,
    );
    // archive 逐节拍切片（D7 第三层）：本拍台词全文，entryId = 谱系叶（防剧透过滤键）
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
      reason: stop ? "stop" : "act_end",
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
          attrs: { id: event.id, ...(event.mood ? { mood: event.mood } : {}) },
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
      case "scene":
        if (event.bg) this.opts.scene = event.bg;
        this.appendLineage("scene", {
          payload: {
            seq,
            attrs: {
              bg: event.bg ?? "",
              ...pick(event, ["bgm", "ambient", "transition"]),
            },
          },
        });
        return;
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
        this.appendLineage("sfx", { payload: { seq, attrs: { src: event.src } } });
        return;
      case "preload_asset":
        this.appendLineage("preload", {
          payload: {
            seq,
            attrs: { type: event.type, prompt: event.prompt, id: event.id },
          },
        });
        // 立绘差分不做生图（一致性不足，见 D6）：只记谱系，不发起
        if (event.type === "bg" || event.type === "cg") {
          // 已有同名导入素材就不烧配额（提示词也要求别重复生成，这里兜底）。
          // 素材清单的键是目录名（backgrounds/cg），与 DSL 的 type（bg/cg）不同名。
          const kind = event.type === "bg" ? "backgrounds" : "cg";
          const owned = (this.opts.assets?.[kind] ?? []).some(
            (file) => file.replace(/\.\w+$/, "") === event.id,
          );
          if (!owned) this.opts.onPreloadAsset?.(event.type, event.prompt, event.id);
        }
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
