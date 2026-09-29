import { useCallback, useEffect, useRef, useState } from "react";
import type { ClientMessage, ServerMessage } from "@stage-ai/core";
import type { WorkshopInbound } from "../stage/useStageSocket.js";

export type WorkshopSubscribe = (handler: (msg: WorkshopInbound) => void) => () => void;

/**
 * 工坊专用 WS 连接（独立全屏工坊页用）：只收 workshop_* 下行、只发工坊上行。
 * 带 `?workshop=1`——服务端据此跳过 autostart，逛工坊不会把演出开起来。
 */
export function useWorkshopSocket(playId: string): {
  connected: boolean;
  error: string | null;
  send: (msg: ClientMessage) => void;
  subscribe: WorkshopSubscribe;
} {
  const [connected, setConnected] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const retryRef = useRef(0);
  const handlersRef = useRef(new Set<(msg: WorkshopInbound) => void>());

  const subscribe = useCallback<WorkshopSubscribe>((handler) => {
    handlersRef.current.add(handler);
    return () => handlersRef.current.delete(handler);
  }, []);

  useEffect(() => {
    let closed = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const url = `${location.protocol === "https:" ? "wss" : "ws"}://${location.host}/ws?play=${encodeURIComponent(playId)}&workshop=1`;

    const connect = (): void => {
      const ws = new WebSocket(url);
      wsRef.current = ws;
      ws.onopen = () => {
        retryRef.current = 0;
        setConnected(true);
      };
      ws.onmessage = (raw) => {
        const msg = JSON.parse(String(raw.data)) as ServerMessage;
        if (msg.type.startsWith("workshop_")) {
          for (const handler of handlersRef.current) handler(msg as WorkshopInbound);
        } else if (msg.type === "error") {
          setError(msg.message);
        }
      };
      ws.onclose = () => {
        setConnected(false);
        if (closed) return;
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

  return { connected, error, send, subscribe };
}
