import { useCallback, useEffect, useRef, useState } from "react";
import type { ClientMessage, ServerMessage, StopPayload } from "@stage-ai/core";
import { ScriptBuilder, type ScriptLine } from "./script.js";

export type BeatState = "connecting" | "streaming" | "stopped" | "error";

export interface StageSocket {
  state: BeatState;
  error: string | null;
  /** lines 版本号：每次事件批次自增（lines 是稳定引用）。 */
  revision: number;
  lines: readonly ScriptLine[];
  scene: string;
  names: Readonly<Record<string, string>>;
  stop: StopPayload | null;
  isActEnd: boolean;
  sendChoice: (index: number) => void;
  sendFree: (text: string) => void;
  sendContinue: () => void;
  sendOoc: (text: string) => void;
}

export function useStageSocket(url: string): StageSocket {
  const [state, setState] = useState<BeatState>("connecting");
  const [error, setError] = useState<string | null>(null);
  const [stop, setStop] = useState<StopPayload | null>(null);
  const [isActEnd, setActEnd] = useState(false);
  const [names, setNames] = useState<Record<string, string>>({});
  const [tick, setTick] = useState(0); // lines/scene 由 builder 持有，tick 触发重渲染
  const builderRef = useRef(new ScriptBuilder());
  const lastSeqRef = useRef(0);
  const wsRef = useRef<WebSocket | null>(null);
  const retryRef = useRef(0);

  useEffect(() => {
    let closed = false;
    let timer: ReturnType<typeof setTimeout> | undefined;

    const connect = (): void => {
      const ws = new WebSocket(url);
      wsRef.current = ws;

      ws.onopen = () => {
        retryRef.current = 0;
        // 总是 resume：lastSeq=0（页面刷新/内存丢失）= 全量重放；网络闪断 = 增量补发
        ws.send(JSON.stringify({ type: "resume", lastSeq: lastSeqRef.current } satisfies ClientMessage));
      };
      ws.onmessage = (raw) => {
        const msg = JSON.parse(String(raw.data)) as ServerMessage;
        switch (msg.type) {
          case "hello":
            setNames(Object.fromEntries((msg.cast ?? []).map(({ id, name }) => [id, name])));
            setState((prev) => (prev === "connecting" ? "streaming" : prev));
            return;
          case "beat_start":
            setStop(null);
            setActEnd(false);
            setState("streaming");
            return;
          case "events": {
            for (const { seq, event } of msg.events) {
              if (seq <= lastSeqRef.current) continue;
              lastSeqRef.current = seq;
              builderRef.current.apply(event);
            }
            setTick((t) => t + 1);
            return;
          }
          case "beat_end":
            setStop(msg.stop ?? null);
            setActEnd(msg.reason === "act_end");
            setState("stopped");
            return;
          case "error":
            setError(msg.message);
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
  }, [url]);

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
    /** lines 为原地变更的稳定引用，下游 effect（自动滚底）以 revision 驱动。 */
    revision: tick,
    lines: builderRef.current.lines,
    scene: builderRef.current.scene,
    names,
    stop,
    isActEnd,
    sendChoice: (index) => send({ type: "player_choice", optionIndex: index }),
    sendFree: (text) => send({ type: "player_free", text }),
    sendContinue: () => send({ type: "continue" }),
    sendOoc: (text) => send({ type: "ooc", text }),
  };
}
