import { PhraseChunker } from "@aivn/core";
import { errorText, type PendingJobs } from "./pendingJobs.js";

/** 合成函数（FishTts + 剧目 URL 前缀绑定；测试注入 fake）。 */
export type TtsSynthFn = (text: string, voiceId: string) => Promise<{ url: string }>;

export interface VoicePipelineOptions {
  synth: TtsSynthFn;
  /** 角色卡 voiceId 查询（无音色角色/旁白返回 undefined → 不合成）。 */
  voiceOf: (charId: string) => string | undefined;
  /** 语音事件出口（编排器广播）：started = 短语进了队列，ready = 音频生成完毕。 */
  emit: (event: { seq: number; phrase: number; state: "started" | "ready"; url?: string }) => void;
  /** 并发合成上限，默认 2。 */
  concurrency?: number;
  /** 在合成的事（面板上那一行）：一行台词一条，别把每个分句都摆出来。 */
  pending?: PendingJobs;
}

/**
 * 语音预取管线（D5）：say 行文本流 → PhraseChunker 分句 → 并发 TTS 预取 → audio_ready。
 * 门控：enabled（语音总开关，关=停合成）/ paused（客户端背压：缓冲积压或持续快进）。
 * 音频失败只告警不阻塞演出（风险#3 对策）。
 */
export class VoicePipeline {
  enabled = true;
  paused = false;

  private chunker: PhraseChunker | null = null;
  private voiceId: string | null = null;
  private lineSeq = 0;
  private phraseNo = 0;
  private readonly queue: { text: string; voiceId: string; seq: number; phrase: number }[] = [];
  private inFlight = 0;
  private disposed = false;

  constructor(private readonly opts: VoicePipelineOptions) {}

  setEnabled(on: boolean): void {
    this.enabled = on;
    if (!on) {
      this.queue.length = 0;
      this.closeLine();
      this.opts.pending?.clearKind("voice");
    } else {
      // 重新开启视为新会话（B2 纵深防御）：清掉客户端可能残留的背压暂停，泵复活
      this.paused = false;
      this.pump();
    }
  }

  setPaused(paused: boolean): void {
    this.paused = paused;
    if (!paused) this.pump();
  }

  /** say_start：开启新行分句器（无音色角色不开）。seq = say_start 事件的序号（客户端行关联键）。 */
  lineStart(seq: number, charId: string): void {
    this.closeLine();
    if (!this.enabled) return;
    const voiceId = this.opts.voiceOf(charId);
    if (!voiceId) return;
    this.voiceId = voiceId;
    this.lineSeq = seq;
    this.phraseNo = 0;
    this.chunker = new PhraseChunker({ onPhrase: (text) => this.enqueue(text) });
  }

  feedText(delta: string): void {
    this.chunker?.push(delta);
  }

  /** say_end：冲刷残余短语。 */
  lineEnd(): void {
    this.chunker?.flush();
    this.closeLine();
  }

  dispose(): void {
    this.disposed = true;
    this.queue.length = 0;
    this.closeLine();
    this.opts.pending?.clearKind("voice");
  }

  private closeLine(): void {
    this.chunker?.reset();
    this.chunker = null;
    this.voiceId = null;
  }

  private enqueue(text: string): void {
    if (!this.voiceId || !this.enabled) return;
    const job = { text, voiceId: this.voiceId, seq: this.lineSeq, phrase: this.phraseNo++ };
    this.queue.push(job);
    // 先报「开始合成」再排队：客户端要在这条消息到达时就亮起喇叭，而不是等第一个字节回来。
    this.opts.emit({ seq: job.seq, phrase: job.phrase, state: "started" });
    this.pump();
  }

  private pump(): void {
    if (this.disposed || !this.enabled || this.paused) return;
    const limit = this.opts.concurrency ?? 2;
    while (this.inFlight < limit && this.queue.length > 0) {
      const job = this.queue.shift();
      if (!job) return;
      this.inFlight += 1;
      const done = this.opts.pending?.begin({
        id: `voice:${job.seq}`,
        kind: "voice",
        label: `第 ${job.phrase + 1} 句台词`,
      });
      this.opts
        .synth(job.text, job.voiceId)
        .then(({ url }) => {
          if (!this.disposed && this.enabled) {
            this.opts.emit({ seq: job.seq, phrase: job.phrase, state: "ready", url });
          }
          done?.();
        })
        .catch((error: unknown) => {
          const reason = errorText(error);
          // 音频失败不阻塞演出：告警后丢弃该句（客户端的喇叭就此熄灭）。
          // 面板上那一条留成失败态记下错因：合成挂了得有人看见，不该跟着这句一起蒸发。
          console.warn(`[aivn] TTS 失败（跳过）: ${reason}`);
          done?.(reason);
        })
        .finally(() => {
          this.inFlight -= 1;
          this.pump();
        });
    }
  }
}
