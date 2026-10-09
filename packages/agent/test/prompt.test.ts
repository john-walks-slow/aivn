import { describe, expect, it } from "vitest";
import {
  DEFAULT_KEY_COLOR,
  genericReferenceSuffix,
  isKeyBackgroundColor,
  KEY_BACKGROUND_COLORS,
  NEUTRAL_LEAD,
  referenceSuffix,
  spriteSuffix,
} from "../src/index.js";

/**
 * 立绘后缀的唯一出口。
 *
 * 这里盯的是两件真出过事的东西：
 * - **底色必须由引擎拼死值**：差分曾经写「跟参考图同色」，而参考图是抠过底的透明 PNG，
 *   模型还原成白底 → 色键把浅色打成镂空；
 * - **标点归一**：片段各写各的句点时出过 30/57 条 `expression..`。
 */

describe("spriteSuffix", () => {
  it("定妆照：景别在前、色键底与画风压轴，标点不重复", () => {
    const s = spriteSuffix("full", true, 0, undefined);
    expect(s.startsWith("full body, head to toe")).toBe(true);
    expect(s).toContain("pure green #00FF00");
    expect(s).toContain("NOT a 3D render");
    expect(s).toContain("No gradient, no shadow");
    expect(s).not.toContain("..");
    expect(s.endsWith(".")).toBe(true);
    expect(s).not.toContain("reference image");
  });

  it("色键色是拼进来的死值：magenta 覆盖缺省绿", () => {
    expect(spriteSuffix("half", true, 0, "magenta")).toContain("pure magenta #FF00FF");
    expect(spriteSuffix("half", true, 0, undefined)).toContain("pure green #00FF00");
  });

  it("非人主体（square）换留白措辞：只说完整入画，不给人形的手臂留缝", () => {
    const s = spriteSuffix("square", true, 0, "green");
    expect(s).toContain("clear empty background space all around it");
    expect(s).not.toContain("narrow sliver");
    expect(s).not.toContain("space above the head");
  });

  it("差分：身份锁在前，景别跟着再来一次", () => {
    const s = spriteSuffix("half", false, 0, "green");
    expect(s.startsWith("Same character as the reference image")).toBe(true);
    expect(s.indexOf("medium shot, waist-up")).toBeGreaterThan(0);
    expect(s).toContain("pure green #00FF00");
  });

  it("非人差分的身份锁说「状态」不说「面部表情」", () => {
    const s = spriteSuffix("square", false, 0, "green");
    expect(s).toContain("Change only its state");
    expect(s).not.toContain("facial expression");
  });

  it("定妆照垫了图才补身份尾注，且压在最后", () => {
    const withPipe = spriteSuffix("full", true, 1, "green");
    expect(withPipe).toContain("Based on the attached reference image");
    expect(withPipe.indexOf("Based on the attached reference image")).toBeGreaterThan(
      withPipe.indexOf("No gradient"),
    );
    expect(spriteSuffix("full", true, 0, "green")).not.toContain("Based on the attached reference image");
    // 差分垫的是自家 neutral，不走这条尾注。
    expect(spriteSuffix("full", false, 1, "green")).not.toContain("Based on the attached reference image");
  });

  it("缺省取景是全身", () => {
    expect(spriteSuffix(undefined, true, 0, undefined)).toBe(spriteSuffix("full", true, 0, undefined));
  });
});

describe("垫图锚点", () => {
  it("全部具名：按顺序编号并锁住每张的身份", () => {
    const s = referenceSuffix(["七濑", "澪"]);
    expect(s).toContain("1) 七濑, 2) 澪");
    expect(s).toContain("Do not merge them into one person");
  });

  it("混了没有名字的垫图：能报名字的报名字，剩下的叫 reference image", () => {
    // 路径 / 网址类的垫图在宿主侧解析出来的 name 就是 null（网址本身不是名字）。
    const s = genericReferenceSuffix(["七濑", null, null]);
    expect(s).toContain("1) 七濑, 2) reference image, 3) reference image");
  });

  it("一张具名的都没有：退回通用措辞", () => {
    const s = genericReferenceSuffix([null, undefined]);
    expect(s).toContain("Follow the attached reference image(s)");
    expect(s).not.toContain("in this exact order");
  });
});

describe("色键枚举", () => {
  it("两种底色，缺省绿", () => {
    expect([...KEY_BACKGROUND_COLORS]).toEqual(["green", "magenta"]);
    expect(DEFAULT_KEY_COLOR).toBe("green");
    expect(isKeyBackgroundColor("magenta")).toBe(true);
    expect(isKeyBackgroundColor("blue")).toBe(false);
  });

  it("定妆照前置描述按取景取词，三种都有", () => {
    expect(Object.keys(NEUTRAL_LEAD).sort()).toEqual(["full", "half", "square"]);
    expect(NEUTRAL_LEAD.square).not.toContain("portrait");
  });
});
