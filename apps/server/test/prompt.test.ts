import { describe, expect, it } from "vitest";
import type { CharacterDocument } from "@stage-ai/core";
import type { AgentCapabilities } from "../src/agentkit/kit.js";
import { buildSystemPrompt, type PromptContext } from "../src/prompt.js";

function card(id: string, head: Partial<CharacterDocument>): Map<string, CharacterDocument> {
  return new Map([[id, { id, body: "p", ...head }]]);
}
import { PlayMemory } from "../src/memory.js";
import { caps, PLAY } from "./helpers.js";

/**
 * 剧作家提示词的装配口：能力位缺省「生图开、联网与资源库关」，用例只写它关心的那几位。
 * 生产侧的对应入口是 `orchestrator.ts` 的 `can: this.kit.can`。
 */
function build(ctx: Omit<PromptContext, "can"> & { can?: Partial<AgentCapabilities> }): string {
  return buildSystemPrompt({ ...ctx, can: { ...caps(), ...ctx.can } });
}

describe("buildSystemPrompt：素材元数据与已生成图清单", () => {
  it("描述挂在对应 id 后面，没描述的只留 id", () => {
    const prompt = build({
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
    const prompt = build({
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
    const prompt = build({
      play: {
        ...PLAY,
      },
      memory: new PlayMemory({ characters: card("mio", { name: "澪", sprites: { pout: "pout.png" } }) }),
      notes: { "mio/pout": { description: "鼓腮嗔怒" } },
    });
    expect(prompt).toContain("expression：pout（鼓腮嗔怒）");
  });

  it("主角卡在角色表里标出「玩家扮演」，契约点明它与别的角色同权", () => {
    const prompt = build({
      play: PLAY,
      memory: new PlayMemory({
        characters: new Map([
          ["protagonist", { id: "protagonist", name: "你", body: "高二学生，话不多。" }],
          ["mio", { id: "mio", name: "澪", body: "p" }],
        ]),
      }),
    });
    // 主角就是一张普通卡，只在标题里多一个标注——上台、立绘、配音都由创作口径决定
    expect(prompt).toContain("### 你（id: protagonist，玩家扮演）");
    expect(prompt).toContain("### 澪（id: mio）");
    expect(prompt).not.toContain("### 澪（id: mio，玩家扮演）");
    expect(prompt).toContain("id 固定为 protagonist");
  });

  it("立绘差分的两套键约定合并取字段：规范键只有 prompt 时别把裸键的描述挡掉", () => {
    // 引擎记 prompt 走 <角色id>/<差分名>，手写与工坊补的描述常是裸差分名：两套并存是现实
    const prompt = build({
      play: PLAY,
      memory: new PlayMemory({ characters: card("mio", { name: "澪", sprites: { neutral: "n.png" } }) }),
      notes: { "mio/neutral": { prompt: "a girl with pink hair" }, neutral: { description: "粉发定妆照" } },
    });
    expect(prompt).toContain("expression：neutral（粉发定妆照）");
    // 规范键自己的字段仍然赢
    const both = build({
      play: PLAY,
      memory: new PlayMemory({ characters: card("mio", { name: "澪", sprites: { neutral: "n.png" } }) }),
      notes: { "mio/neutral": { description: "规范键的描述" }, neutral: { description: "裸键的描述" } },
    });
    expect(both).toContain("expression：neutral（规范键的描述）");
  });

  it("已生成的图带 id 与 prompt 进清单，并提示直接引用", () => {
    const prompt = build({
      play: PLAY,
      generated: [{ id: "bg_town_dusk", type: "bg", prompt: "small town at dusk, anime background" }],
    });
    expect(prompt).toContain("# 已生成的图");
    expect(prompt).toContain("bg_town_dusk（bg）—— small town at dusk, anime background");
    expect(prompt).toContain("不要再 generate_image");
  });

  it("记忆索引：有分类的带 [分类] 前缀，顶层卡不打空括号", () => {
    const memory = new PlayMemory({
      cards: [
        { layer: "locations", name: "旧校舍", summary: "四层走廊", detail: "", file: "locations/旧校舍", arc: false },
        { layer: "lore", name: "结界", summary: "折寿一年", detail: "", file: "lore/结界", arc: false },
        { layer: "", name: "旧约定", summary: "顶层卡不必分类", detail: "", file: "旧约定", arc: false },
      ],
    });
    const prompt = build({ play: PLAY, memory });
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
    expect(build({ play: PLAY, memory, arcIds: [] })).not.toContain("第一纪元");
    expect(build({ play: PLAY, memory, arcIds: ["epoch-e1-1"] })).toContain("- [arcs] 第一纪元");
  });

  it("没有描述表时清单退化为纯 id，行为与从前一致", () => {
    const prompt = build({ play: PLAY, assets: { backgrounds: ["bg_dusk.jpg"] } });
    expect(prompt).toContain("- bg_dusk\n");
    expect(prompt).toContain("scene 的 bg 优先取这些 id。");
    expect(prompt).not.toContain("# 已生成的图");
    // 没有音素材就不灌编排规则，避免教模型用不存在的功能
    expect(prompt).not.toContain("# 配乐与音效（怎么用）");
  });
});

describe("buildSystemPrompt：创作口径与演出契约", () => {
  it("引擎不再自带任何创作口径：craft.md 是唯一来源，有内容才注入", () => {
    const empty = build({ play: PLAY });
    expect(empty).not.toContain("# 台词怎么写");

    const withCraft = build({
      play: PLAY,
      memory: new PlayMemory({ craft: "# 创作口径\n\n- 每轮 6~10 句。\n- 选项给三条。" }),
    });
    expect(withCraft).toContain("每轮 6~10 句。");
    expect(withCraft).toContain("选项给三条。");
  });

  it("craft.md 为空时不注入任何剧目口径（新剧目的默认状态）", () => {
    const prompt = build({ play: PLAY, memory: new PlayMemory({ craft: "   " }) });
    expect(prompt).not.toContain("# 创作口径");
  });

  it("每轮多长、选项几条、多久交还主导权都不写死在提示词里——全归剧目的创作口径", () => {
    // 2026-10-03：这三条从系统提示词撤走，改由搭台助手与用户对齐后写进 craft.md。
    // 撤掉之后提示词不能再偷偷留一份默认，否则剧目自己的口径永远压不过引擎的。
    const prompt = build({
      play: PLAY,
      memory: new PlayMemory({ craft: "每轮写长一点。" }),
    });
    for (const hardcoded of ["10–25 句", "500–1500 字", "至少 10 句", "2~4", "# 单轮该写多长"]) {
      expect(prompt).not.toContain(hardcoded);
    }
  });

  it("选项给几条交给创作口径，但工具的三种收尾方式仍是硬契约", () => {
    const prompt = build({ play: PLAY });
    expect(prompt).toContain("给几条互斥的选项照创作口径来");
    expect(prompt).toContain("beat_done(placeholder=");
    expect(prompt).toContain("beat_done()，两个参数都不给");
  });

  it("演出契约单列为引擎规则，与可改的创作口径分开", () => {
    const prompt = build({ play: PLAY });
    expect(prompt).toContain("# 演出契约（引擎规则，不可改）");
    // beat_done 独占批次是引擎事实，不属于用户可改口径
    expect(prompt).toContain("beat_done");
  });

  it("讲清工作方式：beat_done 是这一轮的出口，没有停止点时引擎接上下一轮", () => {
    const prompt = build({ play: PLAY });
    expect(prompt).toContain("# 你怎么工作");
    expect(prompt).toContain("停止点是这一轮的出口，不是故事的终点");
    expect(prompt).toContain("引擎接上的下一轮");
    // 停止点不再是文本标签，教的是工具参数
    expect(prompt).toContain("## 结束轮（beat_done）");
    expect(prompt).not.toContain("<stop");
  });

  it("输出纯净写在不可改的契约里，且不再拿 <comment> 当出口来邀请", () => {
    const prompt = build({ play: PLAY });
    const contract = prompt.slice(prompt.indexOf("# 演出契约（引擎规则，不可改）"));
    expect(contract).toContain("你是剧本引擎，不是助手");
    expect(contract).toContain("不聊天、不寒暄");
    // 注释是兜底出口，不是功能位：提示词里除格式章那一次示范外，不再劝模型去用它
    expect(contract).not.toContain("<comment>");
    expect(prompt.match(/<comment>/g) ?? []).toHaveLength(1);
  });

  it("输出纯净不再依赖可被用户删掉的口径文件", () => {
    const prompt = build({
      play: PLAY,
      memory: new PlayMemory({ craft: "只写一句。" }),
    });
    expect(prompt).toContain("你是剧本引擎，不是助手");
  });

  it("剧作家 prompt 不再出现技能清单：它没有 read_skill 这个工具", () => {
    // 教模型调一个装不进去的工具，它只会反复空转。技能库归搭台助手。
    const prompt = build({ play: PLAY });
    expect(prompt).not.toContain("<available_skills>");
    expect(prompt).not.toContain("read_skill");
  });

  it("格式段示范的 <comment> 开闭标签必须配平——模型照抄不闭合的示范就写坏了", () => {
    const prompt = build({ play: PLAY });
    const section = prompt.slice(prompt.indexOf("## 注释"), prompt.indexOf("## 结束轮（beat_done）"));
    const opens = section.match(/<comment>/g) ?? [];
    const closes = section.match(/<\/comment>/g) ?? [];
    expect(opens.length).toBeGreaterThan(0);
    expect(closes.length).toBe(opens.length);
  });

  it("工具契约只写在工具描述里，系统提示词不再复述一遍", () => {
    // 同一个规则写两遍，两处就会各自漂移——生图那几条已经漂移过一次了。
    const prompt = build({ play: PLAY, can: { image: true } });
    expect(prompt).not.toContain("<call:generate_image");
    expect(prompt).toContain("看 generate_image 的工具说明");
  });

  it("schema 统一后，剧作家的引入新角色章不再说它没有 expression 参数", () => {
    // generate_image 两个角色同一份 schema，这句话曾经是对的，现在是有害的假信息
    const prompt = build({ play: PLAY, can: { image: true } });
    expect(prompt).not.toContain("这个工具没有 expression 参数");
    expect(prompt).toContain("expression=\"neutral\"");
  });

  it("生图关掉时不出工具调用示范，只留一句降级说明", () => {
    const prompt = build({ play: PLAY, can: { image: false } });
    expect(prompt).toContain("本剧目没有开启生图");
    expect(prompt).not.toContain("generate_image(kind=\"background\"");
  });
});

describe("buildSystemPrompt：素材从哪来", () => {
  it("有资源库时讲清引用即导入这条契约（引擎事实，不是创作口径）", () => {
    const prompt = build({ play: PLAY, assets: { backgrounds: ["bg_dusk.jpg"] }, can: { library: true } });
    expect(prompt).toContain("宿主会自动去素材资源库");
    expect(prompt).toContain("不用你重写这一行");
    // 库里没有是静默降级——必须把「不会有人告诉你」写出来，否则它会换个 id 反复重试
    expect(prompt).toContain("不会有任何回执告诉你");
    expect(prompt).toContain("list_library");
  });

  it("没配库就不注这段——那条链路不存在，教它去查是教它对着空气找", () => {
    const prompt = build({ play: PLAY, assets: { backgrounds: ["bg_dusk.jpg"] }, can: { library: false } });
    expect(prompt).not.toContain("引用一个剧目里还没有的 id");
    expect(prompt).not.toContain("list_library");
  });

  it("素材清单全空时不再教「每写到一个新场景先生成一张背景」", () => {
    const prompt = build({ play: PLAY, assets: {}, can: { image: true, library: true } });
    expect(prompt).not.toContain("没有任何背景与插图");
    expect(prompt).not.toContain("先用 generate_image 排一张背景");
  });

  it("出图章节只讲工具与后果，不替所有剧目决定背景该怎么来", () => {
    const prompt = build({ play: PLAY, can: { image: true } });
    expect(prompt).toContain("哪些素材该出图、出哪几张，照剧目的创作口径");
    expect(prompt).not.toContain("缺素材时自己画");
  });
});
