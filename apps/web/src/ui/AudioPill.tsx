import { useEffect, useRef, useState } from "react";
import { Icon } from "@aivn/stage";

/** 秒 → `m:ss`。 */
function clock(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds <= 0) return "0:00";
  const total = Math.floor(seconds);
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, "0")}`;
}

/** 路径 → 认得出的短名（`assets/bgm/spring.m4a` → `spring.m4a`）。 */
function labelOf(path: string): string {
  return path.split("/").pop() ?? path;
}

/**
 * 一句素材音频的紧凑播放器。
 *
 * 浏览器自带的 `<audio controls>` 是个两三百像素宽的小面板：音量条、三个点菜单、下载项，
 * 一路排开比整条消息还抢眼，而且每个浏览器的样子都不一样。这里只留三件东西——
 * 播放键、进度条、时长；点整条即播/停，进度条上点哪儿从哪儿播。
 */
export function AudioPill({ src, path }: { src: string; path: string }) {
  const ref = useRef<HTMLAudioElement | null>(null);
  const [playing, setPlaying] = useState(false);
  const [pos, setPos] = useState(0);
  const [dur, setDur] = useState(0);

  // 卸载时把声音停掉：对话里滚过去一条还在响的音频是最容易忘的一种
  useEffect(() => () => ref.current?.pause(), []);

  const toggle = (): void => {
    const el = ref.current;
    if (!el) return;
    if (el.paused) void el.play().catch(() => setPlaying(false));
    else el.pause();
  };

  const seek = (event: React.MouseEvent<HTMLSpanElement>): void => {
    const el = ref.current;
    if (!el || dur <= 0) return;
    const rect = event.currentTarget.getBoundingClientRect();
    const ratio = Math.min(1, Math.max(0, (event.clientX - rect.left) / rect.width));
    el.currentTime = ratio * dur;
    setPos(el.currentTime);
  };

  const pct = dur > 0 ? Math.min(100, (pos / dur) * 100) : 0;

  return (
    <span className={`audio-pill${playing ? " on" : ""}`}>
      <button type="button" className="audio-pill-btn" onClick={toggle} title={playing ? "停" : "听"}>
        <Icon name={playing ? "pause" : "play"} size={12} />
      </button>
      <span className="audio-pill-name" title={path}>
        {labelOf(path)}
      </span>
      <span className="audio-track" onClick={seek} role="presentation">
        <span className="audio-fill" style={{ width: `${pct}%` }} />
      </span>
      <span className="audio-time">{clock(playing || pos > 0 ? pos : dur)}</span>
      <audio
        ref={ref}
        src={src}
        preload="metadata"
        onPlay={() => setPlaying(true)}
        onPause={() => setPlaying(false)}
        onEnded={() => {
          setPlaying(false);
          setPos(0);
        }}
        onLoadedMetadata={(e) => setDur(e.currentTarget.duration)}
        onTimeUpdate={(e) => setPos(e.currentTarget.currentTime)}
      />
    </span>
  );
}
