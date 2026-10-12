import { describe, expect, it } from "vitest";
import { presentationPlan, presentationProfile } from "./presentation.js";
import type { SpriteSlot } from "./director.js";

function slot(orderSeq: number, partial: Partial<SpriteSlot> = {}): SpriteSlot {
  return {
    pos: undefined,
    resolvedPos: "center",
    keepVisible: false,
    variant: null,
    shot: null,
    anchor: null,
    action: null,
    actionSeq: 0,
    orderSeq,
    ...partial,
  };
}

describe("presentationPlan：窄屏容量", () => {
  it("390px 窄竖屏只保留说话人和 keepVisible", () => {
    const plan = presentationPlan({
      width: 390,
      height: 844,
      speakerId: "old",
      sprites: {
        old: slot(1),
        newcomer: slot(3),
        kept: slot(2, { keepVisible: true }),
      },
    });
    expect(plan.profile).toBe("narrow-portrait");
    expect(plan.capacity).toBe(2);
    expect(plan.actors.old?.visible).toBe(true);
    expect(plan.actors.kept?.visible).toBe(true);
    expect(plan.actors.newcomer?.visible).toBe(false);
    expect(plan.actors.newcomer?.reason).toBe("suppressed-overflow");
  });

  it("没有说话人时，新入场角色优先于旧角色", () => {
    const plan = presentationPlan({
      width: 390,
      height: 844,
      speakerId: null,
      sprites: { old: slot(1), middle: slot(2), newcomer: slot(3) },
    });
    expect(plan.actors.newcomer?.visible).toBe(true);
    expect(plan.actors.middle?.visible).toBe(true);
    expect(plan.actors.old?.visible).toBe(false);
  });

  it("speaker 和 keepVisible 超过容量时全部保留", () => {
    const plan = presentationPlan({
      width: 390,
      height: 844,
      speakerId: "speaker",
      sprites: {
        speaker: slot(1),
        keptA: slot(2, { keepVisible: true }),
        keptB: slot(3, { keepVisible: true }),
      },
    });
    expect(Object.values(plan.actors).every((actor) => actor.visible)).toBe(true);
  });

  it("真实 leaving 不占容量，但仍保留在呈现计划里播退场", () => {
    const plan = presentationPlan({
      width: 390,
      height: 844,
      speakerId: "new",
      sprites: { leaving: slot(1, { leaving: true }), new: slot(2), old: slot(3), older: slot(4) },
    });
    expect(plan.actors.leaving?.visible).toBe(true);
    expect(plan.actors.new?.visible).toBe(true);
    expect(plan.actors.old?.visible).toBe(false);
  });

  it("同一输入稳定，宽屏不收起角色", () => {
    const sprites = { a: slot(1), b: slot(2), c: slot(3) };
    const input = { width: 1440, height: 900, speakerId: null, sprites };
    expect(presentationPlan(input)).toEqual(presentationPlan(input));
    expect(presentationProfile(900, 844)).toBe("desktop");
    expect(Object.values(presentationPlan(input).actors).every((actor) => actor.visible)).toBe(true);
  });
});
