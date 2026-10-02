import { describe, expect, it } from "vitest";
import {
  dialogContent,
  emptyDialogHint,
  shouldAutoStart,
  stopAffordance,
  type AutoStartInput,
} from "../src/stage/playbackState.js";
import { readFlag, writeFlag, SETTING_CONTINUE_CARD, SETTING_VOICE } from "../src/stage/settings.js";

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

describe("台词条归属：回声 > 当前行 > 空提示", () => {
  const base = { playerEcho: null, viewName: "小春", shown: "……喂。", hasView: true, live: true };

  it("停止点上回声压得住上一句——初版就是死在这里，屏幕上什么都没有", () => {
    const d = dialogContent({ ...base, playerEcho: "（选择了：走）" });
    expect(d).toEqual({ name: "你", text: "（选择了：走）" });
  });

  it("没有回声时照常显示当前行与它的名牌", () => {
    expect(dialogContent(base)).toEqual({ name: "小春", text: "……喂。" });
  });

  it("旁白不挂名牌，正文照给", () => {
    expect(dialogContent({ ...base, viewName: null })).toEqual({ name: null, text: "……喂。" });
  });

  it("既没有回声也没有当前行才轮到占位文案", () => {
    expect(dialogContent({ ...base, hasView: false, shown: "", viewName: null })).toEqual({
      name: null,
      text: "剧作家正在落笔…",
    });
  });

  it("回声空了才回落，不留上一句的残影", () => {
    expect(dialogContent({ ...base, playerEcho: "" })).toEqual({ name: "小春", text: "……喂。" });
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
