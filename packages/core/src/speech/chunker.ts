/**
 * PhraseChunker —— 语音句级切分器（D5：语音不可逆，杜绝多音字畸变）。
 *
 * 流式喂入 say 行文本增量，产出可安全提交 TTS 的完整短语：
 * - 强终止标点（。！？…\n 等）绝对切分；
 * - 长句在次级标点（，；、：）处累计超阈值（默认 30 字）切分；
 * - 非终止点停顿超 idleFlushMs（默认 700ms）强制冲刷——慢流时尽早预取；
 * - say_end 时 flush 兜底（行尾无标点也产出）。
 */

/** 强终止标点：出现即切（省略号整组视为一个终止符）。 */
const STRONG_END = /[。！？!?\n\r]/;
/** 次级标点：长句累计阈值后的合法切点（含 ASCII 逗号分号冒号）。 */
const SOFT_END = /[，；、：—,;:]/;
/** 省略号（……/…/...）整组终止。 */
const ELLIPSIS = /^(……|…|\.\.\.)/;

/** 统计切分长度：CJK 字符计 1，连续拉丁/数字串计 1（按"词"近似）。 */
export function speechLength(text: string): number {
  let n = 0;
  let prevLatin = false;
  for (const ch of text) {
    if (/[\u3400-\u9fff\uf900-\ufaff\uff00-\uffef\u3000-\u303f]/.test(ch)) {
      n += 1;
      prevLatin = false;
    } else if (/[a-z0-9]/i.test(ch)) {
      if (!prevLatin) n += 1;
      prevLatin = true;
    } else {
      prevLatin = false;
    }
  }
  return n;
}

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

export interface PhraseChunkerOptions {
  /** 次级标点切分阈值（汉字数），默认 30。 */
  maxChars?: number;
  /** 非终止点空闲冲刷毫秒数，默认 700。 */
  idleFlushMs?: number;
  /** 短语产出回调（含空闲冲刷与 flush 兜底）。 */
  onPhrase: (phrase: string) => void;
  /** 定时器注入（测试用），默认 globalThis。 */
  schedule?: (fn: () => void, ms: number) => Timer;
  cancel?: (timer: Timer) => void;
}

export class PhraseChunker {
  private readonly maxChars: number;
  private readonly idleFlushMs: number;
  private readonly onPhrase: (phrase: string) => void;
  private readonly schedule: (fn: () => void, ms: number) => Timer;
  private readonly cancel: (timer: Timer) => void;
  private buffer = "";
  private idleTimer: Timer | null = null;

  constructor(opts: PhraseChunkerOptions) {
    this.maxChars = opts.maxChars ?? 30;
    this.idleFlushMs = opts.idleFlushMs ?? 700;
    this.onPhrase = opts.onPhrase;
    const scheduler = globalThis as unknown as Scheduler;
    this.schedule = opts.schedule ?? ((fn, ms) => scheduler.setTimeout(fn, ms));
    this.cancel = opts.cancel ?? ((t) => scheduler.clearTimeout(t));
  }

  /** 流式喂入文本增量。 */
  push(delta: string): void {
    if (delta === "") return;
    this.armIdle();
    for (let i = 0; i < delta.length; ) {
      const rest = delta.slice(i);
      const ellipsis = ELLIPSIS.exec(rest);
      if (ellipsis) {
        this.buffer += ellipsis[0];
        i += ellipsis[0].length;
        this.emit();
        continue;
      }
      const ch = delta[i] ?? "";
      i += 1;
      if (STRONG_END.test(ch)) {
        this.buffer += ch === "\n" || ch === "\r" ? "。" : ch;
        this.emit();
        continue;
      }
      this.buffer += ch;
      if (SOFT_END.test(ch) && speechLength(this.buffer) >= this.maxChars) this.emit();
    }
  }

  /** 行/流结束：冲刷残余（无尾标点也产出）。 */
  flush(): void {
    this.disarmIdle();
    if (this.buffer !== "") this.emit();
  }

  /** 丢弃缓冲并停表（行被跳过/放弃时）。 */
  reset(): void {
    this.disarmIdle();
    this.buffer = "";
  }

  private emit(): void {
    this.disarmIdle();
    const phrase = this.buffer.trim();
    this.buffer = "";
    // 纯标点短语（如句首「……」停顿）对 TTS 无意义，直接丢弃
    if (phrase !== "" && /[\p{L}\p{N}]/u.test(phrase)) this.onPhrase(normalizeForTts(phrase));
  }

  /** 非终止点停顿超时：强制冲刷当前缓冲（慢流预取）。 */
  private armIdle(): void {
    this.disarmIdle();
    if (this.idleFlushMs <= 0) return;
    this.idleTimer = this.schedule(() => {
      this.idleTimer = null;
      this.emit();
    }, this.idleFlushMs);
  }

  private disarmIdle(): void {
    if (this.idleTimer !== null) {
      this.cancel(this.idleTimer);
      this.idleTimer = null;
    }
  }
}
