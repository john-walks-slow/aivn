import { describe, expect, it } from "vitest";
import { applyActorCue, applyVisualCue, type SpriteSlot, type VisualState } from "./director.js";
import type { Cue } from "./script.js";
import { ScriptBuilder } from "./script.js";

const cue = (partial: Partial<Extract<Cue, { kind: "actor" }>> & { id: string }): Extract<Cue, { kind: "actor" }> => ({
  key: "k",
  kind: "actor",
  ...partial,
});

const slot = (partial: Partial<SpriteSlot> & { resolvedPos: SpriteSlot["resolvedPos"] }): SpriteSlot => ({
  variant: null,
  shot: null,
  anchor: null,
  action: null,
  actionSeq: 0,
  orderSeq: 1,
  ...partial,
});

const visual = (partial: Partial<VisualState>): VisualState => ({
  bg: null,
  bgm: null,
  ambient: null,
  transition: null,
  cg: null,
  sprites: {},
  pending: {},
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
    let s = applyActorCue({}, cue({ id: "a", variant: "smile", shot: "close" }));
    s = applyActorCue(s, cue({ id: "a", pos: "left" }));
    expect(s.a!.variant).toBe("smile");
    expect(s.a!.shot).toBe("close");
    expect(s.a!.resolvedPos).toBe("left");
  });

  it("anchor 缺省是 null：剧本不写就听素材声明，写了才钉住", () => {
    let s = applyActorCue({}, cue({ id: "cat" }));
    expect(s.cat!.anchor).toBeNull();
    s = applyActorCue(s, cue({ id: "cat", anchor: "center" }));
    expect(s.cat!.anchor).toBe("center");
    // 后续 cue 不给 anchor 时钉住的那一档保留
    s = applyActorCue(s, cue({ id: "cat", variant: "curled" }));
    expect(s.cat!.anchor).toBe("center");
    expect(s.cat!.variant).toBe("curled");
  });

  it("换差分只有一个槽位：人的表情与机甲的状态是同一个 variant", () => {
    let s = applyActorCue({}, cue({ id: "a", variant: "smile" }));
    expect(s.a!.variant).toBe("smile");
    s = applyActorCue(s, cue({ id: "a", variant: "broken" }));
    expect(s.a!.variant).toBe("broken");
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
    s = applyActorCue(s, cue({ id: "a", variant: "smile" }));
    expect(s.a!.action).toBeNull();
    expect(s.a!.actionSeq).toBe(1);
  });

  it("认不出来的词不演（不猜），但也不影响别的属性", () => {
    const s = applyActorCue({}, cue({ id: "a", action: "explode", variant: "smile" }));
    expect(s.a!.action).toBeNull();
    expect(s.a!.variant).toBe("smile");
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

describe("applyActorCue：入场次序与 z-index (orderSeq)", () => {
  it("首个角色入场次序为 1，后入场角色次序递增", () => {
    let s = applyActorCue({}, cue({ id: "a" }));
    expect(s.a!.orderSeq).toBe(1);
    s = applyActorCue(s, cue({ id: "b" }));
    expect(s.b!.orderSeq).toBe(2);
    s = applyActorCue(s, cue({ id: "c" }));
    expect(s.c!.orderSeq).toBe(3);
  });

  it("已在场角色更新状态（动作、差分等）时，orderSeq 保持不变", () => {
    let s = applyActorCue({}, cue({ id: "a" }));
    s = applyActorCue(s, cue({ id: "b" }));
    expect(s.a!.orderSeq).toBe(1);
    expect(s.b!.orderSeq).toBe(2);

    // a 更新动作和差分
    s = applyActorCue(s, cue({ id: "a", action: "nod", variant: "smile" }));
    expect(s.a!.orderSeq).toBe(1);
    expect(s.b!.orderSeq).toBe(2);
  });

  it("角色退场后重新入场，获得新的更高 orderSeq", () => {
    let s = applyActorCue({}, cue({ id: "a" }));
    s = applyActorCue(s, cue({ id: "b" }));
    expect(s.a!.orderSeq).toBe(1);
    expect(s.b!.orderSeq).toBe(2);

    // a 退场
    s = applyActorCue(s, cue({ id: "a", leave: "fade" }));
    expect(s.a!.leaving).toBe(true);

    // a 重新入场
    s = applyActorCue(s, cue({ id: "a" }));
    expect(s.a!.leaving).toBe(false);
    expect(s.a!.orderSeq).toBe(3);
    expect(s.a!.orderSeq).toBeGreaterThan(s.b!.orderSeq);
  });
});

describe("开新场 <scene clear/>", () => {
  const twoOnStage = (): Record<string, SpriteSlot> =>
    applyActorCue(
      applyActorCue({}, cue({ id: "a" })),
      cue({ id: "b" }),
    );

  it("ScriptBuilder 把 IR 的 clear 带进 cue", () => {
    const builder = new ScriptBuilder();
    builder.apply({ kind: "scene", bg: "rooftop", clear: true }, 1);
    expect(builder.cues[0]).toMatchObject({ kind: "scene", bg: "rooftop", clear: true });
  });

  it("缺省（不写 clear）只换底、人不动", () => {
    const next = applyVisualCue(visual({ sprites: twoOnStage() }), { key: "k", kind: "scene", bg: "rooftop" });
    expect(Object.keys(next.sprites).sort()).toEqual(["a", "b"]);
  });

  it("clear 时台上的人全下（退场中的也不留）", () => {
    const sprites = applyActorCue(twoOnStage(), cue({ id: "b", leave: "fade" }));
    const next = applyVisualCue(visual({ sprites }), { key: "k", kind: "scene", bg: "rooftop", clear: true });
    expect(Object.keys(next.sprites)).toHaveLength(0);
  });
});
