import { describe, expect, it } from "vitest";
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
};

const caps = (over: Partial<AgentCapabilities> = {}): AgentCapabilities => ({
  image: true,
  search: true,
  library: true,
  voice: false,
  shell: false,
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

describe("工坊提示词：素材来源这一维的写法指导", () => {
  it("能力齐全时三类素材各给一条来路，并指向 craft.md", async () => {
    const prompt = await buildWorkshopPrompt({ ...CTX, can: caps() });
    expect(prompt).toContain("素材来源");
    expect(prompt).toContain("referenceCharacters");
    expect(prompt).toContain("先出 neutral 定妆照");
    expect(prompt).toContain("从资源库里找");
    // 这一维由剧目的创作口径承载，提示词只教怎么写，不自己定规矩
    expect(prompt).toContain("craft.md");
  });

  it("没有库就不教 list_library（那条链路不存在），改说只用清单里已有的", async () => {
    const prompt = await buildWorkshopPrompt({ ...CTX, can: caps({ library: false }) });
    expect(prompt).not.toContain("list_library");
    expect(prompt).toContain("只用素材清单里已有的那些");
  });

  it("没有生图就不教那套出图做法", async () => {
    const prompt = await buildWorkshopPrompt({ ...CTX, can: caps({ image: false }) });
    // 只盯素材来源这一行：职责边界里「出图必须真的调用 generate_image」是既有文案，与能力位无关
    const line = prompt.split("\n").find((l) => l.startsWith("- 素材来源"))!;
    expect(line).toContain("生图当前不可用");
    expect(line).not.toContain("referenceCharacters");
    expect(line).not.toContain("neutral 定妆照");
  });
});
