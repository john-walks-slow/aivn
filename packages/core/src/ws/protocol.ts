import type { SequencedEvent, StageEvent } from "../dsl/events.js";

/** 停止点载荷（编排器随 beat_end 下发，前端渲染选项/输入框）。 */
export interface StopPayload {
  stopType: "choice" | "free";
  options?: { text: string; value?: string }[];
  placeholder?: string;
}

export interface BeatEndPayload {
  beatId: string;
  /** stop = 交互停止点；act_end = 一幕自然写完（beat_done 收束，无 <stop>）。 */
  reason: "stop" | "act_end";
  stop?: StopPayload;
}

/** 工坊线程（D9 meta-chat 多会话）在协议层的投影。 */
export interface WorkshopThreadInfo {
  id: string;
  title: string;
  updatedAt: number;
  archived: boolean;
  summary: string | null;
}

/** 工坊对话消息（面板回放用）。 */
export interface WorkshopChatMessage {
  role: "user" | "assistant";
  text: string;
  at: number;
}

/** 生成资产（D6 生图管线）：剧作家 preload_asset 预发射、后台生成后落 media-cache。 */
export interface GeneratedAsset {
  /** 剧作家给的资源 id，与 `<cg id>` / `<scene bg>` 同一命名空间。 */
  id: string;
  /** 站内 URL：/plays/<playId>/media/img/<file>。 */
  url: string;
  /** bg | cg（sprite 不做生图，见计划 D6）。 */
  type: "bg" | "cg";
}

export type ServerMessage =
  | {
      type: "hello";
      sessionId: string;
      lastSeq: number;
      cast?: { id: string; name: string }[];
      /** 服务端 TTS 能力（配置了 fish-audio keys 才为 true；false 时客户端隐藏语音开关）。 */
      voice?: boolean;
      /** 本剧目已生成的资产全集（manifest 快照）：重连即恢复可见，不必等下一次预发射。 */
      assets?: GeneratedAsset[];
      /**
       * 事件缓冲代号（P6）：每次结构性操作（分岔/跳转/编辑/重写）重放缓冲并自增。
       * 客户端重连时发现与本地不一致 → 清空本地缓冲、lastSeq 归零后全量重放。
       */
      epoch?: number;
      /** 连上这一刻编排器就是空闲的（没有在跑的拍）。重连/刷新后客户端据此直接放开操作条，
       *  不用等一场本来不会到来的 beat_settled。 */
      idle?: boolean;
    }
  | { type: "beat_start"; beatId: string }
  | { type: "events"; events: SequencedEvent[] }
  | BeatEndPayload & { type: "beat_end" }
  /** 编排器真正空闲（模型那一轮收尾完毕）：此前 beat_end 已到但导演/玩家操作仍可能被拒。 */
  | { type: "beat_settled" }
  /** 语音预取就绪（D5）：seq = 所属 say 行 say_start 事件的序号，客户端据此关联行。 */
  | { type: "audio_ready"; seq: number; phrase: number; url: string }
  /** 生成就绪（D6）：客户端预解码后就地 crossfade 淡入，台词早已先行。瞬态消息不进事件缓冲。 */
  | { type: "asset_ready"; asset: GeneratedAsset }
  /** 生图失败（非慢）：客户端保持降级视觉（既有素材/氛围色），不弹占位。 */
  | { type: "asset_failed"; id: string; message: string }
  | { type: "lineage"; leafId: string; turn: number }
  /**
   * 上下文重建完成（P6 四原语共用出口）：挂载点已移到新分支，events 是该分支的完整重放。
   * 客户端收到即清空本地脚本/播放游标，按 events 重建（epoch 自增用于丢弃过期的 seq 认知）。
   */
  | {
      type: "rebase";
      epoch: number;
      leafId: string | null;
      events: SequencedEvent[];
      /** 重建后的停止点（无 = 幕完/拍中，客户端按 continue 处理）。 */
      stop?: StopPayload;
      reason?: "stop" | "act_end";
      /** 本次操作的人类可读说明（前端提示条）。 */
      note?: string;
    }
  /** 原地 OOC 已入队（D9）：当前拍收敛后注入【导演注】并立即续写下一拍。 */
  | { type: "ooc_ack" }
  // —— 工坊（D9）：与演出并行的一条独立 agent 通道，消息都带 threadId 以便前端分流 ——
  | { type: "workshop_threads"; threads: WorkshopThreadInfo[]; activeId: string | null }
  | { type: "workshop_history"; threadId: string; messages: WorkshopChatMessage[] }
  /** 工坊流式增量。 */
  | { type: "workshop_chunk"; threadId: string; delta: string }
  /** 工坊 agent 正在调用某工具（前端显示活动指示）。 */
  | { type: "workshop_tool"; threadId: string; name: string }
  /** 工坊 agent 写了剧目文件：before 为 null 表示新建，可据此一键撤销。 */
  | { type: "workshop_write"; threadId: string; path: string; before: string | null }
  | { type: "workshop_done"; threadId: string; text: string }
  | { type: "workshop_error"; threadId: string | null; message: string }
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
  /** 分岔后立即 OOC：先分岔再注入导演注并重新生成（与原地 steer 正交）。 */
  | { type: "ooc_at"; nodeId: string; text: string }
  // —— 工坊（D9）：线程管理 + 对话 + 文件编辑；与演出共用一条连接，服务端按 type 分流 ——
  /** 打开面板：回线程列表与当前现场。 */
  | { type: "workshop_open" }
  /** 切到指定线程（回放其消息体）。 */
  | { type: "workshop_activate"; threadId: string }
  /** 发一条工坊消息；不带 threadId 则新建线程。 */
  | { type: "workshop_chat"; threadId?: string; text: string }
  | { type: "workshop_archive"; threadId: string; archived: boolean }
  | { type: "workshop_delete"; threadId: string };

export type { StageEvent, SequencedEvent };
