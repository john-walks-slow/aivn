import { PhraseChunker } from "@aivn/core";
import { errorText, type PendingJobs } from "./pendingJobs.js";

/** 合成函数（FishTts + 剧目 URL 前缀绑定；测试注入 fake）。 */
export type TtsSynthFn = (text: string, voiceId: string) => Promise<{ url: string }>;

/** 排队等着合成的一句（seq = 它所属 say 行的 seq）。 */
interface VoiceJob {
  text: string;
  voiceId: string;
  seq: number;
  phrase: number;
  /** 排下这句时这一行的「台词代次」：原地改写会抬一代，旧代的结果不再发出去。 */
  gen: number;
}

/**
 * 交班：换一任编排器时把还没做完的语音活儿带过去（见 handover / adopt）。
 * 排队的句子、观众不在时攒下的帧、以及当时的观众状态，三样一起走。
 */
export interface VoiceBacklog {
  queue: VoiceJob[];
  deferred: DeferredFrame[];
  audience: boolean;
  /** 台词代次跟着走：接力之后旧代的结果照样作废。 */
  lineGen: Map<number, number>;
}

/** 攒着待人回来补推的一帧：连它属于哪一代一起留着，补推时才知道还算不算数。 */
interface DeferredFrame {
  frame: VoiceFrame;
  seq: number;
  gen: number;
}

/** 一帧语音状态：started = 短语进了队列，ready = 音频生成完毕，failed = 这一句合成不出来。 */
export interface VoiceFrame {
  seq: number;
  phrase: number;
  state: "started" | "ready" | "failed";
  url?: string;
}

export interface VoicePipelineOptions {
  synth: TtsSynthFn;
  /** 角色卡 voiceId 查询（无音色角色/旁白返回 undefined → 不合成）。 */
  voiceOf: (charId: string) => string | undefined;
  /** 语音事件出口（编排器广播）。 */
  emit: (event: VoiceFrame) => void;
  /** 并发合成上限，默认 2。 */
  concurrency?: number;
  /** 在合成的事（面板上那一行）：一行台词一条，别把每个分句都摆出来。 */
  pending?: PendingJobs;
}

/**
 * 语音预取管线（D5）：say 行文本流 → PhraseChunker 分句 → 并发 TTS 预取 → audio_ready。
 * 三道门：enabled（语音总开关，关=不要配音）/ paused（客户端背压：缓冲积压或持续快进）/
 * audience（有没有观众；见 setAudience）。
 * 音频失败只告警不阻塞演出（风险#3 对策）。
 */
export class VoicePipeline {
  enabled = true;
  paused = false;
  /**
   * 有没有人在听（最后一个舞台连接断开 / 有人连回来）。
   *
   * 与 enabled 的差别只在**已经许出去的句子怎么办**：总开关关掉是「不要配音了」——
   * 队列作废、后续也不再收；观众离场是「这一刻没人在听」——那些句子的 audio_pending
   * 早就发过了，客户端正按行号一句句等着它们，清掉它们那一行就永远停在那儿
   * （后半句再也不会出声）。所以这里只停泵：不往上游发新请求，队列与已生成的帧都留着。
   */
  audience = true;

  private chunker: PhraseChunker | null = null;
  private voiceId: string | null = null;
  private lineSeq = 0;
  private phraseNo = 0;
  private readonly queue: VoiceJob[] = [];
  /** 观众不在的那段时间发不出去的帧：人回来按原序补推，客户端才不会卡在缺的那一句上。 */
  private readonly deferred: DeferredFrame[] = [];
  /**
   * 正在合成的那几句（队列里已经取走、结论还没回来的）。
   * 交班时要连它们一起带走：新管线再排一次会命中内容寻址缓存（同一个 FishTts 客户端里
   * 那个请求还挂着，去重就是等它），所以既不会重复烧配额，也不会丢掉这两句。
   */
  private readonly inFlightJobs = new Set<VoiceJob>();
  /**
   * 每一行的台词代次。原地改写（`invalidateLine`）抬一代：这一行按旧台词排下的活儿
   * 结果回来也不发——发了客户端就会拿旧声音盖掉新台词。
   */
  private readonly lineGen = new Map<number, number>();
  private inFlight = 0;
  private disposed = false;

  constructor(private readonly opts: VoicePipelineOptions) {}

  setEnabled(on: boolean): void {
    this.enabled = on;
    if (!on) {
      this.queue.length = 0;
      // 玩家自己关的语音：这些帧对他已经没有意义（客户端那边整行也一起清了），别留着占内存
      this.deferred.length = 0;
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

  /**
   * 观众离场 / 回来（最后一个舞台连接断开、或有人连回来）。
   *
   * 离场只是停泵：队列留着（已经许出去的句子照做，只是暂不发请求），
   * 离场期间合成完的帧也留着——人一回来先补推，再接着排。
   */
  setAudience(present: boolean): void {
    if (this.audience === present) return;
    this.audience = present;
    if (!present) return;
    for (const item of this.deferred.splice(0)) {
      if ((this.lineGen.get(item.seq) ?? 0) === item.gen) this.opts.emit(item.frame);
    }
    this.pump();
  }

  /**
   * 把还没做完的活儿交出去（换编排器时由剧目层接力，见 VoiceBacklog）。
   *
   * 调用契约：**取走 → 停本实例 → 新管线 adopt，三步在同一个同步块里做，中间不许 await**
   *（换了一任就没人接手这段窗口里的帧了：插一个 await，期间的帧会在「已经不是这一任」的
   * 实例上白白发掉或丢掉）。其中 adopt 必须排在 dispose **之后**——dispose 会把剧目共享的
   * pending 表整表清掉，接手重新登记的语音条目要落在它后面才留得住（见 playhouse 的 handOverVoice）。
   * 在飞的那几句也一并交出去：新管线重排一遍会命中内容寻址缓存（同一个 FishTts 客户端里
   * 去重的是同一个请求），既不重复烧配额，也不丢这两句。
   */
  handover(): VoiceBacklog {
    const backlog: VoiceBacklog = {
      // 在飞的那几句是**更早**从队首取走的，拼在前面才与原来的先后一致
      // （客户端按 (seq, phrase) 认短语，顺序只影响听感上的先后）
      queue: [...this.inFlightJobs, ...this.queue],
      deferred: [...this.deferred],
      audience: this.audience,
      lineGen: new Map(this.lineGen),
    };
    this.queue.length = 0;
    this.deferred.length = 0;
    this.inFlightJobs.clear();
    return backlog;
  }

  /** 接过上一任留下的活儿：接着排队，观众状态照当时的算。 */
  adopt(backlog: VoiceBacklog): void {
    if (this.disposed) return;
    this.audience = backlog.audience;
    for (const [seq, gen] of backlog.lineGen) this.lineGen.set(seq, gen);
    this.queue.push(...backlog.queue);
    this.deferred.push(...backlog.deferred);
    if (this.audience) this.pump();
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
    this.deferred.length = 0;
    this.inFlightJobs.clear();
    this.closeLine();
    this.opts.pending?.clearKind("voice");
  }

  private closeLine(): void {
    this.chunker?.reset();
    this.chunker = null;
    this.voiceId = null;
  }

  /** 发一帧语音状态；没人在听就先存下（见 audience），等人回来补推。 */
  private send(frame: VoiceFrame, job?: VoiceJob): void {
    if (this.audience) {
      this.opts.emit(frame);
      return;
    }
    // 没人在听就先攒着，但**连代次一起攒**：人回来时按当时的代次再判一次，
    // 期间的原地改写／重建该作废就作废（否则补推这一路会绕过代次校验）。
    this.deferred.push({ frame, seq: frame.seq, gen: job?.gen ?? (this.lineGen.get(frame.seq) ?? 0) });
  }

  /** 分句回调：偏向当前这一行。 */
  private enqueue(text: string): void {
    if (!this.voiceId || !this.enabled) return;
    const seq = this.lineSeq;
    this.enqueueJob({
      text,
      voiceId: this.voiceId,
      seq,
      phrase: this.phraseNo++,
      gen: this.lineGen.get(seq) ?? 0,
    });
  }

  /**
   * 这一行被原地改写了：按**旧**台词排下的活儿全部作废。
   *
   * 排队里的直接扔掉（台词都没了，别再烧配额）；在飞的那几句拦不住，但它们的结果回来时
   * 认代次不再发出去——否则客户端会拿旧声音写回台账，下一次重听念的还是旧词。
   */
  invalidateLine(seq: number): void {
    this.lineGen.set(seq, (this.lineGen.get(seq) ?? 0) + 1);
    for (let i = this.queue.length - 1; i >= 0; i -= 1) {
      if (this.queue[i]?.seq === seq) this.queue.splice(i, 1);
    }
  }

  /** 这一句的结果还属于这一行的当前台词吗。 */
  private fresh(job: VoiceJob): boolean {
    return (this.lineGen.get(job.seq) ?? 0) === job.gen;
  }

  private enqueueJob(job: VoiceJob): void {
    this.queue.push(job);
    // 先报「开始合成」再排队：客户端要在这条消息到达时就亮起喇叭，而不是等第一个字节回来。
    this.send({ seq: job.seq, phrase: job.phrase, state: "started" }, job);
    this.pump();
  }

  /**
   * 补生成一整行（客户端点名重听、而这一行没有音频时走这里）。
   *
   * 台词是现成的，所以**先一次性把整行的短语都排上**再开泵：客户端据此知道这一行一共几句，
   * 等它们都回来（或都失败）才起播——不然它会照第一句回来的就播，又变成「只配了前半句」。
   * 生成过的短语命中内容寻址缓存，秒回且不重复烧配额。
   */
  synthesizeLine(seq: number, charId: string, text: string): void {
    if (this.disposed || !this.enabled || !this.audience) return;
    const voiceId = this.opts.voiceOf(charId);
    if (!voiceId) return;
    const gen = this.lineGen.get(seq) ?? 0;
    const jobs: VoiceJob[] = [];
    const chunker = new PhraseChunker({
      onPhrase: (piece) => jobs.push({ text: piece, voiceId, seq, phrase: jobs.length, gen }),
    });
    chunker.push(text);
    chunker.flush();
    for (const job of jobs) this.enqueueJob(job);
  }

  private pump(): void {
    if (this.disposed || !this.enabled || this.paused || !this.audience) return;
    const limit = this.opts.concurrency ?? 2;
    while (this.inFlight < limit && this.queue.length > 0) {
      const job = this.queue.shift();
      if (!job) return;
      this.inFlight += 1;
      this.inFlightJobs.add(job);
      const done = this.opts.pending?.begin({
        id: `voice:${job.seq}`,
        kind: "voice",
        label: `第 ${job.phrase + 1} 句台词`,
      });
      this.opts
        .synth(job.text, job.voiceId)
        .then(({ url }) => {
          if (!this.disposed && this.enabled && this.fresh(job)) {
            this.send({ seq: job.seq, phrase: job.phrase, state: "ready", url }, job);
          }
          done?.();
        })
        .catch((error: unknown) => {
          const reason = errorText(error);
          // 音频失败不阻塞演出：告警后丢弃该句。
          // 面板上那一条留成失败态记下错因：合成挂了得有人看见，不该跟着这句一起蒸发。
          console.warn(`[aivn] TTS 失败（跳过）: ${reason}`);
          // 明说一声，客户端不必靠 45s 兜底上界才把「合成中」摘掉；等着补生成那一行也据此收束。
          // 旧代（台词已改写）的失败同样不发：那会误清新请求在同一位上的「合成中」。
          if (this.fresh(job)) this.send({ seq: job.seq, phrase: job.phrase, state: "failed" }, job);
          done?.(reason);
        })
        .finally(() => {
          this.inFlight -= 1;
          this.inFlightJobs.delete(job);
          this.pump();
        });
    }
  }
}
