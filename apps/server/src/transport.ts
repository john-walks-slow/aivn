import type { WebSocket, WebSocketServer } from "ws";
import type { ClientMessage, ServerMessage } from "@stage-ai/core";
import type { PlayHouse, PlayRuntime } from "./playhouse.js";

/**
 * WS 会话层（多剧目）：/ws?play=<id> 连接路由到剧目 runtime。
 * start = 重开新档；resume 增量重放；其余玩家动作。
 * 消息监听器同步注册、早到消息缓冲到 runtime 就绪——
 * get() 的异步间隙不能吞客户端 resume；客户端注册先于 autostart，开局事件不丢。
 */
export function attachTransport(wss: WebSocketServer, playhouse: PlayHouse): void {
  wss.on("connection", (ws, req) => {
    const url = new URL(req.url ?? "/", "http://localhost");
    const playId = url.searchParams.get("play") ?? "";
    if (!/^[\w-]+$/.test(playId)) {
      ws.close(1008, "缺少 ?play=<剧目id>");
      return;
    }
    onConnection(ws, playhouse, playId);
  });
}

function onConnection(ws: WebSocket, playhouse: PlayHouse, playId: string): void {
  const sender = (msg: ServerMessage): void => {
    if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(msg));
  };
  let runtime: PlayRuntime | null = null;
  const pending: ClientMessage[] = [];

  const dispatchSafe = (msg: ClientMessage): void => {
    void dispatch(msg).catch((error: unknown) => {
      const message = error instanceof Error ? error.message : String(error);
      sender({ type: "error", message, recoverable: true });
    });
  };

  ws.on("message", (data) => {
    let msg: ClientMessage;
    try {
      msg = JSON.parse(String(data)) as ClientMessage;
    } catch {
      sender({ type: "error", message: "无法解析的消息", recoverable: true });
      return;
    }
    if (runtime) dispatchSafe(msg);
    else pending.push(msg);
  });

  const drop = (): void => {
    runtime?.clients.delete(sender);
  };
  ws.on("close", drop);
  ws.on("error", drop);

  void (async () => {
    runtime = await playhouse.get(playId);
    runtime.clients.add(sender);
    sendHello(ws, playId, runtime);
    runtime.orchestrator.autostart();
    for (const msg of pending.splice(0)) dispatchSafe(msg);
  })();

  async function dispatch(msg: ClientMessage): Promise<void> {
    const current = runtime;
    if (!current) return;
    if (msg.type === "start") {
      const fresh = await playhouse.startFresh(playId);
      if (fresh === current) return;
      current.clients.delete(sender);
      runtime = fresh;
      runtime.clients.add(sender);
      sendHello(ws, playId, runtime);
      runtime.orchestrator.autostart();
      return;
    }
    await routeMessage(current, sender, msg);
  }
}

function sendHello(ws: WebSocket, playId: string, runtime: PlayRuntime): void {
  const hello = {
    type: "hello",
    sessionId: playId,
    lastSeq: runtime.orchestrator.lastSeq,
    cast: runtime.cast,
  } satisfies ServerMessage;
  ws.send(JSON.stringify(hello));
  // 重连时处于 stopped 态：重发 beat_end 恢复前端交互面板（演出进行中则等增量事件）
  const replay = runtime.orchestrator.stoppedReplay;
  if (replay) ws.send(JSON.stringify(replay satisfies ServerMessage));
}

async function routeMessage(
  runtime: PlayRuntime,
  sender: (msg: ServerMessage) => void,
  msg: ClientMessage,
): Promise<void> {
  const orchestrator = runtime.orchestrator;
  switch (msg.type) {
    case "resume": {
      const missed = orchestrator.eventsAfter(msg.lastSeq);
      if (missed.length > 0) sender({ type: "events", events: missed });
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
      sender({ type: "error", message: `P2 暂不支持的操作: ${(msg as { type: string }).type}`, recoverable: true });
  }
}
