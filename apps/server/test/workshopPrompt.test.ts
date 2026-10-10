import { describe, expect, it } from "vitest";
import { DEFAULT_CRAFT } from "@aivn/core";
import { buildWorkshopPrompt } from "../src/workshop.js";
import { readSkill } from "../src/skills.js";
import type { AgentCapabilities } from "../src/agentkit/kit.js";

/**
 * 工坊提示词的边界：工具知识归工具描述，提示词只留工作方法。
 *
 * 资源库那章曾经同时存在于 system prompt 与工具描述里——规则改一处、另一处就过期，
 * 出现过「剧作家 prompt 教一个它没有的工具」那一类漂移。这条用例盯住不再倒退。
 */

const CTX = {
  title: "T",
  files: "可写 plays/T/memory/always/craft.md (12B)",
  readiness: { ready: true, missing: [] } as never,
  craft: DEFAULT_CRAFT,
};

/** 工坊的常见态：文件、故事树、技能库、看图、就绪门都开，命令行与剧作家那几位不适用。 */
const caps = (over: Partial<AgentCapabilities> = {}): AgentCapabilities => ({
  stage: false,
  nsfw: false,
  characters: false,
  memory: false,
  voice: false,
  shell: false,
  image: true,
  search: true,
  library: true,
  files: true,
  skill: true,
  view: true,
  readiness: true,
  ...over,
});

describe("工坊提示词：工具知识不在这里重复", () => {
  it("资源库用法只由工具描述承担（清单 / 导入怎么调都不在提示词里）", async () => {
    const prompt = await buildWorkshopPrompt({ ...CTX, can: caps() });
    // 「先查资源库」是工作方法，留着；条目怎么解释、角色包怎么处理，归工具描述
    expect(prompt).not.toContain("# 素材资源库");
    expect(prompt).not.toContain("库和剧目各存一份");
    expect(prompt).toContain("先查资源库");
  });

  it("库不可用时连「先查资源库」也不提——那两个工具压根没注册", async () => {
    const prompt = await buildWorkshopPrompt({ ...CTX, can: caps({ library: false }) });
    expect(prompt).not.toContain("list_library");
    expect(prompt).not.toContain("library_import");
  });

  it("生图不可用时换一句降级说明，不教它调工具", async () => {
    const prompt = await buildWorkshopPrompt({ ...CTX, can: caps({ image: false }) });
    expect(prompt).toContain("生图当前不可用");
    expect(prompt).not.toContain("画幅不对会直接作废");
  });
});

describe("工坊提示词：写作参数这一维的写法指导", () => {
  it("现值摆在提示词里，并明确「这些改 play.json，不写进 craft.md」", async () => {
    const prompt = await buildWorkshopPrompt({ ...CTX, can: caps() });
    expect(prompt).toContain("写作参数");
    expect(prompt).toContain("用 `edit` 定点改");
    expect(prompt).toContain("validate_play");
    expect(prompt).toContain("每轮篇幅：中等");
    expect(prompt).toContain("素材来源：背景 资源库优先");
    expect(prompt).toContain("文风与禁忌");
  });

  it("生图能力关掉：出图那一章换成降级说明，不再教 neutral 定妆照那套", async () => {
    const prompt = await buildWorkshopPrompt({ ...CTX, can: caps({ image: false }) });
    expect(prompt).toContain("生图当前不可用");
    expect(prompt).not.toContain("先出 neutral 定妆照");
  });

  it("没有库就不教 list_library（那条链路不存在）", async () => {
    const prompt = await buildWorkshopPrompt({ ...CTX, can: caps({ library: false }) });
    expect(prompt).not.toContain("list_library");
  });
});

describe("工坊提示词：play.json 的字段面", () => {
  it("提示词只留指针，字段表（含会被静默降级的字段）在 skill 里", async () => {
    const prompt = await buildWorkshopPrompt({ ...CTX, can: caps(), voiceLanguage: "ja" });
    expect(prompt).toContain("play.json");
    // 字段表已下沉到 skill：提示词钉指针，「全文还在」由下面那条配对用例守。
    // （只删不补 = 把「挪层」写成「删除」，正是 8a08d4fc 漏改这条用例时留下的坑。）
    expect(prompt).toContain("galgame-play-setup");
    expect(prompt).not.toContain("defaultVoiceId");
    // 「改既有文件用 edit 定点改」这条规矩仍在提示词正文里
    expect(prompt).toContain("别整篇 `write` 覆盖");
  });

  it("下沉的那份 skill 真能被读到，字段面的关键语义一条不少", async () => {
    const skill = await readSkill("galgame-play-setup");
    for (const wanted of ["defaultVoiceId", "voiceLanguage", "静默消失", "不要整篇 `write` 覆盖"]) {
      expect(skill.content).toContain(wanted);
    }
  });
});

describe("工坊提示词：能力关掉之后不再教它调那个工具", () => {
  it("「改剧目文件」关：写口那一整套（对话风格 / play.json 字段表 / 写作参数）收走", async () => {
    const prompt = await buildWorkshopPrompt({ ...CTX, can: caps({ files: false }) });
    // 讲的全是「怎么改文件」的章节整章收走
    expect(prompt).not.toContain("# 对话风格");
    expect(prompt).not.toContain("用 `edit` 定点改");
    expect(prompt).not.toContain("defaultVoiceId");
    expect(prompt).not.toContain("assets/manifest.json");
    // 产出物与落盘方式换成清单式：要改就交给用户
    expect(prompt).toContain("这条路上没有给你写口");
    expect(prompt).toContain("**本剧目没给你写口**");
    expect(prompt).toContain("清单交给用户");
    expect(prompt).toContain("不许说\"已写入\"");
    // 出图那部分不受影响
    expect(prompt).toContain("先出 neutral 定妆照");
  });

  it("读树那一章教的是读取单树文件，不提供写树工具", async () => {
    const prompt = await buildWorkshopPrompt({ ...CTX, can: caps({}) });
    expect(prompt).not.toContain("list_saves");
    expect(prompt).not.toContain("read_lineage");
    expect(prompt).toContain("lineage.jsonl");
    expect(prompt).toContain("parentId");
  });

  it("「技能库」关：技能清单块整块不注入（清单里点名了 read_skill）", async () => {
    const on = await buildWorkshopPrompt({ ...CTX, can: caps({ skill: true }) });
    const off = await buildWorkshopPrompt({ ...CTX, can: caps({ skill: false }) });
    expect(on).toContain("galgame-visual-craft");
    expect(off).not.toContain("galgame-visual-craft");
    expect(off).not.toContain("read_skill");
  });
});
