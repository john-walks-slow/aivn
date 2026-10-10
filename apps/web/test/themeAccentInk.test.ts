import { describe, expect, it } from "vitest";
import { luminance, readableInk } from "../src/hooks/useTheme.js";

/**
 * 自定义主色的墨色：预设色是成对的，自己挑的只有一个色。
 * 不配墨色时浅色主色上会留白字（实测 1.41:1），所以这条规则要有测试兜着。
 */
describe("自定义主色的墨色", () => {
  it("浅色主色配深字", () => {
    expect(readableInk("#ffd54f")).toBe("#0e1a1b");
    expect(readableInk("#ffffff")).toBe("#0e1a1b");
  });

  it("深色主色配白字", () => {
    expect(readableInk("#122033")).toBe("#ffffff");
    expect(readableInk("#1b3a5c")).toBe("#ffffff");
  });

  it("三位简写与带不带 # 都认", () => {
    expect(luminance("#fff")).toBeCloseTo(1, 3);
    expect(readableInk("fff")).toBe("#0e1a1b");
    expect(luminance("#000")).toBeCloseTo(0, 3);
  });

  it("认不出的写法回落到白字，不改坏颜色", () => {
    expect(luminance("rebeccapurple")).toBeNull();
    expect(readableInk("rebeccapurple")).toBe("#ffffff");
  });
});
