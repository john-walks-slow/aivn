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
