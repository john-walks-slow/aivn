import type { WebSocket, WebSocketServer } from "ws";
import type { ClientMessage, ServerMessage } from "@stage-ai/core";
import { helloPayload, type PlayHouse, type PlayRuntime } from "./playhouse.js";

/**
 * WS 会话层（多剧目）：/ws?play=<id> 连接路由到剧目 runtime。
 * 新周目 = 建一棵空树，连接建立后 autostart 自己开轮，协议里没有「重开」消息；
 * resume 增量重放；其余玩家动作。
 * 客户端集合挂在 PlayHouse（与 runtime 生命周期解耦）；每次派发现查 runtime——
 * 切档 switchSave / 配置保存 reload 重建后，活连接自动路由到新实例，不断线。
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

/**
 * 每剧目的舞台连接数：语音合成的存活依据。
 * 工坊连接不计入——它不消费 audio_ready，把它算成观众会让「最后一个观众离场」永远判不出来。
 */
const stageConnections = new Map<string, number>();

function onConnection(ws: WebSocket, playhouse: PlayHouse, playId: string, stage: boolean): void {
  const sender = (msg: ServerMessage): void => {
    if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(msg));
  };
  let established = false;
  let dropped = false;
  let registered: Set<(msg: ServerMessage) => void> | null = null;
  const pending: ClientMessage[] = [];
  if (stage) stageConnections.set(playId, (stageConnections.get(playId) ?? 0) + 1);

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
    if (dropped) return;
    dropped = true;
    registered?.delete(sender);
    if (!stage) return;
    const left = (stageConnections.get(playId) ?? 1) - 1;
    if (left > 0) {
      stageConnections.set(playId, left);
      return;
    }
    stageConnections.delete(playId);
    // 最后一个观众离场：没人能消费 audio_ready 了，停合成（重连时客户端会重发 enabled 同步回来）。
    // 用 peek 不用 get：get 会懒加载，凭空把 runtime 拉回来常驻一份。
    playhouse.peek(playId)?.orchestrator.setTtsState({ enabled: false });
  };
  ws.on("close", drop);
  ws.on("error", drop);

  void (async () => {
    // 舞台连上 = 玩家要看戏，runtime 必须挂在真实的故事树上（没有就先建一棵）；
    // 工坊连接只是逛，不该凭空多出一个周目。
    const runtime = await (stage ? playhouse.stage(playId) : playhouse.get(playId));
    // runtime 就绪前就断开了：不注册，否则残留 sender 会让「最后一个观众」永远判不出来
    if (dropped) return;
    registered = playhouse.clientsFor(playId);
    registered.add(sender);
    sendHello(ws, playId, runtime);
    if (stage) runtime.orchestrator.autostart();
    established = true;
    for (const msg of pending.splice(0)) dispatchSafe(msg);
  })();

  async function dispatch(msg: ClientMessage): Promise<void> {
    // 每次现查：runtime 重建（配置保存 reload / 切档 switchSave）后自动路由到新实例
    const current = await (stage ? playhouse.stage(playId) : playhouse.get(playId));
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
    case "prompt":
      await orchestrator.playerAction({ kind: "prompt", text: msg.text });
      return;
    case "prompt_edit":
      orchestrator.editPending(msg.id, msg.text);
      return;
    case "prompt_delete":
      orchestrator.deletePending(msg.id);
      return;
    case "tts_control":
      orchestrator.setTtsState({ enabled: msg.enabled, paused: msg.paused });
      return;
    // —— 导演操作：跳转 / 分岔 / 编辑，彼此正交 ——
    //     jumpTo 只移挂载点、不生成任何内容；分岔落一条 fork 标记，其后内容整段转兄弟分支。
    //     resume=true 一次往返完成「重演这一轮」：分岔后立刻续演，中间不设停止点
    case "jump":
      await orchestrator.jumpTo(msg.nodeId);
      return;
    case "fork":
      await orchestrator.forkTo(msg.nodeId, { resume: msg.resume });
      return;
    case "edit":
      orchestrator.editLine(msg.nodeId, msg.newText);
      return;
    case "read":
      orchestrator.setReadPos({ seq: msg.seq, len: msg.len });
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
