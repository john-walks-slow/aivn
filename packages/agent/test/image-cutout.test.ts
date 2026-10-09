import { describe, expect, it } from "vitest";
import {
  CUTOUT_TUNING_GUIDE,
  cutoutTuningFields,
  imageCutout,
  imageCutoutFields,
  tuningOf,
} from "../src/capabilities/media/cutout.js";
import { assertCommonSubset } from "../src/schema/ir.js";

describe("image.cutout", () => {
  it("字段只用共同子集（范围收紧写在各自的 face 上）", () => {
    expect(() => assertCommonSubset(imageCutoutFields, "image.cutout")).not.toThrow();
    expect(Object.keys(cutoutTuningFields)).toEqual(["tolerance", "keySmooth", "edgeBand", "spill", "solidResidual"]);
  });

  it("调参指南按症状给旋钮——两份（重抠与 cut）原先各写一份，现在只有这一份", () => {
    expect(CUTOUT_TUNING_GUIDE).toContain("tolerance");
    expect(CUTOUT_TUNING_GUIDE).toContain("一次只调一两个");
  });

  it("只把真给了的旋钮传下去（没给的不覆盖默认档）", () => {
    expect(tuningOf({})).toEqual({});
    expect(tuningOf({ tolerance: 0, spill: 30 })).toEqual({ tolerance: 0, spill: 30 });
  });

  it("execute 归一化 source 并转交给宿主的写盘口", async () => {
    const seen: unknown[] = [];
    const out = await imageCutout.execute(
      { source: "  assets/tmp/a.png ", output: " assets/sprites/mio/neutral.png ", tolerance: 52 },
      {
        cut: async (request) => {
          seen.push(request);
          return { path: "assets/sprites/mio/neutral.png", absPath: "/tmp/x.png", coverage: 0.2, figureHeight: 1600 };
        },
      },
    );
    expect(seen).toEqual([
      { source: "assets/tmp/a.png", output: "assets/sprites/mio/neutral.png", tuning: { tolerance: 52 } },
    ]);
    expect(out.coverage).toBe(0.2);
    await expect(imageCutout.execute({ source: "   " }, { cut: async () => ({}) as never })).rejects.toThrow(/source/);
  });
});
