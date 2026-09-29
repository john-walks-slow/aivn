import { useCallback, useEffect, useRef, useState } from "react";
import type { ClientMessage, GeneratedAsset, ServerMessage, StopPayload } from "@stage-ai/core";

/** 工坊通道下行消息（D9）：与演出事件共用连接、按 type 分流。 */
export type WorkshopInbound = Extract<ServerMessage, { type: `workshop_${string}` }>;
import { ScriptBuilder, type ScriptLine, type Cue } from "./script.js";

export type BeatState = "connecting" | "streaming" | "stopped" | "error";
export type StartMode = "start" | "continue";

export interface StageSocket {
  state: BeatState;
  error: string | null;
  /** lines/cues 版本号：每次事件批次自增（两者是稳定引用，原地变更）。 */
  revision: number;
  lines: readonly ScriptLine[];
  cues: readonly Cue[];
  scene: string;
  names: Readonly<Record<string, string>>;
  stop: StopPayload | null;
  isActEnd: boolean;
  /** 事件缓冲代号（P6）：结构性操作后整段重放，播放层据此强制复位。 */
  epoch: number;
  /** 服务端 TTS 能力（hello.voice；false 时隐藏语音开关）。 */
  voiceAvailable: boolean;
  sendChoice: (index: number) => void;
  sendFree: (text: string) => void;
  sendContinue: () => void;
  sendOoc: (text: string) => void;
  sendTtsControl: (state: { enabled?: boolean; paused?: boolean }) => void;
  // —— 四原语（P6）：跳转 / 分岔 / 编辑 / 重写 / 分岔后 OOC / 书签 ——
  sendFork: (nodeId: string) => void;
  sendJump: (nodeId: string) => void;
  sendEdit: (nodeId: string, newText: string) => void;
  sendRewrite: (nodeId: string, granularity: "line" | "beat", instruction?: string) => void;
  sendOocAt: (nodeId: string, text: string) => void;
  sendBookmark: (nodeId: string, name: string) => void;
  sendUnbookmark: (bookmarkId: string) => void;
  /** 工坊通道发送（面板自带消息构造）。 */
  send: (msg: ClientMessage) => void;
}

/** 语音/重置事件外发钩子（StageScreen 绑定 VoiceDirector）。 */
export interface StageSocketHandlers {
  onAudio?: (ready: { seq: number; phrase: number; url: string }) => void;
  onBeatStart?: () => void;
  onReset?: () => void;
  /** 原地 OOC 已入队（D9）：当前拍收敛后注入导演注、立即续写下一拍。 */
  onOocAck?: () => void;
  /** 工坊通道下行消息（D9）。 */
  onWorkshop?: (msg: WorkshopInbound) => void;
  /** hello 带回来的既有生成资产全集（重连即恢复可见）。 */
  onAssets?: (assets: GeneratedAsset[]) => void;
  /** 结构性操作完成（P6 rebase）：缓冲已整段重放，播放层须复位后快进到新分支末尾。 */
  onRebase?: (info: { epoch: number; note?: string; busy: boolean }) => void;
  /** 生图就绪（D6）：预解码后就地淡入。 */
  onAssetReady?: (asset: GeneratedAsset) => void;
  /** 生图失败：保持降级视觉 + 提示，不弹永久骨架。 */
  onAssetFailed?: (id: string, message: string) => void;
}

export function useStageSocket(playId: string, mode: StartMode, handlers?: StageSocketHandlers): StageSocket {
  const [state, setState] = useState<BeatState>("connecting");
  const [error, setError] = useState<string | null>(null);
  const [stop, setStop] = useState<StopPayload | null>(null);
  const [isActEnd, setActEnd] = useState(false);
  const [names, setNames] = useState<Record<string, string>>({});
  const [voiceAvailable, setVoiceAvailable] = useState(false);
  const [epoch, setEpoch] = useState(0);
  /** 本地缓冲所属代号：与服务端不一致说明缓冲已被结构性操作整段替换。 */
  const epochRef = useRef(0);
  const [tick, setTick] = useState(0); // lines/cues/scene 由 builder 持有，tick 触发重渲染
  const builderRef = useRef(new ScriptBuilder());
  const lastSeqRef = useRef(0);
  const wsRef = useRef<WebSocket | null>(null);
  const retryRef = useRef(0);
  /** start 模式：等待新档 hello，期间丢弃旧会话的 beat_end 重放。 */
  const expectFreshRef = useRef(mode === "start");
  const handlersRef = useRef<StageSocketHandlers>({});
  handlersRef.current = handlers ?? {};

  useEffect(() => {
    let closed = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const url = `${location.protocol === "https:" ? "wss" : "ws"}://${location.host}/ws?play=${encodeURIComponent(playId)}`;

    const connect = (): void => {
      const ws = new WebSocket(url);
      wsRef.current = ws;

      ws.onopen = () => {
        retryRef.current = 0;
        if (expectFreshRef.current) {
          ws.send(JSON.stringify({ type: "start" } satisfies ClientMessage));
          return;
        }
        // 总是 resume：lastSeq=0（页面刷新/内存丢失）= 全量重放；网络闪断 = 增量补发
        ws.send(JSON.stringify({ type: "resume", lastSeq: lastSeqRef.current } satisfies ClientMessage));
      };
      ws.onmessage = (raw) => {
        const msg = JSON.parse(String(raw.data)) as ServerMessage;
        switch (msg.type) {
          case "hello":
            setNames(Object.fromEntries((msg.cast ?? []).map(({ id, name }) => [id, name])));
            setVoiceAvailable(msg.voice ?? false);
            if (msg.assets) handlersRef.current.onAssets?.(msg.assets);
            setState((prev) => (prev === "connecting" ? "streaming" : prev));
            // 代号不一致 = 缓冲已被替换：本地 seq 全部作废，全量重放
            if (msg.epoch !== undefined && msg.epoch !== epochRef.current) {
              epochRef.current = msg.epoch;
              setEpoch(msg.epoch);
              if (lastSeqRef.current > 0) {
                lastSeqRef.current = 0;
                builderRef.current.reset();
                handlersRef.current.onReset?.();
                setTick((t) => t + 1);
                ws.send(JSON.stringify({ type: "resume", lastSeq: 0 } satisfies ClientMessage));
              }
            }
            if (expectFreshRef.current && msg.lastSeq === 0) {
              // 新档 hello：清旧脚本，从头接收
              expectFreshRef.current = false;
              builderRef.current.reset();
              lastSeqRef.current = 0;
              handlersRef.current.onReset?.();
              setTick((t) => t + 1);
            }
            return;
          case "beat_start":
            setStop(null);
            setActEnd(false);
            setError(null);
            setState("streaming");
            handlersRef.current.onBeatStart?.();
            return;
          case "events": {
            for (const { seq, event } of msg.events) {
              if (seq <= lastSeqRef.current) continue;
              lastSeqRef.current = seq;
              builderRef.current.apply(event, seq);
            }
            setTick((t) => t + 1);
            return;
          }
          case "asset_ready":
            handlersRef.current.onAssetReady?.(msg.asset);
            return;
          case "asset_failed":
            handlersRef.current.onAssetFailed?.(msg.id, msg.message);
            return;
          case "audio_ready":
            handlersRef.current.onAudio?.({ seq: msg.seq, phrase: msg.phrase, url: msg.url });
            return;
          case "beat_end":
            if (expectFreshRef.current) return; // 旧会话的 stoppedReplay，新档即将开始
            setStop(msg.stop ?? null);
            setActEnd(msg.reason === "act_end");
            setState("stopped");
            return;
          case "ooc_ack":
            handlersRef.current.onOocAck?.();
            return;
          case "rebase": {
            // 上下文重建：整段替换本地缓冲与播放游标（新分支从头重放）
            epochRef.current = msg.epoch;
            setEpoch(msg.epoch);
            builderRef.current.reset();
            lastSeqRef.current = 0;
            for (const { seq, event } of msg.events) {
              lastSeqRef.current = seq;
              builderRef.current.apply(event, seq);
            }
            setStop(msg.stop ?? null);
            setActEnd(msg.reason === "act_end");
            setError(null);
            setTick((t) => t + 1);
            handlersRef.current.onRebase?.({
              epoch: msg.epoch,
              ...(msg.note ? { note: msg.note } : {}),
              // 停在新分支的停止点 = 等玩家继续；停在拍中 = 接下来还会有事件流
              busy: msg.reason !== "act_end" && !msg.stop,
            });
            return;
          }
          case "error":
            setError(msg.message);
            return;
          default:
            // 工坊通道（workshop_*）：与演出状态机无关，整包外发
            if (msg.type.startsWith("workshop_")) handlersRef.current.onWorkshop?.(msg as WorkshopInbound);
            return;
        }
      };
      ws.onclose = () => {
        if (closed) return;
        setState("connecting");
        const delay = Math.min(500 * 2 ** retryRef.current, 4000);
        retryRef.current += 1;
        timer = setTimeout(connect, delay);
      };
      ws.onerror = () => ws.close();
    };

    connect();
    return () => {
      closed = true;
      if (timer) clearTimeout(timer);
      wsRef.current?.close();
    };
  }, [playId]);

  const send = useCallback((msg: ClientMessage): void => {
    const ws = wsRef.current;
    if (ws && ws.readyState === WebSocket.OPEN) {
      setError(null);
      ws.send(JSON.stringify(msg));
    }
  }, []);

  // 稳定引用：四原语出口挂在导演视图上，引用抖动会让整棵子树反复重渲染
  const sendChoice = useCallback((index: number) => send({ type: "player_choice", optionIndex: index }), [send]);
  const sendFree = useCallback((text: string) => send({ type: "player_free", text }), [send]);
  const sendContinue = useCallback(() => send({ type: "continue" }), [send]);
  const sendOoc = useCallback((text: string) => send({ type: "ooc", text }), [send]);
  const sendFork = useCallback((nodeId: string) => send({ type: "fork", nodeId }), [send]);
  const sendJump = useCallback((nodeId: string) => send({ type: "jump", nodeId }), [send]);
  const sendEdit = useCallback(
    (nodeId: string, newText: string) => send({ type: "edit", nodeId, newText }),
    [send],
  );
  const sendRewrite = useCallback(
    (nodeId: string, granularity: "line" | "beat", instruction?: string) =>
      send({ type: "rewrite", nodeId, granularity, ...(instruction ? { instruction } : {}) }),
    [send],
  );
  const sendOocAt = useCallback(
    (nodeId: string, text: string) => send({ type: "ooc_at", nodeId, text }),
    [send],
  );
  const sendBookmark = useCallback(
    (nodeId: string, name: string) => send({ type: "bookmark", nodeId, name }),
    [send],
  );
  const sendUnbookmark = useCallback(
    (bookmarkId: string) => send({ type: "unbookmark", bookmarkId }),
    [send],
  );

  void tick;

  return {
    state,
    error,
    /** lines/cues 为原地变更的稳定引用，下游 effect 以 revision 驱动。 */
    revision: tick,
    lines: builderRef.current.lines,
    cues: builderRef.current.cues,
    scene: builderRef.current.scene,
    names,
    stop,
    isActEnd,
    epoch,
    voiceAvailable,
    sendChoice,
    sendFree,
    sendContinue,
    sendOoc,
    sendTtsControl: (ttsState) => send({ type: "tts_control", ...ttsState }),
    sendFork,
    sendJump,
    sendEdit,
    sendRewrite,
    sendOocAt,
    sendBookmark,
    sendUnbookmark,
    send,
  };
}
