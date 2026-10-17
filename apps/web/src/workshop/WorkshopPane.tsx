import {
  Fragment,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { attachMessageAssets, normalizeParts } from "@aivn/core";
import { Modal } from "@aivn/stage";
import { useLeaveGuard } from "./dirtyGuard.js";
import { useDismissible } from "../ui/useDismissible.js";
import type {
  ClientMessage,
  GeneratedAsset,
  WorkshopAssetView,
  WorkshopAttachment,
} from "@aivn/core";
import type { WorkshopInbound } from "../stage/useStageSocket.js";
import { Icon, type IconName, type WorkshopTab } from "@aivn/stage";
import { navigate } from "../router.jsx";
import { api } from "../api.js";
import { ImageLightbox, type LightboxImage } from "../ui/ImageLightbox.js";
import { AgentPane } from "./AgentPane.js";
import { AssetStrip } from "./AssetStrip.js";
import { CharacterPane } from "./CharacterPane.js";
import { AssetsPanel } from "./AssetsPanel.js";
import { FileBrowser } from "./FileBrowser.js";
import { MemoryPane } from "./MemoryPane.js";
import { PlayPane } from "./PlayPane.js";
import { pickStarters } from "./starters.js";
import { TurnParts } from "./TurnParts.js";
import { WorkshopMarkdown } from "./WorkshopMarkdown.js";
import { useWorkshop } from "./useWorkshop.js";

/** 离底部这么近就算「贴着底」：滚轮一格常常差几像素，卡上几个像素不该当成离开了底部。 */
const TAIL_GAP = 24;

const TABS: { id: WorkshopTab; label: string; icon: IconName }[] = [
  { id: "chat", label: "对话", icon: "chat" },
  { id: "play", label: "剧目", icon: "drama" },
  { id: "characters", label: "角色", icon: "users" },
  { id: "memory", label: "记忆", icon: "memory" },
  { id: "assets", label: "素材", icon: "assets" },
  { id: "files", label: "文件", icon: "files" },
  { id: "agent", label: "Agent", icon: "sparkles" },
];

/**
 * 工坊：搭台的地方（改剧目、写角色与记忆、补素材、翻文件、调 agent）。D9 的 meta-chat 多会话。
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
  playTitle,
  onBackToStage,
  tab,
  onTab,
  subscribe,
  subscribeImageResult,
  subscribeAssetReady,
  spriteFocus,
  onManageSprites,
  send,
  connected,
  queue,
}: {
  playId: string;
  playTitle?: string;
  /** 返回舞台游玩 */
  onBackToStage?: () => void;
  tab: WorkshopTab;
  onTab: (tab: WorkshopTab) => void;
  /** 注册工坊下行消息回调（返回取消订阅）。 */
  subscribe: (handler: (msg: WorkshopInbound) => void) => () => void;
  /** 注册手动出图结果回调（返回取消订阅）。 */
  subscribeImageResult?: (
    handler: (
      res:
        | { target: string; ok: true; url: string; path: string }
        | { target: string; ok: false; message: string },
    ) => void,
  ) => () => void;
  /** 注册素材到货回调（返回取消订阅）：舞台那边的引用即导入、助手的导入、后台出图都从这里过。 */
  subscribeAssetReady?: (
    handler: (asset: GeneratedAsset) => void,
  ) => () => void;
  /** 「管立绘」的落点：素材页要滚到哪个主体（nonce 让同一个 id 再点一次也能生效）。 */
  spriteFocus?: { id: string; nonce: number } | null;
  /** 角色页的「管立绘」：切到素材页并点名一个主体。 */
  onManageSprites?: (id: string) => void;
  send: (msg: ClientMessage) => void;
  /** WS 连通性：断线要解锁本轮、重连要重新报到。 */
  connected?: boolean;
  /** 待注入队列与生成任务条（舞台那条连接上的同一份数据），贴在内容区底部。 */
  queue?: ReactNode;
}) {
  const workshop = useWorkshop(send);
  const { state } = workshop;
  const [input, setInput] = useState("");
  /** 空会话摆出的开场建议：每次开新会话重抽一批（见 pickStarters）。 */
  const [starters, setStarters] = useState(pickStarters);
  const [threadsOpen, setThreadsOpen] = useState(false);
  /** 待发附件：挑中即上传，随下一条消息一起发出去（上传完才入列）。 */
  const [attachments, setAttachments] = useState<WorkshopAttachment[]>([]);
  const [uploading, setUploading] = useState(false);
  const [attachError, setAttachError] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [lightbox, setLightbox] = useState<{
    images: LightboxImage[];
    index: number;
  } | null>(null);
  /** 压缩摘要是否展开（默认折叠成一行一句话）。 */
  const [digestOpen, setDigestOpen] = useState(false);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLTextAreaElement | null>(null);
  /** 视口是否贴着对话底部。离开底部就不再自动下拽——正读着上文的人不该被新一行拖走。 */
  const [atTail, setAtTail] = useState(true);
  const navRef = useRef<HTMLElement | null>(null);

  /** 吸到最底下，并恢复贴底跟随。 */
  const stickToTail = (): void => {
    const el = scrollRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
    setAtTail(true);
  };

  /** 回到会话顶部。 */
  const goTop = (): void => {
    scrollRef.current?.scrollTo({ top: 0, behavior: "smooth" });
  };

  /** 点一条开场建议：只填进输入框（发不发由用户决定），光标落到末尾方便接着改。 */
  const applyStarter = (text: string): void => {
    setInput(text);
    const el = inputRef.current;
    if (!el) return;
    el.focus();
    // value 要等这一帧渲染完才更新，同步设 selection 只会被旧值截短
    requestAnimationFrame(() => el.setSelectionRange(text.length, text.length));
  };

  /** 滚动位置的唯一真相：剩下的距离在 TAIL_GAP 以内就算贴着底。 */
  const onChatScroll = (): void => {
    const el = scrollRef.current;
    if (!el) return;
    setAtTail(el.scrollHeight - el.scrollTop - el.clientHeight <= TAIL_GAP);
  };

  // 面板一挂上就先订阅再报到（StrictMode 下会走两遍，报到幂等）
  useEffect(
    () => subscribe(workshop.onMessage),
    [subscribe, workshop.onMessage],
  );

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

  // 手机上一行放不下七个 tab：切到靠后的页（文件 / Agent）时，当前项要自己
  // 滚进可视区。不滚的话条上永远是最左边那五项，人看不出自己在哪一页。
  useEffect(() => {
    const nav = navRef.current;
    const active = nav?.querySelector<HTMLElement>(".studio-nav-item.active");
    if (!nav || !active) return;
    const delta =
      active.getBoundingClientRect().left - nav.getBoundingClientRect().left;
    // 直接写 scrollLeft：元素级 scrollTo 不是所有环境都有（jsdom 就没有），
    // 而这一步是「切页顺手把条带对齐」，瞬间到位比滑过去更贴动作
    nav.scrollLeft = Math.max(
      0,
      nav.scrollLeft + delta - (nav.clientWidth - active.clientWidth) / 2,
    );
  }, [tab]);

  /** 这一轮失败的那条通知可以收起来（错误状态本身留着，下一轮照常复位）。 */
  const chatError = useDismissible(state.error ?? null);

  /** 有未保存草稿时拦一下切页：草稿只在页内 state 里，切走就没了，而人往往以为「反正存过」。 */
  const guard = useLeaveGuard();

  /** 连过再断才算「断线」：初次进页面时 connected 也是 false，那是「连接中」，不是断了。 */
  const [everConnected, setEverConnected] = useState(false);
  useEffect(() => {
    if (connected) setEverConnected(true);
  }, [connected]);
  const offline = connected === false && everConnected;

  /** 上一条用户消息：失败之后要「照样再来一次」，人不必自己把那句话翻出来重打。 */
  const lastUserText = useMemo(() => {
    for (let i = state.messages.length - 1; i >= 0; i -= 1) {
      const msg = state.messages[i];
      if (msg?.role === "user") return msg.text;
    }
    return "";
  }, [state.messages]);

  // 进对话页 / 切会话：落一次到底。用 layout effect 是为了别让人先看见会话开头、再被拽下去。
  useLayoutEffect(() => {
    if (tab === "chat") stickToTail();
  }, [tab, state.activeId]);

  // 新消息 / 流式增量 / 到货素材：跟着往下长。只贴着底时才跟。
  useEffect(() => {
    if (atTail) stickToTail();
  }, [atTail, state.messages.length, state.live, state.pendingAssets.length]);

  /** 挑中的文件逐个上传：服务端算好的附件视图（尺寸/类型/URL）才作数，本地那份只是草稿。 */
  const uploadFiles = async (picked: File[]): Promise<void> => {
    if (picked.length === 0) return;
    setUploading(true);
    setAttachError(null);
    try {
      for (const file of picked) {
        const uploaded = await api.uploadResource(
          playId,
          file.name || `附件.${extOf(file.type)}`,
          file,
        );
        setAttachments((prev) => [...prev, uploaded]);
      }
    } catch (error) {
      setAttachError(error instanceof Error ? error.message : String(error));
    } finally {
      setUploading(false);
    }
  };

  /** 粘贴：剪贴板里带文件（截图）时收下；纯文本粘贴照旧走浏览器默认行为。 */
  const onPaste = (event: React.ClipboardEvent<HTMLTextAreaElement>): void => {
    const picked = [...event.clipboardData.items]
      .filter((item) => item.kind === "file")
      .map((item) => item.getAsFile())
      .filter((file): file is File => file !== null);
    if (picked.length === 0) return;
    event.preventDefault();
    void uploadFiles(picked);
  };

  const submit = (): void => {
    const text = input.trim();
    if (offline || uploading || state.busy) return;
    if (text === "" && attachments.length === 0) return;
    workshop.chat(text, attachments);
    // 自己发的话一定是最新一条：人先前翻上去了，这一句也把他带回底部
    stickToTail();
    setInput("");
    setAttachments([]);
    setThreadsOpen(false);
  };

  const openImage = (images: WorkshopAssetView[], index: number): void =>
    setLightbox({
      images: images.map((a) => ({ url: a.url, caption: a.path })),
      index,
    });

  const activeThread = state.threads.find((t) => t.id === state.activeId);
  // 一个会话都没有时，切换器没得切，不渲染——否则它会和右边的「新会话」并排成两个同名按钮。
  // 新会话还没发出第一句时，切换器写「未命名会话」，让右边那个「新会话」只有一个同名出口。
  const hasThreads = state.threads.length > 0;
  const threadName = workshop.freshThread
    ? "未命名会话"
    : (activeThread?.title ?? "未命名会话");

  return (
    <div className="workshop-studio">
      <aside className="studio-rail" aria-label="工坊导航">
        {/* 舞台 ⇄ 工坊的切换是全局导航的第一元素：舞台上它在画面左上角，
            切进工坊后仍在同一个位置（rail 顶端），整条 rail 从它下面排。
            两处是同一个组件语言（.stage-view-segmented），所以切换时不会「跳」。 */}
        <div className="studio-rail-switch">
          <div
            className="stage-view-segmented"
            role="tablist"
            aria-label="模式切换"
          >
            <button
              type="button"
              className="stage-seg-btn"
              role="tab"
              aria-selected={false}
              onClick={onBackToStage && (() => guard(onBackToStage))}
              disabled={!onBackToStage}
              title="回到舞台游玩"
            >
              <Icon name="drama" size={13} />
              <span>舞台</span>
            </button>
            <button
              type="button"
              className="stage-seg-btn is-active"
              role="tab"
              aria-selected={true}
              title="创作工坊"
            >
              <Icon name="workshop" size={13} />
              <span>工坊</span>
            </button>
          </div>
        </div>

        <header className="studio-rail-brand">
          <span className="studio-brand-title" title={playTitle || playId}>
            {playTitle || playId}
          </span>
        </header>

        <nav className="studio-nav" role="tablist" ref={navRef}>
          {TABS.map((item) => (
            <button
              key={item.id}
              role="tab"
              aria-selected={tab === item.id}
              className={`studio-nav-item${tab === item.id ? " active" : ""}`}
              onClick={() => guard(() => onTab(item.id))}
            >
              <Icon name={item.icon} size={15} />
              <span className="studio-nav-label">{item.label}</span>
            </button>
          ))}
        </nav>

        <footer className="studio-rail-foot">
          <div className="studio-conn-status">
            <span className={`conn-dot ${connected ? "online" : "offline"}`} />
            <span className="conn-label">
              {connected ? "已连接" : "连接中…"}
            </span>
          </div>
          <button
            type="button"
            className="studio-exit-btn"
            onClick={() => guard(() => navigate(`/play/${playId}`))}
            title="退出工坊回到标题画面"
          >
            <Icon name="exit" size={14} />
            <span>退出</span>
          </button>
        </footer>
      </aside>

      <div className="studio-content">
        <div className="notice-layer">
          {offline && (
            <div className="warn-banner small" role="status">
              <Icon name="alert" size={13} />{" "}
              连接断了，正在重连。这期间发出去的话不作数，等回到「已连接」再发。
            </div>
          )}
          {state.error && !chatError.hidden && (
            <div className="error-banner small" role="alert">
              <span>{state.error}</span>
              {!state.busy && lastUserText !== "" && (
                <button
                  type="button"
                  className="ghost-btn small-btn"
                  onClick={() => workshop.chat(lastUserText)}
                  title="把上一条照样再发一次"
                >
                  <span className="btn-icon">
                    <Icon name="refresh" size={13} /> 重发上一条
                  </span>
                </button>
              )}
              <button
                type="button"
                className="notice-close"
                aria-label="收起这条"
                onClick={chatError.dismiss}
              >
                <Icon name="close" size={12} />
              </button>
            </div>
          )}
        </div>

        {tab === "files" && (
          <FileBrowser
            playId={playId}
            revision={state.revision}
            onSaved={() => undefined}
          />
        )}

        {tab === "assets" && (
          <AssetsPanel
            playId={playId}
            subscribeImageResult={subscribeImageResult}
            subscribeAssetReady={subscribeAssetReady}
            focus={spriteFocus}
          />
        )}

        {tab === "play" && (
          <PlayPane playId={playId} revision={state.revision} />
        )}

        {tab === "memory" && (
          <MemoryPane playId={playId} revision={state.revision} />
        )}

        {tab === "characters" && (
          <CharacterPane
            playId={playId}
            revision={state.revision}
            subscribeAssetReady={subscribeAssetReady}
            onManageSprites={onManageSprites}
          />
        )}

        {tab === "agent" && <AgentPane playId={playId} />}

        {tab === "chat" && (
          <div className="studio-chat-tab">
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
                  workshop.clearState();
                  workshop.newThread();
                  setInput("");
                  setStarters(pickStarters());
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
                {state.threads.length === 0 && (
                  <p className="muted small">还没有会话。</p>
                )}
                {state.threads.map((thread) => (
                  <div
                    key={thread.id}
                    className={`thread-row${thread.id === state.activeId ? " active" : ""}`}
                  >
                    <button
                      className="thread-name"
                      onClick={() => {
                        workshop.activate(thread.id);
                        setStarters(pickStarters());
                        setThreadsOpen(false);
                      }}
                    >
                      {thread.archived && (
                        <span className="muted">[归档] </span>
                      )}
                      {thread.title}
                    </button>
                    <button
                      className="ghost-btn tiny-btn icon-btn icon-btn-xs"
                      onClick={() =>
                        workshop.setArchived(thread.id, !thread.archived)
                      }
                      title={thread.archived ? "取消归档" : "归档"}
                    >
                      <Icon
                        name={thread.archived ? "reply" : "download"}
                        size={13}
                      />
                    </button>
                    <button
                      className="ghost-btn tiny-btn danger-btn icon-btn icon-btn-xs"
                      onClick={() => {
                        if (window.confirm(`删除会话「${thread.title}」？`))
                          workshop.remove(thread.id);
                      }}
                      title="删除"
                    >
                      <Icon name="close" size={13} />
                    </button>
                  </div>
                ))}
              </div>
            )}

            {/* 滚动区外面套一层：只给「回到顶部」键一个定位锚点，键不跟着内容滚走 */}
            <div className="chat-scroll">
              <div
                className="workshop-chat"
                ref={scrollRef}
                onScroll={onChatScroll}
              >
                {state.messages.length === 0 && state.live.length === 0 && (
                  <div className="workshop-empty">
                    <div className="empty-icon">
                      <Icon name="chat" size={36} />
                    </div>
                    <h3>开启你的视觉小说创作</h3>
                    <p>描述你想要的世界、角色设定、剧情转折或修改要求。</p>
                    <div className="starter-chips">
                      {starters.map((idea) => (
                        <button
                          key={idea.text}
                          type="button"
                          className="starter-chip"
                          onClick={() => applyStarter(idea.text)}
                        >
                          {idea.text}
                        </button>
                      ))}
                    </div>
                  </div>
                )}
                {state.messages.map((msg, i) => (
                  <Fragment key={`${msg.at}-${i}`}>
                    {i === state.compaction?.cutAt && (
                      <>
                        <div className="chat-divider">
                          <button
                            className="ghost-btn tiny-btn"
                            onClick={() => setDigestOpen(!digestOpen)}
                          >
                            早期 {state.compaction!.cutAt} 条对话已压缩
                          </button>
                          {!digestOpen && (
                            <span>{state.compaction!.oneLiner}</span>
                          )}
                        </div>
                        {digestOpen && (
                          <div className="chat-digest">
                            <WorkshopMarkdown
                              text={state.compaction!.body}
                              onOpen={(images, index) =>
                                setLightbox({ images, index })
                              }
                            />
                          </div>
                        )}
                      </>
                    )}
                    {msg.role === "user" ? (
                      <>
                        {msg.text !== "" && (
                          <div className="chat-bubble chat-user">
                            <WorkshopMarkdown
                              text={msg.text}
                              onOpen={(images, index) =>
                                setLightbox({ images, index })
                              }
                            />
                          </div>
                        )}
                        {msg.attachments && msg.attachments.length > 0 && (
                          <AttachmentChips
                            items={msg.attachments}
                            onOpen={(url, name) =>
                              setLightbox({
                                images: [{ url, caption: name }],
                                index: 0,
                              })
                            }
                          />
                        )}
                      </>
                    ) : (
                      <div className="chat-turn">
                        <TurnParts
                          parts={
                            attachMessageAssets(normalizeParts(msg), msg.images)
                              .parts
                          }
                          live={false}
                          onOpenMarkdown={(images, index) =>
                            setLightbox({ images, index })
                          }
                          onOpenAssets={openImage}
                        />
                        {attachMessageAssets(normalizeParts(msg), msg.images)
                          .remaining.length > 0 && (
                          <AssetStrip
                            assets={
                              attachMessageAssets(
                                normalizeParts(msg),
                                msg.images,
                              ).remaining
                            }
                            onOpen={openImage}
                          />
                        )}
                      </div>
                    )}
                  </Fragment>
                ))}
                {state.live.length > 0 && (
                  <div className="chat-turn">
                    <TurnParts
                      parts={state.live}
                      live
                      onOpenMarkdown={(images, index) =>
                        setLightbox({ images, index })
                      }
                      onOpenAssets={openImage}
                    />
                  </div>
                )}
                {/* 本轮出图即时可见：本轮话还没收束，图先摆在这儿，收束后并进上面那条消息 */}
                {state.pendingAssets.length > 0 && (
                  <div className="asset-strip pending">
                    <AssetStrip
                      assets={state.pendingAssets}
                      onOpen={openImage}
                      bare
                    />
                  </div>
                )}
                {state.busy && state.live.length === 0 && (
                  <div className="chat-activity">思考中…</div>
                )}
              </div>
              {!atTail && (
                <button
                  type="button"
                  className="chat-top-btn"
                  onClick={goTop}
                  title="回到顶部"
                  aria-label="回到顶部"
                >
                  <Icon name="up" size={15} />
                </button>
              )}
            </div>

            <footer
              className={`workshop-input${dragging ? " drag" : ""}`}
              onDragOver={(e) => {
                e.preventDefault();
                setDragging(true);
              }}
              onDragLeave={() => setDragging(false)}
              onDrop={(e) => {
                e.preventDefault();
                setDragging(false);
                void uploadFiles([...e.dataTransfer.files]);
              }}
            >
              <input
                ref={fileInputRef}
                type="file"
                multiple
                hidden
                onChange={(e) => {
                  const picked = [...(e.target.files ?? [])];
                  e.target.value = "";
                  void uploadFiles(picked);
                }}
              />
              <div className="composer-body">
                {attachments.length > 0 && (
                  <AttachmentChips
                    items={attachments}
                    removable
                    onRemove={(path) =>
                      setAttachments((prev) =>
                        prev.filter((a) => a.path !== path),
                      )
                    }
                  />
                )}
                {attachError && (
                  <p className="composer-error small">{attachError}</p>
                )}
                <textarea
                  ref={inputRef}
                  value={input}
                  disabled={offline}
                  placeholder={
                    offline
                      ? "连接断了，正在重连…"
                      : "描述你想要的世界、角色或改动…（Enter 发送，Shift+Enter 换行；可拖入图片或文件）"
                  }
                  onChange={(e) => setInput(e.target.value)}
                  onPaste={onPaste}
                  onKeyDown={(e) => {
                    if (
                      e.key === "Enter" &&
                      !e.shiftKey &&
                      !e.nativeEvent.isComposing
                    ) {
                      e.preventDefault();
                      submit();
                    }
                  }}
                />
              </div>
              <button
                type="button"
                className="ghost-btn composer-attach"
                title="添加图片或文件"
                aria-label="添加图片或文件"
                disabled={offline || uploading}
                onClick={() => fileInputRef.current?.click()}
              >
                <Icon name="attach" size={16} />
              </button>
              {state.busy ? (
                <button className="primary stop-btn" onClick={workshop.stop}>
                  <Icon name="pause" size={14} /> 停止
                </button>
              ) : (
                <button
                  className="primary send-btn"
                  disabled={
                    offline ||
                    uploading ||
                    (input.trim() === "" && attachments.length === 0)
                  }
                  title={offline ? "连接断了，正在重连" : undefined}
                  onClick={submit}
                >
                  <Icon name="forward" size={14} /> {uploading ? "上传中…" : "发送"}
                </button>
              )}
            </footer>
          </div>
        )}
        {queue}
      </div>

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

/** 附件草稿条 / 消息附件条共用的一份渲染：图片给缩略图，其余给名字 + 大小。 */
function AttachmentChips({
  items,
  removable,
  onRemove,
  onOpen,
}: {
  items: WorkshopAttachment[];
  removable?: boolean;
  onRemove?: (path: string) => void;
  onOpen?: (url: string, name: string) => void;
}) {
  return (
    <div className={`chat-attachments${onOpen ? " in-message" : ""}`}>
      {items.map((item) => (
        <div
          key={item.path}
          className={`chat-attachment${item.kind === "image" ? " is-image" : ""}`}
          title={item.path}
        >
          {item.kind === "image" ? (
            <button
              type="button"
              className="chat-attachment-thumb"
              onClick={() => onOpen?.(item.url, item.name)}
            >
              <img src={item.url} alt={item.name} loading="lazy" />
            </button>
          ) : (
            <span className="chat-attachment-thumb">
              <Icon name="file" size={15} />
            </span>
          )}
          <span className="chat-attachment-name">{item.name}</span>
          <span className="chat-attachment-size">{formatSize(item.size)}</span>
          {removable && (
            <button
              type="button"
              className="chat-attachment-x"
              title="移除"
              aria-label={`移除 ${item.name}`}
              onClick={() => onRemove?.(item.path)}
            >
              <Icon name="close" size={13} />
            </button>
          )}
        </div>
      ))}
    </div>
  );
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)}KB`;
  return `${(bytes / 1048576).toFixed(1)}MB`;
}

/** 剪贴板里的图常常没有文件名，按 mime 给个默认扩展名。 */
function extOf(mime: string): string {
  const sub = mime.split("/")[1] ?? "";
  return sub === "jpeg" ? "jpg" : sub || "bin";
}
