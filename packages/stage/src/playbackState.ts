/**
 * 对话区「此刻有没有话可说」的几个纯判断。
 *
 * 抽出来是因为它们各自踩过一次坑，而出在同一个毛病上——用间接状态反推，
 * 而不是直接问「演出还在不在进行」：
 *  - 空对话区的文案曾经写成 `live && exhausted`，重演这一轮时新事件一到
 *    `exhausted` 就翻假，舞台当场退回「（点击开始）」；
 *  - 起播条件只看玩家点击，演出中的新内容于是永远等着被点一下才出现。
 */

import { resolveSceneBg, type StopPayload } from "@aivn/core";
import type { Cue, ScriptLine } from "./script.js";
import type { TranscriptEntry } from "./transcript.js";

/**
 * 空对话区该显示什么。
 *
 * 演出中就是「剧作家正在落笔…」——没有台词可显示只可能是还在写，报「点击开始」
 * 是撒谎；非演出中才是真的等玩家发话。
 */
export function emptyDialogHint(live: boolean, fresh = false): string {
  if (fresh) return "还没开演——按画面上的「开演」开始。";
  return live ? "剧作家正在落笔…" : "（点击开始）";
}

export interface DialogInput {
  /** 当前行的名牌（只有 say/thought 挂名牌）；没有行在显示时为 null。 */
  viewName: string | null;
  /** 当前行已经打出来的字。 */
  shown: string;
  /** 有没有行在显示。 */
  hasView: boolean;
  /** 一拍正在生成。 */
  live: boolean;
}

/**
 * 台词条此刻的名牌与正文。
 *
 * 玩家的回执不再有特权分支：它是缓冲里的普通一行（`player_input` 事件），
 * 播放头走到它就照常显示——「立刻看见」由 shouldAutoStart 的回执例外保证。
 */
export function dialogContent(input: DialogInput): { name: string | null; text: string } {
  if (input.hasView) return { name: input.viewName, text: input.shown };
  return { name: null, text: emptyDialogHint(input.live) };
}

export interface AutoStartInput {
  /** 一拍正在生成（stage.state === "streaming"）。只管台词的起播，回执不等它。 */
  live: boolean;
  /** 自动模式：台词由它自己的延时节奏接管，与这里的起播互斥；回执不等它。 */
  auto: boolean;
  /** 语音 hold：当前句语音还没播完，任何推进都要让路——回执也不例外。 */
  hold: boolean;
  /** 对话区已有正在显示的台词。 */
  hasCurrent: boolean;
  /** 当前行已读完（hasCurrent 为 false 时无意义）。 */
  currentComplete: boolean;
  /** 播放游标位置。 */
  cursor: number;
  /** 已缓冲的 cue 数。 */
  cueCount: number;
  /** 游标前的下一张 cue 是玩家的回执行。 */
  nextIsPlayerInput: boolean;
}

/**
 * 演出中且此刻没有台词在显示、缓冲区里还有没消费的内容 → 起播，不必让玩家点一下。
 *
 * `hasCurrent` 是关键：正在读的句子不会被新到的内容抢走，阅读节奏仍归玩家。
 * 两个例外通道会在「演出中且对话区空着」之外自己出现——
 * 新内容一到就自己出现（边生成边演出，须演出中），和玩家自己的回执：
 * 回执不等演出状态。player_input 先于 beat_start 到达时 state 还停在 stopped，
 * Auto 模式的读速节奏也不拦自己的话——已读完即可顶上，否则「选完立刻看见」
 * 就成了看网络脸色。
 */
export function shouldAutoStart(input: AutoStartInput): boolean {
  if (input.hold) return false;
  if (input.nextIsPlayerInput) {
    return (!input.hasCurrent || input.currentComplete) && input.cursor < input.cueCount;
  }
  if (!input.live || input.auto) return false;
  return !input.hasCurrent && input.cursor < input.cueCount;
}

export interface StopAffordanceInput {
  /** 停止点面板就绪：这一轮演完、编排器空闲（与出选肢卡同一个条件）。 */
  ready: boolean;
  /** 引擎给的停止点类型；这一轮没有停止点时为 null。 */
  stopType: StopPayload["stopType"] | null;
  /** 这一轮没写 stop（beat_end 的 no_stop）。 */
  isNoStop: boolean;
  /**
   * 这一条会话已经到达结局（`<ending …/>`）。终局态没有任何出口：不给卡、点舞台也不继续。
   *
   * 缺省 false（向后兼容：还没有结局概念的老宿主照旧）。它与 `isNoStop` 的交互是要点——
   * 结局那一轮本来就没有 `<stop>`，`isNoStop` 为真，没有这道闸就会摆出「点舞台继续」。
   */
  ended?: boolean;
}

/**
 * 本轮写完时玩家还有没有出口：点舞台（= 翻下一句的那个动作）即开下一轮。
 *
 * 出口只有这一个——选项由停止点自己摆（choice/free），没有「（继续）」卡这一形态
 * （2026-10-10 用户裁决删掉那个开关：轮与轮之间的边界不值得在画面中央摆一张卡）。
 *
 * pause 例外：它是编排器自造的重试口（轮中截断 / 空轮报错），不是剧本写出来的
 * 停止点，照旧走点舞台。
 */
export function stopAffordance(input: StopAffordanceInput): boolean {
  // 终局优先于一切：结局之后不给任何出口（它没有 stop，isNoStop 反而是真的）。
  if (input.ended || !input.ready) return false;
  // 有真停止点（choice/free）时出口是选项本身，不额外给继续
  if (input.stopType === "pause") return true;
  return input.isNoStop && input.stopType === null;
}

/**
 * 逐句标题卡（`<title mode="lines">`）的揭示断点：每个**非空物理行**结束处的字符偏移。
 *
 * 句子边界取物理换行而不是标点切分——诗歌的"句"就是换行，标点在无标点的诗行上完全失效，
 * 且作者才最清楚一行到哪儿断（见 docs/features/261007-dsl-title）。空行是分节间距，
 * 不单独占一个揭示步，但它的换行字符会随前缀一起显示出来。
 *
 * 全是空白的正文返回 `[text.length]`：保证至少有一个揭示步，避免零步卡死（正常不会出现——
 * 解析器已把空 title 丢掉）。
 */
export function titleStepEnds(text: string): number[] {
  const ends: number[] = [];
  let offset = 0;
  for (const line of text.split("\n")) {
    offset += line.length;
    if (line.trim() !== "") ends.push(offset);
    offset += 1; // 该行的换行符
  }
  return ends.length > 0 ? ends : [text.length];
}

/** 当前该显示到第几个字：逐句卡按 step 取断点，其余行（含 block 标题卡）取全文。 */
export function titleRevealTarget(line: ScriptLine, step: number): number {
  if (line.type !== "title" || line.mode !== "lines") return line.text.length;
  const ends = titleStepEnds(line.text);
  const index = Math.min(Math.max(step, 0), ends.length - 1);
  return ends[index] ?? line.text.length;
}

/** 逐句卡的最后一个揭示步下标（其余行为 0）——末句已显完时才允许点击离开。 */
export function titleLastStep(line: ScriptLine): number {
  if (line.type !== "title" || line.mode !== "lines") return 0;
  return Math.max(0, titleStepEnds(line.text).length - 1);
}

/** 书页流 / 音响小说（novel / nvl）同屏显示的一条段落。 */
export interface PageEntry {
  key: string;
  kind: TranscriptEntry["kind"];
  type: "say" | "narrate" | "thought";
  actorId: string | null;
  nameOverride?: string;
  /** 上屏文本（当前打字行按 viewLength 截断，已读行取全文）。 */
  text: string;
  seq: number | null;
  nodeId: string | null;
  /** 当前聚焦行（播放头或回看游标所在行）。 */
  isCurrent: boolean;
}

/** 书页流 / 音响小说的当前页视图。 */
export interface PageView {
  /** 当前页所属的场景 id 或章节标题（页眉展示用；无则为 null）。 */
  scene: string | null;
  /** 页码（从 1 起，遇到换景或标题卡自动翻页 +1）。 */
  pageNo: number;
  /** 本页内的连续段落（按演出先后正序排列）。 */
  entries: PageEntry[];
}

export interface PageViewInput {
  cues: readonly Cue[];
  lines: readonly ScriptLine[];
  transcript: readonly TranscriptEntry[];
  current: ScriptLine | null;
  view: TranscriptEntry | null;
  viewLength: number;
  shownLength: number;
  scrubbed: boolean;
  /** 已消费到的 cue 游标（缺省视同全部已消费）。 */
  cursor?: number;
}

function scriptLineToTranscriptEntry(line: ScriptLine): TranscriptEntry {
  if (line.type === "input") {
    return {
      key: line.key,
      kind: "input",
      type: "say",
      actorId: "player",
      text: line.text,
      seq: line.seq ?? null,
      nodeId: line.nodeId ?? null,
    };
  }
  return {
    key: line.key,
    kind: "line",
    type: line.type === "say" || line.type === "narrate" || line.type === "thought" || line.type === "title" ? line.type : "narrate",
    actorId: line.actorId ?? null,
    ...(line.nameOverride ? { nameOverride: line.nameOverride } : {}),
    text: line.text,
    seq: line.seq ?? null,
    nodeId: line.nodeId ?? null,
  };
}

/**
 * 计算书页流（novel）与音响小说（nvl）当前页的连续段落列表。
 *
 * 分页规则：
 * - 同一场景内的台词（say）、旁白（narrate）、独白（thought）、玩家回执（input）连续累积在同一页；
 * - 遇到真正换景（`<scene bg="新背景"/>` 与前一次背景不同，或 `<scene clear="true"/>`）或章节卡（`<title>`）时自动翻开新页；
 * - 仅换配乐/环境音（`<scene bgm="…"/>`）或重复声明相同背景不翻页，保持对话连贯；
 * - 回看（scrubbed）时自动定位到回看条目所在的那一页，并将 `.is-current` 移到该条。
 */
export function buildPageView(input: PageViewInput): PageView {
  const { cues, lines, transcript, current, view, viewLength, shownLength, scrubbed } = input;
  const limit = input.cursor ?? cues.length;
  const lineByKey = new Map<string, ScriptLine>();
  for (const l of lines) lineByKey.set(l.key, l);

  let pageNo = 1;
  let scene: string | null = null;
  let currentBg: string | null = null;
  let hasLinesOnPage = false;
  const pageByKey = new Map<string, { pageNo: number; scene: string | null }>();

  for (let i = 0; i < Math.min(limit, cues.length); i += 1) {
    const cue = cues[i]!;
    if (cue.kind === "scene") {
      const nextBg = cue.bg?.trim() || null;
      const bgChanged = nextBg !== null && nextBg !== currentBg;
      if ((cue.clear === true || bgChanged) && hasLinesOnPage) {
        pageNo += 1;
        hasLinesOnPage = false;
      }
      if (cue.clear === true && nextBg === null) {
        currentBg = null;
        scene = null;
      } else if (nextBg !== null) {
        currentBg = nextBg;
        const parsedBg = resolveSceneBg(nextBg);
        scene = parsedBg?.kind === "color" ? null : nextBg;
      }
      continue;
    }
    if (cue.kind === "line") {
      const line = lineByKey.get(cue.lineKey);
      if (line?.type === "title") {
        if (hasLinesOnPage) {
          pageNo += 1;
          hasLinesOnPage = false;
        }
        const firstLine = line.text
          .split("\n")
          .find((s) => s.trim() !== "")
          ?.trim();
        if (firstLine) scene = firstLine;
        continue;
      }
      hasLinesOnPage = true;
      pageByKey.set(cue.lineKey, { pageNo, scene });
    }
  }

  if (limit === 0 && current === null && !scrubbed) {
    return { scene, pageNo: 1, entries: [] };
  }

  let headIdx = -1;
  if (current) {
    for (let i = transcript.length - 1; i >= 0; i -= 1) {
      if (transcript[i]!.key === current.key) {
        headIdx = i;
        break;
      }
    }
  }

  let rawEntries: TranscriptEntry[];
  if (current) {
    if (headIdx >= 0) {
      rawEntries = transcript.slice(0, headIdx + 1);
    } else if (current.type === "title") {
      rawEntries = [...transcript];
    } else {
      rawEntries = [...transcript, scriptLineToTranscriptEntry(current)];
    }
  } else {
    rawEntries = [...transcript];
  }

  const tagged: Array<{ entry: TranscriptEntry; pageNo: number; scene: string | null }> = [];
  let walkPageNo = 1;
  let walkScene: string | null = scene;
  let walkHasLines = false;

  for (const entry of rawEntries) {
    if (entry.type === "title") {
      if (!pageByKey.has(entry.key) && walkHasLines) {
        walkPageNo += 1;
        walkHasLines = false;
      }
      const firstLine = entry.text
        .split("\n")
        .find((s) => s.trim() !== "")
        ?.trim();
      if (firstLine) walkScene = firstLine;
      continue;
    }
    const mapped = pageByKey.get(entry.key);
    if (mapped) {
      walkPageNo = mapped.pageNo;
      walkScene = mapped.scene;
    }
    walkHasLines = true;
    tagged.push({ entry, pageNo: walkPageNo, scene: walkScene });
  }

  if (tagged.length === 0) {
    return { scene, pageNo, entries: [] };
  }

  const activeKey = view?.key ?? current?.key ?? null;
  let targetPageNo = tagged[tagged.length - 1]!.pageNo;
  let targetScene = tagged[tagged.length - 1]!.scene ?? scene;

  if (scrubbed && activeKey) {
    for (let i = tagged.length - 1; i >= 0; i -= 1) {
      if (tagged[i]!.entry.key === activeKey) {
        targetPageNo = tagged[i]!.pageNo;
        targetScene = tagged[i]!.scene ?? scene;
        break;
      }
    }
  }

  const pageItems = tagged.filter((item) => item.pageNo === targetPageNo);
  const entries: PageEntry[] = pageItems.map((item, idx) => {
    const e = item.entry;
    const isCurrent = activeKey !== null ? e.key === activeKey : idx === pageItems.length - 1;
    let text = e.text;
    if (!scrubbed && isCurrent) {
      text = e.text.slice(0, viewLength);
    } else if (scrubbed && current && e.key === current.key) {
      text = e.text.slice(0, shownLength);
    }
    return {
      key: e.key,
      kind: e.kind,
      type: e.type === "say" || e.type === "thought" ? e.type : "narrate",
      actorId: e.actorId,
      ...(e.nameOverride ? { nameOverride: e.nameOverride } : {}),
      text,
      seq: e.seq,
      nodeId: e.nodeId,
      isCurrent,
    };
  });

  return {
    scene: targetScene,
    pageNo: targetPageNo,
    entries,
  };
}
