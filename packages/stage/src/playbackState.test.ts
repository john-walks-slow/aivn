import { describe, expect, it } from "vitest";
import type { Cue, ScriptLine } from "./script.js";
import type { TranscriptEntry } from "./transcript.js";
import { buildPageView, titleLastStep, titleRevealTarget, titleStepEnds } from "./playbackState.js";

function title(text: string, mode: "block" | "lines" = "lines"): ScriptLine {
  return { key: "t", type: "title", text, mode, align: "center" } as ScriptLine;
}

describe("titleStepEnds：逐句标题卡的行断点", () => {
  it("每个非空行的末尾给一个断点（字符偏移）", () => {
    expect(titleStepEnds("床前明月光\n疑是地上霜")).toEqual([5, 11]);
  });

  it("空行是分节间距，不单独占一步", () => {
    expect(titleStepEnds("A\n\nB")).toEqual([1, 4]);
  });

  it("无换行的单行", () => {
    expect(titleStepEnds("独白")).toEqual([2]);
  });

  it("尾随换行不额外产生一步", () => {
    expect(titleStepEnds("A\n")).toEqual([1]);
  });

  it("全空白退回一个全文断点（保证至少一步，不零步卡死）", () => {
    expect(titleStepEnds("   ")).toEqual([3]);
  });
});

describe("titleRevealTarget / titleLastStep", () => {
  it("逐句卡按步取断点，末步即全文", () => {
    const line = title("床前明月光\n疑是地上霜");
    expect(titleRevealTarget(line, 0)).toBe(5);
    expect(titleRevealTarget(line, 1)).toBe(11);
    expect(titleRevealTarget(line, 99)).toBe(11);
    expect(titleLastStep(line)).toBe(1);
  });

  it("block 卡与普通行恒取全文、恒 0 步", () => {
    const block = title("第一章\n风起", "block");
    expect(titleRevealTarget(block, 0)).toBe(block.text.length);
    expect(titleLastStep(block)).toBe(0);
    const say = { key: "s", type: "say", text: "台词" } as ScriptLine;
    expect(titleRevealTarget(say, 3)).toBe(2);
    expect(titleLastStep(say)).toBe(0);
  });
});

describe("buildPageView：书页流 / 音响小说连续段落分页", () => {
  const mkEntry = (
    key: string,
    type: "say" | "narrate" | "thought",
    text: string,
    kind: "line" | "input" = "line",
    actorId: string | null = null,
  ): TranscriptEntry => ({
    key,
    kind,
    type,
    actorId,
    text,
    seq: null,
    nodeId: null,
  });

  it("同场景内多句累积同屏，当前行按打字机 viewLength 截断并标记 isCurrent", () => {
    const lines: ScriptLine[] = [
      { key: "l1", type: "narrate", text: "第一段旁白。", raw: "第一段旁白。" },
      { key: "l2", type: "say", actorId: "manami", text: "你好，欢迎来到图书馆。", raw: "你好，欢迎来到图书馆。" },
    ];
    const cues: Cue[] = [
      { key: "c0", kind: "scene", bg: "library_dusk" },
      { key: "c1", kind: "line", lineKey: "l1" },
      { key: "c2", kind: "line", lineKey: "l2" },
    ];
    const transcript: TranscriptEntry[] = [
      mkEntry("l1", "narrate", "第一段旁白。"),
      mkEntry("l2", "say", "你好，欢迎来到图书馆。", "line", "manami"),
    ];
    const page = buildPageView({
      cues,
      lines,
      transcript,
      current: lines[1]!,
      view: transcript[1]!,
      viewLength: 3,
      shownLength: 3,
      scrubbed: false,
    });
    expect(page.pageNo).toBe(1);
    expect(page.scene).toBe("library_dusk");
    expect(page.entries).toEqual([
      expect.objectContaining({ key: "l1", text: "第一段旁白。", isCurrent: false }),
      expect.objectContaining({ key: "l2", text: "你好，", isCurrent: true }),
    ]);
  });

  it("重复声明相同 bg 或仅切换 bgm 不翻页；切换不同 bg 时自动翻到新页", () => {
    const lines: ScriptLine[] = [
      { key: "l1", type: "narrate", text: "图书馆里的第一句。", raw: "图书馆里的第一句。" },
      { key: "l2", type: "input", actorId: "player", text: "推开门走出去。", raw: "推开门走出去。" },
      { key: "l3", type: "say", actorId: "manami", text: "依然在图书馆。", raw: "依然在图书馆。" },
      { key: "l4", type: "narrate", text: "来到了天台。", raw: "来到了天台。" },
    ];
    const cues: Cue[] = [
      { key: "c0", kind: "scene", bg: "library" },
      { key: "c1", kind: "line", lineKey: "l1" },
      { key: "c2", kind: "line", lineKey: "l2" },
      { key: "c3", kind: "scene", bg: "library", bgm: "rain" }, // 同场景换乐：不翻页
      { key: "c4", kind: "line", lineKey: "l3" },
      { key: "c5", kind: "scene", bg: "rooftop" }, // 真正换景：翻页
      { key: "c6", kind: "line", lineKey: "l4" },
    ];
    const transcript: TranscriptEntry[] = [
      mkEntry("l1", "narrate", "图书馆里的第一句。"),
      mkEntry("l2", "say", "推开门走出去。", "input", "player"),
      mkEntry("l3", "say", "依然在图书馆。", "line", "manami"),
      mkEntry("l4", "narrate", "来到了天台。"),
    ];

    // 停在 l3 时，l1/l2/l3 同处第 1 页
    const page1 = buildPageView({
      cues: cues.slice(0, 5),
      lines,
      transcript,
      current: lines[2]!,
      view: transcript[2]!,
      viewLength: 6,
      shownLength: 6,
      scrubbed: false,
    });
    expect(page1.pageNo).toBe(1);
    expect(page1.entries.map((e) => e.key)).toEqual(["l1", "l2", "l3"]);

    // 推进到 l4（rooftop）时，自动翻到第 2 页
    const page2 = buildPageView({
      cues,
      lines,
      transcript,
      current: lines[3]!,
      view: transcript[3]!,
      viewLength: 5,
      shownLength: 5,
      scrubbed: false,
    });
    expect(page2.pageNo).toBe(2);
    expect(page2.scene).toBe("rooftop");
    expect(page2.entries.map((e) => e.key)).toEqual(["l4"]);

    // 回看（scrubbed）滚回 l2 时，自动翻回第 1 页并高亮 l2
    const rewound = buildPageView({
      cues,
      lines,
      transcript,
      current: lines[3]!,
      view: transcript[1]!,
      viewLength: transcript[1]!.text.length,
      shownLength: 5,
      scrubbed: true,
    });
    expect(rewound.pageNo).toBe(1);
    expect(rewound.scene).toBe("library");
    expect(rewound.entries.map((e) => [e.key, e.isCurrent])).toEqual([
      ["l1", false],
      ["l2", true],
      ["l3", false],
    ]);
  });

  it("无背景开场切入有背景、无 bg 的 clear、纯色场与 <title> 章节均正确分页并维护页眉场景名", () => {
    const lines: ScriptLine[] = [
      { key: "l1", type: "narrate", text: "纯文字序幕。", raw: "纯文字序幕。" },
      { key: "l2", type: "narrate", text: "切入教室背景。", raw: "切入教室背景。" },
      { key: "l3", type: "narrate", text: "清场后的空场。", raw: "清场后的空场。" },
      { key: "l4", type: "narrate", text: "黑场独白。", raw: "黑场独白。" },
      { key: "t1", type: "title", text: "第二章 · 雨夜\n副标题", raw: "第二章 · 雨夜\n副标题" },
      { key: "l5", type: "say", actorId: "manami", text: "新章节第一句。", raw: "新章节第一句。" },
    ];
    const cues: Cue[] = [
      { key: "c1", kind: "line", lineKey: "l1" },
      { key: "c2", kind: "scene", bg: "classroom" },
      { key: "c3", kind: "line", lineKey: "l2" },
      { key: "c4", kind: "scene", clear: true },
      { key: "c5", kind: "line", lineKey: "l3" },
      { key: "c6", kind: "scene", bg: "black" },
      { key: "c7", kind: "line", lineKey: "l4" },
      { key: "c8", kind: "line", lineKey: "t1" },
      { key: "c9", kind: "line", lineKey: "l5" },
    ];
    const transcript: TranscriptEntry[] = [
      mkEntry("l1", "narrate", "纯文字序幕。"),
      mkEntry("l2", "narrate", "切入教室背景。"),
      mkEntry("l3", "narrate", "清场后的空场。"),
      mkEntry("l4", "narrate", "黑场独白。"),
      { key: "t1", kind: "line", type: "title", actorId: null, text: "第二章 · 雨夜\n副标题", seq: null, nodeId: null },
      mkEntry("l5", "say", "新章节第一句。", "line", "manami"),
    ];

    // 1) 无背景 l1 -> <scene bg="classroom"> l2 翻到第 2 页
    const p2 = buildPageView({
      cues: cues.slice(0, 3),
      lines,
      transcript: transcript.slice(0, 2),
      current: lines[1]!,
      view: transcript[1]!,
      viewLength: 7,
      shownLength: 7,
      scrubbed: false,
    });
    expect(p2.pageNo).toBe(2);
    expect(p2.scene).toBe("classroom");
    expect(p2.entries.map((e) => e.key)).toEqual(["l2"]);

    // 2) <scene clear="true"/> 无 bg 翻到第 3 页，且清空上一场遗留的 classroom 场景名
    const p3 = buildPageView({
      cues: cues.slice(0, 5),
      lines,
      transcript: transcript.slice(0, 3),
      current: lines[2]!,
      view: transcript[2]!,
      viewLength: 7,
      shownLength: 7,
      scrubbed: false,
    });
    expect(p3.pageNo).toBe(3);
    expect(p3.scene).toBeNull();
    expect(p3.entries.map((e) => e.key)).toEqual(["l3"]);

    // 3) <scene bg="black"/> 纯色场翻到第 4 页，且不把 "black" 暴露为页眉场景名
    const p4 = buildPageView({
      cues: cues.slice(0, 7),
      lines,
      transcript: transcript.slice(0, 4),
      current: lines[3]!,
      view: transcript[3]!,
      viewLength: 5,
      shownLength: 5,
      scrubbed: false,
    });
    expect(p4.pageNo).toBe(4);
    expect(p4.scene).toBeNull();
    expect(p4.entries.map((e) => e.key)).toEqual(["l4"]);

    // 4) <title> 章节卡翻到第 5 页，并把首行「第二章 · 雨夜」作为页眉标题
    const p5 = buildPageView({
      cues,
      lines,
      transcript,
      current: lines[5]!,
      view: transcript[5]!,
      viewLength: 7,
      shownLength: 7,
      scrubbed: false,
    });
    expect(p5.pageNo).toBe(5);
    expect(p5.scene).toBe("第二章 · 雨夜");
    expect(p5.entries.map((e) => e.key)).toEqual(["l5"]);
  });
});
