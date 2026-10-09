import { describe, expect, it } from "vitest";
import {
  countVoicesByLanguage,
  isVoiceId,
  languageLabel,
  VOICE_TAG_GROUPS,
  type VoiceEntry,
} from "../src/speech/voices.js";

function entry(id: string, languages: string[], likes = 0): VoiceEntry {
  return { id, title: id, description: "", languages, tags: [], likes, cover: "" };
}

describe("voiceId 校验", () => {
  it("32 位 hex 合法（Fish 目录外的老音色仍须放行，否则 demo 剧目直接失声）", () => {
    expect(isVoiceId("f82e3885ac22468eb6c773b96f2c5752")).toBe(true);
  });

  it("非 32 位 hex 拒绝", () => {
    expect(isVoiceId("")).toBe(false);
    expect(isVoiceId("萝莉萌妹")).toBe(false);
    expect(isVoiceId("f82e3885ac22468eb6c773b96f2c575")).toBe(false);
    expect(isVoiceId("F82E3885AC22468EB6C773B96F2C5752")).toBe(false);
  });
});

describe("语言显示名", () => {
  it("收录语言给中文名", () => {
    expect(languageLabel("zh")).toBe("中文");
    expect(languageLabel("sw")).toContain("斯瓦希里语");
  });

  it("未收录代码原样返回（小语种不能显示成空白）", () => {
    expect(languageLabel("xyz")).toBe("xyz");
  });
});

describe("常用标签词表（list_voices 描述照它教模型）", () => {
  it("分组齐、词不重（重复词会让描述教出两遍同一个 tag）", () => {
    const flat = VOICE_TAG_GROUPS.flatMap((group) => group.tags);
    expect(flat).toContain("anime");
    expect(new Set(flat).size).toBe(flat.length);
    expect(VOICE_TAG_GROUPS.every((group) => group.label !== "" && group.tags.length > 0)).toBe(true);
  });
});

describe("countVoicesByLanguage", () => {
  it("按音色出现次数降序，同数按代码排", () => {
    const counts = countVoicesByLanguage([
      entry("a", ["zh", "ja"]),
      entry("b", ["zh"]),
      entry("c", ["hi", "zh"]),
    ]);
    expect(counts).toEqual([
      { code: "zh", count: 3 },
      { code: "hi", count: 1 },
      { code: "ja", count: 1 },
    ]);
  });

  it("多语言音色在每个语言下各计一次（同一个音色的两种语言都能被筛到）", () => {
    expect(countVoicesByLanguage([entry("a", ["zh", "en"])]).map((c) => c.code)).toEqual(["en", "zh"]);
  });

  it("空目录返回空表（语言轨不渲染）", () => {
    expect(countVoicesByLanguage([])).toEqual([]);
  });
});
