/**
 * 送 TTS 前的文本整理（D5）。
 *
 * 语音是一行一条请求（整句一起送，不边流边切），所以这里只管「送过去的那一句长什么样」。
 */

/**
 * TTS 前置文本正则化（D5）：数字/百分比/符号读法与全角化。
 * 轻量原则——fish-audio 自带数字归一化前端，这里只处理其易错项。
 */
export function normalizeForTts(text: string): string {
  return (
    text
      // 百分比：50% → 百分之50（TTS 数字前端读作"百分之五十"）
      .replace(/(\d+(?:\.\d+)?)\s*%/g, "百分之$1")
      // 温度/单位符号
      .replace(/(\d+(?:\.\d+)?)\s*℃/g, "$1摄氏度")
      .replace(/(\d+(?:\.\d+)?)\s*°/g, "$1度")
      // ASCII 标点 → 全角（读法一致，韵律更稳）
      .replace(/,/g, "，")
      .replace(/;/g, "；")
      .replace(/:/g, "：")
      .replace(/!/g, "！")
      .replace(/\?/g, "？")
      // 剧本/排版符号：TTS 无意义且易触发怪读法
      .replace(/[*_~`#>|《》「」『』【】]/g, "")
      // emoji 与杂项符号
      .replace(/[\u{1f000}-\u{1ffff}\u{2600}-\u{27bf}\u{fe00}-\u{fe0f}]/gu, "")
      // CJK 之间的空白整段剔除（排版残留），其余空白折叠
      .replace(/(?<=[\u3400-\u9fff\u3000-\u303f\uff00-\uffef])\s+(?=[\u3400-\u9fff\u3000-\u303f\uff00-\uffef])/g, "")
      .replace(/\s+/g, " ")
      .trim()
  );
}

/** 定时器句柄（端无关：core 不引 DOM/Node 类型，句柄对调用方不透明）。 */
type Timer = unknown;

/** 浏览器/Node 通用默认调度器（两者 globalThis 均有 setTimeout/clearTimeout）。 */
type Scheduler = {
  setTimeout: (fn: () => void, ms: number) => unknown;
  clearTimeout: (timer: unknown) => void;
};
