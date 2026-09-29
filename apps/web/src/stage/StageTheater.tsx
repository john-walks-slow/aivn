import { useEffect, useRef, useState } from "react";
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
  onWorkshop: () => void;
}

const POS_CLASS: Record<string, string> = { left: "pos-left", center: "pos-center", right: "pos-right" };

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
  onWorkshop,
}: StageTheaterProps) {
  const bgmRef = useRef<HTMLAudioElement | null>(null);
  const [directorOpen, setDirectorOpen] = useState(false);
  const [directorDraft, setDirectorDraft] = useState("");
  const { current, shownLength, exhausted, advance } = playback;
  const shown = current ? current.text.slice(0, shownLength) : "";
  const lineDone = current !== null && shownLength >= current.text.length;

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

  const submitDirectorNote = (): void => {
    const text = directorDraft.trim();
    if (!text) return;
    onOoc(text);
    setDirectorDraft("");
    setDirectorOpen(false);
  };

  return (
    <div className="theater" onClick={advance}>
      <header className="theater-bar">
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

      <div className="theater-stage">
        {bgUrl ? (
          <img key={bgUrl} className="theater-bg" src={bgUrl} alt="" />
        ) : (
          <div className={`theater-bg theater-bg-fallback ${visual.transition === "cut" ? "cut" : ""}`} />
        )}

        {Object.entries(visual.sprites).map(([id, slot]) => {
          const url = index.sprite(id, slot.expression);
          if (!url) return null;
          return (
            <img
              key={id}
              className={`theater-sprite ${POS_CLASS[slot.pos] ?? "pos-center"}`}
              src={url}
              alt={names[id] ?? id}
            />
          );
        })}

        {cgUrl && (
          <div className="theater-cg">
            <img src={cgUrl} alt={visual.cg?.id ?? ""} />
            {visual.cg?.caption && <p className="theater-cg-caption">{visual.cg.caption}</p>}
          </div>
        )}
      </div>

      <div className="theater-dialog" role="text">
        {current && (current.type === "say" || current.type === "thought") && (
          <div className="dialog-name">
            {names[current.actorId ?? ""] ?? current.actorId ?? "？"}
            {current.mood && <span className="dialog-mood">（{current.mood}）</span>}
          </div>
        )}
        <p className={`dialog-text ${current?.type === "thought" ? "thought" : ""}`}>
          {shown ||
            (current ? "" : live && exhausted ? "剧作家正在落笔…" : "（点击开始演出）")}
          {current && !lineDone && <span className="dialog-caret" aria-hidden />}
        </p>
        <div className="dialog-hint">
          {exhausted && live ? (
            <span className="dialog-loading" aria-label="生成中">
              ●●●
            </span>
          ) : (
            lineDone && <span className="dialog-next" aria-hidden>
              ▼
            </span>
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
