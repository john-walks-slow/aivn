import { afterEach, describe, expect, it, vi } from "vitest";
import { VoiceDirector } from "./audio.js";

/**
 * 重听落在「还没有音频」的行上：请服务端按当时的台词整句补生成，回来就播。
 * 这一段不需要 AudioContext（起播那一步在浏览器里实测），验的是**决定与收束**：
 * 什么时候去求服务端、什么时候收手，以及合成失败时这个键回不回得到原样。
 */
describe("VoiceDirector：按需补生成（重听）", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  function director() {
    const asked: number[] = [];
    const d = new VoiceDirector();
    d.onRequestVoice = (seq) => asked.push(seq);
    return { d, asked };
  }

  it("台账里没有这一行 → 求服务端补生成", () => {
    const { d, asked } = director();
    d.requestReplay(42);
    expect(asked).toEqual([42]);
  });

  it("已经在合成中的行不再重复点一次", () => {
    const { d, asked } = director();
    d.markPending(42);
    d.requestReplay(42);
    expect(asked).toEqual([]);
  });

  it("补生成失败：收手，这个键回到「没有音频」", () => {
    const { d, asked } = director();
    d.requestReplay(42);
    d.markPending(42);
    d.audioFailed(42);
    expect(d.voiceState(42)).toBe("none");
    expect(asked).toEqual([42]);
  });

  it("连点两下只求一次（帧还没回来的这段时间不重复烧配额）", () => {
    const { d, asked } = director();
    d.requestReplay(7);
    d.requestReplay(7);
    d.requestReplay(7);
    expect(asked).toEqual([7]);
  });

  it("关了语音再打开：这一行还能再点一次（幂等记号不许把重试入口焊死）", () => {
    const { d, asked } = director();
    d.requestReplay(7);
    d.setEnabled(false); // 关语音：服务端那边这一趟的活儿也会被扔掉
    d.setEnabled(true);
    d.requestReplay(7);
    expect(asked).toEqual([7, 7]);
  });

  it("换行之后，上一行的计时不许提前解开新行的等待", () => {
    vi.useFakeTimers();
    const { d, asked } = director();
    d.requestReplay(7);
    vi.advanceTimersByTime(10_000); // 等了 10s，改听另一行
    d.requestReplay(8);
    vi.advanceTimersByTime(15_000); // t=25s：seq 7 那条 20s 的计时到点了
    d.requestReplay(8); // 新行的记号还在 → 不该重复求
    expect(asked).toEqual([7, 8]);

    vi.advanceTimersByTime(20_000); // 再过一会儿，seq 8 自己也到点
    d.requestReplay(8);
    expect(asked).toEqual([7, 8, 8]);
  });

  it("等待有上界：没人回执时到点放下记号，同一行还能再点一次", () => {
    vi.useFakeTimers();
    const { d, asked } = director();
    d.requestReplay(7);
    d.requestReplay(7);
    expect(asked).toEqual([7]);
    vi.advanceTimersByTime(20_000);
    d.requestReplay(7);
    expect(asked).toEqual([7, 7]);
  });

  it("积压清了要撤销暂停：否则那条 paused:true 会把服务端的泵永久停住", () => {
    const controls: { paused?: boolean }[] = [];
    const d = new VoiceDirector();
    d.onControl = (state) => controls.push(state);
    // 五行到货未播 → 超过 PAUSE_AT(4)，客户端喊暂停
    for (const seq of [1, 2, 3, 4, 5]) d.handleAudio({ seq, url: `/tts/${seq}.mp3` });
    expect(controls).toEqual([{ paused: true }]);

    // 播放头前移到第 9 行：旧行被清掉，积压归零，而第 9 行还没到货（不会再有别的时机重算）
    d.lineStarted(9, true);
    expect(controls).toEqual([{ paused: true }, { paused: false }]);
  });

  it("别的行的迟到帧不该把这一行的等待放掉（等的是谁就只认谁的帧）", () => {
    const { d, asked } = director();
    d.requestReplay(7);
    d.handleAudio({ seq: 3, url: "/tts/早先演过的那一行.mp3" }); // 迟到/重推的别行帧
    d.markPending(7);
    expect(asked).toEqual([7]);
    expect(d.voiceState(7)).toBe("pending");
  });

  it("换一行再点：新的一行照求，不会因为上一行还挂着就哑掉", () => {
    const { d, asked } = director();
    d.requestReplay(7);
    d.requestReplay(8);
    expect(asked).toEqual([7, 8]);
  });

  it("原地改写：那一行的旧音频作废，重听改走补生成", () => {
    const { d, asked } = director();
    d.markPending(9);
    d.forgetLine(9);
    expect(d.voiceState(9)).toBe("none");
    d.requestReplay(9);
    expect(asked).toEqual([9]);
  });

  it("作废之后旧帧迟到：不写台账，也不把这一行点亮", () => {
    const { d } = director();
    d.forgetLine(9);
    d.markPending(9);
    d.handleAudio({ seq: 9, url: "/tts/旧词.mp3" });
    expect(d.voiceState(9)).toBe("none");
  });

  it("重新点名之后这一行才重新收帧", () => {
    const { d, asked } = director();
    d.forgetLine(9);
    d.requestReplay(9); // 用户点名要听 = 解封
    d.markPending(9);
    expect(asked).toEqual([9]);
    expect(d.voiceState(9)).toBe("pending");
  });
});
