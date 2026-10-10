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

describe("spriteStagePreset：figureTop 把图片盒往上推，头顶落回声明的位置", () => {
  it("推量按盒高等比缩放：(96 / 1920) × 132 = 6.6，18 → 11.4", () => {
    const box = spriteStagePreset("full", "normal", "bottom", 96).landscape;
    expect(box.top).toBe(11.4);
    expect(box.height).toBe(132);
  });

  it("缺省与非法 figureTop 一律逐位退回现状", () => {
    expect(spriteStagePreset("full", "normal", "bottom").landscape.top).toBe(18);
    expect(spriteStagePreset("full", "normal", "bottom", 0).landscape.top).toBe(18);
    expect(spriteStagePreset("full", "normal", "bottom", -10).landscape.top).toBe(18);
    expect(spriteStagePreset("full", "normal", "bottom", Number.NaN).landscape.top).toBe(18);
  });

  it("负 top 是正确解，不夹到 0——盒子伸到舞台顶以上，人物头顶照旧落在 18 附近", () => {
    const box = spriteStagePreset("full", "normal", "bottom", 1824).landscape;
    expect(box.top).toBeLessThan(0);
  });

  it("悬空物与垂下物不吃头顶偏移", () => {
    const center = spriteStagePreset("square", "normal", "center");
    expect(spriteStagePreset("square", "normal", "center", 96)).toEqual(center);
    expect(spriteStagePreset("full", "normal", "top", 96).landscape.top).toBe(0);
  });

  it("贴地的小东西不吃偏移：top + height = 100 的不变式照旧", () => {
    const small = spriteStagePreset("square", "small", "bottom", 96).landscape;
    expect(small.top + small.height).toBe(100);
  });
});

describe("spriteStagePreset：figureHeight 把盒高补回人物在画布上的实际占比", () => {
  it("人物只占画布一半时盒高翻倍，头顶仍落在 preset 的 18", () => {
    const box = spriteStagePreset("square", "normal", "bottom", 960, 960).landscape;
    expect(box.height).toBe(180);
    expect(box.top).toBe(-72);
    expect(box.top + (960 / 1920) * box.height).toBeCloseTo(18, 5);
  });

  it("人物占画布四分之一时盒高乘四（上界），头顶照旧落在 18", () => {
    const box = spriteStagePreset("square", "normal", "bottom", 1440, 480).landscape;
    expect(box.height).toBe(360);
    expect(box.top + (1440 / 1920) * box.height).toBeCloseTo(18, 5);
  });

  it("缺省与非法 figureHeight 逐位退回 1.0；小到离谱的按上界夹住", () => {
    expect(spriteStagePreset("square", "normal", "bottom").landscape).toMatchObject({ top: 18, height: 90 });
    for (const bad of [0, -20, Number.NaN]) {
      expect(spriteStagePreset("square", "normal", "bottom", 960, bad).landscape.height).toBe(90);
    }
    expect(spriteStagePreset("square", "normal", "bottom", 100, 100).landscape.height).toBe(360);
  });

  it("贴地的小东西也按占比补高，但 top + height = 100 不破", () => {
    const small = spriteStagePreset("square", "small", "bottom", 960, 960).landscape;
    expect(small.height).toBe(56);
    expect(small.top + small.height).toBe(100);
  });

  it("悬空物按盒心居中，figureTop 那笔偏移不参与", () => {
    const withTop = spriteStagePreset("square", "normal", "center", 960, 960).landscape;
    const withoutTop = spriteStagePreset("square", "normal", "center", undefined, 960).landscape;
    expect(withTop).toEqual(withoutTop);
    expect(withTop.top + withTop.height / 2).toBe(50);
  });
});
