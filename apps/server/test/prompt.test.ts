import { describe, expect, it } from "vitest";
import { buildSystemPrompt, DEFAULT_CRAFT } from "../src/prompt.js";
import { PlayMemory } from "../src/memory.js";
import { PLAY } from "./helpers.js";

describe("buildSystemPrompt：素材元数据与已生成图清单", () => {
  it("描述挂在对应 id 后面，没描述的只留 id", () => {
    const prompt = buildSystemPrompt({
      play: PLAY,
      assets: { backgrounds: ["bg_dusk.jpg", "bg_rain.jpg"], cg: ["cg_1.png"] },
      notes: { bg_dusk: { description: "放学后的空教室，落日余晖" }, bg_rain: { description: "  " } },
    });
    expect(prompt).toContain("- bg_dusk（放学后的空教室，落日余晖）");
    expect(prompt).toContain("- bg_rain\n");
    expect(prompt).toContain("- cg_1\n");
    expect(prompt).not.toContain("bg_rain（");
  });

  it("音频素材把情绪、适用场景、时长、可循环一起摆出来", () => {
    const prompt = buildSystemPrompt({
      play: PLAY,
      assets: { bgm: ["twilight.mp3"], sfx: ["rain.ogg"] },
      notes: {
        twilight: { description: "黄昏钢琴曲", mood: ["忧伤", "温柔"], durationSec: 96, loop: true, volume: 0.3 },
        rain: { description: "窗外雨声", mood: ["安静"], scene: ["夜戏"] },
      },
    });
    expect(prompt).toContain("黄昏钢琴曲｜情绪：忧伤、温柔｜约 96 秒｜可循环｜建议音量 0.3");
    expect(prompt).toContain("窗外雨声｜情绪：安静｜适用：夜戏");
    // 库里有音素材才讲编排规则
    expect(prompt).toContain("# 配乐与音效（怎么用）");
  });

  it("立绘差分也带描述", () => {
    const prompt = buildSystemPrompt({
      play: {
        ...PLAY,
        characters: [{ id: "mio", name: "澪", persona: "p", sprites: { pout: "pout.png" } }],
      },
      notes: { "mio/pout": { description: "鼓腮嗔怒" } },
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

  it("记忆索引：有分类的带 [分类] 前缀，顶层卡不打空括号", () => {
    const memory = new PlayMemory({
      cards: [
        { layer: "locations", name: "旧校舍", summary: "四层走廊", detail: "", file: "locations/旧校舍", arc: false },
        { layer: "lore", name: "结界", summary: "折寿一年", detail: "", file: "lore/结界", arc: false },
        { layer: "", name: "旧约定", summary: "顶层卡不必分类", detail: "", file: "旧约定", arc: false },
      ],
    });
    const prompt = buildSystemPrompt({ play: PLAY, memory });
    expect(prompt).toContain("- [locations] 旧校舍：四层走廊");
    expect(prompt).toContain("- [lore] 结界：折寿一年");
    // 顶层卡的 layer 是空串：打出来就是「- [] 」，丑且误导
    expect(prompt).toContain("- 旧约定：顶层卡不必分类");
    expect(prompt).not.toContain("- [] ");
  });

  it("纪元卡只在它所属的分支上出现（防剧透）", () => {
    const memory = new PlayMemory({
      cards: [
        { layer: "arcs", name: "第一纪元", summary: "两人走到旧校舍", detail: "", file: "epoch-e1-1", arc: true },
        { layer: "locations", name: "旧校舍", summary: "四层走廊", detail: "", file: "locations/旧校舍", arc: false },
      ],
    });
    expect(buildSystemPrompt({ play: PLAY, memory, arcIds: [] })).not.toContain("第一纪元");
    expect(buildSystemPrompt({ play: PLAY, memory, arcIds: ["epoch-e1-1"] })).toContain("- [arcs] 第一纪元");
  });

  it("没有描述表时清单退化为纯 id，行为与从前一致", () => {
    const prompt = buildSystemPrompt({ play: PLAY, assets: { backgrounds: ["bg_dusk.jpg"] } });
    expect(prompt).toContain("- bg_dusk\n");
    expect(prompt).toContain("scene 的 bg 优先取这些 id。");
    expect(prompt).not.toContain("# 已生成的图");
    // 没有音素材就不灌编排规则，避免教模型用不存在的功能
    expect(prompt).not.toContain("# 配乐与音效（怎么用）");
  });
});

describe("buildSystemPrompt：创作口径与演出契约", () => {
  it("没有 craft.md 时用内置默认口径，并标出可改的边界", () => {
    const prompt = buildSystemPrompt({ play: PLAY });
    expect(prompt).toContain(DEFAULT_CRAFT);
    expect(prompt).toContain("# 创作口径");
  });

  it("craft.md 覆盖默认口径（用户手写与工坊 agent 改的是同一份）", () => {
    const prompt = buildSystemPrompt({
      play: PLAY,
      memory: new PlayMemory({ craft: "# 创作口径\n\n每拍只写一句。" }),
    });
    expect(prompt).toContain("每拍只写一句。");
    expect(prompt).not.toContain(DEFAULT_CRAFT);
  });

  it("演出契约单列为引擎规则，与可改的创作口径分开", () => {
    const prompt = buildSystemPrompt({ play: PLAY });
    expect(prompt).toContain("# 演出契约（引擎规则，不可改）");
    // beat_done 独占批次是引擎事实，不属于用户可改口径
    expect(prompt).toContain("beat_done");
  });
});
