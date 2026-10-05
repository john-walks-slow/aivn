import { describe, expect, it } from "vitest";
import {
  stageTabFromQuery,
  stageViewFromQuery,
  VIEW_LABEL,
  workshopConnectionFromQuery,
  workshopUrl,
  type StageView,
  type WorkshopTab,
} from "@aivn/stage";

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

  it("认 CG 页（?view=cg 直达同一外壳下的第五个视图）", () => {
    expect(stageViewFromQuery("view=cg")).toBe<StageView>("cg");
  });

  it("工坊 tab：素材页直达（就绪门那句「到素材与配置」用）", () => {
    expect(stageTabFromQuery("tab=assets")).toBe<WorkshopTab>("assets");
  });

  it("工坊 tab：剧目页与记忆页直达（两个页签拆开之后各自有 URL）", () => {
    expect(stageTabFromQuery("tab=play")).toBe<WorkshopTab>("play");
    expect(stageTabFromQuery("tab=memory")).toBe<WorkshopTab>("memory");
    expect(stageTabFromQuery("tab=characters")).toBe<WorkshopTab>("characters");
  });

  it("tab 认不出就回对话页", () => {
    expect(stageTabFromQuery("tab=nope")).toBe<WorkshopTab>("chat");
    expect(stageTabFromQuery("")).toBe<WorkshopTab>("chat");
  });
});

describe("视图名", () => {
  it("五个视图各有一个中文名（外壳视图栏与 README 用同一份）", () => {
    expect(Object.values(VIEW_LABEL)).toEqual(["舞台", "回顾", "路线", "CG", "工坊"]);
  });
});

describe("连接模式", () => {
  it("workshop=1 = 逛工坊，不 autostart（标题页直达工坊走这条）", () => {
    expect(workshopConnectionFromQuery("view=workshop&workshop=1")).toBe(true);
  });

  it("默认是真舞台连接：重挂即开演，这是既有行为", () => {
    expect(workshopConnectionFromQuery("")).toBe(false);
    expect(workshopConnectionFromQuery("view=workshop")).toBe(false);
  });
});

describe("工坊直达地址", () => {
  it("工坊是舞台外壳的一个视图：入口就是舞台地址带 view+连接模式", () => {
    expect(workshopUrl("demo")).toBe("/play/demo/stage?view=workshop&workshop=1");
  });

  it("可以顺带落在某一页（就绪门里的「素材页」）", () => {
    expect(workshopUrl("demo", "assets")).toBe("/play/demo/stage?view=workshop&workshop=1&tab=assets");
  });
});
