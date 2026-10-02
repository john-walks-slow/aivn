import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ActorAction, ActorAnchor, ActorShot, ReadPos } from "@stage-ai/core";
import { isActorAction, layoutSprites, parsePosition, type SpritePosition } from "@stage-ai/core";
import { shouldAutoStart } from "./playbackState.js";
import type { Cue, ScriptLine } from "./script.js";
import type { TranscriptEntry } from "./transcript.js";

/** 找回「seq 属于哪条台词 cue」的下标；找不到返回 -1（换过分支的旧位置、老档的行）。 */
export function lineCueIndexAt(cues: readonly Cue[], lines: readonly ScriptLine[], seq: number): number {
  for (let i = 0; i < cues.length; i += 1) {
    const cue = cues[i]!;
    if (cue.kind !== "line") continue;
    if (lines.find((l) => l.key === cue.lineKey)?.seq === seq) return i;
  }
  return -1;
}

/**
 * 一个人物 sprite 的舞台上状态。
 *
 * `pos` 存**显式写过的站位**（undefined = 没点名 = 跟着自动排布走）；`resolvedPos`
 * 是每次重算后的最终站位。这样「谁手动钉住、谁自动」的信息不会在第一次排布后丢失。
 */
export interface SpriteSlot {
  pos?: SpritePosition;
  resolvedPos: SpritePosition;
  expression: string | null;
  state: string | null;
  shot: ActorShot | null;
  anchor: ActorAnchor;
  /**
   * 行为词（剧本的 `action=`）与它的演出序号。
   *
   * `actionSeq` 是必要的：同一个词连演两次（nod 之后又 nod）必须重播，
   * 而 React 看到相同的 props 不会重挂 animation。序号每来一次行为词就 +1，
   * 渲染层拿它当 animation 的重播 nonce（见 StageTheater 的 Sprite）。
   */
  action: ActorAction | null;
  actionSeq: number;
  /** 正在退场（淡出播完才真正摘掉，见 applyVisual 的 actor 分支）。 */
  leaving?: boolean;
}

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
  /** 在场角色 id → 舞台状态。站位每次重排都重算（见 applyVisual）。 */
  sprites: Record<string, SpriteSlot>;
  /** 预发射中（尚未到达）的生图 id（D6）：被 bg/cg 引用时先上骨架占位，不卡台词。 */
  pending: Record<string, { type: "bg" | "cg"; at: number }>;
}

/** 空 slot 的缺省值——`anchor` 默认 bottom（脚踩地），其余都是「不指定」。 */
function newSlot(): SpriteSlot {
  return {
    resolvedPos: "center",
    expression: null,
    state: null,
    shot: null,
    anchor: "bottom",
    action: null,
    actionSeq: 0,
  };
}

/**
 * 应用一条 `<actor>` 指令：在场表怎么变。
 *
 * 纯函数，单独导出是为了能测——站位重算是这一版的中心逻辑，
 * 而它藏在 `applyVisual` 的 useCallback 里就只能靠实机看。
 *
 * **每次都重排全场**：第二个人进场时第一个人要让位，这是「不写位置、按人数自动分配」
 * 能成立的唯一办法。显式钉过 `at` 的不动（pos 有值的退出自动排布），
 * 其余按剩余人数重新分配，且避开已被占掉的档位。
 */
export function applyActorCue(
  sprites: Record<string, SpriteSlot>,
  cue: Extract<Cue, { kind: "actor" }>,
): Record<string, SpriteSlot> {
  const isLeave = Boolean(cue.leave) || cue.action === "exit" || cue.action === "leave";
  const leaving = sprites[cue.id];
  const next: Record<string, SpriteSlot> = isLeave
    ? // 软删除而不是从表里抹掉：直接抹掉没有淡出可播，角色是「啪」地消失。
      leaving
      ? { ...sprites, [cue.id]: { ...leaving, leaving: true } }
      : sprites
    : {
        ...sprites,
        [cue.id]: {
          ...(sprites[cue.id] ?? newSlot()),
          // 显式站位：认不出来就当没写（走自动），不猜不抛
          pos: parsePosition(cue.pos) ?? sprites[cue.id]?.pos,
          expression: cue.expression ?? sprites[cue.id]?.expression ?? null,
          state: cue.state ?? sprites[cue.id]?.state ?? null,
          shot: cue.shot ?? sprites[cue.id]?.shot ?? null,
          anchor: cue.anchor ?? sprites[cue.id]?.anchor ?? "bottom",
          // 行为词是一次性的：给了就演一次，不给不重播。exit/leave 走退场分支，
          // 不该同时被当成行为词（`action="leave"` 是退场的旧写法，不是动作）。
          action: isActorAction(cue.action) ? cue.action : null,
          actionSeq: isActorAction(cue.action) ? (sprites[cue.id]?.actionSeq ?? 0) + 1 : (sprites[cue.id]?.actionSeq ?? 0),
          leaving: false,
        },
      };

  const explicit = new Map<string, SpritePosition>();
  for (const [id, slot] of Object.entries(next)) {
    if (slot.pos && !slot.leaving) explicit.set(id, slot.pos);
  }
  // 正在退场的**不占排布名额**：它还在表里只是为了把淡出播完。
  // 算进去的话，一个人退场后剩下的人永远按「两人同框」摆着，再也回不到居中。
  const standing = Object.keys(next).filter((id) => !next[id]!.leaving);
  const layout = layoutSprites(standing, explicit);
  return Object.fromEntries(
    Object.entries(next).map(([id, slot]) => [
      id,
      // 退场中的人保留它退场前的位置（不动它，淡出才自然）
      { ...slot, resolvedPos: slot.leaving ? slot.resolvedPos : (layout.get(id) ?? "center") },
    ]),
  );
}

/**
 * 骨架占位上限（D6 铁律：骨架禁止永久停留）。到货/失败都会立刻摘掉占位，
 * 但重连重放历史 preload、或瞬态通知恰好丢在断线窗口里时没人来摘——超时兜底。
 *
 * 上界由服务端按生图配置下发（hello.assetsTtlMs），因为只有服务端知道一次预发射
 * 真正可能花多久。这个兜底只在「没人会再来说一声」时开火，早于它摘掉占位等于
 * 把正在生成的骨架自己撤了——那正是 45s 写死时的后果。服务端没给（旧协议）时的
 * 回落值刻意取大，宁可多等也不误杀。
 */
const PENDING_TTL_MS = 600_000;

/** 兜底上界（毫秒）：服务端没给 assetsTtlMs 时的保守值。 */
export function pendingTtlMs(fromServer: number | null | undefined): number {
  return fromServer !== null && fromServer !== undefined && fromServer > 0 ? fromServer : PENDING_TTL_MS;
}

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
 * 下一个字要等多久：上一个字是标点就多停一轮，否则按基础速度。
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
  /** 播放头推进（逐字）：上报阅读位置，由外层防抖、服务端节流落盘。 */
  onRead?: (pos: ReadPos) => void;
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
    /** 上次退出时读到的位置（hello.readPos）：首屏据此 seek 回那一句，而不是快进到本轮末尾。 */
    resumeAt?: ReadPos | null;
    /** 按住 Ctrl 的快进档：当前行一次读完，行间不设停顿，一路追到缓冲末端。 */
    turbo?: boolean;
    /** 骨架占位的兜底上界（hello.assetsTtlMs）；缺省用保守默认值。 */
    assetsTtlMs?: number | null;
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
  /** 快进到末尾后要不要显示末行；false = 只推进游标与视觉，留给等待态。 */
  const showTailRef = useRef(opts.resumeAfterReset === true);
  const linesRef = useRef(lines);
  linesRef.current = lines;
  const transcript = opts.transcript;
  const transcriptRef = useRef(transcript);
  transcriptRef.current = transcript;
  const hooksRef = useRef<PlaybackHooks>({});
  hooksRef.current = { onLineStart: opts.onLineStart, onFastForward: opts.onFastForward };
  /** 首屏 seek 目标：只在首次快进时消费一次，之后由 resetToken 换代清空（老分支的 seq 不能拿来 seek）。 */
  const resumeAtRef = useRef<ReadPos | null>(opts.resumeAt ?? null);
  // hello 比事件重放晚到还是早到不保证，用 effect 同步而不是只在首渲染取一次初值。
  useEffect(() => {
    if (opts.resumeAt) resumeAtRef.current = opts.resumeAt;
  }, [opts.resumeAt]);

  const current = currentKey ? (linesRef.current.find((l) => l.key === currentKey) ?? null) : null;
  const turbo = opts.turbo ?? false;

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
        case "actor":
          return { ...prev, cg: null, sprites: applyActorCue(prev.sprites, cue) };
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
  // 快进档：不等字，整行一次读完（语音同步淡出，与点击二段式第一段同一套钩子）。
  useEffect(() => {
    if (!current || shownLength >= current.text.length) return;
    if (turbo) {
      setShownLength(current.text.length);
      hooksRef.current.onFastForward?.();
      return;
    }
    const timer = setTimeout(() => setShownLength((n) => n + 1), charDelay(current.text, shownLength));
    return () => clearTimeout(timer);
  }, [current, shownLength, turbo]);

  // 快进（按住 Ctrl）：不依赖自动模式——松手立刻回到原节奏，中途只追缓冲里已有的内容。
  // 回看中不推进：正在读历史时把播放头往前拽，读到的东西就白翻了。
  useEffect(() => {
    if (!turbo || scrubIndex !== null) return;
    if (current && shownLength < current.text.length) return;
    if (cursorRef.current >= cues.length) return;
    const timer = setTimeout(() => consumeNext(), 30);
    return () => clearTimeout(timer);
  }, [turbo, scrubIndex, current, shownLength, cues, consumeNext, opts.revision]);

  // 自动模式：行播完且还有后续 → 延迟推进；尚未开演时自动起播。
  // 语音 hold：当前行语音仍在播则暂缓（D5 文字先行、语音收尾再走）。
  // 快进档交给上面的 drain effect，免得两条路同时消费队列把 cue 跳过。
  // 依赖 opts.revision：cues 是原地变更的稳定引用，新事件批次到达时须重新评估。
  useEffect(() => {
    if (!auto || turbo) return;
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
  }, [auto, current, lineComplete, cues, consumeNext, opts.revision, opts.hold, turbo]);

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
    // 两种情况都要快进到新分支末尾：区别只在要不要把最后一句旧台词显示出来。
    // 后面还有内容在来时不显示——舞台要停在「剧作家正在落笔…」的等待态，
    // 一旦露出旧台词，玩家会以为这就是重来的结果。
    fastForwardedRef.current = false;
    showTailRef.current = opts.resumeAfterReset === true;
    resumeAtRef.current = null;
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
      const resumeAt = resumeAtRef.current;
      resumeAtRef.current = null;
      // 有阅读位置就 seek 回那一刻：视觉只补到那一行（后面的换景/退场属于还没读到的内容，
      // 提前生效等于剧透），游标停在那行之后，字数接着上次显示到的位置续。
      const resumeIndex = resumeAt ? lineCueIndexAt(cues, linesRef.current, resumeAt.seq) : -1;
      if (resumeIndex >= 0) {
        for (let i = 0; i <= resumeIndex; i += 1) applyVisual(cues[i]!);
        const cue = cues[resumeIndex]!;
        cursorRef.current = resumeIndex + 1;
        if (cue.kind === "line") {
          setCurrentKey(cue.lineKey);
          const line = linesRef.current.find((l) => l.key === cue.lineKey);
          setShownLength(Math.min(resumeAt!.len, line?.text.length ?? 0));
        }
        return;
      }
      for (let i = 0; i < cues.length; i += 1) applyVisual(cues[i]!);
      cursorRef.current = cues.length;
      let lastLineKey: string | null = null;
      for (const cue of cues) if (cue.kind === "line") lastLineKey = cue.lineKey;
      if (lastLineKey && showTailRef.current) {
        setCurrentKey(lastLineKey);
        const line = linesRef.current.find((l) => l.key === lastLineKey);
        setShownLength(line?.text.length ?? 0);
      }
    }
  }, [opts.revision, cues, applyVisual]);

  // 阅读位置上报：刷新后要回到原处，位置得由播放头持续告诉服务端。
  // 只认正在显示的行：回看（scrub）不改播放头，不该把回看位置存成「读到哪儿了」。
  useEffect(() => {
    const line = current;
    if (!line || line.seq === undefined) return;
    hooksRef.current.onRead?.({ seq: line.seq, len: shownLength });
  }, [current, shownLength]);

  // 演出中「等新内容」的起播：此刻没有正在显示的台词，新的一句一到就起播，不必让玩家点一下。
  // 只在 current 为 null 时生效——正在读的句子不会被新到的内容抢走，阅读节奏仍归玩家；
  // 玩家自己点着读完最后一句（current 归 null、屏幕显示「剧作家正在落笔…」）之后，
  // 新内容一到就该自己出现，这正是「边生成边演出」。
  useEffect(() => {
    const go = shouldAutoStart({
      live: opts.live,
      auto,
      hold: opts.hold === true,
      hasCurrent: current !== null,
      cursor: cursorRef.current,
      cueCount: cues.length,
    });
    if (!go) return;
    const timer = setTimeout(() => consumeNext(), 80);
    return () => clearTimeout(timer);
  }, [opts.live, auto, current, cues, consumeNext, opts.revision, opts.hold]);

  // 骨架超时兜底：定期摘掉到点还没到货的占位，落到氛围底色而不是一直闪
  const pendingTtl = pendingTtlMs(opts.assetsTtlMs);
  useEffect(() => {
    if (Object.keys(visual.pending).length === 0) return;
    const timer = setInterval(() => {
      const now = Date.now();
      setVisual((prev) => {
        const stale = Object.entries(prev.pending)
          .filter(([, v]) => now - v.at >= pendingTtl)
          .map(([id]) => id);
        if (stale.length === 0) return prev;
        const pending = { ...prev.pending };
        for (const id of stale) delete pending[id];
        return { ...prev, pending };
      });
    }, 5000);
    return () => clearInterval(timer);
  }, [visual.pending, pendingTtl]);

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
