import { describe, expect, it } from "vitest";
import {
  lineCueIndexAt,
  lineCueIndexByNodeId,
  resolveResumeSeek,
  type Cue,
  type ScriptLine,
} from "@aivn/stage";

/** 一次真实形状的缓冲：换景 → 台词 → 立绘入场 → 台词。 */
const lines: ScriptLine[] = [
  { key: "l1", type: "narrate", seq: 10, nodeId: "n_a", text: "放学后的走廊空无一人。" },
  { key: "l2", type: "say", seq: 13, nodeId: "n_b", text: "……太慢了！" },
];
const cues: Cue[] = [
  { key: "c1", kind: "scene", bg: "bg_hall" },
  { key: "c2", kind: "line", lineKey: "l1" },
  { key: "c3", kind: "actor", id: "yu", pos: "center" },
  { key: "c4", kind: "line", lineKey: "l2" },
];

describe("刷新后 seek 回归位置（lineCueIndexByNodeId）", () => {
  it("按稳定 nodeId 找回那条台词 cue 的下标", () => {
    expect(lineCueIndexByNodeId(cues, lines, "n_a")).toBe(1);
    expect(lineCueIndexByNodeId(cues, lines, "n_b")).toBe(3);
  });

  it("nodeId 不在缓冲里就返回 -1——交给调用方退回「快进到末尾」的老路", () => {
    // 分岔/重写后换过分支，旧分支的节点不在这里
    expect(lineCueIndexByNodeId(cues, lines, "n_gone")).toBe(-1);
  });

  it("cue 与行对不上（缓冲被重放过）也不猜", () => {
    const orphan: Cue[] = [{ key: "c9", kind: "line", lineKey: "gone" }];
    expect(lineCueIndexByNodeId(orphan, lines, "n_a")).toBe(-1);
  });

  it("没有 nodeId 的布景行永远不会被当成锚点", () => {
    const staged: Cue[] = [{ key: "c0", kind: "line", lineKey: "noline" }];
    const withSceneLine: ScriptLine[] = [{ key: "noline", type: "scene", text: "背景 · 校门口" }];
    expect(lineCueIndexByNodeId(staged, withSceneLine, "n_a")).toBe(-1);
  });
});

describe("老档兼容 seek（lineCueIndexAt 按 seq）", () => {
  it("按行的 seq 找回那条台词 cue 的下标", () => {
    expect(lineCueIndexAt(cues, lines, 10)).toBe(1);
    expect(lineCueIndexAt(cues, lines, 13)).toBe(3);
  });

  it("seq 不在缓冲里就返回 -1", () => {
    expect(lineCueIndexAt(cues, lines, 99)).toBe(-1);
  });
});

describe("行中刷新恢复（resolveResumeSeek：nodeId + offset 回到读到的那一个字）", () => {
  it("停在那一行、补到 offset 那个字——不是行首也不是行尾", () => {
    // 「……太慢了！」共 6 个字，刷在读到第 3 个字时
    expect(resolveResumeSeek(cues, lines, { nodeId: "n_b", offset: 3 })).toEqual({
      cueIndex: 3,
      shownLength: 3,
    });
  });

  it("offset 超出行长（存档比当前文本长）补到行尾，不让进度倒退", () => {
    expect(resolveResumeSeek(cues, lines, { nodeId: "n_b", offset: 99 }).shownLength).toBe(6);
  });

  it("老档只有 seq：按 seq 找行，offset 照旧生效", () => {
    expect(resolveResumeSeek(cues, lines, { nodeId: "", seq: 10, offset: 4 })).toEqual({
      cueIndex: 1,
      shownLength: 4,
    });
  });

  it("没有 offset 只有老档的 len 时按 len 补字", () => {
    expect(resolveResumeSeek(cues, lines, { nodeId: "n_a", len: 2 }).shownLength).toBe(2);
  });

  it("节点不在缓冲里（换过分支）返回 -1，交给调用方快进到末尾", () => {
    expect(resolveResumeSeek(cues, lines, { nodeId: "n_gone", offset: 3 })).toEqual({
      cueIndex: -1,
      shownLength: 0,
    });
  });
});
