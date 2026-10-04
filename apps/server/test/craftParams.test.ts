import { describe, expect, it } from "vitest";
import { DEFAULT_CRAFT, resolveCraft } from "@aivn/core";
import { describeCraftParams, mergeCraftParams, renderCraftParams } from "../src/craftParams.js";

const FULL = { image: true, library: true };
const NO_IMAGE = { image: false, library: true };
const NO_LIBRARY = { image: true, library: false };

describe("renderCraftParams：剧作家的写作参数段", () => {
  it("三项都写出来——默认值也照说", () => {
    const text = renderCraftParams(DEFAULT_CRAFT, FULL);
    expect(text).toContain("# 写作参数（本剧目设定，照它写）");
    expect(text).toContain("一轮 8~15 句");
    expect(text).toContain('beat_done(options=["…", "…", "…"])');
    expect(text).toContain(" - 背景：优先用素材资源库里现成的");
    expect(text).toContain('立绘：自己 generate_image（kind="sprite"）出。');
    expect(text).toContain("音乐与音效：只用素材资源库里现成的 bgm/sfx。");
  });

  it("改成短轮 + 自由输入：不再提 options，改提 placeholder", () => {
    const text = renderCraftParams(resolveCraft({ beatLength: "short", stopOptions: "free" }), FULL);
    expect(text).toContain("一轮 3~6 句");
    expect(text).toContain('beat_done(placeholder="…")');
    expect(text).not.toContain("options=[");
  });

  it("没有生图能力：一条 generate_image 都不提，换成旁白交代", () => {
    // 教模型调一个装不进去的工具，只会让它反复空转。
    const text = renderCraftParams(DEFAULT_CRAFT, NO_IMAGE);
    expect(text).not.toContain("generate_image");
    expect(text).toContain("本剧目没开生图");
  });

  it("没配素材资源库：背景那条不能再说「用库里现成的」", () => {
    const text = renderCraftParams(DEFAULT_CRAFT, NO_LIBRARY);
    expect(text).toContain("直接 generate_image 出（本剧目没配素材资源库）");
  });

  it("关掉插图 / 立绘 / 音效：各有各的停法", () => {
    const text = renderCraftParams(resolveCraft({ assets: { cg: "off", sprite: "off", audio: "off" } }), FULL);
    expect(text).toContain("不要写 <cg>");
    expect(text).toContain("不要给角色出立绘");
    expect(text).toContain("不要写 bgm/ambient/sfx");
  });
});

describe("describeCraftParams：现状清单", () => {
  it("报值不报祈使句，三项都在", () => {
    const text = describeCraftParams(resolveCraft({ stopOptions: "two" }));
    expect(text).toContain("每轮篇幅：中等");
    expect(text).toContain("停止点选项：每次 2 条");
    expect(text).toContain("素材来源：背景 资源库优先，没有再出图");
  });

  it("自由输入那档写成「固定自由输入」而不是「每次 N 条」", () => {
    expect(describeCraftParams(resolveCraft({ stopOptions: "free" }))).toContain("停止点选项：固定自由输入");
  });
});

describe("mergeCraftParams：三态补丁", () => {
  it("省略 = 保持现状", () => {
    expect(mergeCraftParams({ beatLength: "long" }, {})).toEqual({ beatLength: "long" });
    expect(mergeCraftParams({ beatLength: "long" }, { stopOptions: "two" })).toEqual({
      beatLength: "long",
      stopOptions: "two",
    });
  });

  it("只留与默认不同的字段：写回默认值 = 那一行从文件里消失", () => {
    expect(mergeCraftParams(undefined, { stopOptions: "three" })).toBeUndefined();
    expect(mergeCraftParams({ beatLength: "long" }, { beatLength: "medium" })).toBeUndefined();
    expect(mergeCraftParams({ assets: { background: "generate" } }, {})).toEqual({ assets: { background: "generate" } });
  });

  it("null = 恢复默认，不动同层其它字段", () => {
    const current = { beatLength: "long" as const, stopOptions: "two" as const, assets: { background: "generate" as const } };
    expect(mergeCraftParams(current, { beatLength: null })).toEqual({
      stopOptions: "two",
      assets: { background: "generate" },
    });
    expect(mergeCraftParams(current, { assets: { background: null } })).toEqual({
      beatLength: "long",
      stopOptions: "two",
    });
  });

  it("assets 整个给 null：四项一起回默认", () => {
    const current = { assets: { background: "generate" as const, cg: "off" as const, audio: "off" as const } };
    expect(mergeCraftParams(current, { assets: null })).toBeUndefined();
  });
});
