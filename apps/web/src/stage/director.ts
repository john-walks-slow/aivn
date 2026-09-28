import { useCallback, useEffect, useRef, useState } from "react";
import type { Cue, ScriptLine } from "./script.js";

/** 舞台视觉状态（视觉 cues 即时应用后的累积结果）。 */
export interface VisualState {
  bg: string | null;
  bgm: string | null;
  /** 场景切换方式（fade/cut），供背景层 CSS 过渡。 */
  transition: string | null;
  cg: { id: string; caption?: string } | null;
  sprites: Record<string, { pos: string; expression: string | null }>;
}

const EMPTY_VISUAL: VisualState = { bg: null, bgm: null, transition: null, cg: null, sprites: {} };
const CHAR_MS = 35;

export interface Playback {
  visual: VisualState;
  /** 打字机目标行（null = 尚无台词）。 */
  current: ScriptLine | null;
  shownLength: number;
  /** 全部已到 cues 消费完毕（streaming 中 = loading 呼吸点）。 */
  exhausted: boolean;
  auto: boolean;
  setAuto: (on: boolean) => void;
  /** 最近消费的音效（key 变化触发播放）。 */
  sfx: { key: string; src: string; volume?: number } | null;
  /** 舞台点击：打字中 → 瞬显全文；已完 → 消费下一条。 */
  advance: () => void;
}

/**
 * 演出导演：消费 cues 队列——视觉提示即时应用、台词行打字机播放（本地节奏重整）。
 * resume 模式首次到达快进到当前末端（续演所见即上次位置）。
 */
export function usePlayback(
  cues: readonly Cue[],
  lines: readonly ScriptLine[],
  opts: { live: boolean; resume: boolean; revision: number },
): Playback {
  const [visual, setVisual] = useState<VisualState>(EMPTY_VISUAL);
  const [currentKey, setCurrentKey] = useState<string | null>(null);
  const [shownLength, setShownLength] = useState(0);
  const [auto, setAuto] = useState(false);
  /** 最近消费的音效（key 变化触发播放）。 */
  const [sfx, setSfx] = useState<{ key: string; src: string; volume?: number } | null>(null);
  const cursorRef = useRef(0);
  const fastForwardedRef = useRef(!opts.resume);
  const linesRef = useRef(lines);
  linesRef.current = lines;

  const current = currentKey ? (linesRef.current.find((l) => l.key === currentKey) ?? null) : null;

  const applyVisual = useCallback((cue: Cue): void => {
    setVisual((prev) => {
      switch (cue.kind) {
        case "scene":
          return {
            ...prev,
            bg: cue.bg ?? prev.bg,
            bgm: cue.bgm ?? null,
            transition: cue.transition ?? "fade",
            cg: cue.bg ? null : prev.cg,
          };
        case "cg":
          return { ...prev, cg: { id: cue.id, caption: cue.caption } };
        case "actor": {
          if (cue.action === "exit" || cue.action === "leave") {
            const sprites = { ...prev.sprites };
            delete sprites[cue.id];
            return { ...prev, sprites };
          }
          const existing = prev.sprites[cue.id];
          return {
            ...prev,
            cg: null,
            sprites: {
              ...prev.sprites,
              [cue.id]: { pos: cue.pos ?? existing?.pos ?? "center", expression: cue.expression ?? null },
            },
          };
        }
        default:
          return prev;
      }
    });
  }, []);

  /** 消费队列直到下一句台词（视觉提示连续应用）。 */
  const consumeNext = useCallback((): void => {
    for (;;) {
      const cue = cues[cursorRef.current];
      if (!cue) return;
      cursorRef.current += 1;
      if (cue.kind === "line") {
        setCurrentKey(cue.lineKey);
        setShownLength(0);
        return;
      }
      if (cue.kind === "sfx") {
        setSfx({ key: cue.key, src: cue.src, volume: cue.volume });
        continue;
      }
      applyVisual(cue);
    }
  }, [cues, applyVisual]);

  /** 该行是否已播完（文本到头，且不再有增量——live 中以「下一条 cue 已到」为准）。 */
  const lineComplete = current !== null && shownLength >= current.text.length;
  const canAdvance = current === null || lineComplete;
  /** 派生：队列消费到头且当前行播完（无台词也算到头）——streaming 中即「等新内容」。 */
  const exhausted = cues.length <= cursorRef.current && (current === null || lineComplete);

  const advance = useCallback((): void => {
    if (!canAdvance) {
      setShownLength(current?.text.length ?? 0);
      return;
    }
    consumeNext();
  }, [canAdvance, current, consumeNext]);

  // 打字机：本地节奏逐字推进（目标行文本随流式增长，追赶即等待）
  useEffect(() => {
    if (!current || shownLength >= current.text.length) return;
    const timer = setTimeout(() => setShownLength((n) => n + 1), CHAR_MS);
    return () => clearTimeout(timer);
  }, [current, shownLength]);

  // 自动模式：行播完且还有后续 → 延迟推进；尚未开演时自动起播。
  // 依赖 opts.revision：cues 是原地变更的稳定引用，新事件批次到达时须重新评估。
  useEffect(() => {
    if (!auto) return;
    if (!current) {
      if (cursorRef.current >= cues.length) return;
      const timer = setTimeout(() => consumeNext(), 400);
      return () => clearTimeout(timer);
    }
    if (!lineComplete) return;
    const next = cues[cursorRef.current];
    if (!next) return;
    const delay = Math.min(900 + current.text.length * 55, 3200);
    const timer = setTimeout(() => consumeNext(), delay);
    return () => clearTimeout(timer);
  }, [auto, current, lineComplete, cues, consumeNext, opts.revision]);

  // cues 到达/重置检测：builder reset（fresh start）→ 播放归零
  useEffect(() => {
    if (cues.length < cursorRef.current) {
      cursorRef.current = 0;
      setCurrentKey(null);
      setShownLength(0);
      setVisual(EMPTY_VISUAL);
      return;
    }
    // resume 首次快进：视觉全应用 + 末行全文显示
    if (!fastForwardedRef.current && cues.length > 0) {
      fastForwardedRef.current = true;
      for (let i = 0; i < cues.length; i += 1) applyVisual(cues[i]!);
      cursorRef.current = cues.length;
      let lastLineKey: string | null = null;
      for (const cue of cues) if (cue.kind === "line") lastLineKey = cue.lineKey;
      if (lastLineKey) {
        setCurrentKey(lastLineKey);
        const line = linesRef.current.find((l) => l.key === lastLineKey);
        setShownLength(line?.text.length ?? 0);
      }
    }
  }, [opts.revision, cues, applyVisual]);

  return { visual, current, shownLength, exhausted, auto, setAuto, advance, sfx };
}
