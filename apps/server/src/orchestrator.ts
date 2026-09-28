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
import { buildSystemPrompt, renderStateSection } from "./prompt.js";
import type { PlayConfig } from "./play.js";

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
  tree: LineageTree;
  engine: EngineStateSnapshot;
  scene: string;
  /** 服务端消息出口（transport 广播）。 */
  onServerMessage: (msg: ServerMessage) => void;
  /** 行级谱系事件落盘钩子（每次 append 后调用）。 */
  onLineageEvent?: (event: LineageEvent) => void;
  /** 会话落盘钩子（beat 收束时调用）。 */
  persist: () => void;
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

  constructor(opts: OrchestratorOptions) {
    this.opts = opts;
    this.parser = new StageDslParser((event) => this.onStageEvent(event));
    this.agent = new PiAgent({
      streamFn: opts.streamFn,
      getApiKey: opts.getApiKey,
      initialState: {
        systemPrompt: buildSystemPrompt(opts.play),
        model: opts.model,
        thinkingLevel: "off",
        tools: [createBeatDoneTool()],
        messages: [],
      },
    });
    this.agent.subscribe((event) => void this.onAgentEvent(event));
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
      this.opts.onServerMessage({ type: "error", message: "演出进行中，请等待当前节拍结束", recoverable: true });
      return;
    }
    let resolved: ResolvedAction;
    if (action.kind === "choice") {
      const option = this.lastStop?.options?.[action.optionIndex];
      if (!option) {
        this.opts.onServerMessage({ type: "error", message: `无效的选项索引: ${action.optionIndex}`, recoverable: true });
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
    this.opts.engine.turn = this.beatNo;
    const beatId = `beat-${this.beatNo}`;
    this.opts.onServerMessage({ type: "beat_start", beatId });
    this.opts.onServerMessage({ type: "lineage", leafId: this.opts.tree.leafId ?? "", turn: this.opts.tree.leafId ? (this.opts.tree.get(this.opts.tree.leafId)?.turn ?? 0) : 0 });
    try {
      await this.agent.prompt(userText);
      await this.agent.waitForIdle();
    } catch (error) {
      this.opts.onServerMessage({
        type: "error",
        message: `演出生成失败: ${error instanceof Error ? error.message : String(error)}`,
        recoverable: true,
      });
      this.finishBeat();
    }
  }

  private async onAgentEvent(event: Parameters<Parameters<Agent["subscribe"]>[0]>[0]): Promise<void> {
    if (event.type === "message_update" && event.assistantMessageEvent.type === "text_delta") {
      this.parser.feed(event.assistantMessageEvent.delta);
    } else if (event.type === "message_end" && event.message.role === "assistant") {
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
    this.lastStop = stop;
    this.appendLineage("beat_end", { payload: { reason: stop ? "stop" : "act_end" } });
    // 谱系快照随 beat 收束保存（分岔/续演恢复用）
    const memory: MemorySnapshot = { state: { scene: this.opts.scene }, arcs: [] };
    this.opts.tree.saveSnapshot(this.opts.engine, memory);
    this.opts.onServerMessage({
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
    const sequenced: SequencedEvent = { seq: this.seq, event };
    this.events.push(sequenced);
    this.opts.onServerMessage({ type: "events", events: [sequenced] });
    this.accumulateLineage(event);
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
