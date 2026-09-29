import { useEffect, useRef, useState } from "react";
import type { ClientMessage, WorkshopAssetView } from "@stage-ai/core";
import { api } from "../api.js";
import type { WorkshopInbound } from "../stage/useStageSocket.js";
import { ImageLightbox, type LightboxImage } from "../ui/ImageLightbox.js";
import { FileBrowser } from "./FileBrowser.js";
import { WorkshopMarkdown } from "./WorkshopMarkdown.js";
import { useWorkshop } from "./useWorkshop.js";

/** 抽屉/全屏两种形态：抽屉从右侧滑入压在舞台上，全屏独占页面。 */
export type WorkshopMode = "drawer" | "full";

/**
 * 工坊面板（D9）：meta-chat 多会话 + 剧目文件浏览编辑。
 * 与演出并行——工坊 agent 写盘只影响下一拍（服务端在拍边界重建 runtime）。
 */
export function WorkshopPanel({
  playId,
  mode,
  onModeChange,
  onClose,
  subscribe,
  send,
}: {
  playId: string;
  mode: WorkshopMode;
  /** 省略则不显示抽屉/全屏切换（全屏独立页没有可切的另一半）。 */
  onModeChange?: (mode: WorkshopMode) => void;
  onClose: () => void;
  /** 注册工坊下行消息回调（返回取消订阅）。 */
  subscribe: (handler: (msg: WorkshopInbound) => void) => () => void;
  send: (msg: ClientMessage) => void;
}) {
  const workshop = useWorkshop(send);
  const { state } = workshop;
  const [tab, setTab] = useState<"chat" | "files">("chat");
  const [input, setInput] = useState("");
  const [showThreads, setShowThreads] = useState(false);
  const [lightbox, setLightbox] = useState<{ images: LightboxImage[]; index: number } | null>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);

  // 面板一挂上就先订阅再报到（StrictMode 下会走两遍，报到幂等）
  useEffect(() => {
    const off = subscribe(workshop.onMessage);
    workshop.open();
    return off;
  }, [subscribe, workshop.onMessage, workshop.open]);

  // 新消息/流式增量追随到底部
  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [state.messages.length, state.streaming, state.activity, state.pendingAssets.length]);

  const submit = (): void => {
    const text = input.trim();
    if (text === "") return;
    workshop.chat(text);
    setInput("");
  };

  const openImage = (images: WorkshopAssetView[], index: number): void =>
    setLightbox({ images: images.map((a) => ({ url: a.url, caption: a.path })), index });

  const activeThread = state.threads.find((t) => t.id === state.activeId);

  return (
    <aside className={`workshop workshop-${mode}`} aria-label="工坊">
      <header className="workshop-bar">
        <button className="ghost-btn" onClick={() => setShowThreads((v) => !v)} title="线程列表">
          ☰
        </button>
        <span className="workshop-title">{activeThread?.title ?? "新线程"}</span>
        <div className="workshop-bar-actions">
          <button className="ghost-btn small-btn" onClick={() => setTab(tab === "chat" ? "files" : "chat")}>
            {tab === "chat" ? "📁 文件" : "💬 对话"}
          </button>
          {onModeChange && (
            <button
              className="ghost-btn small-btn"
              onClick={() => onModeChange(mode === "drawer" ? "full" : "drawer")}
              title={mode === "drawer" ? "全屏" : "收成抽屉"}
            >
              {mode === "drawer" ? "⤢" : "⤡"}
            </button>
          )}
          <button className="ghost-btn small-btn" onClick={onClose} title="关闭">
            ✕
          </button>
        </div>
      </header>

      {showThreads && (
        <div className="workshop-threads">
          <button
            className="primary small-btn"
            onClick={() => {
              setTab("chat");
              setShowThreads(false);
              setInput("");
            }}
          >
            ＋ 新线程
          </button>
          {state.threads.map((thread) => (
            <div key={thread.id} className={`thread-row${thread.id === state.activeId ? " active" : ""}`}>
              <button
                className="thread-name"
                onClick={() => {
                  workshop.activate(thread.id);
                  setShowThreads(false);
                }}
              >
                {thread.archived && <span className="muted">[归档] </span>}
                {thread.title}
              </button>
              <button
                className="ghost-btn tiny-btn"
                onClick={() => workshop.setArchived(thread.id, !thread.archived)}
                title={thread.archived ? "取消归档" : "归档"}
              >
                {thread.archived ? "↩" : "📥"}
              </button>
              <button
                className="ghost-btn tiny-btn danger-btn"
                onClick={() => {
                  if (window.confirm(`删除线程「${thread.title}」？`)) workshop.remove(thread.id);
                }}
                title="删除"
              >
                ✕
              </button>
            </div>
          ))}
          {state.threads.length === 0 && <p className="muted small">还没有工坊线程。</p>}
        </div>
      )}

      {state.error && (
        <div className="error-banner small" role="alert">
          {state.error}
        </div>
      )}

      {tab === "files" ? (
        <FileBrowser
          playId={playId}
          revision={state.writes.length}
          onSaved={() => undefined}
        />
      ) : (
        <>
          <div className="workshop-chat" ref={scrollRef}>
            {state.messages.length === 0 && !state.streaming && (
              <div className="workshop-empty">
                <p>和工坊一起把这部剧搭起来。</p>
                <p className="muted small">
                  例如：「我想要一个赛博朋克侦探故事，主角是个记不住人脸的女高中生」
                </p>
              </div>
            )}
            {state.messages.map((msg, i) => (
              <div key={`${msg.at}-${i}`} className={`chat-bubble chat-${msg.role}`}>
                <WorkshopMarkdown
                  text={msg.text}
                  onOpen={(images, index) => setLightbox({ images, index })}
                />
                {msg.images && msg.images.length > 0 && (
                  <div className="asset-strip">
                    {msg.images.map((asset, j) => (
                      <button
                        key={`${asset.path}-${j}`}
                        className="asset-thumb"
                        onClick={() => openImage(msg.images ?? [], j)}
                        title={asset.path}
                      >
                        <img src={asset.url} alt={asset.path} loading="lazy" />
                      </button>
                    ))}
                  </div>
                )}
              </div>
            ))}
            {state.streaming && (
              <div className="chat-bubble chat-assistant">
                <WorkshopMarkdown
                  text={state.streaming}
                  onOpen={(images, index) => setLightbox({ images, index })}
                />
              </div>
            )}
            {/* 本轮出图即时可见：本轮话还没收束，图先摆在这儿，收束后并进上面那条消息 */}
            {state.pendingAssets.length > 0 && (
              <div className="asset-strip pending">
                {state.pendingAssets.map((asset, j) => (
                  <button
                    key={`${asset.path}-${j}`}
                    className="asset-thumb"
                    onClick={() => openImage(state.pendingAssets, j)}
                    title={asset.path}
                  >
                    <img src={asset.url} alt={asset.path} />
                  </button>
                ))}
              </div>
            )}
            {state.activity && <div className="chat-activity">{state.activity}…</div>}
            {state.busy && !state.streaming && !state.activity && <div className="chat-activity">思考中…</div>}
          </div>

          <footer className="workshop-input">
            <textarea
              value={input}
              placeholder="描述你想要的世界、角色或改动…（Enter 发送，Shift+Enter 换行）"
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                // 中文输入法敲 Enter 是「确认候选词」，不是发送
                if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
                  e.preventDefault();
                  submit();
                }
              }}
            />
            <button className="primary" disabled={state.busy || input.trim() === ""} onClick={submit}>
              发送
            </button>
          </footer>
        </>
      )}

      {state.writes.length > 0 && (
        <div className="workshop-writes">
          {state.writes.map((write) => (
            <div key={write.at} className="write-row">
              <span className="file-path">📝 {write.path}</span>
              <button
                className="ghost-btn tiny-btn"
                onClick={() => {
                  const restore = write.before ?? null;
                  const path = write.path;
                  void (async () => {
                    try {
                      if (restore === null) {
                        await api.deleteFile(playId, path);
                      } else {
                        await api.saveFile(playId, path, restore);
                      }
                      workshop.dismissWrite(write.at);
                    } catch {
                      // 撤销失败保留记录，用户可重试
                    }
                  })();
                }}
              >
                撤销
              </button>
              <button className="ghost-btn tiny-btn" onClick={() => workshop.dismissWrite(write.at)}>
                知道了
              </button>
            </div>
          ))}
        </div>
      )}

      {lightbox && (
        <ImageLightbox
          images={lightbox.images}
          index={lightbox.index}
          onIndex={(index) => setLightbox({ ...lightbox, index })}
          onClose={() => setLightbox(null)}
        />
      )}
    </aside>
  );
}
