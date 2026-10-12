/**
 * VoiceDirector —— 舞台语音导演（D5 Web Audio 侧）。
 *
 * - 单一 AudioContext，「点击开始」遮罩手势 resume()（移动端铁律）；
 * - 一行一个音频文件：台词说完（say_end）整句送合成，回来即播，没有片段拼接那一层；
 * - 文字先行：行开始时语音未就绪则静音上文字，音频解码完成后跟进起播；
 * - 快进：淡出当前行（100ms），还没播的到达即丢弃（文件留在服务端缓存，回顾可重听）；
 * - 背压：已到货未播的行积压超阈值 → onControl({paused:true}) 暂停服务端预取（省配额）。
 */

/** 快进淡出时长（毫秒）。 */
const FADE_MS = 100;
/** 背压阈值：已到货未播的行数（一行一文件，一条就是几秒到十几秒）超过 PAUSE_AT 暂停预取，回落 RESUME_AT 恢复。 */
const PAUSE_AT = 4;
const RESUME_AT = 1;
/** 重听 URL 台账的行数上限（内存护栏）。 */
const URL_LEDGER_MAX = 500;
/** 「合成中」标记的兜底上界：帧在半路丢了（服务端重启、连接断在中间）时靠它自己熄灯。 */
const PENDING_TTL_MS = 45_000;
/**
 * 补生成的等待上界：请求在断线时丢掉、或服务端压根不受理（没有回执），
 * 到点就放下「已经问过了」的记号——**别让重试入口被自己的幂等标记焊死**。
 * 定得比一句长台词合成完还宽（那也就几秒）。
 */
const REPLAY_WAIT_MS = 20_000;

interface LineAudio {
  url: string;
  buffer: AudioBuffer | null;
  /** 已经排进播放链（同一行只排一次）。 */
  started: boolean;
  /** 已调度链的结束时刻（AudioContext 时间）；null = 未起播。 */
  chainEnd: number | null;
  /** 快进/换行/改写后废弃：这一行的音频到达即丢弃。 */
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
   * 行 → 音频 URL 台账。跨轮保留：解码好的 AudioBuffer 在 beatStarted 就随 lines 一起扔了，
   * 但文件还躺在服务端的内容寻址缓存里——回顾要能重听旧行，靠的就是这张表重新拉一遍。
   */
  private readonly urls = new Map<number, string>();
  /** 重听链：正在挂起的播放节点（重听不归属任何演出行，单独记以便单独掐断）。 */
  private replaySources = new Map<AudioBufferSourceNode, GainNode>();
  /** 每次发起重听自增：迟到的解码结果发现令牌已变就自我淘汰。 */
  private replayToken = 0;
  /** 正在重听的那一行（编辑作废时要连它一起掐）。 */
  private replaySeq: number | null = null;
  /** 已见最大 seq（beatStarted 时冻结为门槛：旧轮迟到音频直接丢弃）。 */
  private maxSeqSeen = 0;
  private floorSeq = 0;
  private pausedSent = false;
  enabled = true;
  /** React 通知（重渲染驱动自动模式解除 hold 等）。 */
  onNotify: (() => void) | null = null;
  /** 服务端预取控制（背压）。 */
  onControl: ((state: { paused?: boolean }) => void) | null = null;
  /** 按需补生成的出口（宿主接上：发 voice_request）。 */
  onRequestVoice: ((seq: number) => void) | null = null;
  /** 用户点名要听、正在等它回来的那一行（见 requestReplay）。 */
  private wantReplay: number | null = null;
  /** 上面那条等待的兜底计时（见 REPLAY_WAIT_MS）。 */
  private wantReplayTimer: ReturnType<typeof setTimeout> | null = null;
  /**
   * 等待的代号：每换一次等待自增。计时器回调只认自己那一次的代号——
   * 换行、超时、关语音之后，已经排上队的老回调不该再去动新那一次的记号。
   */
  private wantReplayToken = 0;
  /**
   * 已经作废的行（原地改写）：这一行的旧音频不再收，直到用户重新点名要听。
   * 服务端那边按台词代次拦了一道（见 VoicePipeline.invalidateLine），这里再拦一道——
   * 旧宿主、重连补帧、代理重放这类「帧从别处来」的路不该能写回台账。
   */
  private readonly voided = new Set<number>();
  /**
   * 合成中（服务端已经接下、音频还没回来）的行 → 记录时刻。
   * 只用来给界面一个「正在生成」的信号；真音频到达就摘掉，轮切换时整体清空。
   *
   * 记时刻是因为帧可能根本不到（服务端在合成中途挂了）：没有上界的话喇叭会一直闪到本轮结束。
   */
  private readonly pendingLines = new Map<number, number>();

  get unlocked(): boolean {
    return this.ctx !== null;
  }

  /** 已到货未播的行数（背压派生值）：存活行里音频有了、还没轮到的那些。 */
  private get pending(): number {
    let n = 0;
    for (const line of this.lines.values()) if (!line.faded && !line.started) n += 1;
    return n;
  }

  /** 用户手势解锁（遮罩点击）：取得共享 context 并 resume，补解码积压。 */
  unlock(): void {
    if (this.ctx) return;
    this.ctx = sharedAudioContext();
    this.master = this.ctx.createGain();
    this.master.connect(this.ctx.destination);
    void this.ctx.resume().then(() => this.notify());
    for (const line of this.lines.values()) {
      if (line.buffer === null && !line.faded) void this.decode(line);
    }
  }

  /** 放下这一行的等待（用户自己关掉语音、换行、超时都走这里）。 */
  private clearWantReplay(): void {
    this.wantReplay = null;
    this.wantReplayToken += 1;
    if (this.wantReplayTimer !== null) {
      clearTimeout(this.wantReplayTimer);
      this.wantReplayTimer = null;
    }
  }

  setEnabled(on: boolean): void {
    this.enabled = on;
    if (!on) {
      this.fadeAll();
      this.lines.clear();
      this.pendingLines.clear();
      this.clearBackpressure();
      // 关语音 = 这一趟等待作废（服务端那边也会把队列扔掉）。清了它，重新打开之后
      // 同一行还能再点一次生成——不然那个「已经问过了」的记号会把重试入口焊死。
      this.clearWantReplay();
    }
    this.notify();
  }

  /**
   * 一行的语音三态。合成中也占一个位——图标闪着，玩家才知道这句有配音、只是还没好。
   * 语音总开关关掉时一律 none：那时候不是「没配音」，是不要配音。
   */
  voiceState(seq: number | null | undefined): "none" | "pending" | "ready" {
    if (!this.enabled || seq === null || seq === undefined) return "none";
    if (this.voided.has(seq)) return "none";
    if (this.urls.has(seq)) return "ready";
    if (!this.pendingLines.has(seq)) return "none";
    this.pruneStalePending();
    return this.pendingLines.has(seq) ? "pending" : "none";
  }

  /**
   * 重听一行（工具栏的喇叭键 / 回顾里的播放徽章）。
   *
   * 台账里已经有这一行的音频 → 直接重播，不打扰服务端；一行就是一个文件，
   * 「有」就等于「整句齐全」，不存在只播到半句那种事。
   * 没有（当时关着语音、合成失败、换了设备，或刷新过页面——台账在内存里，刷新即空）
   * → 请服务端按这一行**当时的台词**补生成，并记下它是「用户点名要听的」：
   * 音频回来（或明确失败）那一刻自动起播。
   */
  requestReplay(seq: number): void {
    if (!this.enabled) return;
    const state = this.voiceState(seq);
    // 用户点名要听 = 这一行重新收帧（编辑作废之后只有这一条路能解封）
    this.voided.delete(seq);
    if (state === "ready") {
      void this.replay(seq);
      return;
    }
    // 同一个来回里连点几下只求一次：帧还没回来的这段时间，wantReplay 就是「已经问过了」的记号
    if (this.wantReplay === seq) return;
    // 换到新的一行：旧的那条等待连同它的计时一起作废（否则旧计时到点会提前解开新行的记号）
    this.clearWantReplay();
    this.wantReplay = seq;
    const token = this.wantReplayToken;
    this.wantReplayTimer = setTimeout(() => {
      if (this.wantReplayToken === token) this.clearWantReplay();
    }, REPLAY_WAIT_MS);
    // 已经在合成中的不必再点一次，等它回来就好
    if (state === "none") this.onRequestVoice?.(seq);
  }

  /**
   * 用户点名的那一行有回音了：放下等待，台账里有音频就起播。
   * 一行一条请求，所以「这一行的帧到了」就等于「这一行做完了」——没有分批等齐那一层。
   * **只认它自己那一帧**：同一时刻别的行（早先演过的、重连补推的）也可能有帧在飞，
   * 那些帧不该把这一行的等待放掉。
   */
  private flushWantReplay(seq: number): void {
    if (this.wantReplay !== seq) return;
    this.clearWantReplay();
    if (this.urls.has(seq)) void this.replay(seq);
  }

  /**
   * 这一行被原地改写了（line_edited）：台词换了，台账里那份音频是旧词的，作废。
   * 于是重听会走「没有音频」那条路——按新台词补生成，不会播出旧声音。
   */
  forgetLine(seq: number | null | undefined): void {
    if (typeof seq !== "number") return;
    this.urls.delete(seq);
    this.pendingLines.delete(seq);
    this.voided.add(seq);
    if (this.wantReplay === seq) this.clearWantReplay();
    // 声音也当场作废：台词都换了，别让旧音频接着念
    const line = this.lines.get(seq);
    if (line) this.fadeLine(line);
    if (this.currentSeq === seq) this.currentSeq = null;
    if (this.replaySeq === seq) this.stopReplay();
    this.checkBackpressure();
    this.notify();
  }

  /** audio_failed 到达：这一行合成不出来，摘掉「合成中」标记并看看等它的重听是否就此收束。 */
  audioFailed(seq: number): void {
    if (this.voided.has(seq)) return;
    this.clearPending(seq);
    this.flushWantReplay(seq);
    // 喇叭要立刻从「合成中」回到「可以再点一次」：失败不回通知的话它会一直闪下去
    this.notify();
  }

  /** audio_pending 到达：记下这一行正在合成，让界面亮起喇叭。 */
  markPending(seq: number): void {
    if (!this.enabled || this.voided.has(seq)) return;
    this.pruneStalePending();
    this.pendingLines.set(seq, Date.now());
    this.notify();
  }

  private clearPending(seq: number): void {
    this.pendingLines.delete(seq);
  }

  /** 合成中途没回音的（服务端挂了/帧丢了）按上界自己摘掉，别让喇叭闪到本轮结束。 */
  private pruneStalePending(): void {
    const cutoff = Date.now() - PENDING_TTL_MS;
    for (const [seq, at] of this.pendingLines) {
      if (at < cutoff) this.pendingLines.delete(seq);
    }
  }

  /**
   * 重听一行（回顾/回看里的播放键）：拉这一个文件解码起播。
   * 一次只留一条重听链——再点别的就掐断上一条，不叠音。
   */
  async replay(seq: number): Promise<boolean> {
    if (!this.enabled) return false;
    this.unlock();
    if (!this.ctx || !this.master) return false;
    const url = this.urls.get(seq);
    if (!url) return false;

    this.stopReplay(); // 先掐断上一条重听，再认领当前令牌
    const token = this.replayToken;
    this.replaySeq = seq;
    const ctx = this.ctx;
    let buffer = this.lines.get(seq)?.buffer ?? null;
    if (!buffer) {
      try {
        const res = await fetch(url);
        if (res.ok) buffer = await ctx.decodeAudioData(await res.arrayBuffer());
      } catch {
        // 拉不到就当这次没播成：不打扰演出，用户再点一次即可
      }
    }
    if (token !== this.replayToken || !this.enabled || !buffer) return false;
    this.playBuffer(null, buffer, ctx.currentTime + 0.05);
    this.notify();
    return true;
  }

  /** 掐断正在播的重听（再点一次播放键、或新的一键把它顶掉）。 */
  stopReplay(): void {
    this.replaySeq = null;
    const ctx = this.ctx;
    if (!ctx) {
      this.replaySources.clear();
      return;
    }
    this.fadeSources(this.replaySources);
  }

  /** audio_ready 到达：记账 + 预取解码。 */
  handleAudio(ready: { seq: number; url: string }): void {
    this.clearPending(ready.seq);
    if (!this.enabled || this.voided.has(ready.seq)) return;
    this.rememberUrl(ready.seq, ready.url);
    // 补生成等的是这一行回来，与它是否还在演无关：先评估，再走下面的丢弃守卫
    this.flushWantReplay(ready.seq);
    // 喇叭要立刻从「合成中」切回「可重听」——台账变了，界面得看见
    this.notify();
    // 旧轮迟到音频（beat 已收束后 TTS 才完成）与已播过的行：直接丢弃
    if (ready.seq <= this.floorSeq) return;
    if (this.currentSeq !== null && ready.seq < this.currentSeq) return;
    this.maxSeqSeen = Math.max(this.maxSeqSeen, ready.seq);
    let line = this.lines.get(ready.seq);
    if (!line) {
      line = {
        url: ready.url,
        buffer: null,
        started: false,
        chainEnd: null,
        faded: false,
        sources: new Map(),
      };
      this.lines.set(ready.seq, line);
    }
    if (line.faded || line.buffer) return;
    if (this.ctx) void this.decode(line);
    this.checkBackpressure();
  }

  /** 播放行切换（usePlayback onLineStart）：narrate/scene 行 seq=undefined → 仅收尾上一行。 */
  lineStarted(seq: number | undefined, isSay: boolean): void {
    this.finishCurrent();
    this.pruneBefore(seq);
    // 旧行清掉之后积压可能已经回落：不重算的话那条 paused:true 会一直挂着，泵就永久停住了
    this.checkBackpressure();
    if (!this.enabled || seq === undefined || !isSay) {
      this.currentSeq = null;
      return;
    }
    this.currentSeq = seq;
    const line = this.lines.get(seq);
    if (line && !line.faded) this.trySchedule(line);
  }

  /** 快进（打字中点击 / 行末点击推进）：淡出当前行语音，未播的直接丢。 */
  fastForward(): void {
    this.finishCurrent();
    this.checkBackpressure();
  }

  /** 新轮开始：停掉全部残留语音，旧轮迟到音频一律丢弃（floor 门槛）。 */
  beatStarted(): void {
    this.fadeAll();
    this.lines.clear();
    this.pendingLines.clear();
    this.clearBackpressure();
    this.clearWantReplay();
    this.currentSeq = null;
    this.floorSeq = this.maxSeqSeen;
    this.notify();
  }

  /** fresh start / 组件卸载。 */
  reset(): void {
    this.beatStarted();
    this.urls.clear();
    this.voided.clear();
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
    this.clearWantReplay();
    this.lines.clear();
    this.pendingLines.clear();
    this.clearBackpressure();
    this.currentSeq = null;
  }

  /** URL 台账记账。条数封顶：整场下来也就几百行，超了就丢最旧的（回顾翻不到那么远）。 */
  private rememberUrl(seq: number, url: string): void {
    this.urls.set(seq, url);
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
    // 未播的行就此作废（文件留在服务端缓存，回顾重听可用；pending 为派生值，faded 行自动除账）
    this.fadeSources(line.sources);
  }

  /** 淡出并停掉一组播放节点。 */
  private fadeSources(sources: Map<AudioBufferSourceNode, GainNode>): void {
    const ctx = this.ctx;
    if (!ctx) {
      sources.clear();
      return;
    }
    const now = ctx.currentTime;
    for (const [source, gain] of sources) {
      try {
        gain.gain.cancelScheduledValues(now);
        gain.gain.setValueAtTime(Math.max(gain.gain.value, 0.0001), now);
        gain.gain.linearRampToValueAtTime(0.0001, now + FADE_MS / 1000);
        source.stop(now + FADE_MS / 1000 + 0.02);
      } catch {
        // 已停止的节点：忽略
      }
    }
    sources.clear();
  }

  private async decode(line: LineAudio): Promise<void> {
    const ctx = this.ctx;
    if (!ctx) return;
    try {
      const res = await fetch(line.url);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      line.buffer = await ctx.decodeAudioData(await res.arrayBuffer());
    } catch {
      // 解码失败：这一行就当没配音，不起播也不占位（一行一文件，没有再接不上的后续片段）
    }
    if (!line.faded && this.lines.get(this.currentSeq ?? -1) === line) this.trySchedule(line);
  }

  /** 到点起播：当前行、音频已解码、还没排过。 */
  private trySchedule(line: LineAudio): void {
    const ctx = this.ctx;
    if (!ctx || line.faded || line.started || !line.buffer) return;
    const when = ctx.currentTime + 0.03;
    this.playBuffer(line, line.buffer, when);
    line.started = true;
    line.chainEnd = when + line.buffer.duration;
    // 链尾到点后通知 React（自动模式解除 hold / 背压回落检查）
    const waitMs = Math.max(0, (line.chainEnd - ctx.currentTime + 0.05) * 1000);
    setTimeout(() => {
      this.checkBackpressure();
      this.notify();
    }, waitMs);
  }

  /** 播放一个音频：attack/release 短斜坡消爆音。line 为 null 时是重听链，挂到独立的节点表上。 */
  private playBuffer(line: LineAudio | null, buffer: AudioBuffer, when: number): void {
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
