import { describe, expect, it } from "vitest";
import { pickStarters, STARTER_IDEAS } from "../src/workshop/starters.js";

/** 定死随机源：连续取给定数列，用完后回到开头。 */
function seededRandom(values: number[]): () => number {
  let i = 0;
  return () => values[i++ % values.length]!;
}

describe("pickStarters", () => {
  it("抽出的建议不重复，且每类各有一条", () => {
    const picked = pickStarters(4, seededRandom([0.1, 0.5, 0.9, 0.3, 0.7]));

    expect(picked).toHaveLength(4);
    expect(new Set(picked.map((idea) => idea.text)).size).toBe(4);
    expect(new Set(picked.map((idea) => idea.kind))).toEqual(
      new Set(["original", "fanfic", "adaptation", "form"]),
    );
  });

  it("要的条数超过池子时按池子大小给，不补空", () => {
    const picked = pickStarters(999, seededRandom([0.4, 0.2, 0.8]));
    expect(picked).toHaveLength(STARTER_IDEAS.length);
  });

  it("随机源不同则结果不同（真的在抽，不是写死一批）", () => {
    const a = pickStarters(4, seededRandom([0.05, 0.15, 0.25, 0.35]));
    const b = pickStarters(4, seededRandom([0.95, 0.85, 0.75, 0.65]));
    expect(a.map((idea) => idea.text)).not.toEqual(b.map((idea) => idea.text));
  });
});
