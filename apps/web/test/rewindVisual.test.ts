import { describe, expect, it } from "vitest";
import { applyCue, applyVisualCue, cueWatermarkForEntry, visualAt, withAttachedCg } from "../src/stage/director.js";
import type { Cue } from "../src/stage/script.js";
import type { TranscriptEntry } from "../src/stage/transcript.js";

/** 一次真实形状的缓冲：换景 → 独白 → 小优进场 → 台词 → 表情差分 → 预发射 → 音效 → 台词 → 退场 → 台词。 */
const cues: Cue[] = [
  { key: "c0", kind: "scene", bg: "bg_hall", bgm: "bgm_rain" },
  { key: "c1", kind: "line", lineKey: "l1" },
  { key: "c2", kind: "actor", id: "yu", pos: "center" },
  { key: "c3", kind: "line", lineKey: "l2" },
  { key: "c4", kind: "actor", id: "yu", expression: "pout" },
  { key: "c5", kind: "preload", id: "bg_roof", type: "bg" },
  { key: "c6", kind: "sfx", src: "door" },
  { key: "c7", kind: "line", lineKey: "l3" },
  { key: "c8", kind: "actor", id: "yu", leave: "1" },
  { key: "c9", kind: "line", lineKey: "l4" },
];

function entry(key: string, kind: TranscriptEntry["kind"] = "line"): TranscriptEntry {
  return { key, kind, type: "say", actorId: null, text: key, seq: null, nodeId: `n_${key}` };
}

const transcript: TranscriptEntry[] = [
  entry("l1"),
  entry("l2"),
  entry("n_input", "input"),
  entry("l3"),
  entry("l4"),
];

describe("回看重算画面（visualAt）", () => {
  it("水位线 0 是空场——什么都还没发生", () => {
    const visual = visualAt(cues, 0);
    expect(visual.bg).toBeNull();
    expect(visual.cg).toBeNull();
    expect(visual.sprites).toEqual({});
  });

  it("折到第一句之前只有景，没有还没登场的人", () => {
    const visual = visualAt(cues, 1);
    expect(visual.bg).toBe("bg_hall");
    expect(visual.sprites).toEqual({});
  });

  it("按水位线还原立绘、站位与表情差分", () => {
    expect(Object.keys(visualAt(cues, 3).sprites)).toEqual(["yu"]);
    expect(visualAt(cues, 3).sprites.yu?.expression).toBeNull();
    expect(visualAt(cues, 5).sprites.yu?.expression).toBe("pout");
  });

  it("严格按那一刻：还没登场的人不出现，已经退场的人不留幽灵", () => {
    // 第二句时小优已登场；第二句之前没有她
    expect(visualAt(cues, 4).sprites.yu).toBeDefined();
    expect(visualAt(cues, 2).sprites.yu).toBeUndefined();
    // 退场那条 cue 之后（第 9 条 cue 起）台上不再有她
    expect(visualAt(cues, 9).sprites.yu).toBeUndefined();
  });

  it("换景清掉上一张 CG，且 CG 是这一刻的画面", () => {
    const withCg: Cue[] = [
      { key: "x0", kind: "cg", id: "cg_a", caption: "雨" },
      { key: "x1", kind: "line", lineKey: "l1" },
      { key: "x2", kind: "scene", bg: "bg_roof" },
    ];
    expect(visualAt(withCg, 2).cg?.id).toBe("cg_a");
    expect(visualAt(withCg, 3).cg).toBeNull();
  });

  it("预发射与音效不进画面：回看看到的是当时的舞台，不是骨架占位", () => {
    // 水位线 7 已越过 preload(c5) 与 sfx(c6)
    expect(visualAt(cues, 7).pending).toEqual({});
  });

  it("音乐不在画面重算里——氛围归现场，调用方把当下那条贴回来", () => {
    expect(visualAt(cues, cues.length).bgm).toBeNull();
  });

  it("现场那条路照旧保留退场中的立绘（留着把淡出播完）", () => {
    let live = visualAt(cues, 3);
    live = applyCue(live, { key: "k0", kind: "actor", id: "yu", leave: "1" });
    expect(live.sprites.yu?.leaving).toBe(true);
    expect(visualAt(cues, 9).sprites.yu).toBeUndefined();
  });
});

describe("回看游标 → cue 水位线（cueWatermarkForEntry）", () => {
  it("台词条目落到它自己那条 cue 上——折到它之前就是「这句刚开始」", () => {
    expect(cueWatermarkForEntry(cues, transcript, 0)).toBe(1);
    expect(cueWatermarkForEntry(cues, transcript, 1)).toBe(3);
    expect(cueWatermarkForEntry(cues, transcript, 3)).toBe(7);
    expect(cueWatermarkForEntry(cues, transcript, 4)).toBe(9);
  });

  it("玩家输入没有 cue，落到下一条台词之前（上一句演完时的画面）", () => {
    expect(cueWatermarkForEntry(cues, transcript, 2)).toBe(7);
  });

  it("末尾的玩家输入：整条缓冲都演完了，就是现场", () => {
    const tail: TranscriptEntry[] = [...transcript, entry("n_tail", "input")];
    expect(cueWatermarkForEntry(cues, tail, 5)).toBe(cues.length);
  });

  it("缓冲里找不到这条台词就返回 null——宁可不回退画面，也不折成另一个时刻", () => {
    const ghost: TranscriptEntry[] = [entry("l_gone")];
    expect(cueWatermarkForEntry(cues, ghost, 0)).toBeNull();
    // 玩家输入后面跟的也都是找不到的台词，同样不猜
    const ghostInput: TranscriptEntry[] = [entry("n_in", "input"), entry("l_gone")];
    expect(cueWatermarkForEntry(cues, ghostInput, 0)).toBeNull();
  });

  it("下标越界返回 null", () => {
    expect(cueWatermarkForEntry(cues, transcript, 99)).toBeNull();
  });
});

describe("行级插图（withAttachedCg）", () => {
  const base = visualAt(cues, 3);

  it("这一行挂着图：它就盖在那一刻的画面上", () => {
    const attached = withAttachedCg(base, "n_l2", new Map([["n_l2", "cg_back"]]));
    expect(attached.cg).toEqual({ id: "cg_back" });
    // 其余画面照旧（图是叠上去的，不是重算一遍）
    expect(attached.bg).toBe(base.bg);
  });

  it("翻到别的行、或者这行没挂过图：画面原样不动", () => {
    const map = new Map([["n_l2", "cg_back"]]);
    expect(withAttachedCg(base, "n_l1", map).cg).toBe(base.cg);
    expect(withAttachedCg(base, null, map)).toBe(base);
    expect(withAttachedCg(base, "n_l2")).toBe(base);
  });

  it("旁注盖过那一刻原有的 CG：行上挂的是最新的说法", () => {
    const withCg = applyVisualCue(base, { key: "cX", kind: "cg", id: "cg_old" });
    expect(withAttachedCg(withCg, "n_l2", new Map([["n_l2", "cg_new"]])).cg).toEqual({ id: "cg_new" });
  });
});
