import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ActorAction, ActorAnchor, ActorShot, ReadPos } from "@aivn/core";
import { isActorAction, layoutSprites, parsePosition, type SpritePosition } from "@aivn/core";
import { shouldAutoStart } from "./playbackState.js";
import type { Cue, ScriptLine } from "./script.js";
import type { TranscriptEntry } from "./transcript.js";

/** 找回「nodeId 属于哪条台词 cue」的下标；找不到返回 -1（换过分支的旧位置、老档的行）。 */
export function lineCueIndexByNodeId(
  cues: readonly Cue[],
  lines: readonly ScriptLine[],
  nodeId: string,
): number {
  for (let i = 0; i < cues.length; i += 1) {
    const cue = cues[i]!;
    if (cue.kind !== "line") continue;
    if (lines.find((l) => l.key === cue.lineKey)?.nodeId === nodeId) return i;
  }
  return -1;
}

/** 老档兼容：按 seq 找回台词 cue 下标；找不到返回 -1。 */
export function lineCueIndexAt(cues: readonly Cue[], lines: readonly ScriptLine[], seq: number): number {
  for (let i = 0; i < cues.length; i += 1) {
    const cue = cues[i]!;
    if (cue.kind !== "line") continue;
    if (lines.find((l) => l.key === cue.lineKey)?.seq === seq) return i;
  }
  return -1;
}

/** 刷新恢复的落点：停在哪条 cue 上、那行已经显示到第几个字。 */
export interface ResumeSeek {
  /** cue 下标；-1 = 这条世界线上找不到（换过分支的旧位置），交给调用方快进到末尾。 */
  cueIndex: number;
  /** 该行打字机要一次性补到第几个字（行内刷新就是靠它回到读到的那一个字）。 */
  shownLength: number;
}

/**
 * 刷新后「我在哪个节点读到第几个字」的唯一解算点。
 *
 * 优先按稳定 nodeId 寻址（跨刷新、跨分支切换都成立），老档没有 nodeId 时才退回 seq；
 * offset 超出行长就补到行尾——宁可多显示一个字，也不能让进度看起来倒退。
 */
export function resolveResumeSeek(
  cues: readonly Cue[],
  lines: readonly ScriptLine[],
  resumeAt: ReadPos,
): ResumeSeek {
  const cueIndex = resumeAt.nodeId
    ? lineCueIndexByNodeId(cues, lines, resumeAt.nodeId)
    : typeof resumeAt.seq === "number"
      ? lineCueIndexAt(cues, lines, resumeAt.seq)
      : -1;
  if (cueIndex < 0) return { cueIndex: -1, shownLength: 0 };
  const cue = cues[cueIndex]!;
  if (cue.kind !== "line") return { cueIndex, shownLength: 0 };
  const line = lines.find((l) => l.key === cue.lineKey);
  const want = resumeAt.offset ?? resumeAt.len ?? 0;
  return { cueIndex, shownLength: Math.min(want, line?.text.length ?? 0) };
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
  /** 换哪张差分（人的表情、机甲的状态——同一个槽位）。null = 没写过，取目录第一张。 */
  variant: string | null;
  shot: ActorShot | null;
  /** 剧本显式写的对齐基准；null = 没写，听素材声明（见立绘的呈现三轴）。 */
  anchor: ActorAnchor | null;
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

/**
 * 空 slot 的缺省值——全是「不指定」。
 *
 * `variant` 与 `anchor` 的缺省不在这里：差分缺省是立绘目录里的第一张、对齐缺省写在素材声明里
 * （机甲居中悬空、道具贴地各不同），都由渲染层查素材表补，slot 只记剧本真写了什么。
 */
function newSlot(): SpriteSlot {
  return {
    resolvedPos: "center",
    variant: null,
    shot: null,
    anchor: null,
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
          variant: cue.variant ?? sprites[cue.id]?.variant ?? null,
          shot: cue.shot ?? sprites[cue.id]?.shot ?? null,
          anchor: cue.anchor ?? sprites[cue.id]?.anchor ?? null,
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
 * 说话者聚焦：返回该保持原亮度的那个人（其余同框立绘压暗）；没有就返回 null。
 *
 * 只有「当前这句台词的发言人确实站在台上」才算焦点：
 * - 旁白 / 空舞台没有发言人（actorId 为 null）；
 * - 玩家输入挂的是 "player"，没有对应立绘；
 * - 一次性路人（`<say id="passerby">`）或还没登场的角色也没立绘。
 *
 * 这几种情况返回 null，整台回到原亮度——不把上一句的焦点留到下一句，
 * 否则旁白一来画面就跳一下、说话的人退场后焦点还挂在一个不在台上的人身上。
 */
export function speakerFocusId(
  view: TranscriptEntry | null,
  sprites: Record<string, SpriteSlot>,
): string | null {
  const id = view?.actorId;
  return id && sprites[id] ? id : null;
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

/**
 * 一条 cue 对**画面**的改动：背景 / CG / 立绘在场表。
 *
 * 音频与骨架占位刻意不在其中——那两件事只属于「此刻」：音乐是当下的氛围（跟着回看
 * 倒退，滚轮就成了打碟机），骨架讲的是「图还在路上」（历史画面不该显示占位）。
 * 回看重算（`visualAt`）折的就是这一条。
 */
export function applyVisualCue(visual: VisualState, cue: Cue): VisualState {
  switch (cue.kind) {
    case "scene":
      return {
        ...visual,
        bg: cue.bg ?? visual.bg,
        transition: cue.transition ?? "fade",
        // 换景即从上一张插画里出来：CG 是「这一刻的画面」，不跨景延续
        cg: cue.bg ? null : visual.cg,
      };
    case "cg":
      return { ...visual, cg: { id: cue.id, caption: cue.caption } };
    case "actor":
      return { ...visual, cg: null, sprites: applyActorCue(visual.sprites, cue) };
    default:
      return visual;
  }
}

/** 一条 cue 对舞台的全部改动 = 画面 + 音频 + 骨架占位。播放头往前走时走这条。 */
export function applyCue(visual: VisualState, cue: Cue): VisualState {
  const next = applyVisualCue(visual, cue);
  switch (cue.kind) {
    case "scene":
      // 音频属性缺省 = 保持（换景不换乐）；显式 none/空串才停。见 resolveAudio。
      return {
        ...next,
        bgm: resolveAudio(next.bgm, cue.bgm),
        ambient: resolveAudio(next.ambient, cue.ambient),
        bgmVolume: cue.bgmVolume ?? next.bgmVolume,
        ambientVolume: cue.ambientVolume ?? next.ambientVolume,
      };
    case "preload":
      if (cue.type === "sprite") return next;
      return { ...next, pending: { ...next.pending, [cue.id]: { type: cue.type, at: Date.now() } } };
    default:
      return next;
  }
}

/** 台上还站着的人：退场中的不算（他们留在表里只为把淡出播完）。 */
function standingSprites(sprites: Record<string, SpriteSlot>): Record<string, SpriteSlot> {
  const out: Record<string, SpriteSlot> = {};
  for (const [id, slot] of Object.entries(sprites)) if (!slot.leaving) out[id] = slot;
  return out;
}

/**
 * 回看：把舞台画面折回「第 `upto` 条 cue 之前」的那一刻。
 *
 * 从空场起折，所以早于立绘入场的那一刻台上就没有这个人——这正是「回到那一刻」
 * 该有的样子。一次性音效不重放、骨架占位不重现（都不在画面里），音乐不回退
 * （调用方把现场那条音频贴回来）。
 */
export function visualAt(cues: readonly Cue[], upto: number): VisualState {
  let visual = EMPTY_VISUAL;
  for (let i = 0; i < upto; i += 1) visual = applyVisualCue(visual, cues[i]!);
  return { ...visual, sprites: standingSprites(visual.sprites) };
}

/**
 * 一副画面 + 当前这一行上挂着的插图 = 该显示什么。
 *
 * 回看中生图落的是行级旁注（`LineageNodeView.cgs`）：翻到那一行它就在画面上，
 * 翻过去就没了——图属于那一刻，不跟着世界线往后走。
 */
export function withAttachedCg(
  visual: VisualState,
  nodeId: string | null | undefined,
  cgByNode?: ReadonlyMap<string, string>,
): VisualState {
  const attached = nodeId ? cgByNode?.get(nodeId) : undefined;
  return attached ? { ...visual, cg: { id: attached } } : visual;
}

/**
 * 画面这一刻属于谱系里哪个节点：回看认游标那一条，跟随播放头认正在显示的这一行。
 *
 * 缓冲行（`fromLine`）的 nodeId 恒为 null——它取自脚本缓冲，谱系是按需拉的、可能还没跟上；
 * 回看窗里的那一条来自会话记录，两处指的都是同一行，各取各的才不会认错。
 */
export function displayedNodeId(
  entry: TranscriptEntry | null,
  line: ScriptLine | null,
  scrubbed: boolean,
): string | null {
  return scrubbed ? (entry?.nodeId ?? null) : (line?.nodeId ?? entry?.nodeId ?? null);
}

/**
 * 回看游标（会话记录下标）→ cue 水位线：折到这一条之前，舞台就是「它刚出现」的样子。
 *
 * 台词条目找它那条 line cue；玩家输入在缓冲里没有 cue，落到下一条台词之前
 * （即上一句演完之后）。找不到返回 null——谱系比缓冲快、或换过分支时，宁可不回退
 * 画面，也不能拿一个错的水位线把舞台折成另一个时刻。
 */
export function cueWatermarkForEntry(
  cues: readonly Cue[],
  transcript: readonly TranscriptEntry[],
  index: number,
): number | null {
  const cueIndexAt = (key: string): number => {
    for (let i = 0; i < cues.length; i += 1) {
      const cue = cues[i]!;
      if (cue.kind === "line" && cue.lineKey === key) return i;
    }
    return -1;
  };
  const entry = transcript[index];
  if (!entry) return null;
  if (entry.kind === "line") {
    const at = cueIndexAt(entry.key);
    return at < 0 ? null : at;
  }
  // 玩家输入：它后面紧跟着的那句台词之前，就是这句话说完时的舞台
  for (let i = index + 1; i < transcript.length; i += 1) {
    const next = transcript[i]!;
    if (next.kind !== "line") continue;
    const at = cueIndexAt(next.key);
    return at < 0 ? null : at;
  }
  // 它是最后一条：整条缓冲都演完了，就是现场
  return cues.length;
}

/** 记录下标：同一 key 可能出现多次（编辑后重放），播放头取最后一次。 */
function lastIndexOfKey(entries: readonly TranscriptEntry[], key: string): number {
  for (let i = entries.length - 1; i >= 0; i -= 1) if (entries[i]!.key === key) return i;
  return -1;
}

/** 谱系还没追上时，播放头这行先自造一条记录顶上，台词不会闪空。 */
function lineEntry(line: ScriptLine): TranscriptEntry {
  if (line.type === "input") {
    return {
      key: line.key,
      kind: "input",
      type: "say",
      actorId: "player",
      text: line.text,
      seq: line.seq ?? null,
      nodeId: null,
    };
  }
  return {
    key: line.key,
    kind: "line",
    type: line.type === "say" || line.type === "narrate" || line.type === "thought" ? line.type : "narrate",
    actorId: line.actorId ?? null,
    ...(line.nameOverride ? { nameOverride: line.nameOverride } : {}),
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
  /** 回看游标：-1 上滚/↑ 往回翻，+1 下滚/↓/←/→ 往回追（追到播放头即恢复跟随）。 */
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
    /**
     * 结构性操作（跳转重读）配套的播放头落点：resetToken 换代后从这个位置起读
     * （offset=0 即该句从头打字），而不是按 resumeAfterReset 快进到本轮末尾。
     */
    seekTo?: ReadPos | null;
    /** 按住 Ctrl 的快进档：当前行一次读完，行间不设停顿，一路追到缓冲末端。 */
    turbo?: boolean;
    /** 骨架占位的兜底上界（hello.assetsTtlMs）；缺省用保守默认值。 */
    assetsTtlMs?: number | null;
    /**
     * 挂在行上的插图（谱系旁注）：nodeId → cg id。回看中生图接的就是这条——
     * 那一行显示时图就在画面上，世界线一根不动。同一行挂过多张时取最新的那张。
     */
    cgByNode?: ReadonlyMap<string, string>;
  } & PlaybackHooks,
): Playback {
  const [visual, setVisual] = useState<VisualState>(EMPTY_VISUAL);
  const [currentKey, setCurrentKey] = useState<string | null>(null);
  const [shownLength, setShownLength] = useState(0);
  const [auto, setAuto] = useState(false);
  /** 最近消费的音效（key 变化触发播放）。 */
  const [sfx, setSfx] = useState<{ key: string; src: string; volume?: number } | null>(null);
  /** 回看游标（脚本行下标）：null = 跟随播放头。非 null 时台词与舞台画面都回到那一刻（见 rewindVisual）。 */
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
  /** 正显示这一行的谱系节点：插图旁注按它认领（见 withAttachedCg）。 */
  const displayedNode = displayedNodeId(view, current, scrubbed);
  const headIndexRef = useRef(headIndex);
  headIndexRef.current = headIndex;

  /** 往回/往前翻一条；翻到播放头即交还跟随。舞台画面随游标折回那一刻（见 rewindVisual）。 */
  const scrub = useCallback((delta: number): void => {
    setScrubIndex((prev) => {
      const list = transcriptRef.current;
      const head = headIndexRef.current >= 0 ? headIndexRef.current : list.length - 1;
      const next = Math.max(0, Math.min((prev ?? head) + delta, head));
      return next >= head ? null : next;
    });
  }, []);

  const applyVisual = useCallback((cue: Cue): void => {
    setVisual((prev) => applyCue(prev, cue));
  }, []);

  /** 消费队列直到下一句台词（视觉提示连续应用）。 */
  const consumeNext = useCallback((): void => {
    for (;;) {
      const cue = cues[cursorRef.current];
      if (!cue) return;
      cursorRef.current += 1;
      if (cue.kind === "line") {
        const line = linesRef.current.find((l) => l.key === cue.lineKey) ?? null;
        setCurrentKey(cue.lineKey);
        // 玩家回执一次到位：那是他刚说的话，不是逐字打出来的台词。
        setShownLength(line?.type === "input" ? line.text.length : 0);
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
    // 跳转重读：换代后从这个落点起读，而不是快进到本轮末尾
    resumeAtRef.current = opts.seekTo ?? null;
  }, [opts.resetToken, opts.resumeAfterReset, opts.seekTo]);

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
      const seek = resumeAt ? resolveResumeSeek(cues, linesRef.current, resumeAt) : null;
      const resumeIndex = seek?.cueIndex ?? -1;
      if (seek && resumeIndex >= 0) {
        for (let i = 0; i <= resumeIndex; i += 1) applyVisual(cues[i]!);
        const cue = cues[resumeIndex]!;
        cursorRef.current = resumeIndex + 1;
        if (cue.kind === "line") {
          setCurrentKey(cue.lineKey);
          setShownLength(seek.shownLength);
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
  // 首帧立即上报（切到新行 offset=0），行内打字推进由 StageScreen 侧节流。
  useEffect(() => {
    const line = current;
    if (!line || (line.nodeId === undefined && line.seq === undefined)) return;
    hooksRef.current.onRead?.({
      nodeId: line.nodeId ?? "",
      offset: shownLength,
      ...(line.seq !== undefined ? { seq: line.seq } : {}),
      len: shownLength,
    });
  }, [current, shownLength]);

  // 演出中「等新内容」的起播：此刻没有正在显示的台词，新的一句一到就起播，不必让玩家点一下。
  // 只在 current 为 null 时生效——正在读的句子不会被新到的内容抢走，阅读节奏仍归玩家；
  // 玩家自己点着读完最后一句（current 归 null、屏幕显示「剧作家正在落笔…」）之后，
  // 新内容一到就该自己出现，这正是「边生成边演出」。
  // 回执例外：停止点上选完/说完，缓冲里进来的第一张就是自己的 input 行——
  // 起播不等点击也不等演出状态（player_input 先于 beat_start 到达时 state 还停在
  // stopped、Auto 模式的读速节奏，都不拦自己的话），但已读完是前提。
  useEffect(() => {
    const next = cues[cursorRef.current];
    const nextIsPlayerInput =
      next?.kind === "line" &&
      (linesRef.current.find((l) => l.key === next.lineKey)?.type ?? null) === "input";
    const go = shouldAutoStart({
      live: opts.live,
      auto,
      hold: opts.hold === true,
      hasCurrent: current !== null,
      currentComplete: current === null || shownLength >= current.text.length,
      cursor: cursorRef.current,
      cueCount: cues.length,
      nextIsPlayerInput,
    });
    if (!go) return;
    const timer = setTimeout(() => consumeNext(), 80);
    return () => clearTimeout(timer);
  }, [opts.live, auto, current, shownLength, cues, consumeNext, opts.revision, opts.hold]);

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

  /**
   * 回看时给舞台换一张「当时的画面」：背景、CG、立绘（含站位/表情/差分/在场与否）
   * 都折回那一句刚开始的那一刻。现场那个 `visual` 一个字节都不动——滚回播放头就是
   * 无缝回现场，不必做任何还原。
   *
   * 音频与骨架占位取自现场：音乐是此刻的氛围，不随回看倒退；占位讲的是「图还在路上」，
   * 回看到的历史画面不该是骨架。水位线找不到（谱系比缓冲快、换过分支）就整段退回现场。
   */
  const rewindVisual = useMemo(() => {
    if (scrubIndex === null) return null;
    const upto = cueWatermarkForEntry(cues, transcript, scrubIndex);
    if (upto === null) return null;
    return {
      ...visualAt(cues, upto),
      bgm: visual.bgm,
      ambient: visual.ambient,
      bgmVolume: visual.bgmVolume,
      ambientVolume: visual.ambientVolume,
      pending: visual.pending,
    };
  }, [scrubIndex, cues, transcript, visual.bgm, visual.ambient, visual.bgmVolume, visual.ambientVolume, visual.pending]);

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
    // 回看重算的画面 + 这一行上挂着的插图（图跟着行走，见 withAttachedCg）
    visual: withAttachedCg(rewindVisual ?? visual, displayedNode, opts.cgByNode),
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
