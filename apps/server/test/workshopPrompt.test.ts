import { describe, expect, it } from "vitest";
import { buildWorkshopPrompt } from "../src/workshop.js";

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

describe("工坊提示词：工具知识不在这里重复", () => {
  it("资源库用法只由 list_library / import_asset 的描述承担", async () => {
    const prompt = await buildWorkshopPrompt({ ...CTX, canGenerate: true, canSearch: true, canBrowseLibrary: true });
    // 「先查资源库」是工作方法，留着；条目怎么解释、角色包怎么处理，归工具描述
    expect(prompt).not.toContain("# 素材资源库");
    expect(prompt).not.toContain("库和剧目各存一份");
    expect(prompt).toContain("先查资源库");
  });

  it("库不可用时连「先查资源库」也不提——那两个工具压根没注册", async () => {
    const prompt = await buildWorkshopPrompt({ ...CTX, canGenerate: true, canSearch: true, canBrowseLibrary: false });
    expect(prompt).not.toContain("list_library");
    expect(prompt).not.toContain("import_asset");
  });

  it("生图不可用时换一句降级说明，不教它调工具", async () => {
    const prompt = await buildWorkshopPrompt({ ...CTX, canGenerate: false, canSearch: true, canBrowseLibrary: true });
    expect(prompt).toContain("生图当前不可用");
    expect(prompt).not.toContain("画幅不对会直接作废");
  });
});
