import { describe, expect, it } from "vitest";
import { buildSystemPrompt } from "../src/prompt.js";
import { PLAY } from "./helpers.js";

describe("buildSystemPrompt：素材描述与已生成图清单", () => {
  it("描述挂在对应 id 后面，没描述的只留 id", () => {
    const prompt = buildSystemPrompt({
      play: PLAY,
      assets: { backgrounds: ["bg_dusk.jpg", "bg_rain.jpg"], cg: ["cg_1.png"] },
      notes: { bg_dusk: "放学后的空教室，落日余晖", bg_rain: "" },
    });
    expect(prompt).toContain("bg_dusk（放学后的空教室，落日余晖） | bg_rain");
    expect(prompt).toContain("cg_1\n");
    expect(prompt).not.toContain("bg_rain（");
  });

  it("立绘差分也带描述", () => {
    const prompt = buildSystemPrompt({
      play: {
        ...PLAY,
        characters: [{ id: "mio", name: "澪", persona: "p", sprites: { pout: "pout.png" } }],
      },
      notes: { pout: "鼓腮嗔怒" },
    });
    expect(prompt).toContain("expression：pout（鼓腮嗔怒）");
  });

  it("已生成的图带 id 与 prompt 进清单，并提示直接引用", () => {
    const prompt = buildSystemPrompt({
      play: PLAY,
      generated: [{ id: "bg_town_dusk", type: "bg", prompt: "small town at dusk, anime background" }],
    });
    expect(prompt).toContain("# 已生成的图");
    expect(prompt).toContain("bg_town_dusk（bg）—— small town at dusk, anime background");
    expect(prompt).toContain("不要再 preload_asset");
  });

  it("没有描述表时清单退化为纯 id，行为与从前一致", () => {
    const prompt = buildSystemPrompt({ play: PLAY, assets: { backgrounds: ["bg_dusk.jpg"] } });
    expect(prompt).toContain("bg_dusk——scene 的 bg 优先取这些 id。");
    expect(prompt).not.toContain("# 已生成的图");
  });
});
