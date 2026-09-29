/**
 * VoiceDirector —— 舞台语音导演（D5 Web Audio 侧）。
 *
 * - 单一 AudioContext，「点击开始」遮罩手势 resume()（移动端铁律）；
 * - 句级 gapless：短语解码完成即挂时间戳链 chainEnd + 缓冲垫调度，段间短斜坡消爆音；
 * - 文字先行：行开始时语音未就绪则静音上文字，短语解码完成后跟进起播；
 * - 快进：淡出当前句（100ms），后续切片直接丢弃（文件留在服务端缓存）；
 * - 背压：未消费短语积压超阈值 → onControl({paused:true}) 暂停服务端预取（省配额）。
 */

/** 句间缓冲垫（秒）：吞解码/调度抖动，兼作自然句间停顿。 */
const PHRASE_PAD = 0.25;
/** 快进淡出时长（毫秒）。 */
const FADE_MS = 100;
/** 背压阈值：未消费短语超过 PAUSE_AT 暂停预取，回落 RESUME_AT 恢复（滞回）。 */
const PAUSE_AT = 10;
const RESUME_AT = 3;
/** 重听 URL 台账的行数上限（内存护栏）。 */
const URL_LEDGER_MAX = 500;

interface PhraseAudio {
  url: string;
  buffer: AudioBuffer | null;
}

interface LineAudio {
  phrases: Map<number, PhraseAudio>;
  /** 下一个待调度短语序号。 */
  nextToPlay: number;
  /** 已调度链的结束时刻（AudioContext 时间）；null = 未起播。 */
  chainEnd: number | null;
  /** 快进/换行后废弃：后续短语到达即丢弃。 */
  faded: boolean;
  /** 已挂起的播放节点（source → 其增益节点，淡出用）。 */
  sources: Map<AudioBufferSourceNode, GainNode>;
}

/** 单一 AudioContext（D5 铁律）：页面级共享，SPA 导航/StrictMode 重挂载不重建。 */
let sharedContext: AudioContext | null = null;

function sharedAudioContext(): AudioContext {
  if (!sharedContext) sharedContext = new AudioContext();
  return sharedContext;
}

export class VoiceDirector {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private readonly lines = new Map<number, LineAudio>();
  private currentSeq: number | null = null;
  /**
   * 行 → 短语音频 URL 台账。跨拍保留：解码好的 AudioBuffer 在 beatStarted 就随 lines 一起扔了，
   * 但文件还躺在服务端的内容寻址缓存里——回顾要能重听旧句，靠的就是这张表重新拉一遍。
   */
  private readonly urls = new Map<number, Map<number, string>>();
  /** 重听链：正在挂起的播放节点（重听不归属任何演出行，单独记以便单独掐断）。 */
  private replaySources = new Map<AudioBufferSourceNode, GainNode>();
  /** 每次发起重听自增：迟到的解码结果发现令牌已变就自我淘汰。 */
  private replayToken = 0;
  /** 已见最大 seq（beatStarted 时冻结为门槛：旧拍迟到音频直接丢弃）。 */
  private maxSeqSeen = 0;
  private floorSeq = 0;
  private pausedSent = false;
  enabled = true;
  /** React 通知（重渲染驱动自动模式解除 hold 等）。 */
  onNotify: (() => void) | null = null;
  /** 服务端预取控制（背压）。 */
  onControl: ((state: { paused?: boolean }) => void) | null = null;

  get unlocked(): boolean {
    return this.ctx !== null;
  }

  /** 未消费短语数（S1 派生值）：存活行内已存储未调度的短语——根除手动记账的双重扣减漂移。 */
  private get pending(): number {
    let n = 0;
    for (const line of this.lines.values()) {
      if (!line.faded) n += line.phrases.size - line.nextToPlay;
    }
    return n;
  }

  /** 用户手势解锁（遮罩点击）：取得共享 context 并 resume，补解码积压。 */
  unlock(): void {
    if (this.ctx) return;
    this.ctx = sharedAudioContext();
    this.master = this.ctx.createGain();
    this.master.connect(this.ctx.destination);
    void this.ctx.resume().then(() => this.notify());
    // 补解码遮罩期积压的短语
    for (const line of this.lines.values()) {
      for (const phrase of line.phrases.values()) {
        if (phrase.buffer === null) void this.decode(line, phrase);
      }
    }
  }

  setEnabled(on: boolean): void {
    this.enabled = on;
    if (!on) {
      this.fadeAll();
      this.lines.clear();
      this.clearBackpressure();
    }
    this.notify();
  }

  /** 这一行有没有可重听的语音（回顾的播放按钮据此显不显示）。 */
  hasVoice(seq: number | null | undefined): boolean {
    return seq !== null && seq !== undefined && this.urls.has(seq);
  }

  /**
   * 重听一句（回顾/回看里的播放键）：按短语序重新拉流解码，gapless 链式起播。
   * 一次只留一条重听链——再点别的就掐断上一条，不叠音。
   */
  async replay(seq: number): Promise<boolean> {
    if (!this.enabled) return false;
    this.unlock();
    if (!this.ctx || !this.master) return false;
    const urls = [...(this.urls.get(seq)?.entries() ?? [])]
      .sort((a, b) => a[0] - b[0])
      .map(([, url]) => url);
    if (urls.length === 0) return false;

    this.stopReplay(); // 先掐断上一条重听，再认领当前令牌
    const token = this.replayToken;
    const ctx = this.ctx;
    const buffers: AudioBuffer[] = [];
    for (const url of urls) {
      let buffer: AudioBuffer | null = null;
      try {
        const res = await fetch(url);
        if (res.ok) buffer = await ctx.decodeAudioData(await res.arrayBuffer());
      } catch {
        // 单个短语拉不到就跳过：文字和后续短语都不该因此卡住
      }
      if (token !== this.replayToken || !this.enabled) return false;
      if (buffer) buffers.push(buffer);
    }
    if (buffers.length === 0) return false;
    let when = ctx.currentTime + 0.05;
    for (const buffer of buffers) {
      this.playPhrase(null, buffer, when);
      when += buffer.duration + PHRASE_PAD;
    }
    this.notify();
    return true;
  }

  /** 掐断正在播的重听（再点一次播放键、或新的一键把它顶掉）。 */
  stopReplay(): void {
    const ctx = this.ctx;
    if (!ctx) {
      this.replaySources.clear();
      return;
    }
    const now = ctx.currentTime;
    for (const [source, gain] of this.replaySources) {
      try {
        gain.gain.cancelScheduledValues(now);
        gain.gain.setValueAtTime(Math.max(gain.gain.value, 0.0001), now);
        gain.gain.linearRampToValueAtTime(0.0001, now + FADE_MS / 1000);
        source.stop(now + FADE_MS / 1000 + 0.02);
      } catch {
        // 已停止的节点：忽略
      }
    }
    this.replaySources.clear();
  }

  /** audio_ready 到达：存储 + 预取解码。 */
  handleAudio(ready: { seq: number; phrase: number; url: string }): void {
    if (!this.enabled) return;
    this.rememberUrl(ready.seq, ready.phrase, ready.url);
    // 旧拍迟到音频（beat 已收束后 TTS 才完成）与已播过的行：直接丢弃
    if (ready.seq <= this.floorSeq) return;
    if (this.currentSeq !== null && ready.seq < this.currentSeq) return;
    this.maxSeqSeen = Math.max(this.maxSeqSeen, ready.seq);
    let line = this.lines.get(ready.seq);
    if (!line) {
      line = { phrases: new Map(), nextToPlay: 0, chainEnd: null, faded: false, sources: new Map() };
      this.lines.set(ready.seq, line);
    }
    if (line.faded || line.phrases.has(ready.phrase)) return;
    const phrase: PhraseAudio = { url: ready.url, buffer: null };
    line.phrases.set(ready.phrase, phrase);
    if (this.ctx) void this.decode(line, phrase);
    this.checkBackpressure();
  }

  /** 播放行切换（usePlayback onLineStart）：narrate/scene 行 seq=undefined → 仅收尾上一行。 */
  lineStarted(seq: number | undefined, isSay: boolean): void {
    this.finishCurrent();
    this.pruneBefore(seq);
    if (!this.enabled || seq === undefined || !isSay) {
      this.currentSeq = null;
      return;
    }
    this.currentSeq = seq;
    const line = this.lines.get(seq);
    if (line && !line.faded) this.trySchedule(line);
  }

  /** 快进（打字中点击 / 行末点击推进）：淡出当前句语音，丢弃后续。 */
  fastForward(): void {
    this.finishCurrent();
  }

  /** 新节拍开始：停掉全部残留语音，旧拍迟到音频一律丢弃（floor 门槛）。 */
  beatStarted(): void {
    this.fadeAll();
    this.lines.clear();
    this.clearBackpressure();
    this.currentSeq = null;
    this.floorSeq = this.maxSeqSeen;
    this.notify();
  }

  /** fresh start / 组件卸载。 */
  reset(): void {
    this.beatStarted();
    this.urls.clear();
  }

  /** 自动模式 hold：当前行语音仍在播。 */
  holdsLine(): boolean {
    const line = this.currentSeq !== null ? this.lines.get(this.currentSeq) : null;
    if (!line || !this.ctx || line.chainEnd === null) return false;
    return this.ctx.currentTime < line.chainEnd;
  }

  /** 卸载/重开：停声清态（共享 AudioContext 不 close；StrictMode 重挂载后可复用）。 */
  dispose(): void {
    this.fadeAll();
    this.stopReplay();
    this.lines.clear();
    this.clearBackpressure();
    this.currentSeq = null;
  }

  /** URL 台账记账。条数封顶：整场下来也就几百行，超了就丢最旧的（回顾翻不到那么远）。 */
  private rememberUrl(seq: number, phrase: number, url: string): void {
    let row = this.urls.get(seq);
    if (!row) {
      row = new Map();
      this.urls.set(seq, row);
    }
    row.set(phrase, url);
    for (const key of this.urls.keys()) {
      if (this.urls.size <= URL_LEDGER_MAX) break;
      if (key === seq) continue;
      this.urls.delete(key);
    }
  }

  private finishCurrent(): void {
    const line = this.currentSeq !== null ? this.lines.get(this.currentSeq) : null;
    if (line) this.fadeLine(line);
    this.currentSeq = null;
  }

  private fadeAll(): void {
    for (const line of this.lines.values()) this.fadeLine(line);
    this.stopReplay();
  }

  private fadeLine(line: LineAudio): void {
    if (line.faded) return;
    line.faded = true;
    // 未播短语就此作废（文件留在服务端缓存，Backlog 重听可用；pending 为派生值，faded 行自动除账）
    const ctx = this.ctx;
    if (!ctx) {
      line.sources.clear();
      return;
    }
    const now = ctx.currentTime;
    for (const [source, gain] of line.sources) {
      try {
        gain.gain.cancelScheduledValues(now);
        gain.gain.setValueAtTime(Math.max(gain.gain.value, 0.0001), now);
        gain.gain.linearRampToValueAtTime(0.0001, now + FADE_MS / 1000);
        source.stop(now + FADE_MS / 1000 + 0.02);
      } catch {
        // 已停止的节点：忽略
      }
    }
    line.sources.clear();
  }

  private async decode(line: LineAudio, phrase: PhraseAudio): Promise<void> {
    const ctx = this.ctx;
    if (!ctx) return;
    try {
      const res = await fetch(phrase.url);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      phrase.buffer = await ctx.decodeAudioData(await res.arrayBuffer());
    } catch {
      // 解码失败：静音墓碑占位（S2）——1 样本静音缓冲顶替该短语，
      // 链式调度不因缺口停滞，落空下方的 trySchedule 照常续链；文字不受影响
      phrase.buffer = ctx.createBuffer(1, 1, ctx.sampleRate);
    }
    if (!line.faded && this.lines.get(this.currentSeq ?? -1) === line) {
      this.trySchedule(line);
    }
  }

  /** 链式调度：从 nextToPlay 起连续调度已解码短语（gapless + 缓冲垫）。 */
  private trySchedule(line: LineAudio): void {
    const ctx = this.ctx;
    if (!ctx || line.faded) return;
    for (;;) {
      const phrase = line.phrases.get(line.nextToPlay);
      if (!phrase?.buffer) return;
      const first = line.chainEnd === null;
      const when = Math.max(ctx.currentTime + 0.03, (line.chainEnd ?? 0) + (first ? 0 : PHRASE_PAD));
      this.playPhrase(line, phrase.buffer, when);
      line.chainEnd = when + phrase.buffer.duration;
      line.nextToPlay += 1;
      // 链尾到点后通知 React（自动模式解除 hold / 背压回落检查）
      const waitMs = Math.max(0, (line.chainEnd - ctx.currentTime + 0.05) * 1000);
      setTimeout(() => {
        this.checkBackpressure();
        this.notify();
      }, waitMs);
    }
  }

  /** 单短语播放：attack/release 短斜坡消爆音。line 为 null 时是重听链，挂到独立的节点表上。 */
  private playPhrase(line: LineAudio | null, buffer: AudioBuffer, when: number): void {
    const ctx = this.ctx;
    const master = this.master;
    if (!ctx || !master) return;
    const source = ctx.createBufferSource();
    source.buffer = buffer;
    const gain = ctx.createGain();
    const attack = 0.015;
    const release = Math.min(0.04, buffer.duration / 4);
    gain.gain.setValueAtTime(0.0001, when);
    gain.gain.linearRampToValueAtTime(1, when + attack);
    gain.gain.setValueAtTime(1, Math.max(when + attack, when + buffer.duration - release));
    gain.gain.linearRampToValueAtTime(0.0001, when + buffer.duration);
    source.connect(gain).connect(master);
    source.start(when);
    const bucket = line ? line.sources : this.replaySources;
    bucket.set(source, gain);
    source.onended = () => {
      bucket.delete(source);
      gain.disconnect();
      source.disconnect();
    };
  }

  /** 清掉当前行之前的行记录（内存护栏；pending 为派生值，删除即除账）。 */
  private pruneBefore(seq: number | undefined): void {
    if (seq === undefined) return;
    for (const key of this.lines.keys()) {
      if (key < seq) this.lines.delete(key);
    }
  }

  /** 清理路径统一出口（B2）：重置 pausedSent 前补发恢复——残留的 paused:true 会让服务端泵永久停摆，语音静默死锁。 */
  private clearBackpressure(): void {
    if (!this.pausedSent) return;
    this.pausedSent = false;
    this.onControl?.({ paused: false });
  }

  /** 客户端背压（D5）：积压滞回阈值 → 暂停/恢复服务端预取。 */
  private checkBackpressure(): void {
    if (!this.pausedSent && this.pending > PAUSE_AT) {
      this.pausedSent = true;
      this.onControl?.({ paused: true });
    } else if (this.pausedSent && this.pending <= RESUME_AT) {
      this.pausedSent = false;
      this.onControl?.({ paused: false });
    }
  }

  private notify(): void {
    this.onNotify?.();
  }
}
