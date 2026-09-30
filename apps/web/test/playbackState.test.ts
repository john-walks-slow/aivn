import { describe, expect, it } from "vitest";
import { emptyDialogHint, shouldAutoStart, type AutoStartInput } from "../src/stage/playbackState.js";

/** 「演出中、对话区空着、缓冲区里还有内容」——重演这一轮之后就是这个状态。 */
const WAITING: AutoStartInput = {
  live: true,
  auto: false,
  hold: false,
  hasCurrent: false,
  cursor: 2,
  cueCount: 6,
};

describe("空对话区文案", () => {
  it("演出中报落笔，不是「点击开始」——此刻只是还没写到下一句", () => {
    expect(emptyDialogHint(true)).toBe("剧作家正在落笔…");
  });

  it("非演出中才等玩家发话", () => {
    expect(emptyDialogHint(false)).toBe("（点击开始）");
  });
});

describe("演出中自动起播", () => {
  it("新内容一到就起播，不必让玩家点一下", () => {
    expect(shouldAutoStart(WAITING)).toBe(true);
  });

  it("正在读的那一句不会被新到内容抢走，阅读节奏仍归玩家", () => {
    expect(shouldAutoStart({ ...WAITING, hasCurrent: true })).toBe(false);
  });

  it("缓冲区空了就等着，不空转", () => {
    expect(shouldAutoStart({ ...WAITING, cueCount: 2 })).toBe(false);
  });

  it("非演出中不自动起播", () => {
    expect(shouldAutoStart({ ...WAITING, live: false })).toBe(false);
  });

  it("自动模式有自己的延时节奏，这里让路不抢", () => {
    expect(shouldAutoStart({ ...WAITING, auto: true })).toBe(false);
  });

  it("当前句语音没播完就不推进", () => {
    expect(shouldAutoStart({ ...WAITING, hold: true })).toBe(false);
  });
});
