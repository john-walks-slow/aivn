import { normalizeForTts } from "@aivn/core";
import { errorText, type PendingJobs } from "./pendingJobs.js";

/** 合成函数（FishTts + 剧目 URL 前缀绑定；测试注入 fake）。 */
export type TtsSynthFn = (text: string, voiceId: string) => Promise<{ url: string }>;

/**
 * 排队等着合成的一行（seq = 这行 say 的 seq）。
 *
 * 一行一条请求：台词写完（say_end）才整句送出去，不边流边切。理由是「缺一句」这类故障
 * 只可能发生在切分之后——不切分就没有「前半句到了、后半句没到」，客户端也不必按序号拼接。
 * 代价是这一行的声音要等整句合成完才出（长句更明显），拿字的节奏本来也给了余量。
 */
interface VoiceJob {
  text: string;
  voiceId: string;
  seq: number;
  /** 排下这行时它的「台词代次」：原地改写会抬一代，旧代的结果不再发出去。 */
  gen: number;
}

/**
 * 交班：换一任编排器时把还没做完的语音活儿带过去（见 handover / adopt）。
 * 排队的行、观众不在时攒下的帧，以及当时的观众状态与开关状态，一起走。
 */
export interface VoiceBacklog {
  queue: VoiceJob[];
  deferred: DeferredFrame[];
  audience: boolean;
  /** 语音总开关与背压暂停跟着走：不带走的话，重建会把「玩家关了语音」悄悄翻回打开、把泵放跑。 */
  enabled: boolean;
  paused: boolean;
  /** 台词代次跟着走：接力之后旧代的结果照样作废。 */
  lineGen: Map<number, number>;
}

/** 攒着待人回来补推的一帧：连它属于哪一代一起留着，补推时才知道还算不算数。 */
interface DeferredFrame {
  frame: VoiceFrame;
  seq: number;
  gen: number;
}

/** 一帧语音状态：started = 这行进队列了，ready = 音频生成完毕，failed = 这行合成不出来。 */
export interface VoiceFrame {
  seq: number;
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
  /** 在合成的事（面板上那一行）：一行一条。 */
  pending?: PendingJobs;
}

/**
 * 语音预取管线（D5）：say 行文本流 → 攒成整句 → 并发 TTS 预取 → audio_ready。
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
   * 与 enabled 的差别只在**已经许出去的行怎么办**：总开关关掉是「不要配音了」——
   * 队列作废、后续也不再收；观众离场是「这一刻没人在听」——那些行的 audio_pending
   * 早就发过了，客户端正一行行等着它们。所以这里只停泵：不往上游发新请求，
   * 队列与已生成的帧都留着。
   */
  audience = true;

  private voiceId: string | null = null;
  private lineSeq = 0;
  /** 正在攒的这一行台词：等 say_end 了整句一起送。 */
  private text = "";
  private readonly queue: VoiceJob[] = [];
  /** 观众不在的那段时间发不出去的帧：人回来按原序补推，客户端才不会卡在缺的那一行上。 */
  private readonly deferred: DeferredFrame[] = [];
  /**
   * 正在合成的那些行（队列里已经取走、结论还没回来的）。
   * 交班时要连它们一起带走：新管线再排一次会命中内容寻址缓存（同一个 FishTts 客户端里
   * 那个请求还挂着，去重就是等它），所以既不会重复烧配额，也不会丢掉这几行。
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
      // 玩家自己关的语音：这些帧对他已经没有意义（客户端那边也一起清了），别留着占内存
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
   * 离场只是停泵：队列留着（已经许出去的行照做，只是暂不发请求），
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
   * 在飞的那几行也一并交出去：新管线重排一遍会命中内容寻址缓存（同一个 FishTts 客户端里
   * 去重的是同一个请求），既不重复烧配额，也不丢这几行。
   */
  handover(): VoiceBacklog {
    const backlog: VoiceBacklog = {
      // 在飞的那几行是**更早**从队首取走的，拼在前面才与原来的先后一致
      queue: [...this.inFlightJobs, ...this.queue],
      deferred: [...this.deferred],
      audience: this.audience,
      enabled: this.enabled,
      paused: this.paused,
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
    this.enabled = backlog.enabled;
    this.paused = backlog.paused;
    for (const [seq, gen] of backlog.lineGen) this.lineGen.set(seq, gen);
    this.queue.push(...backlog.queue);
    this.deferred.push(...backlog.deferred);
    if (this.audience && this.enabled && !this.paused) this.pump();
  }

  /** say_start：认领这一行的 seq 与音色（无音色角色不攒文字）。 */
  lineStart(seq: number, charId: string): void {
    this.closeLine();
    this.voiceId = this.enabled ? (this.opts.voiceOf(charId) ?? null) : null;
    this.lineSeq = seq;
  }

  feedText(delta: string): void {
    if (this.voiceId) this.text += delta;
  }

  /** say_end：台词写完，整句一次送出去。 */
  lineEnd(): void {
    const voiceId = this.voiceId;
    const seq = this.lineSeq;
    const text = this.takeText();
    if (voiceId && text) {
      this.enqueueJob({ text, voiceId, seq, gen: this.lineGen.get(seq) ?? 0 });
    }
    this.closeLine();
  }

  /**
   * 客户端点名补生成一行（重听点在没有音频的行上时走这里）。
   *
   * 台词是现成的，整句一次请求，seq 沿用原值；生成过的命中内容寻址缓存，秒回且不重复烧配额。
   */
  synthesizeLine(seq: number, charId: string, text: string): void {
    if (this.disposed || !this.enabled || !this.audience) return;
    const voiceId = this.opts.voiceOf(charId);
    if (!voiceId) return;
    const piece = speakable(text);
    if (!piece) return;
    this.enqueueJob({ text: piece, voiceId, seq, gen: this.lineGen.get(seq) ?? 0 });
  }

  dispose(): void {
    this.disposed = true;
    this.queue.length = 0;
    this.deferred.length = 0;
    this.inFlightJobs.clear();
    this.closeLine();
    this.opts.pending?.clearKind("voice");
  }

  /**
   * 这一行被原地改写了：按**旧**台词排下的活儿作废。
   *
   * 排队里的直接扔掉（台词都没了，别再烧配额）；在飞的那一条拦不住，但它回来时认代次
   * 不再发出去——否则客户端会拿旧声音写回台账，下一次重听念的还是旧词。
   */
  invalidateLine(seq: number): void {
    this.lineGen.set(seq, (this.lineGen.get(seq) ?? 0) + 1);
    for (let i = this.queue.length - 1; i >= 0; i -= 1) {
      if (this.queue[i]?.seq === seq) this.queue.splice(i, 1);
    }
  }

  private closeLine(): void {
    this.voiceId = null;
    this.text = "";
  }

  /** 取走攒下的台词并整理成可送 TTS 的样子；没有可读的字就返回 null（纯标点/省略号不合成）。 */
  private takeText(): string | null {
    const text = speakable(this.text);
    this.text = "";
    return text;
  }

  /** 这一行的结果还属于它的当前台词吗。 */
  private fresh(job: VoiceJob): boolean {
    return (this.lineGen.get(job.seq) ?? 0) === job.gen;
  }

  private enqueueJob(job: VoiceJob): void {
    this.queue.push(job);
    // 先报「开始合成」再排队：客户端要在这条消息到达时就亮起喇叭，而不是等第一个字节回来。
    this.send({ seq: job.seq, state: "started" }, job);
    this.pump();
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
        label: snippet(job.text),
      });
      this.opts
        .synth(job.text, job.voiceId)
        .then(({ url }) => {
          if (!this.disposed && this.enabled && this.fresh(job)) {
            this.send({ seq: job.seq, state: "ready", url }, job);
          }
          done?.();
        })
        .catch((error: unknown) => {
          const reason = errorText(error);
          // 音频失败不阻塞演出：告警后丢弃这一行。
          // 面板上那一条留成失败态记下错因：合成挂了得有人看见，不该跟着这行一起蒸发。
          console.warn(`[aivn] TTS 失败（跳过）: ${reason}`);
          // 明说一声，客户端不必靠 45s 兜底上界才把「合成中」摘掉；等着补生成那一行也据此收束。
          // 旧代（台词已改写）的失败同样不发：那会误清新请求在这一行上的「合成中」。
          if (this.fresh(job)) this.send({ seq: job.seq, state: "failed" }, job);
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

/** 送去合成的文本：整理过、且至少有字可读（纯标点、纯省略号不合成）。 */
function speakable(text: string): string | null {
  const piece = normalizeForTts(text.trim());
  if (piece === "" || !/[\p{L}\p{N}]/u.test(piece)) return null;
  return piece;
}

/** 面板上那一行的标题：台词开头一截，几行同时在合成时能分清谁是谁。 */
function snippet(text: string): string {
  return text.length > 14 ? `${text.slice(0, 14)}…` : text;
}
