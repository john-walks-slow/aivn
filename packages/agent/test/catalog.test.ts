import { describe, expect, it } from "vitest";
import {
  assetMetaOf,
  assetRel,
  declareBgmSource,
  declareDescription,
  declareSprite,
  ledgerEntryOf,
  ledgerIdOf,
  spriteSourceRel,
  staleSiblings,
  type AssetManifest,
  type AssetRef,
} from "../src/index.js";

/**
 * 素材表声明与落位路径的规则层：两个宿主各自的加锁读改写里调的就是这几个纯函数。
 * 这里盯的是「一个字段都不能丢」与「立绘级取景以定妆照为准」两条。
 */

const girl: AssetRef = {
  kind: "sprite",
  kindPath: "sprites/probe_girl",
  stem: "smile",
  spriteId: "probe_girl",
  variant: "smile",
  framing: "half",
};

describe("落位路径", () => {
  it("素材与留底原片的相对路径", () => {
    expect(assetRel({ kind: "background", kindPath: "backgrounds", stem: "rooftop" }, ".jpg")).toBe(
      "assets/backgrounds/rooftop.jpg",
    );
    expect(spriteSourceRel(girl, ".png")).toBe("media-cache/sprite-sources/probe_girl/smile.png");
    // 背景 / CG 没有原片这回事
    expect(spriteSourceRel({ kind: "cg", kindPath: "cg", stem: "x" }, ".png")).toBeNull();
  });

  it("同 stem 的旧扩展名要清掉，别的 stem 不碰", () => {
    expect(staleSiblings(["smile.png", "smile.jpg", "angry.png"], "smile", "smile.png")).toEqual(["smile.jpg"]);
  });
});

describe("素材表", () => {
  it("旧格式的一句说明等价于只有 description 的元数据", () => {
    expect(assetMetaOf({ rooftop: "天台，黄昏" }, "rooftop")).toEqual({ description: "天台，黄昏" });
    expect(assetMetaOf({}, "rooftop")).toEqual({});
  });

  it("取出来的是一份副本，改它不动原表", () => {
    const manifest: AssetManifest = { probe_girl: { description: "银发少女", title: "七濑" } };
    const meta = assetMetaOf(manifest, "probe_girl");
    meta.title = "改了";
    expect(manifest.probe_girl).toEqual({ description: "银发少女", title: "七濑" });
  });

  it("定妆照写立绘级取景；描述与既有字段一个字不动", () => {
    const before: AssetManifest = { probe_girl: { description: "银发少女", staging: 1 } as never };
    const after = declareSprite(before, {
      kind: "sprite",
      kindPath: "sprites/probe_girl",
      stem: "neutral",
      spriteId: "probe_girl",
      variant: "neutral",
      framing: "full",
      stature: "large",
      title: "七濑",
    });
    expect(after.probe_girl).toEqual({
      description: "银发少女",
      staging: 1,
      title: "七濑",
      framing: "full",
      stature: "large",
    });
    expect(before.probe_girl).toEqual({ description: "银发少女", staging: 1 });
  });

  it("差分级取景与立绘级一致时不重复写那一格，不一致才写", () => {
    // 非 neutral 一律留一条差分级（落位指标是逐文件的，那一格得有个家），
    // 所以「一致」的形态是**空覆盖**，不是没有这条键。
    const base: AssetManifest = { probe_girl: { framing: "full" } };
    expect(declareSprite(base, { ...girl, framing: "full" })).toHaveProperty("probe_girl/smile", {});
    const closeup = declareSprite(base, { ...girl, framing: "half" });
    expect(closeup["probe_girl/smile"]).toEqual({ framing: "half" });
  });

  it("差分级照实记自己的落位指标，不拿立绘级的数冒充", () => {
    const base: AssetManifest = { probe_girl: { framing: "full", figureTop: 96, figureHeight: 1800 } };
    const smile = declareSprite(base, { ...girl, figureTop: 120, figureHeight: 1700 });
    expect(smile["probe_girl/smile"]).toEqual({ framing: "half", figureTop: 120, figureHeight: 1700 });
    // 立绘级那两格不动
    expect(smile.probe_girl).toMatchObject({ figureTop: 96, figureHeight: 1800 });
  });

  it("描述落到立绘的 `<主体>/<差分>` 键上，背景落文件名主体", () => {
    expect(declareDescription({}, girl, "微笑")["probe_girl/smile"]).toEqual({ description: "微笑" });
    expect(declareDescription({}, { kind: "cg", kindPath: "cg", stem: "kiss" }, "吻")["kiss"]).toEqual({
      description: "吻",
    });
  });

  it("BGM 只记一条来源", () => {
    expect(declareBgmSource({}, "theme")["theme"]).toEqual({ source: "AI 生成（本插件）" });
  });
});

describe("出图台账", () => {
  it("键与提示词查表一致，条目自带 id 与记账时刻", () => {
    expect(ledgerIdOf(girl)).toBe("probe_girl/smile");
    expect(ledgerIdOf({ kind: "cg", kindPath: "cg", stem: "kiss" })).toBe("kiss");
    expect(ledgerEntryOf(girl, "assets/sprites/probe_girl/smile.png", "a gentle smile", "2026-10-09T00:00:00.000Z")).toEqual({
      id: "probe_girl/smile",
      kind: "sprite",
      path: "assets/sprites/probe_girl/smile.png",
      prompt: "a gentle smile",
      at: "2026-10-09T00:00:00.000Z",
    });
  });
});
