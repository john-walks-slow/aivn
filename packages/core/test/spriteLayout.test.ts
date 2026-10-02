import { describe, expect, it } from "vitest";
import { layoutSprites, parsePosition, type SpritePosition } from "../src/play/spriteLayout.js";

const m = (pairs: [string, SpritePosition][]): Map<string, SpritePosition> => new Map(pairs);

describe("layoutSprites", () => {
  it("1 人居中", () => {
    expect([...layoutSprites(["a"])]).toEqual([["a", "center"]]);
  });

  it("2 人分居两侧，后进的在右", () => {
    expect([...layoutSprites(["a", "b"])]).toEqual([
      ["a", "left"],
      ["b", "right"],
    ]);
  });

  it("3 人：占满 center + 左右两侧三档，左右对称", () => {
    const got = layoutSprites(["a", "b", "c"]);
    // 3 人的对称一组是 center/left/right，具体谁站哪由进场顺序决定
    expect(new Set(got.values())).toEqual(new Set(["center", "left", "right"]));
    const [left, right] = ["left", "right"];
    // 对称性：left 与 right 必有且仅有一人
    expect([...got.values()].filter((p) => p === left)).toHaveLength(1);
    expect([...got.values()].filter((p) => p === right)).toHaveLength(1);
  });

  it("进场顺序决定谁拿中间的档位（可复现，不是随机的）", () => {
    const a = layoutSprites(["a", "b", "c"]);
    const b = layoutSprites(["a", "b", "c"]);
    expect([...a]).toEqual([...b]);
    // 同样的顺序调两次结果一致
    expect(a.get("a")).toBe(b.get("a"));
  });

  it("4 人以上不复用 center，也不出现重复档", () => {
    const got = layoutSprites(["a", "b", "c", "d"]);
    expect(new Set(got.values()).size).toBe(4);
  });

  it("5 人 / 6 人也不撞档", () => {
    for (const n of [5, 6]) {
      const ids = Array.from({ length: n }, (_, i) => `c${i}`);
      const got = layoutSprites(ids);
      expect(new Set(got.values()).size).toBe(n);
    }
  });

  it("手动指定的退出自动排布，剩下的人按剩余人数重排", () => {
    // 主角钉在 center，配角自动 → 配角不该再被分到 center（否则两人叠一起）
    const got = layoutSprites(["hero", "a"], m([["hero", "center"]]));
    expect(got.get("hero")).toBe("center");
    expect(got.get("a")).not.toBe("center");
  });

  it("手动指定的原样返回", () => {
    const got = layoutSprites(["a", "b", "c"], m([["b", "edge-left"]]));
    expect(got.get("b")).toBe("edge-left");
  });

  it("手动指定了不在场的人 → 忽略（不能凭空占位）", () => {
    const got = layoutSprites(["a"], m([["ghost", "left"]]));
    expect(got.has("ghost")).toBe(false);
    expect(got.get("a")).toBe("center");
  });

  it("0 人 → 空表", () => {
    expect(layoutSprites([]).size).toBe(0);
  });
});

describe("parsePosition", () => {
  it("认全部具名档位", () => {
    for (const p of ["left", "center", "right", "far-left", "edge-right", "bleed-left"]) {
      expect(parsePosition(p)).toBe(p);
    }
  });

  it("认单字母别名（模型确实会这么写）", () => {
    expect(parsePosition("l")).toBe("left");
    expect(parsePosition("C")).toBe("center");
    expect(parsePosition(" r ")).toBe("right");
  });

  it("认不出来 → null（走自动排布），不猜不抛", () => {
    expect(parsePosition("nowhere")).toBeNull();
    expect(parsePosition("12")).toBeNull();
    expect(parsePosition("")).toBeNull();
    expect(parsePosition(undefined)).toBeNull();
  });
});
