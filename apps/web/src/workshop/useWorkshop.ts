import { useCallback, useRef, useState } from "react";
import { appendText, appendThinking, attachToolAssets, endTool, startTool } from "@aivn/core";
import type {
  ClientMessage,
  WorkshopAssetView,
  WorkshopChatMessage,
  WorkshopCompactionView,
  WorkshopPart,
  WorkshopThreadInfo,
} from "@aivn/core";
import type { WorkshopInbound } from "../stage/useStageSocket.js";

/** 工坊面板的一次写盘记录（可一键撤销）。 */
export interface WorkshopWriteRecord {
  path: string;
  /** 写盘前内容；null = 新建（撤销即删除）。 */
  before: string | null;
  at: number;
}

export interface WorkshopState {
  threads: WorkshopThreadInfo[];
  activeId: string | null;
  messages: WorkshopChatMessage[];
  /** 本线程已发生的压缩（未压缩为 null）：前 cutAt 条仍在 messages 里，只是不再进 agent 上下文。 */
  compaction: WorkshopCompactionView | null;
  /** 本轮流式中的段落（正文/思考/工具，拼装规则见 core 的 workshopParts）。done/error 一到整段替换。 */
  live: WorkshopPart[];
  /** 本会话内的写盘记录（面板关闭即清空）。 */
  writes: WorkshopWriteRecord[];
  /**
   * 本轮到货、**不带工具调用号**的素材（外部推来的那种）。
   * 工具产出的都带调用号，挂在对应那一行上，不进这里。
   */
  pendingAssets: WorkshopAssetView[];
  busy: boolean;
  error: string | null;
}

const EMPTY: WorkshopState = {
  threads: [],
  activeId: null,
  messages: [],
  compaction: null,
  live: [],
  writes: [],
  pendingAssets: [],
  busy: false,
  error: null,
};

/** 工坊状态机：把服务端 workshop_* 下行消息收敛成面板可直接渲染的形态。 */
export function useWorkshop(send: (msg: ClientMessage) => void) {
  const [state, setState] = useState<WorkshopState>(EMPTY);
  const activeRef = useRef<string | null>(null);
  /** 「新会话」待发：下一次 chat 不带 threadId，服务端据此新建一条（chat 消费掉它）。 */
  const [freshThread, setFreshThread] = useState(false);

  const onMessage = useCallback((msg: WorkshopInbound): void => {
    setState((prev) => {
      switch (msg.type) {
        case "workshop_threads":
          activeRef.current = msg.activeId;
          return { ...prev, threads: msg.threads, activeId: msg.activeId };
        case "workshop_history":
          activeRef.current = msg.threadId;
          // 服务端历史是权威：整段替换。但**不动 busy**——服务端在开跑前就发一次 history，
          // 那时还没出首字，提前解锁会让用户重发。
          return {
            ...prev,
            activeId: msg.threadId,
            messages: msg.messages,
            compaction: msg.compaction,
            live: [],
            pendingAssets: [],
          };
        case "workshop_chunk":
          return { ...prev, live: appendText(prev.live, msg.delta), busy: true, error: null };
        case "workshop_thinking":
          return { ...prev, live: appendThinking(prev.live, msg.delta), busy: true, error: null };
        case "workshop_tool_start":
          return {
            ...prev,
            live: startTool(prev.live, { id: msg.id, name: msg.name, args: msg.args }),
            busy: true,
            error: null,
          };
        case "workshop_tool_end":
          return {
            ...prev,
            live: endTool(prev.live, {
              id: msg.id,
              result: msg.result,
              isError: msg.isError,
              ms: msg.ms,
            }),
          };
        case "workshop_write":
          return {
            ...prev,
            writes: [...prev.writes, { path: msg.path, before: msg.before, at: Date.now() }],
          };
        case "workshop_asset": {
          const view: WorkshopAssetView = { kind: msg.kind, path: msg.path, url: msg.url };
          if (msg.toolCallId) {
            return { ...prev, live: attachToolAssets(prev.live, msg.toolCallId, [view]), busy: true };
          }
          return { ...prev, pendingAssets: [...prev.pendingAssets, view], busy: true };
        }
        case "workshop_done":
          return {
            ...prev,
            messages: [
              ...prev.messages,
              {
                role: "assistant",
                text: msg.text,
                at: Date.now(),
                parts: msg.parts,
                images: msg.images,
              },
            ],
            live: [],
            pendingAssets: [],
            busy: false,
          };
        case "workshop_error":
          // 本轮出过的图与跑到一半的段落不能跟着错误一起消失——图是真金白银，段落是刚发生的事。
          // 服务端随后补发的 history 会带上它们，live 只是那之前的过渡，不会重影。
          return {
            ...prev,
            error: msg.message,
            busy: false,
            live: msg.parts,
            pendingAssets: msg.images ?? [],
          };
        default:
          return prev;
      }
    });
  }, []);

  /** 报一次到：服务端回线程列表 + 当前线程历史。重复调用无害（幂等重放）。 */
  const open = useCallback((): void => {
    send({ type: "workshop_open" });
  }, [send]);

  /**
   * 连接断了：这一轮的结果永远送不回来（busy 只由 done/error 复位），
   * 不解锁的话界面会永久停在「思考中…」。半截输出直接丢掉——它没进 messages，
   * 重连后服务端会重发完整历史。
   */
  const onDisconnected = useCallback((): void => {
    setState((prev) =>
      prev.busy
        ? { ...prev, busy: false, live: [], error: "连接断开了，正在重连…" }
        : prev,
    );
  }, []);

  const chat = useCallback(
    (text: string): void => {
      const content = text.trim();
      if (content === "" || state.busy) return;
      // 乐观回显：服务端随后的 history 会整段替换掉它
      setState((prev) => ({
        ...prev,
        messages: [...prev.messages, { role: "user" as const, text: content, at: Date.now() }],
        busy: true,
        error: null,
      }));
      // 不带 threadId = 新开一条会话（服务端按首条消息取标题）
      send({
        type: "workshop_chat",
        threadId: freshThread ? undefined : (state.activeId ?? undefined),
        text: content,
      });
      setFreshThread(false);
    },
    [send, state.activeId, state.busy, freshThread],
  );

  /** 开新会话：不立刻建（服务端没有「空会话」这个动作），只把下一条消息标记成新会话的第一句。 */
  const newThread = useCallback((): void => setFreshThread(true), []);

  /** 清空聊天区（消息/流式/状态），保留线程列表与写盘撤销记录，避免切换新会话时整个会话层消失。 */
  const clearState = useCallback((): void => {
    setState((prev) => ({
      ...prev,
      messages: [],
      compaction: null,
      live: [],
      pendingAssets: [],
      busy: false,
      error: null,
    }));
  }, []);

  const activate = useCallback(
    (threadId: string): void => {
      setFreshThread(false);
      send({ type: "workshop_activate", threadId });
    },
    [send],
  );

  const setArchived = useCallback(
    (threadId: string, archived: boolean): void => {
      send({ type: "workshop_archive", threadId, archived });
    },
    [send],
  );

  const remove = useCallback(
    (threadId: string): void => {
      send({ type: "workshop_delete", threadId });
    },
    [send],
  );

  const dismissWrite = useCallback((at: number): void => {
    setState((prev) => ({ ...prev, writes: prev.writes.filter((w) => w.at !== at) }));
  }, []);

  return {
    state,
    freshThread,
    onMessage,
    open,
    onDisconnected,
    chat,
    newThread,
    clearState,
    activate,
    setArchived,
    remove,
    dismissWrite,
  };
}