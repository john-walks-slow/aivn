import { describe, expect, it } from "vitest";
import { COMMON_SPRITE_VARIANTS, spriteVariantChoices } from "../src/index.js";

describe("spriteVariantChoices：已有差分排前，其余按常用词表补", () => {
  it("已有差分排在最前且标 existing，常用词表里剩下的按原序补在后面", () => {
    const choices = spriteVariantChoices(["damaged", "smile"]);
    expect(choices.slice(0, 2)).toEqual([
      { name: "damaged", existing: true },
      { name: "smile", existing: true },
    ]);
    // 常用词表里的 smile / damaged 不重复出现
    const names = choices.map((c) => c.name);
    expect(names.filter((n) => n === "smile")).toHaveLength(1);
    expect(names.filter((n) => n === "damaged")).toHaveLength(1);
    // 词表里的 neutral 仍然在，且不算已有
    expect(choices.find((c) => c.name === "neutral")).toEqual({ name: "neutral", existing: false });
  });

  it("词表外的自定义差分名也进候选（用户自己敲过的要能看见）", () => {
    const choices = spriteVariantChoices(["smug"]);
    expect(choices[0]).toEqual({ name: "smug", existing: true });
    expect(choices.some((c) => c.name === "smile")).toBe(true);
  });

  it("去重：重复与空白的已有名各自只留一条", () => {
    const choices = spriteVariantChoices(["smile", "smile", "  ", ""]);
    expect(choices.filter((c) => c.name === "smile")).toEqual([{ name: "smile", existing: true }]);
    expect(choices.some((c) => c.name === "")).toBe(false);
  });

  it("一个差分都没有时就是整份常用词表，且都标未生成", () => {
    const choices = spriteVariantChoices([]);
    expect(choices.map((c) => c.name)).toEqual([...COMMON_SPRITE_VARIANTS]);
    expect(choices.every((c) => !c.existing)).toBe(true);
  });
});
