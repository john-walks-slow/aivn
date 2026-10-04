import { describe, expect, it } from "vitest";
import { spriteStagePreset } from "../src/index.js";

describe("spriteStagePreset：缺省档的头顶留白", () => {
  it("横屏三档 normal = 18 留白（full 18/132、half 18/90、square 18/90）", () => {
    expect(spriteStagePreset("full", "normal").landscape).toMatchObject({ top: 18, height: 132 });
    expect(spriteStagePreset("half", "normal").landscape).toMatchObject({ top: 18, height: 90 });
    expect(spriteStagePreset("square", "normal").landscape).toMatchObject({ top: 18, height: 90 });
  });

  it("竖屏三档 normal = 16 留白（full 16/102、half 16/92、square 16/92）", () => {
    expect(spriteStagePreset("full", "normal").portrait).toMatchObject({ top: 16, height: 102 });
    expect(spriteStagePreset("half", "normal").portrait).toMatchObject({ top: 16, height: 92 });
    expect(spriteStagePreset("square", "normal").portrait).toMatchObject({ top: 16, height: 92 });
  });

  it("每一档贴头顶的都有留白，不贴天花板（small 除外，它贴地）", () => {
    for (const framing of ["full", "half", "square"] as const) {
      for (const stature of ["normal", "large", "huge"] as const) {
        const { landscape, portrait } = spriteStagePreset(framing, stature);
        expect(landscape.top).toBeGreaterThanOrEqual(8);
        expect(portrait.top).toBeGreaterThanOrEqual(8);
      }
    }
  });

  it("缺省参数 = full/normal：老数据不写取景与体量时站位不变", () => {
    expect(spriteStagePreset()).toEqual(spriteStagePreset("full", "normal"));
  });

  it("体量只改高度与落位，不减档：huge 比 normal 大、small 贴底", () => {
    const normal = spriteStagePreset("full", "normal").landscape;
    const huge = spriteStagePreset("full", "huge").landscape;
    const small = spriteStagePreset("square", "small").landscape;
    expect(huge.height).toBeGreaterThan(normal.height);
    expect(small.top + small.height).toBe(100);
    expect(small.origin).toBe("bottom center");
  });
});

describe("spriteStagePreset：对齐三档", () => {
  it("bottom 保留表里的落位，小东西贴地、其余贴头顶", () => {
    expect(spriteStagePreset("full", "normal", "bottom").landscape.origin).toBe("top center");
    expect(spriteStagePreset("full", "normal", "bottom").landscape.top).toBe(18);
    expect(spriteStagePreset("square", "small", "bottom").landscape.origin).toBe("bottom center");
  });

  it("center 把盒子居中、原点居中（悬空物）", () => {
    const box = spriteStagePreset("square", "normal", "center").landscape;
    expect(box.origin).toBe("center");
    expect(box.top + box.height / 2).toBe(50);
  });

  it("top 从舞台顶挂下来（垂下物）", () => {
    const box = spriteStagePreset("full", "normal", "top").landscape;
    expect(box).toMatchObject({ top: 0, origin: "top center" });
  });
});
