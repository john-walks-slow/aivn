import { useCallback, useRef, useState } from "react";
import type {
  ClientMessage,
  WorkshopAssetView,
  WorkshopChatMessage,
  WorkshopThreadInfo,
} from "@stage-ai/core";
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
  /** 正在流式输出的文本（尚未落进 messages）。 */
  streaming: string;
  /** 工坊 agent 当前在做什么（工具名）。 */
  activity: string | null;
  /** 本会话内的写盘记录（面板关闭即清空）。 */
  writes: WorkshopWriteRecord[];
  /**
   * 本轮已出图但本轮话还没收束的素材：实时出现在流式区旁边，
   * 收束时随末条消息一起进 messages（不留在半截气泡里）。
   */
  pendingAssets: WorkshopAssetView[];
  busy: boolean;
  error: string | null;
}

const EMPTY: WorkshopState = {
  threads: [],
  activeId: null,
  messages: [],
  streaming: "",
  activity: null,
  writes: [],
  pendingAssets: [],
  busy: false,
  error: null,
};

const TOOL_LABEL: Record<string, string> = {
  list_files: "查看文件清单",
  read_file: "读取文件",
  write_file: "写入文件",
  delete_file: "删除文件",
  get_readiness: "检查就绪条件",
  generate_image: "出图中（几十秒，别急着发下一条）",
  list_library: "查素材资源库",
  import_asset: "从资源库导入素材",
  inspect_asset: "看图",
  read_skill: "读出图技能",
  list_saves: "查看周目",
  read_lineage: "读故事树",
  web_search: "联网检索中",
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
            streaming: "",
            activity: null,
            pendingAssets: [],
          };
        case "workshop_chunk":
          return { ...prev, streaming: prev.streaming + msg.delta, busy: true, error: null };
        case "workshop_tool":
          return { ...prev, activity: TOOL_LABEL[msg.name] ?? msg.name, busy: true };
        case "workshop_write":
          return {
            ...prev,
            writes: [...prev.writes, { path: msg.path, before: msg.before, at: Date.now() }],
          };
        case "workshop_asset":
          return {
            ...prev,
            pendingAssets: [...prev.pendingAssets, { kind: msg.kind, path: msg.path, url: msg.url }],
            busy: true,
          };
        case "workshop_done":
          return {
            ...prev,
            messages: [
              ...prev.messages,
              { role: "assistant", text: msg.text, at: Date.now(), images: msg.images },
            ],
            streaming: "",
            activity: null,
            pendingAssets: [],
            busy: false,
          };
        case "workshop_error":
          // 本轮出过的图不能跟着错误一起消失——发出去的是真金白银，且已落盘
          return {
            ...prev,
            error: msg.message,
            busy: false,
            activity: null,
            streaming: "",
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
        ? { ...prev, busy: false, streaming: "", activity: null, error: "连接断开了，正在重连…" }
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
    activate,
    setArchived,
    remove,
    dismissWrite,
  };
}
