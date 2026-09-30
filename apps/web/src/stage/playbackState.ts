/**
 * 对话区「此刻有没有话可说」的两个纯判断。
 *
 * 抽出来是因为它们各自踩过一次坑，而两次都出在同一个毛病上——用间接状态反推，
 * 而不是直接问「演出还在不在进行」：
 *  - 空对话区的文案曾经写成 `live && exhausted`，重演这一轮时新事件一到
 *    `exhausted` 就翻假，舞台当场退回「（点击开始）」；
 *  - 起播条件只看玩家点击，演出中的新内容于是永远等着被点一下才出现。
 */

/**
 * 空对话区该显示什么。
 *
 * 演出中就是「剧作家正在落笔…」——没有台词可显示只可能是还在写，报「点击开始」
 * 是撒谎；非演出中才是真的等玩家发话。
 */
export function emptyDialogHint(live: boolean): string {
  return live ? "剧作家正在落笔…" : "（点击开始）";
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
