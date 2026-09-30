import { useCallback, useEffect, useRef, useState } from "react";
import type { ClientMessage, GeneratedAsset, ServerMessage, StopPayload } from "@stage-ai/core";

/** 工坊通道下行消息（D9）：与演出事件共用连接、按 type 分流。 */
export type WorkshopInbound = Extract<ServerMessage, { type: `workshop_${string}` }>;
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
  isActEnd: boolean;
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
  sendChoice: (index: number) => void;
  sendFree: (text: string) => void;
  sendContinue: () => void;
  sendOoc: (text: string) => void;
  sendTtsControl: (state: { enabled?: boolean; paused?: boolean }) => void;
  // —— 导演操作（P6）：跳转 / 分岔 / 编辑 / 导演注 OOC ——
  sendJump: (nodeId: string) => void;
  sendEdit: (nodeId: string, newText: string) => void;
  sendBranch: (nodeId: string, granularity: "line" | "beat", instruction?: string) => void;
  sendOocAt: (nodeId: string, text: string) => void;
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

export function useStageSocket(playId: string, handlers?: StageSocketHandlers): StageSocket {
  const [state, setState] = useState<BeatState>("connecting");
  const stateRef = useRef<BeatState>("connecting");
  stateRef.current = state;
  const [error, setError] = useState<string | null>(null);
  /** WS 连通性：节拍状态里的 "connecting" 兼作断线态，分不出首次连接与闪断，工坊要的是这个。 */
  const [connected, setConnected] = useState(false);
  const [stop, setStop] = useState<StopPayload | null>(null);
  const [isActEnd, setActEnd] = useState(false);
  const [names, setNames] = useState<Record<string, string>>({});
  const [voiceAvailable, setVoiceAvailable] = useState(false);
  const [assetsTtlMs, setAssetsTtlMs] = useState<number | null>(null);
  const [epoch, setEpoch] = useState(0);
  const [saveName, setSaveName] = useState<string | null>(null);
  /** 本地缓冲所属代号：与服务端不一致说明缓冲已被结构性操作整段替换。 */
  const epochRef = useRef(0);
  const [tick, setTick] = useState(0); // lines/cues/scene 由 builder 持有，tick 触发重渲染
  // 拍已收束 ≠ 可操作：模型那一轮收尾期间服务端仍 engaged，beat_settled 之后按钮才解禁
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
    const url = `${location.protocol === "https:" ? "wss" : "ws"}://${location.host}/ws?play=${encodeURIComponent(playId)}`;

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
          case "beat_settled":
            setSettled(true);
            return;
          case "beat_end":
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
            // 重放即一条静止的现状：没有新事件在流，操作条应当立刻可用
            setState("stopped");
            setSettled(true);
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
  }, [playId]);

  const send = useCallback((msg: ClientMessage): void => {
    const ws = wsRef.current;
    if (ws && ws.readyState === WebSocket.OPEN) {
      setError(null);
      ws.send(JSON.stringify(msg));
    }
  }, []);

  // 稳定引用：五动词出口挂在导演视图上，引用抖动会让整棵子树反复重渲染
  const sendChoice = useCallback((index: number) => send({ type: "player_choice", optionIndex: index }), [send]);
  const sendFree = useCallback((text: string) => send({ type: "player_free", text }), [send]);
  const sendContinue = useCallback(() => send({ type: "continue" }), [send]);
  const sendOoc = useCallback((text: string) => send({ type: "ooc", text }), [send]);
  const sendJump = useCallback((nodeId: string) => send({ type: "jump", nodeId }), [send]);
  const sendEdit = useCallback(
    (nodeId: string, newText: string) => send({ type: "edit", nodeId, newText }),
    [send],
  );
  const sendBranch = useCallback(
    (nodeId: string, granularity: "line" | "beat", instruction?: string) =>
      send({ type: "rewrite", nodeId, granularity, ...(instruction ? { instruction } : {}) }),
    [send],
  );
  const sendOocAt = useCallback(
    (nodeId: string, text: string) => send({ type: "ooc_at", nodeId, text }),
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
    isActEnd,
    epoch,
    voiceAvailable,
    assetsTtlMs,
    saveName,
    sendChoice,
    sendFree,
    sendContinue,
    sendOoc,
    sendTtsControl: (ttsState) => send({ type: "tts_control", ...ttsState }),
    sendJump,
    sendEdit,
    sendBranch,
    sendOocAt,
    send,
  };
}
