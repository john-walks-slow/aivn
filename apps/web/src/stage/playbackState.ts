/**
 * 对话区「此刻有没有话可说」的几个纯判断。
 *
 * 抽出来是因为它们各自踩过一次坑，而出在同一个毛病上——用间接状态反推，
 * 而不是直接问「演出还在不在进行」：
 *  - 空对话区的文案曾经写成 `live && exhausted`，重演这一轮时新事件一到
 *    `exhausted` 就翻假，舞台当场退回「（点击开始）」；
 *  - 起播条件只看玩家点击，演出中的新内容于是永远等着被点一下才出现；
 *  - 回声曾经排在「当前行」后面，而停止点上永远有当前行，回声等于没做。
 */

import type { StopPayload } from "@stage-ai/core";

/**
 * 空对话区该显示什么。
 *
 * 演出中就是「剧作家正在落笔…」——没有台词可显示只可能是还在写，报「点击开始」
 * 是撒谎；非演出中才是真的等玩家发话。
 */
export function emptyDialogHint(live: boolean): string {
  return live ? "剧作家正在落笔…" : "（点击开始）";
}

export interface DialogInput {
  /** 玩家刚发出去的那句话。非空时它占着台词条。 */
  playerEcho: string | null;
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
 * 回声优先级最高——这也是它踩过的坑：初版写成「有当前行就显示当前行，没有才轮到回声」，
 * 而选肢停止点上上一句正是当前行，于是玩家在最常见的路径上根本看不到自己刚发的话。
 * 回声是「按下之后立刻要看见的回执」，不是空对话区的占位符，谁都不该压在它上面。
 *
 * 真台词接管不靠这里的条件，靠 StageScreen 的 echoText——播放头一换行，回声自己就撤了。
 */
export function dialogContent(input: DialogInput): { name: string | null; text: string } {
  if (input.playerEcho) return { name: "你", text: input.playerEcho };
  if (input.hasView) return { name: input.viewName, text: input.shown };
  return { name: null, text: emptyDialogHint(input.live) };
}

export interface AutoStartInput {
  /** 一拍正在生成（stage.state === "streaming"）。 */
  live: boolean;
  /** 自动模式：由它自己的延时节奏接管，与这里的起播互斥。 */
  auto: boolean;
  /** 语音 hold：当前句语音还没播完，任何推进都要让路。 */
  hold: boolean;
  /** 对话区已有正在显示的台词。 */
  hasCurrent: boolean;
  /** 播放游标位置。 */
  cursor: number;
  /** 已缓冲的 cue 数。 */
  cueCount: number;
}

/**
 * 演出中且此刻没有台词在显示、缓冲区里还有没消费的内容 → 起播，不必让玩家点一下。
 *
 * `hasCurrent` 是关键：正在读的句子不会被新到的内容抢走，阅读节奏仍归玩家。
 * 只有玩家自己点着读完最后一句（游标到底、对话区空着）之后，新内容一到才自己出现——
 * 这正是「边生成边演出」，也让「重演这一轮」之后不需要任何点击。
 */
export function shouldAutoStart(input: AutoStartInput): boolean {
  if (!input.live || input.auto || input.hold) return false;
  if (input.hasCurrent) return false;
  return input.cursor < input.cueCount;
}

export interface StopAffordanceInput {
  /** 停止点面板就绪：这一轮演完、编排器空闲（与出选肢卡同一个条件）。 */
  ready: boolean;
  /** 引擎给的停止点类型；这一轮没有停止点时为 null。 */
  stopType: StopPayload["stopType"] | null;
  /** 这一轮没写 stop（beat_end 的 no_stop）。 */
  isNoStop: boolean;
  /** 设置项：本轮写完时摆一张「（继续）」卡。默认关。 */
  continueCardOn: boolean;
}

export interface StopAffordance {
  /** 舞台中央摆一张「（继续）」卡。 */
  showContinueCard: boolean;
  /** 点舞台（= 翻下一句的那个动作）即开下一轮。 */
  clickToContinue: boolean;
}

/**
 * 本轮写完时玩家看到的出口：一张卡，或者「点舞台继续」。两者互斥。
 *
 * 默认（设置关）是没有卡的——演到最后一句话，再点一下就直接开下一轮，
 * 与翻句是同一个动作，玩家不必先意识到「这一轮结束了」。设置打开才摆卡：
 * 有些玩家想看见边界，那是一个明确的停顿。
 *
 * pause 例外：它是编排器自造的重试口（轮中截断 / 空轮报错），不是剧本写出来的
 * 停止点，永远走点舞台，不占卡片位。
 */
export function stopAffordance(input: StopAffordanceInput): StopAffordance {
  const none: StopAffordance = { showContinueCard: false, clickToContinue: false };
  if (!input.ready) return none;
  if (input.stopType === "pause") return { ...none, clickToContinue: true };
  // 有真停止点（choice/free）时出口是选项本身，不额外给继续
  if (!input.isNoStop || input.stopType !== null) return none;
  return input.continueCardOn ? { ...none, showContinueCard: true } : { ...none, clickToContinue: true };
}
