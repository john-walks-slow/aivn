import type { SequencedEvent, StageEvent } from "../dsl/events.js";

/** 停止点载荷（编排器随 beat_end 下发，前端渲染选项/输入框）。 */
export interface StopPayload {
  stopType: "choice" | "free" | "pause";
  options?: { text: string; value?: string }[];
  placeholder?: string;
}

export interface BeatEndPayload {
  beatId: string;
  /** stop = 交互停止点；act_end = 一幕自然写完（beat_done 收束，无 <stop>）。 */
  reason: "stop" | "act_end";
  stop?: StopPayload;
}

export type ServerMessage =
  | { type: "hello"; sessionId: string; lastSeq: number }
  | { type: "beat_start"; beatId: string }
  | { type: "events"; events: SequencedEvent[] }
  | BeatEndPayload & { type: "beat_end" }
  | { type: "lineage"; leafId: string; turn: number }
  | { type: "error"; message: string; recoverable: boolean };

export type ClientMessage =
  | { type: "resume"; lastSeq: number }
  | { type: "player_choice"; optionIndex: number }
  | { type: "player_free"; text: string }
  | { type: "continue" }
  | { type: "ooc"; text: string }
  | { type: "fork"; nodeId: string }
  | { type: "edit"; nodeId: string; newText: string }
  /** 重写（句/段 ±instruction）。粒度契约：granularity 仅标注意图；beat 边界解析归编排器——
   *  granularity="beat" 时编排器须先解析节拍边界并把 nodeId 传节拍首行（见 LineageTree.recordRewrite）。 */
  | { type: "rewrite"; nodeId: string; granularity: "line" | "beat"; instruction?: string }
  | { type: "jump"; nodeId: string }
  | { type: "bookmark"; nodeId: string; name: string };

export type { StageEvent, SequencedEvent };
