import { describe, expect, it } from "vitest";
import { lineCueIndexAt } from "../src/stage/director.js";
import type { Cue, ScriptLine } from "../src/stage/script.js";

/** 一次真实形状的缓冲：换景 → 台词 → 立绘入场 → 台词。 */
const lines: ScriptLine[] = [
  { key: "l1", type: "narrate", seq: 10, text: "放学后的走廊空无一人。" },
  { key: "l2", type: "say", seq: 13, text: "……太慢了！" },
];
const cues: Cue[] = [
  { key: "c1", kind: "scene", bg: "bg_hall" },
  { key: "c2", kind: "line", lineKey: "l1" },
  { key: "c3", kind: "actor", id: "yu", pos: "center" },
  { key: "c4", kind: "line", lineKey: "l2" },
];

describe("刷新后 seek 回归位置（lineCueIndexAt）", () => {
  it("按行的 seq 找回那条台词 cue 的下标", () => {
    expect(lineCueIndexAt(cues, lines, 10)).toBe(1);
    expect(lineCueIndexAt(cues, lines, 13)).toBe(3);
  });

  it("seq 不在缓冲里就返回 -1——交给调用方退回「快进到末尾」的老路", () => {
    // 分岔/重写后换过分支，旧分支的 seq 不在这里
    expect(lineCueIndexAt(cues, lines, 99)).toBe(-1);
  });

  it("cue 与行对不上（缓冲被重放过）也不猜", () => {
    const orphan: Cue[] = [{ key: "c9", kind: "line", lineKey: "gone" }];
    expect(lineCueIndexAt(orphan, lines, 10)).toBe(-1);
  });

  it("seq 为 undefined 的布景行永远不会被当成锚点", () => {
    const staged: Cue[] = [{ key: "c0", kind: "line", lineKey: "noline" }];
    const withSceneLine: ScriptLine[] = [{ key: "noline", type: "scene", text: "背景 · 校门口" }];
    expect(lineCueIndexAt(staged, withSceneLine, 10)).toBe(-1);
  });
});
