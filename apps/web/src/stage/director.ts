import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Cue, ScriptLine } from "./script.js";
import type { TranscriptEntry } from "./transcript.js";

/** 舞台视觉状态（视觉 cues 即时应用后的累积结果）。 */
export interface VisualState {
  bg: string | null;
  /** 背景音乐 id（null = 停）。缺省属性 = 保持当前，写 `none` 才停。 */
  bgm: string | null;
  /** 环境音 id（窗外的雨、教室的钟声…）：与 bgm 两条独立通道，ambient 更轻。 */
  ambient: string | null;
  /** 剧本给的音量（bgm_volume / ambient_volume）；缺省 = 用客户端默认值。 */
  bgmVolume?: number;
  ambientVolume?: number;
  /** 场景切换方式（fade/cut），供背景层 CSS 过渡。 */
  transition: string | null;
  cg: { id: string; caption?: string } | null;
  sprites: Record<string, { pos: string; expression: string | null }>;
  /** 预发射中（尚未到达）的生图 id（D6）：被 bg/cg 引用时先上骨架占位，不卡台词。 */
  pending: Record<string, { type: "bg" | "cg"; at: number }>;
}

/**
 * 骨架占位上限（D6 铁律：骨架禁止永久停留）。到货/失败都会立刻摘掉占位，
 * 但重连重放历史 preload、或瞬态通知恰好丢在断线窗口里时没人来摘——超时兜底。
 */
const PENDING_TTL_MS = 45_000;

const EMPTY_VISUAL: VisualState = {
  bg: null,
  bgm: null,
  ambient: null,
  transition: null,
  cg: null,
  sprites: {},
  pending: {},
};

/** 停止某条循环音轨的写法：显式 `none` 或空串。缺省（undefined）是「保持」，不是停。 */
const STOP_AUDIO = new Set(["none", ""]);

/**
 * 音轨 id 的三态：缺省保持当前、显式 `none` 停止、其余换曲。
 *
 * 这条规则是 DSL 语义的一部分（core 的 SceneAttrs 注释同款），所以单独导出便于回归测试：
 * 「换景把音乐断了」是最常见也最招骂的 bug，规则本身得钉死。
 */
export function resolveAudio(current: string | null, cue: string | undefined): string | null {
  if (cue === undefined) return current;
  return STOP_AUDIO.has(cue.trim().toLowerCase()) ? null : cue;
}

/** 记录下标：同一 key 可能出现多次（编辑后重放），播放头取最后一次。 */
function lastIndexOfKey(entries: readonly TranscriptEntry[], key: string): number {
  for (let i = entries.length - 1; i >= 0; i -= 1) if (entries[i]!.key === key) return i;
  return -1;
}

/** 谱系还没追上时，播放头这行先按台词行自造一条记录顶上，台词不会闪空。 */
function lineEntry(line: ScriptLine): TranscriptEntry {
  return {
    key: line.key,
    kind: "line",
    type: line.type === "say" || line.type === "narrate" || line.type === "thought" ? line.type : "narrate",
    actorId: line.actorId ?? null,
    text: line.text,
    seq: line.seq ?? null,
    nodeId: null,
  };
}
/**
 * 打字机节奏（剧目 theme.css 可覆盖这三个变量）。
 * 短停：逗号类；长停：句末与破折号——让句子有换气感，而不是匀速喷字。
 */
const LONG_PAUSES = new Set(["。", "！", "？", "…", "—", "」", "』"]);
const SHORT_PAUSES = new Set(["，", "、", "；", "：", "）", ".", ",", "!", "?", ";"]);

/**
 * 下一个字要等多久：上一个字是标点就多停一拍，否则按基础速度。
 * 主题变量每 250ms 读一次就够——theme.css 换皮后节奏跟着变，但不值得每个字都问一次样式引擎。
 */
interface Tempo {
  char: number;
  short: number;
  long: number;
}
let tempoCache: { at: number; value: Tempo } | null = null;

function tempo(): Tempo {
  const now = Date.now();
  if (tempoCache && now - tempoCache.at < 250) return tempoCache.value;
  const css = getComputedStyle(document.documentElement);
  const read = (name: string, fallback: number): number => {
    const value = Number.parseInt(css.getPropertyValue(name), 10);
    return Number.isFinite(value) && value >= 0 ? value : fallback;
  };
  tempoCache = {
    at: now,
    value: {
      char: read("--type-ms", 35),
      short: read("--pause-short-ms", 120),
      long: read("--pause-long-ms", 240),
    },
  };
  return tempoCache.value;
}

function charDelay(text: string, shownLength: number): number {
  const last = text[shownLength - 1];
  if (!last) return tempo().char;
  const t = tempo();
  if (LONG_PAUSES.has(last)) return t.char + t.long;
  if (SHORT_PAUSES.has(last)) return t.char + t.short;
  return t.char;
}

export interface Playback {
  visual: VisualState;
  /** 打字机目标行（null = 尚无台词）。 */
  current: ScriptLine | null;
  /** 实际显示的会话记录条目——回看时是历史条目，与 current 不同。 */
  view: TranscriptEntry | null;
  /** 实际显示的字符数（回看时恒为全文）。 */
  viewLength: number;
  shownLength: number;
  /** 全部已到 cues 消费完毕（streaming 中 = loading 呼吸点）。 */
  exhausted: boolean;
  auto: boolean;
  setAuto: (on: boolean) => void;
  /** 最近消费的音效（key 变化触发播放）。 */
  sfx: { key: string; src: string; volume?: number } | null;
  /** 舞台点击：打字中 → 瞬显全文；已完 → 消费下一条。 */
  advance: () => void;
  /** 回看游标：-1 上滚/↑ 往回翻，+1 下滚/空格 往回追（追到播放头即恢复跟随）。 */
  scrub: (delta: number) => void;
  /** 是否正停在历史条目上（不等于播放头）。 */
  scrubbed: boolean;
  /** 播放头之前说过的所有话，最新在最上（回顾用）：台词、玩家表态、导演注都在内。 */
  history: TranscriptEntry[];
  /** 跳到某条历史条目（回顾点选）。 */
  seek: (key: string) => void;
  /** 交还播放头：从任意回看位置直接回到最新（回顾的「回到最新」）。 */
  follow: () => void;
  /** 生图到达/失败：摘掉占位，视觉层交给真实资产（或降级）。 */
  settleAssets: (ids: string[]) => void;
}

export interface PlaybackHooks {
  /** 台词行开始播放（consumeNext 消费 line cue 时；narrate/scene 行 line 为 null 或非 say）。 */
  onLineStart?: (line: ScriptLine | null) => void;
  /** 打字中点击瞬显全文（二段式点击第一段：语音同步淡出）。 */
  onFastForward?: () => void;
  /** 自动模式 hold：true = 当前行语音仍在播，自动推进暂缓。 */
  hold?: boolean;
}

/**
 * 演出导演：消费 cues 队列——视觉提示即时应用、台词行打字机播放（本地节奏重整）。
 * resume 模式首次到达快进到当前末端（续演所见即上次位置）。
 */
export function usePlayback(
  cues: readonly Cue[],
  lines: readonly ScriptLine[],
  opts: {
    live: boolean;
    resume: boolean;
    revision: number;
    /** 会话记录：剧作家的台词 + 玩家的表态与输入 + 导演注。回看与回顾都只在它上面走。 */
    transcript: readonly TranscriptEntry[];
    /** 缓冲代号：变化即整段重放，播放层必须强制归零。 */
    resetToken?: number;
    /** 换代后是否快进到新分支末尾（false = 停住继续流式演出）。 */
    resumeAfterReset?: boolean;
  } & PlaybackHooks,
): Playback {
  const [visual, setVisual] = useState<VisualState>(EMPTY_VISUAL);
  const [currentKey, setCurrentKey] = useState<string | null>(null);
  const [shownLength, setShownLength] = useState(0);
  const [auto, setAuto] = useState(false);
  /** 最近消费的音效（key 变化触发播放）。 */
  const [sfx, setSfx] = useState<{ key: string; src: string; volume?: number } | null>(null);
  /** 回看游标（脚本行下标）：null = 跟随播放头。非 null 时只回看台词，舞台视觉不动。 */
  const [scrubIndex, setScrubIndex] = useState<number | null>(null);
  const cursorRef = useRef(0);
  const fastForwardedRef = useRef(!opts.resume);
  const linesRef = useRef(lines);
  linesRef.current = lines;
  const transcript = opts.transcript;
  const transcriptRef = useRef(transcript);
  transcriptRef.current = transcript;
  const hooksRef = useRef<PlaybackHooks>({});
  hooksRef.current = { onLineStart: opts.onLineStart, onFastForward: opts.onFastForward };

  const current = currentKey ? (linesRef.current.find((l) => l.key === currentKey) ?? null) : null;

  /**
   * 回看游标走会话记录，不走脚本缓冲。
   * 缓冲里混着 scene/sfx/cg 这些布景行，滑回去会看见「背景 · 校门口」当台词；
   * 而玩家的选择、自由输入、导演注只在谱系里，缓冲里根本没有——两边都拿会话记录才同时对。
   */
  const headIndex = currentKey ? lastIndexOfKey(transcript, currentKey) : -1;
  const view: TranscriptEntry | null =
    scrubIndex !== null
      ? (transcript[scrubIndex] ?? null)
      : // 谱系按需拉取会落后缓冲一两句，此时播放头还没进记录：直接用缓冲这行顶上，别让台词闪空。
        (current ? lineEntry(current) : null);
  const scrubbed = scrubIndex !== null;
  const headIndexRef = useRef(headIndex);
  headIndexRef.current = headIndex;

  /** 往回/往前翻一条；翻到播放头即交还跟随。舞台视觉不随回看变动。 */
  const scrub = useCallback((delta: number): void => {
    setScrubIndex((prev) => {
      const list = transcriptRef.current;
      const head = headIndexRef.current >= 0 ? headIndexRef.current : list.length - 1;
      const next = Math.max(0, Math.min((prev ?? head) + delta, head));
      return next >= head ? null : next;
    });
  }, []);

  const applyVisual = useCallback((cue: Cue): void => {
    setVisual((prev) => {
      switch (cue.kind) {
        case "scene":
          // 音频属性缺省 = 保持（换景不换乐）；显式 none/空串才停。见 nextAudio。
          return {
            ...prev,
            bg: cue.bg ?? prev.bg,
            bgm: resolveAudio(prev.bgm, cue.bgm),
            ambient: resolveAudio(prev.ambient, cue.ambient),
            bgmVolume: cue.bgmVolume ?? prev.bgmVolume,
            ambientVolume: cue.ambientVolume ?? prev.ambientVolume,
            transition: cue.transition ?? "fade",
            cg: cue.bg ? null : prev.cg,
          };
        case "cg":
          return { ...prev, cg: { id: cue.id, caption: cue.caption } };
        case "preload": {
          if (cue.type === "sprite") return prev;
          return { ...prev, pending: { ...prev.pending, [cue.id]: { type: cue.type, at: Date.now() } } };
        }
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
        const line = linesRef.current.find((l) => l.key === cue.lineKey) ?? null;
        hooksRef.current.onLineStart?.(line);
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
      hooksRef.current.onFastForward?.();
      return;
    }
    consumeNext();
  }, [canAdvance, current, consumeNext]);

  // 打字机：本地节奏逐字推进（目标行文本随流式增长，追赶即等待）。
  // 标点决定下一个字的等待时长——逗号类短停、句号类长停，读起来才有呼吸（galgame 惯例）。
  useEffect(() => {
    if (!current || shownLength >= current.text.length) return;
    const timer = setTimeout(() => setShownLength((n) => n + 1), charDelay(current.text, shownLength));
    return () => clearTimeout(timer);
  }, [current, shownLength]);

  // 自动模式：行播完且还有后续 → 延迟推进；尚未开演时自动起播。
  // 语音 hold：当前行语音仍在播则暂缓（D5 文字先行、语音收尾再走）。
  // 依赖 opts.revision：cues 是原地变更的稳定引用，新事件批次到达时须重新评估。
  useEffect(() => {
    if (!auto) return;
    if (opts.hold) return;
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
  }, [auto, current, lineComplete, cues, consumeNext, opts.revision, opts.hold]);

  // 缓冲替换检测（P6）：resetToken 变化 = 事件缓冲已被结构性操作整段重放
  // （cues 长度未必变短，length 比较看不出分岔/重写——必须靠代号）
  const resetTokenRef = useRef(opts.resetToken ?? 0);
  useEffect(() => {
    const token = opts.resetToken ?? 0;
    if (token === resetTokenRef.current) return;
    resetTokenRef.current = token;
    cursorRef.current = 0;
    setCurrentKey(null);
    setShownLength(0);
    setScrubIndex(null);
    setVisual(EMPTY_VISUAL);
    fastForwardedRef.current = !opts.resumeAfterReset; // true 则紧接着快进到新分支末尾
  }, [opts.resetToken, opts.resumeAfterReset]);

  // cues 到达/重置检测：builder reset（fresh start）→ 播放归零
  useEffect(() => {
    if (cues.length < cursorRef.current) {
      cursorRef.current = 0;
      setCurrentKey(null);
      setShownLength(0);
      setScrubIndex(null);
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

  // 骨架超时兜底：定期摘掉到点还没到货的占位，落到氛围底色而不是一直闪
  useEffect(() => {
    if (Object.keys(visual.pending).length === 0) return;
    const timer = setInterval(() => {
      const now = Date.now();
      setVisual((prev) => {
        const stale = Object.entries(prev.pending)
          .filter(([, v]) => now - v.at >= PENDING_TTL_MS)
          .map(([id]) => id);
        if (stale.length === 0) return prev;
        const pending = { ...prev.pending };
        for (const id of stale) delete pending[id];
        return { ...prev, pending };
      });
    }, 5000);
    return () => clearInterval(timer);
  }, [visual.pending]);

  const settleAssets = useCallback((ids: string[]): void => {
    if (ids.length === 0) return;
    setVisual((prev) => {
      if (Object.keys(prev.pending).length === 0) return prev;
      const pending = { ...prev.pending };
      for (const id of ids) delete pending[id];
      return { ...prev, pending };
    });
  }, []);

  /** 回顾：播放头之前说过的所有话，倒序给（最近的排最前）。 */
  const history = useMemo(
    () => transcript.slice(0, Math.max(headIndex, 0)).reverse(),
    [transcript, headIndex],
  );

  /** 跳到指定历史条目——与 scrub 同一个游标，Esc 或再点回到播放头。 */
  const seek = useCallback((key: string): void => {
    const at = lastIndexOfKey(transcriptRef.current, key);
    if (at < 0) return;
    setScrubIndex(at >= headIndexRef.current ? null : at);
  }, []);

  const follow = useCallback((): void => {
    setScrubIndex(null);
  }, []);

  return {
    visual,
    current,
    view,
    viewLength: scrubbed ? (view?.text.length ?? 0) : shownLength,
    shownLength,
    exhausted,
    auto,
    setAuto,
    advance,
    scrub,
    scrubbed,
    history,
    seek,
    follow,
    sfx,
    settleAssets,
  };
}
