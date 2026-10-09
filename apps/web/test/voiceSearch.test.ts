import { describe, expect, it } from "vitest";
import { effectiveVoiceLanguage } from "../src/voice/useVoiceCatalog.js";

/**
 * 语言下拉的两种身份（这是「英文环境搜雷姆拿到 0 条」那个 bug 的落点）：
 * 系统语言只是浏览起点，有关键词时不许参与筛选；用户显式挑的语言才是真筛选。
 */
describe("effectiveVoiceLanguage", () => {
  it("没挑过语言、没关键词：落在系统语言（浏览起点）", () => {
    expect(effectiveVoiceLanguage({ picked: null, system: "zh", keyword: "" })).toBe("zh");
  });

  it("没挑过语言、有关键词：摘掉系统语言，走全库标题搜索", () => {
    expect(effectiveVoiceLanguage({ picked: null, system: "en", keyword: "雷姆" })).toBe("");
  });

  it("挑过语言：浏览与搜索都以用户的选择为准（与关键词 AND）", () => {
    expect(effectiveVoiceLanguage({ picked: "ja", system: "en", keyword: "" })).toBe("ja");
    expect(effectiveVoiceLanguage({ picked: "ja", system: "en", keyword: "雷姆" })).toBe("ja");
  });

  it("显式挑「全部语言」：清掉关键词也不弹回系统语言", () => {
    expect(effectiveVoiceLanguage({ picked: "", system: "en", keyword: "" })).toBe("");
  });

  it("系统语言不在基础目录里：不筛语言", () => {
    expect(effectiveVoiceLanguage({ picked: null, system: undefined, keyword: "" })).toBe("");
  });
});
