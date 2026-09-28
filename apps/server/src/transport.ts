import type { WebSocket, WebSocketServer } from "ws";
import type { ClientMessage, ServerMessage } from "@stage-ai/core";
import type { PlaywrightOrchestrator } from "./orchestrator.js";

/**
 * WS 会话层：广播 server 消息、路由 client 消息、重连 resume 重放。
 * orchestrator 的 onServerMessage 出口在 hub 初始化时通过 registerSink 注入。
 */
export function attachHub(
  orchestrator: PlaywrightOrchestrator,
  wss: WebSocketServer,
  registerSink: (sink: (msg: ServerMessage) => void) => void,
  cast: { id: string; name: string }[],
): void {
  const clients = new Set<WebSocket>();

  const broadcast = (msg: ServerMessage): void => {
    const data = JSON.stringify(msg);
    for (const client of clients) {
      if (client.readyState === client.OPEN) client.send(data);
    }
  };

  registerSink(broadcast);

  wss.on("connection", (ws) => {
    clients.add(ws);
    ws.send(
      JSON.stringify({ type: "hello", sessionId: "default", lastSeq: orchestrator.lastSeq, cast } satisfies ServerMessage),
    );
    // 重连时处于 stopped 态：重发 beat_end 恢复前端交互面板（演出进行中则等增量事件）
    const replay = orchestrator.stoppedReplay;
    if (replay) ws.send(JSON.stringify(replay));
    orchestrator.autostart();

    ws.on("message", (data) => {
      let msg: ClientMessage;
      try {
        msg = JSON.parse(String(data)) as ClientMessage;
      } catch {
        ws.send(JSON.stringify({ type: "error", message: "无法解析的消息", recoverable: true }));
        return;
      }
      void handleClientMessage(orchestrator, broadcast, msg);
    });

    ws.on("close", () => clients.delete(ws));
    ws.on("error", () => clients.delete(ws));
  });
}

async function handleClientMessage(
  orchestrator: PlaywrightOrchestrator,
  broadcast: (msg: ServerMessage) => void,
  msg: ClientMessage,
): Promise<void> {
  switch (msg.type) {
    case "resume": {
      const missed = orchestrator.eventsAfter(msg.lastSeq);
      if (missed.length > 0) broadcast({ type: "events", events: missed });
      return;
    }
    case "player_choice":
      await orchestrator.playerAction({ kind: "choice", optionIndex: msg.optionIndex });
      return;
    case "player_free":
      await orchestrator.playerAction({ kind: "free", text: msg.text });
      return;
    case "continue":
      await orchestrator.playerAction({ kind: "continue" });
      return;
    case "ooc":
      await orchestrator.playerAction({ kind: "ooc", text: msg.text });
      return;
    default:
      broadcast({ type: "error", message: `P1 暂不支持的操作: ${(msg as { type: string }).type}`, recoverable: true });
  }
}
