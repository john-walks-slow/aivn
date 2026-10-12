/**
 * 语气标记的形状：`[` 到 `]` 一段，内容不含方括号与换行、不超过 80 字。
 *
 * 只认形状、不认词表——Fish S2.1-Pro 的标记是**开放域**的（官方明说按普通文本处理，
 * 不存在可枚举白名单），`[whispering]` 与 `[voice breaking, barely holding it together]` 同等对待。
 */
const TONE_TAG = /\[[^[\]\n]{1,80}\]/g;

/**
 * 剥掉台词里的语气标记（Fish Audio 的 `[tag]`）——**只用于上屏**。
 *
 * 这是「上屏安全」的启发式，不是 Fish 的语法校验：形状对不上（超过 80 字、跨行）就当普通文本留着，
 * 所以提示词里要说清台词里别写别的方括号。对四种台词（say/narrate/thought/title）一视同仁——
 * 旁白与标题不配音，但玩家也不该看见它们的标记。
 *
 * 标记是台词文本的一部分：一路原样进谱系与 TTS（位置即语义，句中写只管后半句），
 * 只有给玩家看的文本要把它去掉。流式还在半路、`[` 还没等到 `]` 的那一截也一并藏起来
 * （玩家不该看见 `[whi`）——所以整行以「最后一个未闭合的 `[`」为界截断。
 */
export function stripToneTags(text: string): string {
  const open = text.lastIndexOf("[");
  const head =
    open >= 0 && !text.includes("]", open) && !text.slice(open).includes("\n") ? text.slice(0, open) : text;
  return head.replace(TONE_TAG, "");
}

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
