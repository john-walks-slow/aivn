import { describe, expect, it } from "vitest";
import type { ScriptLine } from "./script.js";
import { titleLastStep, titleRevealTarget, titleStepEnds } from "./playbackState.js";

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
