import { describe, expect, it } from "vitest";
import {
  stageTabFromQuery,
  stageViewFromQuery,
  VIEW_LABEL,
  type StageView,
  type WorkshopTab,
} from "../src/stage/view.js";

/**
 * 工坊从标题页直达：URL 带 ?view=workshop&tab=assets。
 * 认错了不会崩，但会「进错地方」——所以这两个函数只认白名单里的值。
 */
describe("入口视图解析", () => {
  it("认工坊直达（标题页「工坊」按钮）", () => {
    expect(stageViewFromQuery("view=workshop")).toBe<StageView>("workshop");
  });

  it("没带 view 就是舞台", () => {
    expect(stageViewFromQuery("")).toBe<StageView>("stage");
    expect(stageViewFromQuery(null)).toBe<StageView>("stage");
  });

  it("不认的值退回舞台——工坊页有独立外壳，直连它不会落到舞台视图", () => {
    expect(stageViewFromQuery("view=workshopp")).toBe<StageView>("stage");
  });

  it("工坊 tab：素材页直达（就绪门那句「到素材与配置」用）", () => {
    expect(stageTabFromQuery("tab=assets")).toBe<WorkshopTab>("assets");
  });

  it("tab 认不出就回对话页", () => {
    expect(stageTabFromQuery("tab=nope")).toBe<WorkshopTab>("chat");
    expect(stageTabFromQuery("")).toBe<WorkshopTab>("chat");
  });
});

describe("视图名", () => {
  it("四个视图各有一个中文名（外壳视图栏与 README 用同一份）", () => {
    expect(Object.values(VIEW_LABEL)).toEqual(["舞台", "回顾", "路线", "工坊"]);
  });
});
