import { useCallback, useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";
import { actorName } from "./script.js";
import type { ScriptLine } from "./script.js";
import type { Playback, VisualState } from "./director.js";
import type { AssetIndex } from "./assets.js";

interface StageTheaterProps {
  visual: VisualState;
  playback: Playback;
  live: boolean;
  names: Readonly<Record<string, string>>;
  index: AssetIndex;
  /** 服务端 TTS 能力（false 时隐藏语音开关）。 */
  voiceAvailable: boolean;
  voiceOn: boolean;
  unlocked: boolean;
  /** 原地 OOC 已入队（下一拍生效，beat_start 自动清除）。 */
  oocQueued: boolean;
  /** 常驻导演注入口（D9）：任意时刻可发（演出中 steer 入队；停止点立即开拍）。 */
  onOoc: (text: string) => void;
  onToggleVoice: () => void;
  onUnlock: () => void;
  onBack: () => void;
  onLog: () => void;
  onRoute: () => void;
  onWorkshop: () => void;
  /** 舞台层浮层：停止点的选肢卡片与入戏输入（P6.5 悬浮于舞台中央，不占底部条）。 */
  overlay?: ReactNode;
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
  onOoc,
  onToggleVoice,
  onUnlock,
  onBack,
  onLog,
  onRoute,
  onWorkshop,
  overlay,
}: StageTheaterProps) {
  const bgmRef = useRef<HTMLAudioElement | null>(null);
  const [directorOpen, setDirectorOpen] = useState(false);
  const [directorDraft, setDirectorDraft] = useState("");
  const { view, viewLength, current, shownLength, exhausted, advance, scrub, scrubbed, history, seek } =
    playback;
  const shown = view ? view.text.slice(0, viewLength) : "";
  const lineDone = current !== null && shownLength >= current.text.length;
  const [chrome, setChrome] = useState(true); // 舞台操作条显隐（沉浸模式）
  const [idleChrome, setIdleChrome] = useState(false); // 久未操作后自动淡出操作条
  const [backlogOpen, setBacklogOpen] = useState(false);
  const chromeVisible = chrome && !idleChrome;
  // 任何一次舞台交互都算「有人在看」：操作条回来，并重置自动淡出计时。
  const poke = useCallback((): void => {
    setChrome(true);
    setIdleChrome(false);
  }, []);
  /** H / 下滑：看得见就收起来，已经收着（手动或自动）就拿回来。 */
  const toggleChrome = useCallback((): void => {
    setChrome(!chromeVisible);
    setIdleChrome(false);
  }, [chromeVisible]);

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
      } else if (e.key === "Escape" && backlogOpen) {
        setBacklogOpen(false);
        e.preventDefault();
      } else if (e.key === "h" || e.key === "H") {
        toggleChrome();
        e.preventDefault();
      } else if (e.key === "l" || e.key === "L") {
        setBacklogOpen((v) => !v);
        e.preventDefault();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [scrub, scrubbed, backlogOpen, toggleChrome]);

  /** 舞台点击：回看中 → 往回追一句；否则两段式推进。 */
  const onStageClick = (): void => {
    poke();
    if (scrubbed) scrub(1);
    else advance();
  };

  // 自动淡出：4 秒没动静就把操作条收起来，画面自己说话；任何交互立刻回来。
  useEffect(() => {
    const timer = setTimeout(() => setIdleChrome(true), 4000);
    return () => clearTimeout(timer);
  }, [idleChrome, view?.key, shownLength]);

  // 触屏手势：上滑看回顾、下滑收操作条；横向滑动交给系统（不拦）。
  const touchRef = useRef<{ y: number; at: number } | null>(null);
  const onTouchStart = (e: React.TouchEvent): void => {
    const t = e.touches[0];
    if (t) touchRef.current = { y: t.clientY, at: Date.now() };
  };
  const onTouchEnd = (e: React.TouchEvent): void => {
    const start = touchRef.current;
    touchRef.current = null;
    if (!start) return;
    const end = e.changedTouches[0];
    if (!end) return;
    const dy = start.y - end.clientY;
    if (Math.abs(dy) < 60 || Date.now() - start.at > 600) return;
    if (dy > 0) setBacklogOpen(true);
    else toggleChrome();
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

  const submitDirectorNote = (): void => {
    const text = directorDraft.trim();
    if (!text) return;
    onOoc(text);
    setDirectorDraft("");
    setDirectorOpen(false);
  };

  return (
    <div
      className="theater"
      ref={theaterRef}
      onClick={onStageClick}
      onTouchStart={onTouchStart}
      onTouchEnd={onTouchEnd}
    >
      <header className={`theater-bar ${chrome && !idleChrome ? "" : "chrome-hidden"}`} onPointerEnter={poke}>
        <button
          className="ghost-btn"
          onClick={(e) => {
            e.stopPropagation();
            onBack();
          }}
        >
          ← 标题
        </button>
        <span className="theater-scene">{visual.bg ?? "…"}</span>
        <span className="theater-actions">
          {voiceAvailable && (
            <button
              className={`ghost-btn ${voiceOn ? "active" : ""}`}
              title={voiceOn ? "语音开（点击静音）" : "语音关（点击开启）"}
              onClick={(e) => {
                e.stopPropagation();
                onToggleVoice();
              }}
            >
              {voiceOn ? "🔊 语音" : "🔇 静音"}
            </button>
          )}
          <button
            className={`ghost-btn ${playback.auto ? "active" : ""}`}
            onClick={(e) => {
              e.stopPropagation();
              playback.setAuto(!playback.auto);
            }}
          >
            自动 {playback.auto ? "开" : "关"}
          </button>
          <button
            className="ghost-btn"
            title="回顾：翻看已经说过的台词（L / 上滑）"
            onClick={(e) => {
              e.stopPropagation();
              setBacklogOpen(true);
            }}
          >
            回顾
          </button>
          <button
            className={`ghost-btn ${oocQueued ? "active" : ""}`}
            title={oocQueued ? "导演注已入队，下一拍生效" : "导演注（OOC）：随时调整演出方向"}
            onClick={(e) => {
              e.stopPropagation();
              setDirectorOpen((open) => !open);
            }}
          >
            🎬 导演{oocQueued ? "·已注入" : ""}
          </button>
          <button
            className="ghost-btn"
            onClick={(e) => {
              e.stopPropagation();
              onLog();
            }}
          >
            剧本
          </button>
          <button
            className="ghost-btn"
            onClick={(e) => {
              e.stopPropagation();
              onRoute();
            }}
          >
            路线
          </button>
          <button
            className="ghost-btn"
            title="工坊：和 AI 一起改设定、角色与文件"
            onClick={(e) => {
              e.stopPropagation();
              onWorkshop();
            }}
          >
            🛠 工坊
          </button>
        </span>
      </header>

      {directorOpen && (
        <div className="director-box" onClick={(e) => e.stopPropagation()}>
          {oocQueued && <div className="director-hint">上一条已入队：当前拍收敛后生效</div>}
          <input
            value={directorDraft}
            placeholder="导演注（OOC）：调整演出方向，不打断当前演出…"
            onChange={(e) => setDirectorDraft(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && submitDirectorNote()}
            autoFocus
          />
          <div className="director-actions">
            <button type="button" onClick={submitDirectorNote} disabled={directorDraft.trim() === ""}>
              发送
            </button>
            <button type="button" className="ghost-btn" onClick={() => setDirectorOpen(false)}>
              收起
            </button>
          </div>
        </div>
      )}

      {backlogOpen && (
        <aside className="backlog" onClick={(e) => e.stopPropagation()}>
          <div className="backlog-head">
            <span>回顾</span>
            <button type="button" className="ghost-btn small-btn" onClick={() => setBacklogOpen(false)}>
              收起
            </button>
          </div>
          {history.length === 0 ? (
            <p className="backlog-empty">还没有说出口的话。</p>
          ) : (
            <ol className="backlog-list">
              {history.map((item) => (
                <li key={item.key}>
                  <button
                    type="button"
                    onClick={() => {
                      seek(item.key);
                      setBacklogOpen(false);
                    }}
                  >
                    {item.actorId && <b>{actorName(names, item.actorId)}</b>}
                    <span>{item.text}</span>
                  </button>
                </li>
              ))}
            </ol>
          )}
        </aside>
      )}

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

        {overlay}
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
        <div className="dialog-hint">
          {scrubbed ? (
            <button type="button" className="dialog-rewind" onClick={() => scrub(1)}>
              ◀ 回看中 · 点此回到最新
            </button>
          ) : (
            <>
              {live && <span className="dialog-spinner" aria-label="剧作家正在写" />}
              {lineDone && !exhausted && (
                <span className="dialog-next" aria-hidden>
                  ▼
                </span>
              )}
            </>
          )}
        </div>
      </div>

      <audio ref={bgmRef} loop />

      {/* AudioContext 解锁遮罩（移动端铁律：手势 resume 后语音才可播；静音用户不要求手势） */}
      {voiceAvailable && voiceOn && !unlocked && (
        <div className="voice-unlock" onClick={onUnlock} role="button">
          <span className="voice-unlock-icon">🔊</span>
          <span>点击开启语音，进入剧场</span>
        </div>
      )}
    </div>
  );
}
