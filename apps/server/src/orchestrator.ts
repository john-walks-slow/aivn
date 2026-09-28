import type { AgentTool, Agent, StreamFn } from "@earendil-works/pi-agent-core";
import { Agent as PiAgent } from "@earendil-works/pi-agent-core";
import { type Api, type Model, type TSchema, Type } from "@earendil-works/pi-ai";
import {
  LineageTree,
  StageDslParser,
  type EngineStateSnapshot,
  type LineageEvent,
  type MemorySnapshot,
  type SequencedEvent,
  type StageEvent,
  type StopPayload,
} from "@stage-ai/core";
import type { ServerMessage } from "@stage-ai/core";
import { buildSystemPrompt, renderStateSection, type AssetManifest } from "./prompt.js";
import type { PlayConfig } from "@stage-ai/core";
import { VoicePipeline, type TtsSynthFn } from "./voice.js";

/** 生成批次收束工具（D3：交互停止点之后或一幕写完时调用）。 */
const beatDoneParams = Type.Object({}, { additionalProperties: false });

export function createBeatDoneTool(): AgentTool<TSchema> {
  return {
    name: "beat_done",
    label: "结束本节拍",
    description: "本节拍演出内容已写完（交互停止点之后，或一幕自然写完）时调用，不与其他工具同批调用",
    parameters: beatDoneParams,
    execute: async () => ({
      content: [{ type: "text", text: "ok" }],
      details: undefined,
      terminate: true,
    }),
  };
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
  tree: LineageTree;
  engine: EngineStateSnapshot;
  scene: string;
  /** 服务端消息出口（transport 广播）。 */
  onServerMessage: (msg: ServerMessage) => void;
  /** 行级谱系事件落盘钩子（每次 append 后调用）。 */
  onLineageEvent?: (event: LineageEvent) => void;
  /** 会话落盘钩子（beat 收束时调用）。 */
  persist: () => void;
  /** 服务器重启恢复：上次会话的运行态（事件缓冲/节拍号/停止点）。 */
  restored?: OrchestratorRuntimeState;
  /** 语音管线合成函数（无则本剧目无声：hello.voice=false）。 */
  tts?: { synth: TtsSynthFn; concurrency?: number };
}

/** 编排器运行态（随 session.json 持久化，重启后恢复重放与续演）。 */
export interface OrchestratorRuntimeState {
  events: SequencedEvent[];
  beatNo: number;
  lastStop: StopPayload | null;
}

interface OpenLine {
  kind: "say" | "narrate" | "thought";
  id?: string;
  text: string;
  attrs: Record<string, string>;
}

/**
 * Playwriter 编排器：pi Agent 流式输出 → StageDslParser → IR 事件（seq）→ 广播；
 * 谱系行级聚合 + 快照；beat 生命周期（start → 流式 → stop/act_end 收束）。
 *
 * 三区装配：A 区 = system prompt（固定）；B 区 = 逐轮追加的 user 消息
 * （【状态】+【导演注】?+【玩家表态】，Active State 进 user 消息保证 KV 前缀稳定）。
 */
export class PlaywrightOrchestrator {
  private readonly agent: Agent;
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
  /** 语音预取管线（D5）：say 行 → 分句 → TTS 预取 → audio_ready。 */
  private readonly voice: VoicePipeline | null;
  /** 本拍内 pi agent 的流错误（message_end.errorMessage）；每拍重置。 */
  private beatError: string | null = null;
  /** 本拍内产出的舞台事件数（空拍检测）。 */
  private beatEvents = 0;
  private readonly unsubscribeAgent: () => void;

  constructor(opts: OrchestratorOptions) {
    this.opts = opts;
    this.parser = new StageDslParser((event) => this.onStageEvent(event));
    this.agent = new PiAgent({
      streamFn: opts.streamFn,
      getApiKey: opts.getApiKey,
      initialState: {
        systemPrompt: buildSystemPrompt(opts.play, opts.assets),
        model: opts.model,
        thinkingLevel: "off",
        tools: [createBeatDoneTool()],
        messages: [],
      },
    });
    this.unsubscribeAgent = this.agent.subscribe((event) => void this.onAgentEvent(event));
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
      this.autostarted = true;
    }
  }

  /** 运行态快照（session.json 持久化，重启后恢复重放与续演）。 */
  get runtimeState(): OrchestratorRuntimeState {
    return { events: this.events, beatNo: this.beatNo, lastStop: this.lastStop };
  }

  /** 丢弃：断订阅、中断当前流、停语音管线（多剧目/重开时回收）。 */
  dispose(): void {
    this.disposed = true;
    this.unsubscribeAgent();
    this.agent.abort();
    this.voice?.dispose();
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

  get lastSeq(): number {
    return this.seq;
  }

  get currentScene(): string {
    return this.opts.scene;
  }

  /** 重连恢复：stopped 态重发 beat_end 载荷；演出进行中/未开局返回 null。 */
  get stoppedReplay(): { type: "beat_end"; beatId: string; reason: "stop" | "act_end"; stop?: StopPayload } | null {
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
    if (this.autostarted || this.busy) return;
    this.autostarted = true;
    void this.beginBeat(this.opts.play.opening);
  }

  /** 玩家操作 → 下一节拍。busy 中拒绝。开局时玩家表态并入开场指令。 */
  async playerAction(action: PlayerAction): Promise<void> {
    if (this.busy) {
      this.send({ type: "error", message: "演出进行中，请等待当前节拍结束", recoverable: true });
      return;
    }
    let resolved: ResolvedAction;
    if (action.kind === "choice") {
      const option = this.lastStop?.options?.[action.optionIndex];
      if (!option) {
        this.send({ type: "error", message: `无效的选项索引: ${action.optionIndex}`, recoverable: true });
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

  private renderUserTurn(action: ResolvedAction): string {
    const sections = [
      `【状态】\n${renderStateSection(this.opts.engine, this.opts.scene)}`,
    ];
    if (action.kind === "ooc") {
      sections.push(
        `【导演注】\n${action.text}\n（以上为导演指示：据此调整接下来的演出，不要在剧本中复述或回应这段指示本身）`,
      );
      // OOC 越过了待回应的 free/choice 停止点：明示玩家未回应，防止模型替玩家编造台词
      if (this.lastStop && this.lastStop.stopType !== "pause") {
        sections.push("【玩家表态】\n（玩家本轮未作回应，请继续演出，并在合适时机再给出回应机会）");
      }
    }
    if (action.kind === "choice") sections.push(`【玩家表态】\n（选择了：${action.text}）`);
    else if (action.kind === "free") sections.push(`【玩家表态】\n${action.text}`);
    else if (action.kind === "continue") sections.push("【玩家表态】\n（继续）");
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
    this.busy = true;
    this.beatNo += 1;
    this.beatError = null;
    this.beatEvents = 0;
    this.opts.engine.turn = this.beatNo;
    const beatId = `beat-${this.beatNo}`;
    this.send({ type: "beat_start", beatId });
    this.send({ type: "lineage", leafId: this.opts.tree.leafId ?? "", turn: this.opts.tree.leafId ? (this.opts.tree.get(this.opts.tree.leafId)?.turn ?? 0) : 0 });
    try {
      await this.agent.prompt(userText);
      await this.agent.waitForIdle();
    } catch (error) {
      // prompt 抛错（网络/中断）：记入 beatError，由 finishBeat 的空拍护栏统一收束
      this.beatError = error instanceof Error ? error.message : String(error);
    } finally {
      // prompt 异常路径可能不发 agent_end：兜底收束（正常路径 busy 已被 finishBeat 清零）
      if (this.busy) this.finishBeat();
    }
  }

  private async onAgentEvent(event: Parameters<Parameters<Agent["subscribe"]>[0]>[0]): Promise<void> {
    if (event.type === "message_update" && event.assistantMessageEvent.type === "text_delta") {
      this.parser.feed(event.assistantMessageEvent.delta);
    } else if (event.type === "message_end" && event.message.role === "assistant") {
      // pi agent 的 provider 失败不抛异常，而是 assistant message 带 errorMessage 正常收束——捕获之
      if (event.message.errorMessage) this.beatError = event.message.errorMessage;
      this.parser.endMessage();
    } else if (event.type === "agent_end") {
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
      stop = { stopType: "free", placeholder: "（本轮选项生成失败，请自由回应）" };
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
      this.send({ type: "error", message: `本节拍生成中断：${this.beatError}`, recoverable: true });
    }
    this.beatError = null;
    this.lastStop = stop;
    this.appendLineage("beat_end", { payload: { reason: stop ? "stop" : "act_end" } });
    // 谱系快照随 beat 收束保存（分岔/续演恢复用）
    const memory: MemorySnapshot = { state: { scene: this.opts.scene }, arcs: [] };
    this.opts.tree.saveSnapshot(this.opts.engine, memory);
    this.send({
      type: "beat_end",
      beatId: `beat-${this.beatNo}`,
      reason: stop ? "stop" : "act_end",
      stop: stop ?? undefined,
    });
    this.opts.persist();
  }

  private appendLineage(kind: LineageEvent["kind"], opts: { text?: string; payload?: LineageEvent["payload"] }): LineageEvent {
    const event = this.opts.tree.append(kind, opts);
    this.opts.onLineageEvent?.(event);
    return event;
  }

  private onStageEvent(event: StageEvent): void {
    this.seq += 1;
    this.beatEvents += 1;
    const sequenced: SequencedEvent = { seq: this.seq, event };
    this.events.push(sequenced);
    this.send({ type: "events", events: [sequenced] });
    this.accumulateLineage(event);
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
  private accumulateLineage(event: StageEvent): void {
    switch (event.kind) {
      case "say_start":
        this.openLine = { kind: "say", id: event.id, text: "", attrs: { id: event.id, ...(event.mood ? { mood: event.mood } : {}) } };
        return;
      case "narrate_start":
        this.openLine = { kind: "narrate", text: "", attrs: {} };
        return;
      case "thought_start":
        this.openLine = { kind: "thought", id: event.id, text: "", attrs: { id: event.id } };
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
        if (line) this.appendLineage(line.kind, { text: line.text, payload: { attrs: line.attrs } });
        return;
      }
      case "scene":
        if (event.bg) this.opts.scene = event.bg;
        this.appendLineage("scene", { payload: { attrs: { bg: event.bg ?? "", ...pick(event, ["bgm", "ambient", "transition"]) } } });
        return;
      case "actor":
        this.appendLineage("actor", { payload: { attrs: { id: event.id, ...pick(event, ["pos", "expression", "action"]) } } });
        return;
      case "sfx":
        this.appendLineage("sfx", { payload: { attrs: { src: event.src } } });
        return;
      case "preload_asset":
        this.appendLineage("preload", { payload: { attrs: { type: event.type, prompt: event.prompt, id: event.id } } });
        return;
      case "cg":
        this.appendLineage("cg", { payload: { attrs: { id: event.id, ...pick(event, ["caption"]) } } });
        return;
      case "stop":
        this.pendingStop = {
          stopType: event.stopType,
          options: event.options,
          placeholder: event.placeholder,
        };
        this.appendLineage("stop", {
          payload: { attrs: { type: event.stopType }, ...(event.options ? { options: event.options } : {}) },
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
