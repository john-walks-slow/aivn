import { describe, expect, it } from "vitest";
import { CRAFT_ENUMS, describeCraftParams, renderCraftParams } from "../src/index.js";
import { resolveCraft, type EffectiveCraft } from "@aivn/core";

/**
 * 写作参数的两份说法。停止点的措辞由宿主注入（工具面 `beat_done` / DSL `<stop/>`），
 * 所以这里用一个显眼的假实现，确认整段其余部分逐字来自包。
 */

const stop = (options: string): string => `STOP(${options})`;
const can = { image: true, library: false };
const craft = (patch: Parameters<typeof resolveCraft>[0] = {}): EffectiveCraft => resolveCraft(patch);

describe("剧作家那段", () => {
  it("永远注入，缺省值也把口径说出来", () => {
    const text = renderCraftParams(craft(), can, stop);
    expect(text).toContain("# 写作参数（本剧目设定，照它写）");
    expect(text).toContain("一轮 8~15 句台词/旁白");
    expect(text).toContain("STOP(three)");
    expect(text).toContain("素材来源：");
  });

  it("停止点整句用宿主给的那一份", () => {
    expect(renderCraftParams(craft({ stopOptions: "free" }), can, stop)).toContain("STOP(free)");
  });

  it("篇幅三档各有一句", () => {
    for (const beatLength of CRAFT_ENUMS.beatLength) {
      const text = renderCraftParams(craft({ beatLength }), can, stop);
      expect(text).toContain(beatLength === "short" ? "3~6 句" : beatLength === "medium" ? "8~15 句" : "20~30 句");
    }
  });

  it("没配素材资源库时不许指向库（插件恒走这一支）", () => {
    const text = renderCraftParams(craft({ assets: { background: "library-first" } }), can, stop);
    expect(text).toContain("直接 generate_image 出（本剧目没配素材资源库）");
    expect(text).not.toContain("优先用素材资源库里现成的");
  });

  it("没开生图时四行都改成它真能做到的事", () => {
    const text = renderCraftParams(craft(), { image: false, library: false }, stop);
    expect(text).toContain("本剧目没开生图：不要给角色出新立绘差分");
    expect(text).toContain("素材清单里已有的");
    expect(text).not.toContain("generate_image");
  });

  it("关掉的那几项各自有话说，且不再提出图", () => {
    const text = renderCraftParams(craft({ assets: { cg: "off", sprite: "off", audio: "off" } }), can, stop);
    expect(text).toContain("不要写 <cg>");
    expect(text).toContain("不要给角色出立绘");
    expect(text).toContain("不要写 bgm/ambient/sfx");
  });
});

describe("工坊那份清单", () => {
  it("只报值不带祈使句", () => {
    const text = describeCraftParams(craft({ beatLength: "long", stopOptions: "free" }));
    expect(text).toBe(
      ["每轮篇幅：长", "停止点选项：固定自由输入", "素材来源：背景 资源库优先，没有再出图；插图 直接出图；立绘 出图；音效 只用资源库里现成的"].join(
        "\n",
      ),
    );
  });
});

