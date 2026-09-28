import type { Api, Model } from "@earendil-works/pi-ai";
import type { StreamFn } from "@earendil-works/pi-agent-core";
import { completeText } from "./llm.js";

/** 翻译缓存上限（超限逐出最旧；短语级条目 KB 级，500 条内存可忽略）。 */
const CACHE_LIMIT = 500;

/**
 * 台词翻译器（D5 语音语言）：say 短语 → 语音语言，供 TTS 使用。
 * - 短语级缓存 + 同文本并发去重（相邻行重复短语只译一次）；
 * - 失败抛错，由调用方决定回退（语音路径回退原文，不阻塞演出）。
 */
export class Translator {
  private readonly cache = new Map<string, string>();
  private readonly inflight = new Map<string, Promise<string>>();

  constructor(
    private readonly opts: { streamFn: StreamFn; model: Model<Api>; getApiKey: () => string | undefined },
    private readonly language: string,
  ) {}

  async translate(text: string): Promise<string> {
    const cached = this.cache.get(text);
    if (cached !== undefined) return cached;
    const running = this.inflight.get(text);
    if (running) return running;
    const job = completeText(
      this.opts,
      [
        `你是台词翻译引擎。把用户给出的台词翻译成 ${this.language}，供语音合成使用。`,
        "要求：只输出译文本身，不加解释、引号或任何前后缀；保持口语化与情感色彩；人名保留原文。",
      ].join("\n"),
      text,
    );
    this.inflight.set(text, job);
    try {
      const translated = await job;
      if (this.cache.size >= CACHE_LIMIT) {
        const oldest = this.cache.keys().next().value;
        if (oldest !== undefined) this.cache.delete(oldest);
      }
      this.cache.set(text, translated);
      return translated;
    } finally {
      this.inflight.delete(text);
    }
  }
}
