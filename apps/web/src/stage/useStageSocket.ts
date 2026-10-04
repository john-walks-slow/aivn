import { useCallback, useEffect, useRef, useState } from "react";
import type {
  ClientMessage,
  GeneratedAsset,
  PendingJob,
  PromptQueueItem,
  ReadPos,
  ServerMessage,
  StopPayload,
} from "@aivn/core";

/** 工坊通道下行消息：与演出事件共用连接、按 type 分流（工坊是舞台外壳的一个视图）。 */
export type WorkshopInbound = Extract<ServerMessage, { type: `workshop_${string}` }>;

import { ScriptBuilder, type ScriptLine, type Cue } from "./script.js";
import { helloSync } from "./helloSync.js";

export type BeatState = "connecting" | "streaming" | "stopped" | "error";

export interface StageSocket {
  state: BeatState;
  /** WS 连通性：断线时为 false（节拍状态里的 "connecting" 兼作断线态，分不出首次连接与闪断）。 */
  connected: boolean;
  /** 编排器已空闲：beat_end 之后还要等它收尾，此前任何操作都会被服务端挡回。 */
  settled: boolean;
  /** 空树（还没开演过）：舞台摆「开演」按钮，不自己开局。 */
  fresh: boolean;
  error: string | null;
  /** lines/cues 版本号：每次事件批次自增（两者是稳定引用，原地变更）。 */
  revision: number;
  lines: readonly ScriptLine[];
  cues: readonly Cue[];
  scene: string;
  names: Readonly<Record<string, string>>;
  stop: StopPayload | null;
  isNoStop: boolean;
  /** 事件缓冲代号（P6）：结构性操作后整段重放，播放层据此强制复位。 */
  epoch: number;
  /** 服务端 TTS 能力（hello.voice；false 时隐藏语音开关）。 */
  voiceAvailable: boolean;
  /**
   * 骨架占位的兜底上界（毫秒，hello.assetsTtlMs）：一次预发射真正可能花多久。
   * null = 服务端没给（旧协议），播放层回落到保守默认值。
   */
  assetsTtlMs: number | null;
  /** 当前周目档名（舞台顶部显示；换档经 hello 续接）。 */
  saveName: string | null;
  /** 上次退出时读到的位置（hello.readPos）：首屏据此 seek，而不是快进到本轮末尾。 */
  readPos: ReadPos | null;
  /** 插一句的待注入队列（右上角面板）：空闲时立刻落笔，演出中先排队等这一轮收束。 */
  queue: readonly PromptQueueItem[];
  /** 正在生成的事（同一块面板的上半截）：剧作家的轮次、生图、语音合成。 */
  pendingJobs: readonly PendingJob[];
  /** 此刻是否处在限制级（NSFW）剧情通道（hello.nsfw + `nsfw` 消息）：舞台那枚常驻标识。 */
  nsfw: boolean;
  sendChoice: (index: number) => void;
  sendFree: (text: string) => void;
  sendContinue: () => void;
  /** 开演空树的第一轮。 */
  sendStart: () => void;
  sendPrompt: (text: string) => void;
  /** 排队面板：改一句 / 撤一句（都已注入的不认，服务端回 error）。 */
  sendPromptEdit: (id: string, text: string) => void;
  sendPromptDelete: (id: string) => void;
  /** 手动清掉一条失败项（失败项不自动消失，面板上的删除键走这里）。 */
  sendPendingDismiss: (jobId: string) => void;
  sendTtsControl: (state: { enabled?: boolean; paused?: boolean }) => void;
  /** 上报阅读位置（播放头推进时防抖调用）：服务端节流落盘，刷新后回到原处。 */
  sendRead: (pos: ReadPos) => void;
  // Director ops: jump moves the world line, fork opens a branch, delete prunes one
  sendJump: (nodeId: string, opts?: { playFrom?: "start" | "end" }) => void;
  /** 分岔锚点二选一：nodeId（路线/回顾给的节点）或 seq（舞台正在看的那一行）。
   *  `replaced` = 被这次重写顶掉的那一拍的首节点（路线卡片点名），新 fork 标记继承它的来源标签。
   *  `instruction` = 随这一岔交代的一句，它是新枝这一轮的第一条输入（不是排进队列等下一轮）。 */
  sendFork: (
    anchor: string | number,
    opts?: { resume?: boolean; replaced?: string; instruction?: string },
  ) => void;
  /** 删除：剪掉该节点及其全部后代。 */
  sendDelete: (nodeId: string) => void;
  sendEdit: (nodeId: string, newText: string) => void;
  /** 工坊通道发送（面板自带消息构造）。 */
  send: (msg: ClientMessage) => void;
}

/** 语音/重置事件外发钩子（StageScreen 绑定 VoiceDirector）。 */
export interface StageSocketHandlers {
  onAudio?: (ready: { seq: number; phrase: number; url: string }) => void;
  /** 某个短语已进入合成：喇叭立刻亮起来，音频到位前不再像「这句没配音」。 */
  onAudioPending?: (pending: { seq: number; phrase: number }) => void;
  onBeatStart?: () => void;
  onReset?: () => void;
  /** 工坊通道下行消息：工坊复用工坊所在那条连接，不再单开一条。 */
  onWorkshop?: (msg: WorkshopInbound) => void;
  /** hello 带回来的既有生成资产全集（重连即恢复可见）。 */
  onAssets?: (assets: GeneratedAsset[]) => void;
  /** 结构性操作完成（P6 rebase）：缓冲已整段重放，播放层须复位后快进到新分支末尾。 */
  onRebase?: (info: {
    epoch: number;
    note?: string;
    playFrom?: "start" | "end";
    resumeAt?: ReadPos;
    busy: boolean;
    /** 这次重建不要切回舞台（删除是「在路线里整理分支」的动作）。 */
    keepView?: boolean;
  }) => void;
  /** 生图就绪（D6）：预解码后就地淡入。 */
  onAssetReady?: (asset: GeneratedAsset) => void;
  /** 生图失败：保持降级视觉 + 提示，不弹永久骨架。 */
  onAssetFailed?: (id: string, message: string) => void;
  /** 一行台词被原地改写：谱系视图跟着换新文本（缓冲由 socket 自己就地替换）。 */
  onLineEdited?: (nodeId: string, text: string) => void;
  /** 一张插图挂上了某一行（回看中生图的旁注）：谱系重拉，翻到那一行就有图。 */
  onCgAttached?: (nodeId: string, id: string) => void;
  /** 手动生图完成/失败通知（工坊对话框监听）。 */
  onImageResult?: (
    result:
      | { target: string; ok: true; url: string; path: string }
      | { target: string; ok: false; message: string },
  ) => void;
}

export function useStageSocket(
  playId: string,
  handlers?: StageSocketHandlers,
  opts?: { workshopOnly?: boolean },
): StageSocket {
  const [state, setState] = useState<BeatState>("connecting");
  const stateRef = useRef<BeatState>("connecting");
  stateRef.current = state;
  const [error, setError] = useState<string | null>(null);
  /** WS 连通性：节拍状态里的 "connecting" 兼作断线态，分不出首次连接与闪断，工坊要的是这个。 */
  const [connected, setConnected] = useState(false);
  const [stop, setStop] = useState<StopPayload | null>(null);
  const [isNoStop, setNoStop] = useState(false);
  const [names, setNames] = useState<Record<string, string>>({});
  const [voiceAvailable, setVoiceAvailable] = useState(false);
  const [assetsTtlMs, setAssetsTtlMs] = useState<number | null>(null);
  const [epoch, setEpoch] = useState(0);
  const [saveName, setSaveName] = useState<string | null>(null);
  const [readPos, setReadPos] = useState<ReadPos | null>(null);
  const [queue, setQueue] = useState<readonly PromptQueueItem[]>([]);
  const [pendingJobs, setPendingJobs] = useState<readonly PendingJob[]>([]);
  const [nsfw, setNsfw] = useState(false);
  /** 本地缓冲所属代号：与服务端不一致说明缓冲已被结构性操作整段替换。 */
  const epochRef = useRef(0);
  /** 本连接是否已经收到过 hello：首屏那次不算「换了树/换代」（见 helloSync）。 */
  const seenHelloRef = useRef(false);
  const [tick, setTick] = useState(0); // lines/cues/scene 由 builder 持有，tick 触发重渲染
  // 轮已收束 ≠ 可操作：模型那一轮收尾期间服务端仍 engaged，beat_settled 之后按钮才解禁
  const [settled, setSettled] = useState(false);
  /** 空树：舞台摆「开演」按钮，等玩家按，不自己开局。 */
  const [fresh, setFresh] = useState(false);
  const builderRef = useRef(new ScriptBuilder());
  const lastSeqRef = useRef(0);
  const wsRef = useRef<WebSocket | null>(null);
  const retryRef = useRef(0);
  /** 当前挂着的存档（周目）：换档 = 换了一棵树，本地缓冲整段作废。 */
  const saveIdRef = useRef<string | null>(null);
  const handlersRef = useRef<StageSocketHandlers>({});
  handlersRef.current = handlers ?? {};

  useEffect(() => {
    let closed = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    // workshopOnly：从标题页直达工坊时用。服务端据此跳过 autostart 也不建周目——
    // 逛工坊不该把演出开起来，更不该凭空多出「第 1 周目」。
    const url = `${location.protocol === "https:" ? "wss" : "ws"}://${location.host}/ws?play=${encodeURIComponent(playId)}${
      opts?.workshopOnly ? "&workshop=1" : ""
    }`;

    const connect = (): void => {
      const ws = new WebSocket(url);
      wsRef.current = ws;

      ws.onopen = () => {
        retryRef.current = 0;
        setConnected(true);
        // 总是 resume：lastSeq=0（页面刷新/内存丢失）= 全量重放；网络闪断 = 增量补发
        ws.send(JSON.stringify({ type: "resume", lastSeq: lastSeqRef.current } satisfies ClientMessage));
      };
      ws.onmessage = (raw) => {
        const msg = JSON.parse(String(raw.data)) as ServerMessage;
        switch (msg.type) {
          case "hello":
            setFresh(msg.fresh ?? false);
            setNames(Object.fromEntries((msg.cast ?? []).map(({ id, name }) => [id, name])));
            setVoiceAvailable(msg.voice ?? false);
            if (msg.assetsTtlMs !== undefined) setAssetsTtlMs(msg.assetsTtlMs);
            if (msg.pendingJobs) setPendingJobs(msg.pendingJobs);
            // 限制级通道：重连即恢复，之后由 `nsfw` 消息翻转
            setNsfw(msg.nsfw ?? false);
            if (msg.assets) handlersRef.current.onAssets?.(msg.assets);
            // 换了周目 = 换了一棵树：本地缓冲与新树无关，作废重放
            const sync = helloSync({
              seen: seenHelloRef.current,
              saveId: saveIdRef.current,
              helloSaveId: msg.saveId,
              epoch: epochRef.current,
              helloEpoch: msg.epoch,
            });
            seenHelloRef.current = true;
            const switched = sync.switched;
            if (msg.saveId !== undefined) {
              saveIdRef.current = msg.saveId;
              // 空 saveId = 这棵剧目还没有周目（runtime 落在无会话作用域上）；空档名不显示成芯片
              setSaveName(msg.saveName || msg.saveId || null);
            }
            if (sync.adoptedEpoch !== undefined) epochRef.current = sync.adoptedEpoch;
            const restamped = sync.restamped;
            if ((restamped || switched) && lastSeqRef.current > 0) {
              if (restamped) setEpoch(sync.adoptedEpoch!);
              lastSeqRef.current = 0;
              builderRef.current.reset();
              handlersRef.current.onReset?.();
              setTick((t) => t + 1);
              ws.send(JSON.stringify({ type: "resume", lastSeq: 0 } satisfies ClientMessage));
            }
            // 阅读位置跟着分支走：缓冲整段换过之后，上次的 seq 属于另一条世界线，不能拿来 seek
            setReadPos(restamped || switched ? null : (msg.readPos ?? null));
            // hello 自报空闲（刷新进来的空闲现场）：直接落 stopped，不必等 beat_settled。
            // 注意不能先无条件把 connecting 提升为 streaming——stateRef 在渲染期赋值，
            // 同一次同步回调里读到的仍是旧值，那个判断永远不会成立，页面会卡死在 streaming。
            if (msg.idle) {
              setSettled(true);
              setState("stopped");
            } else {
              setState((prev) => (prev === "connecting" ? "streaming" : prev));
            }
            return;
          case "beat_start":
            setSettled(false);
            setStop(null);
            setNoStop(false);
            setError(null);
            // 一轮开跑 = 这棵树不再是空树。fresh 只在 hello 里下发，而「开演」按下后
            // 服务端不会再补一条 hello——不在这儿清掉，「开演」卡片就一直摆在画面上，
            // 对话区也一直停在「还没开演」而不报落笔。
            setFresh(false);
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
          case "audio_pending":
            handlersRef.current.onAudioPending?.({ seq: msg.seq, phrase: msg.phrase });
            return;
          case "beat_settled":
            setSettled(true);
            return;
          case "beat_end":
            setStop(msg.stop ?? null);
            setNoStop(msg.reason === "no_stop");
            setState("stopped");
            return;
          case "prompt_queue":
            setQueue(msg.items);
            return;
          case "pending_jobs":
            setPendingJobs(msg.jobs);
            return;
          case "nsfw":
            setNsfw(msg.active);
            return;
          case "line_edited":
            // 原地改写就地替换那一行：谱系重拉要等下一次操作，这里先把画面改对
            if (msg.seq !== undefined) builderRef.current.replaceText(msg.seq, msg.text);
            setTick((t) => t + 1);
            handlersRef.current.onLineEdited?.(msg.nodeId, msg.text);
            return;
          case "cg_attached":
            handlersRef.current.onCgAttached?.(msg.nodeId, msg.id);
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
            setNoStop(msg.reason === "no_stop");
            // 「重演这一轮」的重建后面紧跟着一轮新内容：此刻按终局处理会让舞台摆出
            // 可点击播放的界面，而新的一轮一秒后才到——先摆等待态
            const streaming = msg.resuming === true || (msg.reason !== "no_stop" && !msg.stop);
            setState(streaming ? "streaming" : "stopped");
            setSettled(!streaming);
            setError(null);
            setTick((t) => t + 1);
            handlersRef.current.onRebase?.({
              epoch: msg.epoch,
              ...(msg.note ? { note: msg.note } : {}),
              ...(msg.playFrom ? { playFrom: msg.playFrom } : {}),
              ...(msg.resumeAt ? { resumeAt: msg.resumeAt } : {}),
              // 停在新分支的停止点 = 等玩家继续；停在轮中 = 接下来还会有事件流
              busy: streaming,
              ...(msg.keepView ? { keepView: true } : {}),
            });
            return;
          }
          case "error":
            setError(msg.message);
            return;
          case "image_result":
            handlersRef.current.onImageResult?.(msg);
            return;
          default:
            // 工坊通道（workshop_*）：与演出状态机无关，整包外发
            if (msg.type.startsWith("workshop_")) handlersRef.current.onWorkshop?.(msg as WorkshopInbound);
            return;
        }
      };
      ws.onclose = () => {
        if (closed) return;
        setConnected(false);
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
  }, [playId, opts?.workshopOnly]);

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
  const sendStart = useCallback(() => send({ type: "start" }), [send]);
  const sendPrompt = useCallback((text: string) => send({ type: "prompt", text }), [send]);
  const sendPromptEdit = useCallback(
    (id: string, text: string) => send({ type: "prompt_edit", id, text }),
    [send],
  );
  const sendPromptDelete = useCallback((id: string) => send({ type: "prompt_delete", id }), [send]);
  const sendPendingDismiss = useCallback(
    (jobId: string) => send({ type: "pending_dismiss", jobId }),
    [send],
  );
  const sendJump = useCallback(
    (nodeId: string, opts?: { playFrom?: "start" | "end" }) =>
      send({ type: "jump", nodeId, ...(opts?.playFrom ? { playFrom: opts.playFrom } : {}) }),
    [send],
  );
  const sendFork = useCallback(
    (anchor: string | number, opts?: { resume?: boolean; replaced?: string; instruction?: string }) =>
      send(
        typeof anchor === "number"
          ? {
              type: "fork",
              seq: anchor,
              ...(opts?.resume ? { resume: true } : {}),
              ...(opts?.instruction ? { instruction: opts.instruction } : {}),
            }
          : {
              type: "fork",
              nodeId: anchor,
              ...(opts?.resume ? { resume: true } : {}),
              ...(opts?.replaced ? { replaced: opts.replaced } : {}),
              ...(opts?.instruction ? { instruction: opts.instruction } : {}),
            },
      ),
    [send],
  );
  const sendDelete = useCallback((nodeId: string) => send({ type: "delete_branch", nodeId }), [send]);
  const sendEdit = useCallback(
    (nodeId: string, newText: string) => send({ type: "edit", nodeId, newText }),
    [send],
  );
  const sendRead = useCallback(
    (pos: ReadPos) =>
      send({
        type: "read",
        nodeId: pos.nodeId,
        offset: pos.offset,
        ...(pos.seq !== undefined ? { seq: pos.seq } : {}),
        ...(pos.len !== undefined ? { len: pos.len } : {}),
      }),
    [send],
  );

  void tick;

  return {
    state,
    connected,
    settled,
    fresh,
    error,
    /** lines/cues 为原地变更的稳定引用，下游 effect 以 revision 驱动。 */
    revision: tick,
    lines: builderRef.current.lines,
    cues: builderRef.current.cues,
    scene: builderRef.current.scene,
    names,
    stop,
    isNoStop,
    epoch,
    voiceAvailable,
    assetsTtlMs,
    saveName,
    readPos,
    queue,
    pendingJobs,
    nsfw,
    sendChoice,
    sendFree,
    sendContinue,
    sendStart,
    sendPrompt,
    sendPromptEdit,
    sendPromptDelete,
    sendPendingDismiss,
    sendTtsControl: (ttsState) => send({ type: "tts_control", ...ttsState }),
    sendRead,
    sendJump,
    sendFork,
    sendDelete,
    sendEdit,
    send,
  };
}
