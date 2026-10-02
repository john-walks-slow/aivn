import { Fragment, useEffect, useRef, useState } from "react";
import type { ClientMessage, WorkshopAssetView } from "@stage-ai/core";
import { api } from "../api.js";
import type { WorkshopInbound } from "../stage/useStageSocket.js";
import { Icon, type IconName } from "../ui/Icon.js";
import { ImageLightbox, type LightboxImage } from "../ui/ImageLightbox.js";
import type { WorkshopTab } from "../stage/view.js";
import { AgentPane } from "./AgentPane.js";
import { CharacterPane } from "./CharacterPane.js";
import { AssetsPanel } from "./AssetsPanel.js";
import { FileBrowser } from "./FileBrowser.js";
import { SettingsPane } from "./SettingsPane.js";
import { WorkshopMarkdown } from "./WorkshopMarkdown.js";
import { WorkshopSettings } from "./WorkshopSettings.js";
import { useWorkshop } from "./useWorkshop.js";

const TABS: { id: WorkshopTab; label: string; icon: IconName }[] = [
  { id: "chat", label: "对话", icon: "chat" },
  { id: "characters", label: "角色", icon: "users" },
  { id: "memory", label: "设定与记忆", icon: "memory" },
  { id: "assets", label: "素材", icon: "assets" },
  { id: "files", label: "文件", icon: "files" },
  { id: "agent", label: "Agent", icon: "sparkles" },
  { id: "settings", label: "设置", icon: "settings" },
];

/**
 * 工坊：搭台的地方（改设定、补素材、翻文件、调记忆、调 agent、设置）。D9 的 meta-chat 多会话。
 *
 * 它是舞台外壳的**第四个视图**，不是盖在舞台上的浮层，也不是自带顶栏的独立页：
 * 顶栏与侧栏跟舞台完全一致，从标题页直达工坊时也不会整个换掉（见 stage/view.ts 的入口约定）。
 * 顶栏（视图名 + 回到舞台）归外壳，这里只管自己这一行页签与内容。
 *
 * 会话（旧称「线程」）是**对话页内部的一层**，不占导航位：一条会话头 + 点开的列表。
 * 顶栏里放会话名的话，导航栏就得跟着对话进度改字改宽——那正是要收拾的毛病。
 */
export function WorkshopPane({
  playId,
  tab,
  onTab,
  subscribe,
  send,
  connected,
  voice,
  continueCard,
}: {
  playId: string;
  tab: WorkshopTab;
  onTab: (tab: WorkshopTab) => void;
  /** 注册工坊下行消息回调（返回取消订阅）。 */
  subscribe: (handler: (msg: WorkshopInbound) => void) => () => void;
  send: (msg: ClientMessage) => void;
  /** WS 连通性：断线要解锁本轮、重连要重新报到。 */
  connected?: boolean;
  voice: { on: boolean; available: boolean; onToggle: () => void };
  continueCard: { on: boolean; onToggle: () => void };
}) {
  const workshop = useWorkshop(send);
  const { state } = workshop;
  const [input, setInput] = useState("");
  const [threadsOpen, setThreadsOpen] = useState(false);
  const [lightbox, setLightbox] = useState<{ images: LightboxImage[]; index: number } | null>(null);
  /** 压缩摘要是否展开（默认折叠成一行一句话）。 */
  const [digestOpen, setDigestOpen] = useState(false);
  const scrollRef = useRef<HTMLDivElement | null>(null);

  // 面板一挂上就先订阅再报到（StrictMode 下会走两遍，报到幂等）
  useEffect(() => subscribe(workshop.onMessage), [subscribe, workshop.onMessage]);

  // 断线：busy 只由 done/error 复位，不解锁就永久卡在「思考中…」。
  // 依赖里带 busy——断线期间点发送也会走到这里（send 静默丢弃，但状态已乐观置 busy）。
  useEffect(() => {
    if (connected === false && state.busy) workshop.onDisconnected();
  }, [connected, state.busy, workshop.onDisconnected]);

  // 连上（含断线重连）就重新报到，服务端会重发会话与历史，本轮结果也就回来了
  useEffect(() => {
    if (connected) workshop.open();
  }, [connected, workshop.open]);

  // 换会话就收起摘要：上一个会话展开着看过全文，下一个不该继承这个姿态
  useEffect(() => {
    setDigestOpen(false);
  }, [state.activeId]);

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
    setThreadsOpen(false);
  };

  const openImage = (images: WorkshopAssetView[], index: number): void =>
    setLightbox({ images: images.map((a) => ({ url: a.url, caption: a.path })), index });

  const activeThread = state.threads.find((t) => t.id === state.activeId);
  // 一个会话都没有时，切换器没得切，不渲染——否则它会和右边的「新会话」并排成两个同名按钮。
  // 新会话还没发出第一句时，切换器写「未命名会话」，让右边那个「新会话」只有一个同名出口。
  const hasThreads = state.threads.length > 0;
  const threadName = workshop.freshThread ? "未命名会话" : (activeThread?.title ?? "未命名会话");

  return (
    <div className="workshop-pane">
      <nav className="workshop-tabs" role="tablist">
        {TABS.map((item) => (
          <button
            key={item.id}
            role="tab"
            aria-selected={tab === item.id}
            className={`workshop-tab${tab === item.id ? " active" : ""}`}
            onClick={() => onTab(item.id)}
          >
            <Icon name={item.icon} size={14} />
            {item.label}
          </button>
        ))}
      </nav>

      {state.error && (
        <div className="error-banner small" role="alert">
          {state.error}
        </div>
      )}

      {tab === "files" && (
        <FileBrowser playId={playId} revision={state.writes.length} onSaved={() => undefined} />
      )}

      {tab === "assets" && <AssetsPanel playId={playId} />}

      {tab === "memory" && <SettingsPane playId={playId} revision={state.writes.length} />}

      {tab === "characters" && <CharacterPane playId={playId} revision={state.writes.length} />}

      {tab === "agent" && <AgentPane playId={playId} />}

      {tab === "settings" && (
        <WorkshopSettings voice={voice} continueCard={continueCard} />
      )}

      {tab === "chat" && (
        <>
          {/* 会话层：对话页的子结构。收起时只占一条，选中即收起。 */}
          <div className="thread-bar">
            {hasThreads && (
              <button
                type="button"
                className="thread-toggle"
                onClick={() => setThreadsOpen((v) => !v)}
                aria-expanded={threadsOpen}
                title="切换会话"
              >
                <Icon name="backlog" size={14} />
                <span className="thread-current">{threadName}</span>
                <Icon name={threadsOpen ? "up" : "down"} size={14} />
              </button>
            )}
            <button
              type="button"
              className="ghost-btn small-btn thread-new"
              onClick={() => {
                // 先清空再标记：否则旧消息会挂在「新会话」标题下，直到第一条消息送达才被 history 换掉
                workshop.clearState();
                workshop.newThread();
                setInput("");
                setThreadsOpen(false);
              }}
              title="开一个新会话（下一条消息算它的第一句）"
            >
              <span className="btn-icon">
                <Icon name="plus" size={13} /> 新会话
              </span>
            </button>
          </div>

          {threadsOpen && (
            <div className="thread-list">
              {state.threads.length === 0 && <p className="muted small">还没有会话。</p>}
              {state.threads.map((thread) => (
                <div
                  key={thread.id}
                  className={`thread-row${thread.id === state.activeId ? " active" : ""}`}
                >
                  <button
                    className="thread-name"
                    onClick={() => {
                      workshop.activate(thread.id);
                      setThreadsOpen(false);
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
                      if (window.confirm(`删除会话「${thread.title}」？`)) workshop.remove(thread.id);
                    }}
                    title="删除"
                  >
                    <Icon name="close" size={13} />
                  </button>
                </div>
              ))}
            </div>
          )}

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
              <Fragment key={`${msg.at}-${i}`}>
                {i === state.compaction?.cutAt && (
                  <>
                    <div className="chat-divider">
                      <button className="ghost-btn tiny-btn" onClick={() => setDigestOpen(!digestOpen)}>
                        早期 {state.compaction!.cutAt} 条对话已压缩
                      </button>
                      {!digestOpen && <span>{state.compaction!.oneLiner}</span>}
                    </div>
                    {digestOpen && (
                      <div className="chat-digest">
                        <WorkshopMarkdown
                          text={state.compaction!.body}
                          onOpen={(images, index) => setLightbox({ images, index })}
                        />
                      </div>
                    )}
                  </>
                )}
                <div className={`chat-bubble chat-${msg.role}`}>
                  <WorkshopMarkdown
                    text={msg.text}
                    onOpen={(images, index) => setLightbox({ images, index })}
                  />
                  {msg.images && msg.images.length > 0 && (
                    <AssetStrip assets={msg.images} onOpen={openImage} />
                  )}
                </div>
              </Fragment>
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
            {state.busy && !state.streaming && !state.activity && (
              <div className="chat-activity">思考中…</div>
            )}
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
                <Icon name="memory" size={13} /> {write.path}
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
    </div>
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