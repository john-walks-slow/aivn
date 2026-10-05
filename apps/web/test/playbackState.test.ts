import { describe, expect, it } from "vitest";
import {
  dialogContent,
  emptyDialogHint,
  shouldAutoStart,
  stopAffordance,
  type AutoStartInput,
  readFlag,
  writeFlag,
  SETTING_CONTINUE_CARD,
  SETTING_VOICE,
} from "@aivn/stage";

/** 「演出中、对话区空着、缓冲区里还有内容」——重演这一轮之后就是这个状态。 */
const WAITING: AutoStartInput = {
  live: true,
  auto: false,
  hold: false,
  hasCurrent: false,
  currentComplete: true,
  cursor: 2,
  cueCount: 6,
  nextIsPlayerInput: false,
};

describe("空对话区文案", () => {
  it("演出中报落笔，不是「点击开始」——此刻只是还没写到下一句", () => {
    expect(emptyDialogHint(true)).toBe("剧作家正在落笔…");
  });

  it("非演出中才等玩家发话", () => {
    expect(emptyDialogHint(false)).toBe("（点击开始）");
  });
});

describe("台词条归属：当前行 > 空提示（玩家回执是缓冲里的普通行，没有特权分支）", () => {
  const base = { viewName: "小春", shown: "……喂。", hasView: true, live: true };

  it("照常显示当前行与它的名牌", () => {
    expect(dialogContent(base)).toEqual({ name: "小春", text: "……喂。" });
  });

  it("旁白不挂名牌，正文照给", () => {
    expect(dialogContent({ ...base, viewName: null })).toEqual({ name: null, text: "……喂。" });
  });

  it("没有当前行才轮到占位文案", () => {
    expect(dialogContent({ ...base, hasView: false, shown: "", viewName: null })).toEqual({
      name: null,
      text: "剧作家正在落笔…",
    });
  });
});

describe("演出中自动起播", () => {
  it("新内容一到就起播，不必让玩家点一下", () => {
    expect(shouldAutoStart(WAITING)).toBe(true);
  });

  it("正在读的那一句不会被新到内容抢走，阅读节奏仍归玩家", () => {
    expect(shouldAutoStart({ ...WAITING, hasCurrent: true })).toBe(false);
  });

  it("玩家的回执是唯一例外：停止点上选完立刻要看见自己说了什么", () => {
    expect(
      shouldAutoStart({ ...WAITING, hasCurrent: true, currentComplete: true, nextIsPlayerInput: true }),
    ).toBe(true);
  });

  it("回执不等 beat_start：player_input 先到时 state 还停在 stopped，照样显示", () => {
    expect(
      shouldAutoStart({ ...WAITING, live: false, hasCurrent: true, currentComplete: true, nextIsPlayerInput: true }),
    ).toBe(true);
  });

  it("回执不等自动模式的读速节奏：自己的话不吃那 2~3 秒延迟", () => {
    expect(
      shouldAutoStart({ ...WAITING, auto: true, hasCurrent: true, currentComplete: true, nextIsPlayerInput: true }),
    ).toBe(true);
  });

  it("停止点上对话区空着（刷新后/首拍前）时回执也照常顶上", () => {
    expect(shouldAutoStart({ ...WAITING, live: false, nextIsPlayerInput: true })).toBe(true);
  });

  it("回执也不抢没读完的句子（多端同看时阅读节奏归各自）", () => {
    expect(
      shouldAutoStart({ ...WAITING, hasCurrent: true, currentComplete: false, nextIsPlayerInput: true }),
    ).toBe(false);
  });

  it("回执再急也让语音 hold：当前句语音没播完就不推进", () => {
    expect(
      shouldAutoStart({ ...WAITING, hold: true, hasCurrent: true, currentComplete: true, nextIsPlayerInput: true }),
    ).toBe(false);
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

describe("本轮写完的出口", () => {
  /** 本轮没写 stop、演完且空闲——卡片与点舞台二选一的判定场景。 */
  const NO_STOP = { ready: true, stopType: null, isNoStop: true, continueCardOn: false };

  it("设置默认关：不摆卡，点舞台直接接下一轮", () => {
    expect(stopAffordance(NO_STOP)).toEqual({ showContinueCard: false, clickToContinue: true });
  });

  it("设置打开才摆卡，此时点舞台不再是出口", () => {
    expect(stopAffordance({ ...NO_STOP, continueCardOn: true })).toEqual({
      showContinueCard: true,
      clickToContinue: false,
    });
  });

  it("pause 永远点舞台：它是引擎自造的重试口，不是剧本写出来的停止点", () => {
    expect(stopAffordance({ ...NO_STOP, stopType: "pause", continueCardOn: true })).toEqual({
      showContinueCard: false,
      clickToContinue: true,
    });
  });

  it("有选肢时出口就是选项，不额外给继续", () => {
    expect(stopAffordance({ ...NO_STOP, stopType: "choice", continueCardOn: true })).toEqual({
      showContinueCard: false,
      clickToContinue: false,
    });
  });

  it("还没演完/编排器还忙着，两个出口都不成立", () => {
    expect(stopAffordance({ ...NO_STOP, ready: false })).toEqual({
      showContinueCard: false,
      clickToContinue: false,
    });
  });

  it("开着新一轮（isNoStop 还挂着上一轮）时不误摆卡", () => {
    expect(stopAffordance({ ...NO_STOP, ready: false, isNoStop: true })).toEqual({
      showContinueCard: false,
      clickToContinue: false,
    });
  });
});

describe("设置项读写", () => {
  function fakeStorage(seed: Record<string, string> = {}): Storage {
    const map = new Map(Object.entries(seed));
    return {
      getItem: (k: string) => map.get(k) ?? null,
      setItem: (k: string, v: string) => void map.set(k, v),
    } as Storage;
  }

  it("没存过就是默认值（「（继续）」卡默认关、语音默认开）", () => {
    const s = fakeStorage();
    expect(readFlag(s, SETTING_CONTINUE_CARD, false)).toBe(false);
    expect(readFlag(s, SETTING_VOICE, true)).toBe(true);
  });

  it("写入后可原样读回", () => {
    const s = fakeStorage();
    writeFlag(s, SETTING_CONTINUE_CARD, true);
    expect(readFlag(s, SETTING_CONTINUE_CARD, false)).toBe(true);
    writeFlag(s, SETTING_CONTINUE_CARD, false);
    expect(readFlag(s, SETTING_CONTINUE_CARD, false)).toBe(false);
  });

  it("历史键值（stage-voice 的 \"1\"/\"0\"）行为不变", () => {
    expect(readFlag(fakeStorage({ "stage-voice": "1" }), "stage-voice", true)).toBe(true);
    expect(readFlag(fakeStorage({ "stage-voice": "0" }), "stage-voice", true)).toBe(false);
  });
});
