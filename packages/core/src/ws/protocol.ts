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
  | {
      type: "hello";
      sessionId: string;
      lastSeq: number;
      cast?: { id: string; name: string }[];
      /** 服务端 TTS 能力（配置了 fish-audio keys 才为 true；false 时客户端隐藏语音开关）。 */
      voice?: boolean;
    }
  | { type: "beat_start"; beatId: string }
  | { type: "events"; events: SequencedEvent[] }
  | BeatEndPayload & { type: "beat_end" }
  /** 语音预取就绪（D5）：seq = 所属 say 行 say_start 事件的序号，客户端据此关联行。 */
  | { type: "audio_ready"; seq: number; phrase: number; url: string }
  | { type: "lineage"; leafId: string; turn: number }
  /** 原地 OOC 已入队（D9）：当前拍收敛后注入【导演注】并立即续写下一拍。 */
  | { type: "ooc_ack" }
  | { type: "error"; message: string; recoverable: boolean };

export type ClientMessage =
  | { type: "resume"; lastSeq: number }
  | { type: "start" }
  | { type: "player_choice"; optionIndex: number }
  | { type: "player_free"; text: string }
  | { type: "continue" }
  | { type: "ooc"; text: string }
  /** 语音控制（D5 背压）：enabled=总开关（关=停合成）；paused=暂停预取（快进态/缓冲积压）。 */
  | { type: "tts_control"; enabled?: boolean; paused?: boolean }
  | { type: "fork"; nodeId: string }
  | { type: "edit"; nodeId: string; newText: string }
  /** 重写（句/段 ±instruction）。粒度契约：granularity 仅标注意图；beat 边界解析归编排器——
   *  granularity="beat" 时编排器须先解析节拍边界并把 nodeId 传节拍首行（见 LineageTree.recordRewrite）。 */
  | { type: "rewrite"; nodeId: string; granularity: "line" | "beat"; instruction?: string }
  | { type: "jump"; nodeId: string }
  | { type: "bookmark"; nodeId: string; name: string };

export type { StageEvent, SequencedEvent };
