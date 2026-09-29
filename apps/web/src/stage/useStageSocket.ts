import { useCallback, useEffect, useRef, useState } from "react";
import type { ClientMessage, ServerMessage, StopPayload } from "@stage-ai/core";

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
  /** 服务端 TTS 能力（hello.voice；false 时隐藏语音开关）。 */
  voiceAvailable: boolean;
  sendChoice: (index: number) => void;
  sendFree: (text: string) => void;
  sendContinue: () => void;
  sendOoc: (text: string) => void;
  sendTtsControl: (state: { enabled?: boolean; paused?: boolean }) => void;
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
}

export function useStageSocket(playId: string, mode: StartMode, handlers?: StageSocketHandlers): StageSocket {
  const [state, setState] = useState<BeatState>("connecting");
  const [error, setError] = useState<string | null>(null);
  const [stop, setStop] = useState<StopPayload | null>(null);
  const [isActEnd, setActEnd] = useState(false);
  const [names, setNames] = useState<Record<string, string>>({});
  const [voiceAvailable, setVoiceAvailable] = useState(false);
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
            setState((prev) => (prev === "connecting" ? "streaming" : prev));
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
    voiceAvailable,
    sendChoice: (index) => send({ type: "player_choice", optionIndex: index }),
    sendFree: (text) => send({ type: "player_free", text }),
    sendContinue: () => send({ type: "continue" }),
    sendOoc: (text) => send({ type: "ooc", text }),
    sendTtsControl: (ttsState) => send({ type: "tts_control", ...ttsState }),
    send,
  };
}
