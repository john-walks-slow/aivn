import { afterEach, describe, expect, it, vi } from "vitest";
import { VoiceDirector } from "./audio.js";

/**
 * 重听落在「还没有音频」的行上：请服务端按当时的台词补生成，等短语到齐再播。
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

  it("台账里没有这一行 → 求服务端补生成，不试着播空链", () => {
    const { d, asked } = director();
    d.requestReplay(42);
    expect(asked).toEqual([42]);
  });

  it("已经在合成中的行不再重复点一次", () => {
    const { d, asked } = director();
    d.markPending(42, 0);
    d.requestReplay(42);
    expect(asked).toEqual([]);
  });

  it("补生成全失败：收手，这个键回到「没有音频」", () => {
    const { d, asked } = director();
    d.requestReplay(42);
    d.markPending(42, 0);
    d.markPending(42, 1);
    d.audioFailed(42, 0);
    d.audioFailed(42, 1);
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

  it("换一行再点：新的一行照求，不会因为上一行还挂着就哑掉", () => {
    const { d, asked } = director();
    d.requestReplay(7);
    d.requestReplay(8);
    expect(asked).toEqual([7, 8]);
  });

  it("原地改写：那一行的旧音频作废，重听改走补生成", () => {
    const { d, asked } = director();
    d.markPending(9, 0);
    d.forgetLine(9);
    expect(d.voiceState(9)).toBe("none");
    d.requestReplay(9);
    expect(asked).toEqual([9]);
  });

  it("作废之后旧帧迟到：不写台账，也不把这一行点亮（要用户重新点名）", () => {
    const { d } = director();
    d.forgetLine(9);
    d.markPending(9, 0);
    d.handleAudio({ seq: 9, phrase: 0, url: "/tts/旧词.mp3" });
    expect(d.voiceState(9)).toBe("none");
    // 重新点名要听之后，帧才收得进来（留一句在路上，这一段就不去起播——起播要有 AudioContext）
    d.requestReplay(9);
    d.markPending(9, 1);
    d.handleAudio({ seq: 9, phrase: 0, url: "/tts/新词.mp3" });
    expect(d.voiceState(9)).toBe("ready");
  });
});
