import { useCallback, useEffect, useRef, useState } from "react";
import { Icon } from "../ui/Icon.js";
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
  /** 当前周目档名（点它去周目页切换）。 */
  saveName: string | null;
  onSaves: () => void;
  /** 舞台层浮层：停止点的选肢卡片、入戏输入、幕末黑场（均在台词条之上层级）。 */
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
  saveName,
  onSaves,
  overlay,
}: StageTheaterProps) {
  const bgmRef = useRef<HTMLAudioElement | null>(null);
  const [directorOpen, setDirectorOpen] = useState(false);
  const [directorDraft, setDirectorDraft] = useState("");
  const { view, viewLength, current, shownLength, exhausted, advance, scrub, scrubbed, history, seek } =
    playback;
  const shown = view ? view.text.slice(0, viewLength) : "";
  const lineDone = current !== null && shownLength >= current.text.length;
  // 操作条常驻：舞台上有几个能点的键，藏起来等于让玩家猜。H 手动收起做沉浸模式，仅此一种隐藏途径。
  const [chrome, setChrome] = useState(true);
  const chromeVisible = chrome;
  const [backlogOpen, setBacklogOpen] = useState(false);
  const [moreOpen, setMoreOpen] = useState(false);
  const poke = useCallback((): void => {
    setChrome(true);
  }, []);
  const toggleChrome = useCallback((): void => {
    setChrome(!chrome);
  }, [chrome]);

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
      <header className={`theater-bar ${chromeVisible ? "" : "chrome-hidden"}`} onPointerEnter={poke}>
        <button
          className="bar-btn"
          onClick={(e) => {
            e.stopPropagation();
            onBack();
          }}
        >
          返回
        </button>
        {saveName && (
          <button
            className="bar-btn save-chip"
            title="切换周目（每棵故事树独立保存）"
            onClick={(e) => {
              e.stopPropagation();
              onSaves();
            }}
          >
            {saveName}
          </button>
        )}
        <span className="theater-actions">
          {voiceAvailable && (
            <button
              className={`bar-btn ${voiceOn ? "on" : ""}`}
              title={voiceOn ? "语音开（点击静音）" : "语音关（点击开启）"}
              onClick={(e) => {
                e.stopPropagation();
                onToggleVoice();
              }}
            >
              语音
            </button>
          )}
          <button
            className={`bar-btn ${playback.auto ? "on" : ""}`}
            onClick={(e) => {
              e.stopPropagation();
              playback.setAuto(!playback.auto);
            }}
          >
            自动
          </button>
          <button
            className="bar-btn"
            aria-expanded={moreOpen}
            onClick={(e) => {
              e.stopPropagation();
              setMoreOpen((open) => !open);
              poke();
            }}
          >
            {moreOpen ? "收起" : "更多"}
          </button>
        </span>
      </header>

      {moreOpen && chromeVisible && (
        <div className="theater-more" onPointerEnter={poke}>
          <button
            className="bar-btn"
            onClick={(e) => {
              e.stopPropagation();
              setBacklogOpen(true);
              setMoreOpen(false);
            }}
          >
            回顾
          </button>
          <button
            className={`bar-btn ${oocQueued ? "on" : ""}`}
            title={oocQueued ? "导演注已入队，下一拍生效" : "导演注（OOC）：随时调整演出方向"}
            onClick={(e) => {
              e.stopPropagation();
              setDirectorOpen((open) => !open);
              setMoreOpen(false);
            }}
          >
            导演{oocQueued ? "·已注入" : ""}
          </button>
          <button
            className="bar-btn"
            onClick={(e) => {
              e.stopPropagation();
              onLog();
              setMoreOpen(false);
            }}
          >
            剧本
          </button>
          <button
            className="bar-btn"
            onClick={(e) => {
              e.stopPropagation();
              onRoute();
              setMoreOpen(false);
            }}
          >
            路线
          </button>
          <button
            className="bar-btn"
            title="工坊：和 AI 一起改设定、角色与文件"
            onClick={(e) => {
              e.stopPropagation();
              onWorkshop();
              setMoreOpen(false);
            }}
          >
            <span className="btn-icon">
              <Icon name="workshop" /> 工坊
            </span>
          </button>
        </div>
      )}

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
              <span className="btn-icon">
                <Icon name="prev" size={13} /> 回看中 · 点此回到最新
              </span>
            </button>
          ) : (
            <>
              {live && <span className="dialog-spinner" aria-label="剧作家正在写" />}
              {lineDone && !exhausted && (
                <span className="dialog-next" aria-hidden>
                  <Icon name="down" size={16} />
                </span>
              )}
            </>
          )}
        </div>
      </div>

      {/* 停止点浮层与台词条同级（都在舞台之上），入戏输入因此能贴着台词条下沿而不被它盖住 */}
      {overlay}

      <audio ref={bgmRef} loop />

      {/* AudioContext 解锁遮罩（移动端铁律：手势 resume 后语音才可播；静音用户不要求手势） */}
      {voiceAvailable && voiceOn && !unlocked && (
        <div className="voice-unlock" onClick={onUnlock} role="button">
          <span className="voice-unlock-icon">
            <Icon name="volume" size={22} />
          </span>
          <span>点击开启语音，进入剧场</span>
        </div>
      )}
    </div>
  );
}
