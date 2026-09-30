import { useEffect, useRef, useState } from "react";
import type { ClientMessage, WorkshopAssetView } from "@stage-ai/core";
import { api } from "../api.js";
import type { WorkshopInbound } from "./useWorkshopSocket.js";
import { Icon, type IconName } from "../ui/Icon.js";
import { ImageLightbox, type LightboxImage } from "../ui/ImageLightbox.js";
import { useEscape } from "../ui/escape.js";
import { AssetsPanel } from "./AssetsPanel.js";
import { CraftPanel } from "./CraftPanel.js";
import { FileBrowser } from "./FileBrowser.js";
import { WorkshopMarkdown } from "./WorkshopMarkdown.js";
import { useWorkshop } from "./useWorkshop.js";
import type { WorkshopMode, WorkshopTab } from "./useWorkshopOverlay.js";

const TABS: { id: WorkshopTab; label: string; icon: IconName }[] = [
  { id: "chat", label: "对话", icon: "chat" },
  { id: "assets", label: "素材", icon: "assets" },
  // 「配置」就是剧作家的创作口径（memory/always/craft.md），工坊对话改的是同一份
  { id: "craft", label: "配置", icon: "craft" },
  { id: "files", label: "文件", icon: "files" },
];

/**
 * 工坊面板（D9）：meta-chat 多会话 + 剧目素材/配置/文件。
 * 宿主是 app 级浮层（WorkshopOverlay），抽屉与全屏只是它的两种形态。
 * 与演出并行——工坊 agent 写盘只影响下一拍（服务端在拍边界重建 runtime）。
 */
export function WorkshopPanel({
  playId,
  mode,
  initialTab,
  onModeChange,
  onClose,
  subscribe,
  send,
  connected,
  socketError,
}: {
  playId: string;
  mode: WorkshopMode;
  /** 打开时落在哪个 tab（缺省对话）。 */
  initialTab?: WorkshopTab;
  onModeChange: (mode: WorkshopMode) => void;
  onClose: () => void;
  /** 注册工坊下行消息回调（返回取消订阅）。 */
  subscribe: (handler: (msg: WorkshopInbound) => void) => () => void;
  send: (msg: ClientMessage) => void;
  /** WS 连通性：断线要解锁本轮、重连要重新报到。省略则不做这件事（调用方自己管）。 */
  connected?: boolean;
  /** WS 自身的报错（连接由浮层宿主管，面板只管显示）。 */
  socketError?: string | null;
}) {
  const workshop = useWorkshop(send);
  const { state } = workshop;
  const [tab, setTab] = useState<WorkshopTab>(initialTab ?? "chat");
  const [input, setInput] = useState("");
  const [showThreads, setShowThreads] = useState(false);
  const [lightbox, setLightbox] = useState<{ images: LightboxImage[]; index: number } | null>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);

  // 浮层是模态的：Esc 归它，且只归最上面那一层（灯箱开着时先关灯箱）
  useEscape(onClose);

  // 面板一挂上就先订阅再报到（StrictMode 下会走两遍，报到幂等）
  useEffect(() => subscribe(workshop.onMessage), [subscribe, workshop.onMessage]);

  // 断线：busy 只由 done/error 复位，不解锁就永久卡在「思考中…」。
  // 依赖里带 busy——断线期间点发送也会走到这里（send 静默丢弃，但状态已乐观置 busy）。
  useEffect(() => {
    if (connected === false && state.busy) workshop.onDisconnected();
  }, [connected, state.busy, workshop.onDisconnected]);

  // 连上（含断线重连）就重新报到，服务端会重发线程与历史，本轮结果也就回来了
  useEffect(() => {
    if (connected) workshop.open();
  }, [connected, workshop.open]);

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
    <aside
      className={`workshop workshop-${mode}`}
      role="dialog"
      aria-modal="true"
      aria-label="工坊"
    >
      <header className="workshop-bar">
        <button className="ghost-btn icon-btn" onClick={() => setShowThreads((v) => !v)} title="线程列表">
          <Icon name="menu" />
        </button>
        <span className="workshop-title">{activeThread?.title ?? "新线程"}</span>
        <div className="workshop-bar-actions">
          <button
            className="ghost-btn small-btn icon-btn icon-btn-sm workshop-mode-btn"
            onClick={() => onModeChange(mode === "drawer" ? "full" : "drawer")}
            title={mode === "drawer" ? "铺满全屏" : "收成抽屉"}
          >
            <Icon name={mode === "drawer" ? "expand" : "collapse"} size={14} />
          </button>
          <button className="ghost-btn small-btn icon-btn icon-btn-sm" onClick={onClose} title="关闭">
            <Icon name="close" size={14} />
          </button>
        </div>
      </header>

      <nav className="workshop-tabs" role="tablist">
        {TABS.map((item) => (
          <button
            key={item.id}
            role="tab"
            aria-selected={tab === item.id}
            className={`workshop-tab${tab === item.id ? " active" : ""}`}
            onClick={() => setTab(item.id)}
          >
            <Icon name={item.icon} size={14} />
            {item.label}
          </button>
        ))}
      </nav>

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
            <span className="btn-icon">
              <Icon name="plus" size={13} /> 新线程
            </span>
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
                className="ghost-btn tiny-btn icon-btn icon-btn-xs"
                onClick={() => workshop.setArchived(thread.id, !thread.archived)}
                title={thread.archived ? "取消归档" : "归档"}
              >
                <Icon name={thread.archived ? "reply" : "download"} size={13} />
              </button>
              <button
                className="ghost-btn tiny-btn danger-btn icon-btn icon-btn-xs"
                onClick={() => {
                  if (window.confirm(`删除线程「${thread.title}」？`)) workshop.remove(thread.id);
                }}
                title="删除"
              >
                <Icon name="close" size={13} />
              </button>
            </div>
          ))}
          {state.threads.length === 0 && <p className="muted small">还没有工坊线程。</p>}
        </div>
      )}

      {(state.error || socketError) && (
        <div className="error-banner small" role="alert">
          {state.error ?? socketError}
        </div>
      )}

      {tab === "files" && (
        <FileBrowser playId={playId} revision={state.writes.length} onSaved={() => undefined} />
      )}

      {tab === "assets" && <AssetsPanel playId={playId} />}

      {tab === "craft" && <CraftPanel playId={playId} />}

      {tab === "chat" && (
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
                  <AssetStrip assets={msg.images} onOpen={openImage} />
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
                <AssetStrip assets={state.pendingAssets} onOpen={openImage} bare />
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
              <span className="file-path">
                <Icon name="craft" size={13} /> {write.path}
              </span>
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

/** 素材类别 → 灯箱只看图：bgm/sfx 在对话流里给播放器，不进灯箱。 */
const AUDIO_ASSET = new Set<WorkshopAssetView["kind"]>(["bgm", "sfx"]);

/**
 * 对话流里的素材条：图给缩略图（点开灯箱），音乐/音效给就地播放的播放器——
 * 导入音素材时用户要能当场听一句确认，摆在对话里最省事。
 */
function AssetStrip({
  assets,
  onOpen,
  bare,
}: {
  assets: WorkshopAssetView[];
  onOpen: (images: WorkshopAssetView[], index: number) => void;
  /** 外层已经带了 asset-strip（pending 态还要那个 .pending 修饰）时不再包一层。 */
  bare?: boolean;
}) {
  const pictures = assets.filter((a) => !AUDIO_ASSET.has(a.kind));
  const body = assets.map((asset, j) =>
    AUDIO_ASSET.has(asset.kind) ? (
      <audio
        key={`${asset.path}-${j}`}
        className="asset-audio"
        src={asset.url}
        controls
        preload="none"
        title={asset.path}
      />
    ) : (
      <button
        key={`${asset.path}-${j}`}
        className="asset-thumb"
        onClick={() => onOpen(pictures, pictures.indexOf(asset))}
        title={asset.path}
      >
        <img src={asset.url} alt={asset.path} loading="lazy" />
      </button>
    ),
  );
  return bare ? <>{body}</> : <div className="asset-strip">{body}</div>;
}
