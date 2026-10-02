import { describe, expect, it } from "vitest";
import type { Cue } from "../src/stage/script.js";
import { applyActorCue, type SpriteSlot } from "../src/stage/director.js";

const cue = (partial: Partial<Extract<Cue, { kind: "actor" }>> & { id: string }): Extract<Cue, { kind: "actor" }> => ({
  key: "k",
  kind: "actor",
  ...partial,
});

const slot = (partial: Partial<SpriteSlot> & { resolvedPos: SpriteSlot["resolvedPos"] }): SpriteSlot => ({
  expression: null,
  state: null,
  shot: null,
  anchor: "bottom",
  action: null,
  actionSeq: 0,
  ...partial,
});

describe("applyActorCue：站位自动分配", () => {
  it("一个人 → 居中", () => {
    const s = applyActorCue({}, cue({ id: "a" }));
    expect(s.a!.resolvedPos).toBe("center");
  });

  it("第二个人进场 → 第一个人让位，两人分居两侧（核心行为）", () => {
    let s = applyActorCue({}, cue({ id: "a" }));
    expect(s.a!.resolvedPos).toBe("center");
    s = applyActorCue(s, cue({ id: "b" }));
    // 之前占着 center 的 a 必须让开，否则两个人叠在一起
    expect(s.a!.resolvedPos).not.toBe(s.b!.resolvedPos);
    expect([s.a!.resolvedPos, s.b!.resolvedPos].sort()).toEqual(["left", "right"]);
  });

  it("第三个人进场 → 三人占满三档，不重复", () => {
    let s: Record<string, SpriteSlot> = {};
    for (const id of ["a", "b", "c"]) s = applyActorCue(s, cue({ id }));
    const positions = Object.values(s).map((x) => x.resolvedPos);
    expect(new Set(positions).size).toBe(3);
  });

  it("显式 at 的角色退出自动排布，其余按剩余人数重排", () => {
    let s = applyActorCue({}, cue({ id: "hero", pos: "center" }));
    s = applyActorCue(s, cue({ id: "a" }));
    s = applyActorCue(s, cue({ id: "b" }));
    expect(s.hero!.resolvedPos).toBe("center");
    expect(s.hero!.pos).toBe("center");
    // 剩下两个自动角色不能撞在 center 上，也不能彼此重合
    expect(s.a!.resolvedPos).not.toBe("center");
    expect(s.a!.resolvedPos).not.toBe(s.b!.resolvedPos);
  });

  it("认不出来的不动，站位写 l/c/r 别名也认", () => {
    let s = applyActorCue({}, cue({ id: "a" }));
    s = applyActorCue(s, cue({ id: "a", pos: "nowhere" }));
    expect(s.a!.pos).toBeUndefined();
    s = applyActorCue(s, cue({ id: "a", pos: "l" }));
    expect(s.a!.pos).toBe("left");
    expect(s.a!.resolvedPos).toBe("left");
  });

  it("退场后剩下的人重新居中", () => {
    let s: Record<string, SpriteSlot> = {};
    for (const id of ["a", "b"]) s = applyActorCue(s, cue({ id }));
    expect(Object.values(s).map((x) => x.resolvedPos).sort()).toEqual(["left", "right"]);
    s = applyActorCue(s, cue({ id: "b", leave: "fade" }));
    // b 还在表里（软删除，要播完淡出），但位置已经重排：a 回到 center
    expect(s.b!.leaving).toBe(true);
    expect(s.a!.resolvedPos).toBe("center");
  });

  it("退场也认存量写法 action=exit", () => {
    const s = applyActorCue({ a: slot({ resolvedPos: "center" }) }, cue({ id: "a", action: "exit" }));
    expect(s.a!.leaving).toBe(true);
  });
});

describe("applyActorCue：状态累积", () => {
  it("缺省属性 = 保持当前，不被后续 cue 抹掉", () => {
    let s = applyActorCue({}, cue({ id: "a", expression: "smile", shot: "close" }));
    s = applyActorCue(s, cue({ id: "a", pos: "left" }));
    expect(s.a!.expression).toBe("smile");
    expect(s.a!.shot).toBe("close");
    expect(s.a!.resolvedPos).toBe("left");
  });

  it("anchor 缺省是 bottom（脚踩地），给了才变", () => {
    let s = applyActorCue({}, cue({ id: "cat" }));
    expect(s.cat!.anchor).toBe("bottom");
    s = applyActorCue(s, cue({ id: "cat", anchor: "center" }));
    expect(s.cat!.anchor).toBe("center");
    s = applyActorCue(s, cue({ id: "cat", state: "curled" }));
    expect(s.cat!.anchor).toBe("center");
    expect(s.cat!.state).toBe("curled");
  });

  it("expression 与 state 各存各的，互不覆盖", () => {
    let s = applyActorCue({}, cue({ id: "a", expression: "smile" }));
    s = applyActorCue(s, cue({ id: "a", state: "broken" }));
    expect(s.a!.expression).toBe("smile");
    expect(s.a!.state).toBe("broken");
  });
});

describe("applyActorCue：行为词", () => {
  it("给 action 就演一次，序号 +1（连演同一个词要能重播）", () => {
    let s = applyActorCue({}, cue({ id: "a", action: "nod" }));
    expect(s.a!.action).toBe("nod");
    expect(s.a!.actionSeq).toBe(1);
    s = applyActorCue(s, cue({ id: "a", action: "nod" }));
    expect(s.a!.action).toBe("nod");
    expect(s.a!.actionSeq).toBe(2);
  });

  it("没给 action 不重播，序号保持", () => {
    let s = applyActorCue({}, cue({ id: "a", action: "shake" }));
    s = applyActorCue(s, cue({ id: "a", expression: "smile" }));
    expect(s.a!.action).toBeNull();
    expect(s.a!.actionSeq).toBe(1);
  });

  it("认不出来的词不演（不猜），但也不影响别的属性", () => {
    const s = applyActorCue({}, cue({ id: "a", action: "explode", expression: "smile" }));
    expect(s.a!.action).toBeNull();
    expect(s.a!.expression).toBe("smile");
  });

  it("退场写法 action=exit 不当成行为词", () => {
    let s = applyActorCue({}, cue({ id: "a" }));
    s = applyActorCue(s, cue({ id: "a", action: "exit" }));
    expect(s.a!.leaving).toBe(true);
    expect(s.a!.action).toBeNull();
  });

  it("行为词不影响站位：一个人演动作仍是居中", () => {
    const s = applyActorCue({}, cue({ id: "a", action: "jump" }));
    expect(s.a!.resolvedPos).toBe("center");
  });
});
