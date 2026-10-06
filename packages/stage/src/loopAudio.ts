/**
 * 舞台循环音轨与一次性音效（HTMLAudioElement 版）。
 *
 * 不用 Web Audio：语音那条通路（audio.ts）已经占着共享 AudioContext，而背景乐要的是
 * 「随时能播、别被自动播放策略卡住、能立刻停」。裸 <audio> 的 element.volume 线性
 * 斜坡够用，混响与 EQ 这类效果对循环 BGM 也没有意义。
 *
 * 铁律：音频永远不阻塞演出——play() 被自动播放策略拒绝只是没声音，绝不抛给上层。
 */

/** 换曲交叉淡入淡出（毫秒）。不给模型旋钮，客户端固定：太短会爆音，太长会像没换。 */
const FADE_MS = 1200;
/** 淡变步长：线性插值的 tick 间隔，50ms 一步对线性音量已经听不出台阶。 */
const RAMP_STEP_MS = 50;
/** 同时最多响几声音效：同一拍里连发十几个 sfx 会叠成噪音，该丢的就丢。 */
const MAX_SFX = 6;

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value));
}

function absolute(url: string): string {
  return new URL(url, location.href).href;
}

/** 循环音轨：换曲 = 交叉淡入淡出，停 = 淡出。同一时刻最多两个元素在响。 */
export class LoopChannel {
  private active: HTMLAudioElement | null = null;
  private retired: HTMLAudioElement | null = null;
  private readonly ramps = new Map<HTMLAudioElement, number>();

  /** 缺省音量（剧本没给 bgm_volume/ambient_volume 时用它）。 */
  constructor(private readonly base: number) {}

  /** 换曲 / 停止 / 改音量都走这一个口：url 为 null 即停，volume 缺省回落 base。 */
  set(url: string | null, volume?: number): void {
    const gain = clamp01(volume ?? this.base);
    if (url === null) {
      this.retire();
      return;
    }
    const href = absolute(url);
    if (this.active?.src === href) {
      this.rampTo(this.active, gain);
      return;
    }
    this.retire();
    const el = new Audio(href);
    el.loop = true;
    el.preload = "auto";
    el.volume = 0;
    this.active = el;
    void el.play().catch(() => {});
    this.rampTo(el, gain);
  }

  /** 退场：旧音轨淡出后彻底停掉，元素从 DOM 之外回收（不挂 <audio> 标签，用完即弃）。 */
  private retire(): void {
    if (!this.active) return;
    const old = this.active;
    this.active = null;
    // 上一首还在淡出就又换曲：先把上一首掐掉（它已经淡了半天，再淡下去没人听得见），
    // 再让刚退下的这首从头淡出。反过来做就是「刚淡入一半的新曲被硬掐」，能听见 pop。
    if (this.retired) this.discard(this.retired);
    this.retired = old;
    this.rampTo(old, 0, () => this.discard(old));
  }

  /** 立刻停干净：撤掉淡入淡出定时器、清源、回收元素。 */
  private discard(el: HTMLAudioElement): void {
    this.cancelRamp(el);
    el.pause();
    el.removeAttribute("src");
    el.load();
    if (this.retired === el) this.retired = null;
  }

  private rampTo(el: HTMLAudioElement, target: number, done?: () => void): void {
    this.cancelRamp(el);
    const from = el.volume;
    if (Math.abs(target - from) < 0.01) {
      el.volume = target;
      done?.();
      return;
    }
    const steps = Math.max(1, Math.round(FADE_MS / RAMP_STEP_MS));
    let i = 0;
    const timer = window.setInterval(() => {
      i += 1;
      el.volume = clamp01(from + (target - from) * (i / steps));
      if (i < steps) return;
      window.clearInterval(timer);
      this.ramps.delete(el);
      done?.();
    }, RAMP_STEP_MS);
    this.ramps.set(el, timer);
  }

  private cancelRamp(el: HTMLAudioElement): void {
    const timer = this.ramps.get(el);
    if (timer !== undefined) {
      window.clearInterval(timer);
      this.ramps.delete(el);
    }
  }

  /** 组件卸载/退场时彻底停音。 */
  dispose(): void {
    for (const el of [this.active, this.retired]) {
      if (el) this.discard(el);
    }
    this.active = null;
    this.retired = null;
  }
}

/** 一次性音效：同帧连发不叠加成噪音，超出上限时挤掉最老的一小声。 */
export class SfxPlayer {
  private readonly playing = new Set<HTMLAudioElement>();

  play(url: string, volume = 0.7): void {
    if (this.playing.size >= MAX_SFX) {
      const oldest = this.playing.values().next().value;
      if (oldest) {
        this.playing.delete(oldest);
        oldest.pause();
      }
    }
    const el = new Audio(absolute(url));
    el.volume = clamp01(volume);
    el.addEventListener("ended", () => this.playing.delete(el));
    el.addEventListener("error", () => this.playing.delete(el));
    this.playing.add(el);
    void el.play().catch(() => this.playing.delete(el));
  }

  dispose(): void {
    for (const el of this.playing) el.pause();
    this.playing.clear();
  }
}
