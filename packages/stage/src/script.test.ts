import { describe, expect, it } from "vitest";
import { ScriptBuilder } from "./script.js";

describe("ScriptBuilder · player_input 事件", () => {
  it("落成一条整行 + 一张 line cue，不开打字机增量", () => {
    const builder = new ScriptBuilder();
    builder.apply({ kind: "scene", bg: "corridor" }, 1);
    builder.apply({ kind: "player_input", text: "（选择了：道歉）" }, 2);

    expect(builder.lines.map((l) => [l.type, l.text, l.seq, l.actorId])).toEqual([
      ["scene", "corridor", 1, undefined],
      ["input", "（选择了：道歉）", 2, "player"],
    ]);
    expect(builder.cues.filter((c) => c.kind === "line")).toHaveLength(1);
    // 后续文本增量不追加到 input 行（openKey 已闭合）
    builder.apply({ kind: "say_text", delta: "x" }, 3);
    expect(builder.lines[1]!.text).toBe("（选择了：道歉）");
  });
});

describe("ScriptBuilder · 台词语气标记（上屏剥、原文留）", () => {
  it("标记只进 raw，text 是剥过的；流式半路的 [whi 也不上屏", () => {
    const builder = new ScriptBuilder();
    builder.apply({ kind: "say_start", id: "mio" }, 1);
    builder.apply({ kind: "say_text", delta: "[whispering] 别出" }, 2);
    // 标记已闭合 → 上屏是「 别出」；正文里的半截标记藏起来
    expect(builder.lines[0]!.text).toBe(" 别出");
    expect(builder.lines[0]!.raw).toBe("[whispering] 别出");

    builder.apply({ kind: "say_text", delta: "声[pant" }, 3);
    expect(builder.lines[0]!.text).toBe(" 别出声");
    builder.apply({ kind: "say_text", delta: "ing]，他在隔壁。" }, 4);
    expect(builder.lines[0]!.text).toBe(" 别出声，他在隔壁。");
    expect(builder.lines[0]!.raw).toBe("[whispering] 别出声[panting]，他在隔壁。");
  });

  it("原地改写收到的也是原文：改完标记还在", () => {
    const builder = new ScriptBuilder();
    builder.apply({ kind: "say_start", id: "mio" }, 7);
    builder.apply({ kind: "say_text", delta: "[sigh] 算了。" }, 8);
    builder.replaceText(7, "[sigh] 算了，就这样吧。");
    expect(builder.lines[0]!.text).toBe(" 算了，就这样吧。");
    expect(builder.lines[0]!.raw).toBe("[sigh] 算了，就这样吧。");
  });
});
