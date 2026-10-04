import { describe, expect, it } from "vitest";
import { DEFAULT_CRAFT } from "@aivn/core";
import { buildWorkshopPrompt } from "../src/workshop.js";
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

const caps = (over: Partial<AgentCapabilities> = {}): AgentCapabilities => ({
  image: true,
  search: true,
  library: true,
  voice: false,
  shell: false,
  nsfw: true,
  ...over,
});

describe("工坊提示词：工具知识不在这里重复", () => {
  it("资源库用法只由 list_library / import_asset 的描述承担", async () => {
    const prompt = await buildWorkshopPrompt({ ...CTX, can: caps() });
    // 「先查资源库」是工作方法，留着；条目怎么解释、角色包怎么处理，归工具描述
    expect(prompt).not.toContain("# 素材资源库");
    expect(prompt).not.toContain("库和剧目各存一份");
    expect(prompt).toContain("先查资源库");
  });

  it("库不可用时连「先查资源库」也不提——那两个工具压根没注册", async () => {
    const prompt = await buildWorkshopPrompt({ ...CTX, can: caps({ library: false }) });
    expect(prompt).not.toContain("list_library");
    expect(prompt).not.toContain("import_asset");
  });

  it("生图不可用时换一句降级说明，不教它调工具", async () => {
    const prompt = await buildWorkshopPrompt({ ...CTX, can: caps({ image: false }) });
    expect(prompt).toContain("生图当前不可用");
    expect(prompt).not.toContain("画幅不对会直接作废");
  });
});

describe("工坊提示词：写作参数这一维的写法指导", () => {
  it("现值摆在提示词里，并明确「这些走 set_craft，不写进 craft.md」", async () => {
    const prompt = await buildWorkshopPrompt({ ...CTX, can: caps() });
    expect(prompt).toContain("写作参数");
    expect(prompt).toContain("set_craft");
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
  it("列出会被静默降级的字段，并要求定点改而不是整篇覆盖", async () => {
    const prompt = await buildWorkshopPrompt({ ...CTX, can: caps(), voiceLanguage: "ja" });
    expect(prompt).toContain("play.json");
    expect(prompt).toContain("defaultVoiceId");
    expect(prompt).toContain("voiceLanguage");
    expect(prompt).toContain("不要整篇 `write` 覆盖");
    // 缺省字段不在文件里，read 也读不出来——代价得写在提示词里
    expect(prompt).toContain("静默消失");
  });
});
