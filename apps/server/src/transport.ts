import type { WebSocket, WebSocketServer } from "ws";
import type { ClientMessage, ServerMessage } from "@stage-ai/core";
import { helloPayload, type PlayHouse, type PlayRuntime } from "./playhouse.js";

/**
 * WS 会话层（多剧目）：/ws?play=<id> 连接路由到剧目 runtime。
 * start = 重开新档；resume 增量重放；其余玩家动作。
 * 客户端集合挂在 PlayHouse（与 runtime 生命周期解耦）；每次派发现查 runtime——
 * startFresh/配置保存 reload 重建后，活连接自动路由到新实例，不断线。
 */
export function attachTransport(wss: WebSocketServer, playhouse: PlayHouse): void {
  wss.on("connection", (ws, req) => {
    const url = new URL(req.url ?? "/", "http://localhost");
    const playId = url.searchParams.get("play") ?? "";
    if (!/^[\w-]+$/.test(playId)) {
      ws.close(1008, "缺少 ?play=<剧目id>");
      return;
    }
    // 工坊面板单独连接（?workshop=1）时不触发 autostart——逛工坊不该把演出开起来
    onConnection(ws, playhouse, playId, url.searchParams.get("workshop") !== "1");
  });
}

function onConnection(ws: WebSocket, playhouse: PlayHouse, playId: string, autostart: boolean): void {
  const sender = (msg: ServerMessage): void => {
    if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(msg));
  };
  let established = false;
  let registered: Set<(msg: ServerMessage) => void> | null = null;
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
    if (established) dispatchSafe(msg);
    else pending.push(msg);
  });

  const drop = (): void => {
    registered?.delete(sender);
  };
  ws.on("close", drop);
  ws.on("error", drop);

  void (async () => {
    const runtime = await playhouse.get(playId);
    registered = playhouse.clientsFor(playId);
    registered.add(sender);
    sendHello(ws, playId, runtime);
    if (autostart) runtime.orchestrator.autostart();
    established = true;
    for (const msg of pending.splice(0)) dispatchSafe(msg);
  })();

  async function dispatch(msg: ClientMessage): Promise<void> {
    // 每次现查：runtime 重建（startFresh / 配置保存 reload）后自动路由到新实例
    const current = await playhouse.get(playId);
    if (msg.type === "start") {
      const fresh = await playhouse.startFresh(playId);
      if (fresh === current) return;
      sendHello(ws, playId, fresh);
      fresh.orchestrator.autostart();
      return;
    }
    await routeMessage(current, sender, msg);
  }
}

function sendHello(ws: WebSocket, playId: string, runtime: PlayRuntime): void {
  ws.send(JSON.stringify(helloPayload(playId, runtime)));
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
    case "tts_control":
      orchestrator.setTtsState({ enabled: msg.enabled, paused: msg.paused });
      return;
    // —— 工坊（D9）：与演出同一连接、不同通道；工坊对话不阻塞演出 ——
    case "workshop_open":
      await runtime.workshop.snapshot();
      return;
    case "workshop_activate":
      await runtime.workshop.activate(msg.threadId);
      return;
    case "workshop_chat":
      await runtime.workshop.chat(msg.text, msg.threadId);
      return;
    case "workshop_archive":
      await runtime.workshop.setArchived(msg.threadId, msg.archived);
      return;
    case "workshop_delete":
      await runtime.workshop.remove(msg.threadId);
      return;
    default:
      sender({ type: "error", message: `暂不支持的操作: ${(msg as { type: string }).type}`, recoverable: true });
  }
}
