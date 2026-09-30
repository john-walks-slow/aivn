import { useCallback, useEffect, useRef, useState } from "react";
import type {
  ClientMessage,
  GeneratedAsset,
  PromptQueueItem,
  ServerMessage,
  StopPayload,
} from "@stage-ai/core";

import { ScriptBuilder, type ScriptLine, type Cue } from "./script.js";

export type BeatState = "connecting" | "streaming" | "stopped" | "error";

export interface StageSocket {
  state: BeatState;
  /** WS 连通性：断线时为 false（节拍状态里的 "connecting" 兼作断线态，分不出首次连接与闪断）。 */
  connected: boolean;
  /** 编排器已空闲：beat_end 之后还要等它收尾，此前任何操作都会被服务端挡回。 */
  settled: boolean;
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
  /** 插一句的待注入队列（右上角面板）：空闲时立刻落笔，演出中先排队等这一轮收束。 */
  queue: readonly PromptQueueItem[];
  sendChoice: (index: number) => void;
  sendFree: (text: string) => void;
  sendContinue: () => void;
  sendPrompt: (text: string) => void;
  /** 排队面板：改一句 / 撤一句（都已注入的不认，服务端回 error）。 */
  sendPromptEdit: (id: string, text: string) => void;
  sendPromptDelete: (id: string) => void;
  sendTtsControl: (state: { enabled?: boolean; paused?: boolean }) => void;
  // Director ops: jump moves the world line, fork opens a branch
  sendJump: (nodeId: string) => void;
  sendFork: (nodeId: string, opts?: { resume?: boolean }) => void;
  sendEdit: (nodeId: string, newText: string) => void;
  /** 工坊通道发送（面板自带消息构造）。 */
  send: (msg: ClientMessage) => void;
}

/** 语音/重置事件外发钩子（StageScreen 绑定 VoiceDirector）。 */
export interface StageSocketHandlers {
  onAudio?: (ready: { seq: number; phrase: number; url: string }) => void;
  onBeatStart?: () => void;
  onReset?: () => void;
  /** hello 带回来的既有生成资产全集（重连即恢复可见）。 */
  onAssets?: (assets: GeneratedAsset[]) => void;
  /** 结构性操作完成（P6 rebase）：缓冲已整段重放，播放层须复位后快进到新分支末尾。 */
  onRebase?: (info: { epoch: number; note?: string; busy: boolean }) => void;
  /** 生图就绪（D6）：预解码后就地淡入。 */
  onAssetReady?: (asset: GeneratedAsset) => void;
  /** 生图失败：保持降级视觉 + 提示，不弹永久骨架。 */
  onAssetFailed?: (id: string, message: string) => void;
  /** 一行台词被原地改写：谱系视图跟着换新文本（缓冲由 socket 自己就地替换）。 */
  onLineEdited?: (nodeId: string, text: string) => void;
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
  const [queue, setQueue] = useState<readonly PromptQueueItem[]>([]);
  /** 本地缓冲所属代号：与服务端不一致说明缓冲已被结构性操作整段替换。 */
  const epochRef = useRef(0);
  const [tick, setTick] = useState(0); // lines/cues/scene 由 builder 持有，tick 触发重渲染
  // 轮已收束 ≠ 可操作：模型那一轮收尾期间服务端仍 engaged，beat_settled 之后按钮才解禁
  const [settled, setSettled] = useState(false);
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
            setNames(Object.fromEntries((msg.cast ?? []).map(({ id, name }) => [id, name])));
            setVoiceAvailable(msg.voice ?? false);
            if (msg.assetsTtlMs !== undefined) setAssetsTtlMs(msg.assetsTtlMs);
            if (msg.assets) handlersRef.current.onAssets?.(msg.assets);
            // 换了周目 = 换了一棵树：本地缓冲与新树无关，作废重放
            const switched = msg.saveId !== undefined && msg.saveId !== saveIdRef.current;
            if (msg.saveId !== undefined) {
              saveIdRef.current = msg.saveId;
              // 空 saveId = 这棵剧目还没有周目（runtime 落在无会话作用域上）；空档名不显示成芯片
              setSaveName(msg.saveName || msg.saveId || null);
            }
            // 代号不一致 = 缓冲已被结构性操作整段替换：本地 seq 全部作废，全量重放
            const restamped =
              msg.epoch !== undefined && msg.epoch !== epochRef.current && !switched;
            if (restamped) epochRef.current = msg.epoch!;
            if ((restamped || switched) && lastSeqRef.current > 0) {
              if (restamped) setEpoch(msg.epoch!);
              lastSeqRef.current = 0;
              builderRef.current.reset();
              handlersRef.current.onReset?.();
              setTick((t) => t + 1);
              ws.send(JSON.stringify({ type: "resume", lastSeq: 0 } satisfies ClientMessage));
            }
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
          case "line_edited":
            // 原地改写就地替换那一行：谱系重拉要等下一次操作，这里先把画面改对
            if (msg.seq !== undefined) builderRef.current.replaceText(msg.seq, msg.text);
            setTick((t) => t + 1);
            handlersRef.current.onLineEdited?.(msg.nodeId, msg.text);
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
              // 停在新分支的停止点 = 等玩家继续；停在轮中 = 接下来还会有事件流
              busy: streaming,
            });
            return;
          }
          case "error":
            setError(msg.message);
            return;
          default:
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
  const sendPrompt = useCallback((text: string) => send({ type: "prompt", text }), [send]);
  const sendPromptEdit = useCallback(
    (id: string, text: string) => send({ type: "prompt_edit", id, text }),
    [send],
  );
  const sendPromptDelete = useCallback((id: string) => send({ type: "prompt_delete", id }), [send]);
  const sendJump = useCallback((nodeId: string) => send({ type: "jump", nodeId }), [send]);
  const sendFork = useCallback(
    (nodeId: string, opts?: { resume?: boolean }) =>
      send({ type: "fork", nodeId, ...(opts?.resume ? { resume: true } : {}) }),
    [send],
  );
  const sendEdit = useCallback(
    (nodeId: string, newText: string) => send({ type: "edit", nodeId, newText }),
    [send],
  );

  void tick;

  return {
    state,
    connected,
    settled,
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
    queue,
    sendChoice,
    sendFree,
    sendContinue,
    sendPrompt,
    sendPromptEdit,
    sendPromptDelete,
    sendTtsControl: (ttsState) => send({ type: "tts_control", ...ttsState }),
    sendJump,
    sendFork,
    sendEdit,
    send,
  };
}
