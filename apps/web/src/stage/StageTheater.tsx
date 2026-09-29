import { useCallback, useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";
import { actorName } from "./script.js";
import type { Playback, VisualState } from "./director.js";
import type { AssetIndex } from "./assets.js";
import type { TranscriptEntry } from "./transcript.js";
import { api } from "../api.js";
import type { HistoryBeat, HistoryEntry } from "../api.js";
import { Icon } from "../ui/Icon.js";

interface StageTheaterProps {
  visual: VisualState;
  playback: Playback;
  live: boolean;
  names: Readonly<Record<string, string>>;
  index: AssetIndex;
  /** 服务端 TTS 能力（false 时隐藏语音相关的一切）。 */
  voiceAvailable: boolean;
  voiceOn: boolean;
  unlocked: boolean;
  /** 原地 OOC 已入队（下一拍生效，beat_start 自动清除）。 */
  oocQueued: boolean;
  /** 结构性操作会腰斩正在演的这一幕，busy 时 ↺/🌿 置灰（OOC 仍可用，走 steer 注入）。 */
  busy: boolean;
  /** 操作条可见性（H 键手动收起做沉浸模式，仅此一种隐藏途径）。 */
  chrome: boolean;
  /** 由当前显示行 seq 反查出的锚点：编辑绑行，重生成/分岔绑整幕。 */
  targets: DirectorTargets;
  /** 四个导演原语：OOC / 编辑 / 重生成 / 分岔。 */
  onOoc: (text: string) => void;
  onEdit: (nodeId: string, text: string) => void;
  onRewrite: (beatId: string, instruction?: string) => void;
  onFork: (nodeId: string) => void;
  onReplay: (seq: number) => void;
  hasVoice: (seq: number | null) => boolean;
  onUnlock: () => void;
  onView: (view: StageView) => void;
  /** 点舞台即开新拍：等到内容演完且存在 pause 停止点时成立（不再单列「继续」按钮）。 */
  canContinue: boolean;
  onContinue: () => void;
  /** 操作条可见性控制：碰到舞台叫它回来，H 键手动切换。 */
  onChrome: (next: boolean) => void;
  /** 舞台层浮层：停止点的选肢卡片、入戏输入、幕末黑场（均在台词条之上层级）。 */
  overlay?: ReactNode;
}

export type StageView = "stage" | "backlog" | "route";

export interface DirectorTargets {
  beatId: string | null;
  lineNodeId: string | null;
  lineText: string;
}

const POS_CLASS: Record<string, string> = { left: "pos-left", center: "pos-center", right: "pos-right" };

/**
 * 立绘：表情差分之间交叉淡入。
 * 新图先在内存里解码好再叠上去，切换只是一层 opacity 过渡——不会出现白闪或半张脸。
 */
function Sprite({ url, pos, name }: { url: string | null; pos: string; name: string }): ReactNode {
  const [current, setCurrent] = useState<string | null>(url);
  const [outgoing, setOutgoing] = useState<string | null>(null);

  useEffect(() => {
    if (!url || url === current) return;
    const img = new Image();
    let timer: ReturnType<typeof setTimeout> | undefined;
    img.onload = () => {
      setOutgoing(current);
      setCurrent(url);
      timer = setTimeout(() => setOutgoing(null), 260);
    };
    img.src = url;
    return () => {
      img.onload = null;
      if (timer) clearTimeout(timer);
    };
  }, [url, current]);

  if (!current) return null;
  const cls = `theater-sprite ${POS_CLASS[pos] ?? "pos-center"}`;
  return (
    <>
      {outgoing && <img className={`${cls} sprite-out`} src={outgoing} alt="" aria-hidden />}
      <img className={cls} src={current} alt={name} />
    </>
  );
}

/** 舞台：背景/立绘/CG 视觉层 + 打字机对话框 + 二段式点击 + 自动模式 + sfx/bgm + 语音 + 常驻导演注。 */
export function StageTheater({
  visual,
  playback,
  live,
  names,
  index,
  voiceAvailable,
  voiceOn,
  unlocked,
  oocQueued,
  busy,
  chrome,
  targets,
  onOoc,
  onEdit,
  onRewrite,
  onFork,
  onReplay,
  hasVoice,
  onUnlock,
  onView,
  canContinue,
  onContinue,
  onChrome,
  overlay,
}: StageTheaterProps) {
  const bgmRef = useRef<HTMLAudioElement | null>(null);
  /** 导演原语的面板：四原语的全部输入都在对话框里收，不跳视图。 */
  const [action, setAction] = useState<"ooc" | "edit" | "rewrite" | null>(null);
  const [draft, setDraft] = useState("");
  const { view, viewLength, current, shownLength, exhausted, advance, scrub, scrubbed, follow } =
    playback;
  const shown = view ? view.text.slice(0, viewLength) : "";
  const lineDone = current !== null && shownLength >= current.text.length;
  const poke = useCallback((): void => {
    onChrome(true);
  }, [onChrome]);
  const toggleChrome = useCallback((): void => {
    onChrome(!chrome);
  }, [chrome, onChrome]);

  // 回看：滚轮/↑ 往回翻，下滚/↓/←/→/空格 往回追。输入框内不劫持按键。
  const theaterRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    const el = theaterRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent): void => {
      if (Math.abs(e.deltaY) < 4) return;
      scrub(e.deltaY > 0 ? 1 : -1);
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, [scrub]);

  useEffect(() => {
    const isTyping = (t: EventTarget | null): boolean =>
      t instanceof HTMLElement && (t.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(t.tagName));
    const onKey = (e: KeyboardEvent): void => {
      if (e.metaKey || e.ctrlKey || e.altKey || isTyping(e.target)) return;
      if (e.key === "ArrowUp" || e.key === "ArrowLeft") {
        scrub(-1);
        e.preventDefault();
      } else if (e.key === "ArrowDown" || e.key === "ArrowRight" || e.key === " ") {
        scrub(1);
        e.preventDefault();
      } else if (e.key === "Escape" && scrubbed) {
        scrub(1);
        e.preventDefault();
      } else if (e.key === "Escape" && action) {
        setAction(null);
        setDraft("");
        e.preventDefault();
      } else if (e.key === "h" || e.key === "H") {
        toggleChrome();
        e.preventDefault();
      } else if (e.key === "l" || e.key === "L") {
        onView("backlog");
        e.preventDefault();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [scrub, scrubbed, action, onView, toggleChrome]);

  /**
   * 舞台点击：回看中 → 往回追一句；等新内容时（pause 停止点）→ 直接开新拍。
   * 「继续」不再单列按钮，翻下一句和继续演是同一个动作。
   */
  const onStageClick = (): void => {
    poke();
    if (scrubbed) scrub(1);
    else if (canContinue) onContinue();
    else advance();
  };

  // 触屏手势：左右滑 = 桌面方向键（scrub 回看/追进），上滑 = 回顾。
  // 没有下滑：它跟浏览器下拉刷新撞车，两边都按不准。横向本来也该给系统，但方向键语义更常用，这里接管。
  const touchRef = useRef<{ x: number; y: number; at: number } | null>(null);
  const onTouchStart = (e: React.TouchEvent): void => {
    const t = e.touches[0];
    if (t) touchRef.current = { x: t.clientX, y: t.clientY, at: Date.now() };
  };
  const onTouchEnd = (e: React.TouchEvent): void => {
    const start = touchRef.current;
    touchRef.current = null;
    if (!start) return;
    const end = e.changedTouches[0];
    if (!end) return;
    if (Date.now() - start.at > 800) return;
    const dx = end.clientX - start.x;
    const dy = end.clientY - start.y;
    if (Math.abs(dx) < 45 && Math.abs(dy) < 45) return;
    if (Math.abs(dx) > Math.abs(dy)) scrub(dx > 0 ? -1 : 1);
    else if (dy < 0) onView("backlog");
  };

  // sfx：key 变化即播放
  useEffect(() => {
    const cue = playback.sfx;
    if (!cue) return;
    const url = index.sfx(cue.src);
    if (url) {
      const audio = new Audio(url);
      audio.volume = cue.volume ?? 0.7;
      void audio.play().catch(() => {});
    }
  }, [playback.sfx, index]);

  // bgm：场景切换换曲（循环，轻音量）
  const bgmUrl = index.bgm(visual.bgm);
  useEffect(() => {
    const audio = bgmRef.current;
    if (!audio) return;
    if (!bgmUrl) {
      audio.pause();
      return;
    }
    if (audio.src !== new URL(bgmUrl, location.href).href) {
      audio.src = bgmUrl;
      audio.volume = 0.28;
      void audio.play().catch(() => {});
    }
  }, [bgmUrl]);

  const bgUrl = index.bg(visual.bg);
  const cgUrl = index.cg(visual.cg?.id ?? null);
  // D6：引用的资产正在生成 → 骨架占位（台词照常演出），到货后 crossfade 替换
  const bgPending = !bgUrl && !!visual.bg && visual.pending[visual.bg]?.type === "bg";
  const cgId = visual.cg?.id ?? null;
  const cgPending = !cgUrl && !!cgId && visual.pending[cgId]?.type === "cg";

  const submitAction = (): void => {
    const text = draft.trim();
    if (!text) return;
    if (action === "ooc") onOoc(text);
    else if (action === "edit" && targets.lineNodeId) onEdit(targets.lineNodeId, text);
    else if (action === "rewrite" && targets.beatId) onRewrite(targets.beatId, text || undefined);
    setDraft("");
    setAction(null);
  };

  return (
    <div
      className="theater"
      ref={theaterRef}
      onClick={onStageClick}
      onTouchStart={onTouchStart}
      onTouchEnd={onTouchEnd}
    >
      {/* 顶栏（游戏 HUD 式的 exit/log/branch/studio）在 StageScreen 里，浮于三个视图之上 */}

      <div className="theater-stage">
        {bgUrl ? (
          <img key={bgUrl} className="theater-bg theater-bg-in" src={bgUrl} alt="" />
        ) : (
          <div
            className={`theater-bg theater-bg-fallback ${bgPending ? "theater-bg-pending" : ""} ${
              visual.transition === "cut" ? "cut" : ""
            }`}
          />
        )}

        {Object.entries(visual.sprites).map(([id, slot]) => (
          <Sprite
            key={id}
            url={index.sprite(id, slot.expression)}
            pos={slot.pos ?? "center"}
            name={actorName(names, id)}
          />
        ))}

        {cgUrl && (
          <div className="theater-cg">
            <img className="theater-cg-in" src={cgUrl} alt={visual.cg?.id ?? ""} />
            {visual.cg?.caption && <p className="theater-cg-caption">{visual.cg.caption}</p>}
          </div>
        )}
        {cgPending && (
          <div className="theater-cg theater-cg-pending" aria-label="插图生成中">
            {visual.cg?.caption && <p className="theater-cg-caption">{visual.cg.caption}</p>}
          </div>
        )}
      </div>

      <div className="theater-dialog" role="text">
        {view && (view.type === "say" || view.type === "thought") && (
          <div className="dialog-name">{actorName(names, view.actorId) || "？"}</div>
        )}
        <p className={`dialog-text ${view?.type === "thought" ? "thought" : view?.type === "narrate" ? "narrate" : ""} ${scrubbed ? "rewinding" : ""}`}>
          {shown ||
            (view ? "" : live && exhausted ? "剧作家正在落笔…" : "（点击开始演出）")}
          {view && !scrubbed && !lineDone && <span className="dialog-caret" aria-hidden />}
        </p>
        {/* 导演栏：四个原语 + 重听/自动，全在对话界面内就地完成，不跳视图 */}
        <div className="dialog-foot">
          <div className="dialog-hint dialog-hint-foot">
            {scrubbed ? (
              <button type="button" className="dialog-rewind" onClick={follow} title="回到最新">
                <Icon name="prev" />
                回看中
              </button>
            ) : action ? null : (
              <>
                {live && <span className="dialog-spinner" aria-label="剧作家正在写" />}
                {lineDone && (!exhausted || canContinue) && (
                  <span className="dialog-next" aria-hidden>
                    ▼
                  </span>
                )}
                {canContinue && <span className="muted">点一下继续</span>}
              </>
            )}
          </div>
          <div className="director-bar">
            <button
              type="button"
              className={`dir-btn ${action === "ooc" ? "on" : ""}`}
              title={oocQueued ? "导演注已入队（下一拍起效）" : "导演注（OOC）：随时调整演出方向"}
              onClick={(e) => {
                e.stopPropagation();
                setAction(action === "ooc" ? null : "ooc");
                setDraft("");
              }}
            >
              <Icon name="ooc" />
              {oocQueued && <span className="dir-dot" aria-hidden />}
            </button>
            <button
              type="button"
              className={`dir-btn ${action === "edit" ? "on" : ""}`}
              title={targets.lineNodeId ? "编辑当前这句台词" : "这里是表态或导演注，没有台词可改"}
              disabled={!targets.lineNodeId}
              onClick={(e) => {
                e.stopPropagation();
                setAction(action === "edit" ? null : "edit");
                setDraft(targets.lineText);
              }}
            >
              <Icon name="pencil" />
            </button>
            <button
              type="button"
              className={`dir-btn ${action === "rewrite" ? "on" : ""}`}
              title={busy ? "剧作家正在写，暂时不能重生成" : "重生成这一幕"}
              disabled={busy || !targets.beatId}
              onClick={(e) => {
                e.stopPropagation();
                setAction(action === "rewrite" ? null : "rewrite");
                setDraft("");
              }}
            >
              <Icon name="rewrite" />
            </button>
            <button
              type="button"
              className="dir-btn"
              title={busy ? "剧作家正在写，暂时不能分岔" : "从这里分岔出一条新线"}
              disabled={busy || !targets.beatId}
              onClick={(e) => {
                e.stopPropagation();
                if (targets.beatId) onFork(targets.beatId);
              }}
            >
              <Icon name="fork" />
            </button>
            {voiceAvailable && hasVoice(view?.seq ?? null) && (
              <button
                type="button"
                className="dir-btn"
                title="重听这句"
                onClick={(e) => {
                  e.stopPropagation();
                  if (view?.seq !== null && view?.seq !== undefined) onReplay(view.seq);
                }}
              >
                <Icon name="volume" />
              </button>
            )}
            <button
              type="button"
              className={`dir-btn ${playback.auto ? "on" : ""}`}
              title="自动播放"
              onClick={(e) => {
                e.stopPropagation();
                playback.setAuto(!playback.auto);
              }}
            >
              {playback.auto ? <Icon name="pause" /> : <Icon name="play" />}
            </button>
          </div>
        </div>

        {action && (
          <div
            className="director-panel"
            onClick={(e) => e.stopPropagation()}
            onTouchStart={(e) => e.stopPropagation()}
            onTouchEnd={(e) => e.stopPropagation()}
          >
            <div className="director-hint">
              {action === "ooc" && "导演注：下一拍起效，不打断当前演出"}
              {action === "edit" && "就地改这一句，改完接着演，不重演"}
              {action === "rewrite" && "重写这一幕（留空则按原设定重来）"}
            </div>
            <input
              value={draft}
              placeholder={
                action === "edit"
                  ? "改写这句台词…"
                  : action === "rewrite"
                    ? "想换什么方向？（可留空）"
                    : "调整接下来的演出方向…"
              }
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && submitAction()}
              autoFocus
            />
            <div className="director-actions">
              <button
                type="button"
                onClick={submitAction}
                disabled={action === "rewrite" ? false : draft.trim() === ""}
              >
                {action === "edit" ? "改写" : action === "rewrite" ? "重生成" : "发送"}
              </button>
              <button type="button" className="ghost-btn" onClick={() => setAction(null)}>
                收起
              </button>
            </div>
          </div>
        )}
      </div>

      {/* 停止点浮层与台词条同级（都在舞台之上），入戏输入因此能贴着台词条下沿而不被它盖住 */}
      {overlay}

      <audio ref={bgmRef} loop />

      {/* AudioContext 解锁遮罩（移动端铁律：手势 resume 后语音才可播；静音用户不要求手势） */}
      {voiceAvailable && voiceOn && !unlocked && (
        <div className="voice-unlock" onClick={onUnlock} role="button">
          <span className="voice-unlock-icon">
            <Icon name="volume" size={34} />
          </span>
          <span>点击开启语音，进入剧场</span>
        </div>
      )}
    </div>
  );
}

/**
 * 回顾：整屏重读这一场说过的所有话——剧作家的台词、玩家的选择与输入、导演注。
 *
 * 点一行不再直接跳回那一刻：翻到过去是为了在这儿做点什么（重听、改写、重生成、分岔），
 * 所以每条下面挂一排图标工具栏，跳回舞台只是其中一个。点正文本身不做任何事，避免误触。
 *
 * 标题条右端是「剧作家原始历史」开关：拉 session 快照，看这一场是怎么被写出来的
 * （注入原文 / 思考 / 未经解析的原始 DSL / 工具调用）——演出侧只看得到结果，缺口在这里补。
 */
export function BacklogView({
  playId,
  entries,
  names,
  headKey,
  busy,
  voiceAvailable,
  hasVoice,
  beatFor,
  onSeek,
  onReplay,
  onEdit,
  onRewrite,
  onFork,
  onClose,
}: {
  playId: string;
  entries: readonly TranscriptEntry[];
  names: Readonly<Record<string, string>>;
  headKey: string | null;
  busy: boolean;
  voiceAvailable: boolean;
  hasVoice: (seq: number | null) => boolean;
  /** 这一条落在哪一拍（分岔/重生成的锚点）；表态与导演注没有拍，返 null。 */
  beatFor: (entry: TranscriptEntry) => string | null;
  onSeek: (key: string) => void;
  onReplay: (seq: number) => void;
  onEdit: (nodeId: string, text: string) => void;
  onRewrite: (beatId: string, instruction?: string) => void;
  onFork: (nodeId: string) => void;
  onClose: () => void;
}) {
  /** 改写就地改：点开编辑框在回顾里完成，不跳视图。 */
  const [editing, setEditing] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [showHistory, setShowHistory] = useState(false);
  // 刷新计数住在外层：标题条只有一根，刷新键得从 HistoryView 的外面按。
  const [historyNonce, setHistoryNonce] = useState(0);
  const reloadHistory = useCallback(() => setHistoryNonce((n) => n + 1), []);

  return (
    <div className="screen stage-screen backlog-screen">
      <header className="panel-bar">
        <div className="seg" role="tablist">
          <button
            type="button"
            role="tab"
            aria-selected={!showHistory}
            className={`seg-btn ${showHistory ? "" : "active"}`.trim()}
            onClick={() => setShowHistory(false)}
          >
            回顾
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={showHistory}
            className={`seg-btn ${showHistory ? "active" : ""}`.trim()}
            onClick={() => setShowHistory(true)}
            title="剧作家的 session 快照：注入原文、思考、原始 DSL 与工具调用"
          >
            原始历史
          </button>
        </div>
        <div className="panel-bar-actions">
          {showHistory ? (
            <button
              type="button"
              className="ghost-btn small-btn"
              onClick={reloadHistory}
              title="重新拉取（读盘落后一拍）"
            >
              <Icon name="refresh" size={14} />
              刷新
            </button>
          ) : null}
          <button type="button" className="ghost-btn small-btn icon-btn icon-btn-sm" onClick={onClose} title="关闭">
            <Icon name="close" size={14} />
          </button>
        </div>
      </header>
      {showHistory ? (
        <HistoryView playId={playId} nonce={historyNonce} />
      ) : (
        <div className="panel-body">
          {entries.length === 0 ? (
            <p className="backlog-empty">还没有说出口的话。</p>
          ) : (
            <ol className="backlog-list">
          {entries.map((item) => {
            const beat = beatFor(item);
            const editable = item.kind === "line" && item.nodeId !== null;
            const playable = item.type === "say" && voiceAvailable && hasVoice(item.seq);
            return (
              <li key={item.key} className={`bl-${item.kind}`}>
                <div className={item.key === headKey ? "bl-text current" : "bl-text"}>
                  {item.actorId && <b>{actorName(names, item.actorId)}</b>}
                  <span>{item.text}</span>
                </div>
                {editing === item.key ? (
                  <div className="bl-edit">
                    <input
                      value={draft}
                      autoFocus
                      onChange={(e) => setDraft(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" && item.nodeId) {
                          onEdit(item.nodeId, draft.trim());
                          setEditing(null);
                        } else if (e.key === "Escape") {
                          setEditing(null);
                        }
                      }}
                    />
                    <button
                      type="button"
                      disabled={draft.trim() === ""}
                      onClick={() => {
                        if (!item.nodeId) return;
                        onEdit(item.nodeId, draft.trim());
                        setEditing(null);
                      }}
                    >
                      改写
                    </button>
                    <button type="button" className="ghost-btn" onClick={() => setEditing(null)}>
                      取消
                    </button>
                  </div>
                ) : (
                  <div className="bl-tools">
                    <button
                      type="button"
                      className="bl-tool"
                      title="回到舞台的这一刻"
                      onClick={() => onSeek(item.key)}
                    >
                      <Icon name="prev" />
                    </button>
                    {playable && (
                      <button
                        type="button"
                        className="bl-tool"
                        title="重听这句"
                        onClick={() => item.seq !== null && onReplay(item.seq)}
                      >
                        <Icon name="play" />
                      </button>
                    )}
                    {editable && (
                      <button
                        type="button"
                        className="bl-tool"
                        title="就地改写这句"
                        onClick={() => {
                          setEditing(item.key);
                          setDraft(item.text);
                        }}
                      >
                        <Icon name="pencil" />
                      </button>
                    )}
                    <button
                      type="button"
                      className="bl-tool"
                      title={busy ? "剧作家正在写，暂时不能重生成" : "从这一幕重生成"}
                      disabled={busy || !beat}
                      onClick={() => beat && onRewrite(beat)}
                    >
                      <Icon name="rewrite" />
                    </button>
                    <button
                      type="button"
                      className="bl-tool"
                      title={busy ? "剧作家正在写，暂时不能分岔" : "从这里分岔出一条新线"}
                      disabled={busy || !beat}
                      onClick={() => beat && onFork(beat)}
                    >
                      <Icon name="fork" />
                    </button>
                  </div>
                )}
              </li>
            );
          })}
          </ol>
        )}
        </div>
      )}
    </div>
  );
}

/** 历史条目的呈现分工：正文一个样式，思考/原始 DSL 走等宽体（它们不是台词）。 */
const HISTORY_KIND: Record<HistoryEntry["role"], { label: string; cls: string }> = {
  user: { label: "注入上下文", cls: "hx-user" },
  thinking: { label: "剧作家思考", cls: "hx-thinking" },
  assistant: { label: "原始 DSL（未解析）", cls: "hx-dsl" },
  toolCall: { label: "工具调用", cls: "hx-tool" },
};

/**
 * 剧作家原始历史：活动周目最近若干拍的 session 快照（REST 只读，不建 runtime、不改状态）。
 * 与回顾互补——回顾只给解析后的台词与选肢，这里给写出来之前的原文：注入上下文、
 * 思考、未经解析的原始 DSL、工具调用。空表不是错误：还没落盘（读盘落后一拍）
 * 或纪元压缩前没有留存。标题条由外层 BacklogView 统一给，这里只出内容。
 */
function HistoryView({ playId, nonce }: { playId: string; nonce: number }) {
  const [beats, setBeats] = useState<HistoryBeat[] | null>(null);
  useEffect(() => {
    let alive = true;
    api
      .history(playId)
      .then((r) => alive && setBeats(r.beats))
      .catch(() => alive && setBeats([]));
    return () => {
      alive = false;
    };
  }, [playId, nonce]);

  return (
    <div className="panel-body">
      {beats === null ? (
        <div className="overlay">读取历史…</div>
      ) : beats.length === 0 ? (
        <p className="backlog-empty">还没有留存的历史——下一拍拍完就写进来了。</p>
      ) : (
        <>
          {beats.map((beat) => (
            <section key={beat.turn} className="hx-beat">
              <header className="hx-beat-head">
                <span>第 {beat.turn} 拍</span>
                <span className="muted">{beat.entries.length} 条</span>
              </header>
              {beat.entries.map((entry) => {
                const kind = HISTORY_KIND[entry.role];
                return (
                  <div key={`${entry.beat}-${entry.seq}`} className={`hx-entry ${kind.cls}`}>
                    <span className="hx-kind">
                      {kind.label}
                      {entry.role === "toolCall" && entry.name ? ` · ${entry.name}` : ""}
                    </span>
                    {entry.role === "toolCall" ? (
                      <pre className="hx-tool">{JSON.stringify(entry.args ?? {}, null, 2)}</pre>
                    ) : (
                      <p className="hx-text">{entry.text}</p>
                    )}
                  </div>
                );
              })}
            </section>
          ))}
          <p className="muted hx-foot">只读快照，落盘比当前拍慢一步——要最新的按标题条的「刷新」。</p>
        </>
      )}
    </div>
  );
}
