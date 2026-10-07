import { describe, expect, it } from "vitest";
import { DEFAULT_CRAFT, parsePlayConfig, resolveCraft } from "../src/play/config.js";

const BASE = { id: "t", title: "T", characters: [] };

describe("parsePlayConfig（P4 增量字段归一化）", () => {
  it("语音语言缺省/空白不产生字段，非空保留", () => {
    expect(parsePlayConfig({ ...BASE, voiceLanguage: "  " }).voiceLanguage).toBeUndefined();
    expect(parsePlayConfig({ ...BASE, voiceLanguage: " ja " }).voiceLanguage).toBe("ja");
  });
});

describe("parsePlayConfig：多周目开关 newGamePlus", () => {
  it("只认严格的 true；缺省 / 其它值一律当没开（不留空壳）", () => {
    expect(parsePlayConfig({ ...BASE }).newGamePlus).toBeUndefined();
    expect(parsePlayConfig({ ...BASE, newGamePlus: true }).newGamePlus).toBe(true);
    expect(parsePlayConfig({ ...BASE, newGamePlus: false }).newGamePlus).toBeUndefined();
    expect(parsePlayConfig({ ...BASE, newGamePlus: "true" }).newGamePlus).toBeUndefined();
    expect(parsePlayConfig({ ...BASE, newGamePlus: 1 }).newGamePlus).toBeUndefined();
  });
});

describe("parsePlayConfig：agents 段的补充提示词", () => {
  const withPrompt = (role: "playwriter" | "workshop", prompt: string): unknown =>
    parsePlayConfig({ ...BASE, agents: { [role]: { prompt } } }).agents?.[role]?.prompt;

  it("工坊保留原文（逐剧目追加段，不做 trim 改写）", () => {
    expect(withPrompt("workshop", " 这部作品不说日语。 ")).toBe(" 这部作品不说日语。 ");
  });

  it("纯空白当没写，不留空壳", () => {
    expect(withPrompt("workshop", "  \n ")).toBeUndefined();
  });

  it("剧作家的那份直接丢：它没人读，留着只会让人以为生效了", () => {
    expect(withPrompt("playwriter", "每轮写短点")).toBeUndefined();
  });
});

describe("parsePlayConfig：agents 段的能力启用集", () => {
  const caps = (capabilities: unknown): unknown =>
    parsePlayConfig({ ...BASE, agents: { playwriter: { capabilities } } }).agents?.playwriter?.capabilities;

  it("去空白、去重，顺序照用户写的（顺序不影响装配，但别把文件改样）", () => {
    expect(caps([" memory ", "image", "memory", "  ", "library"])).toEqual([
      "memory",
      "image",
      "library",
    ]);
  });

  it("空数组是显式选择，保留下来（= 只剩常开，与「没写、走默认集」不同义）", () => {
    expect(caps([])).toEqual([]);
    expect(parsePlayConfig({ ...BASE, agents: { playwriter: {} } }).agents?.playwriter).toBeUndefined();
  });

  it("不是数组 / 全是空白：当没写，不留空壳", () => {
    expect(caps("memory")).toBeUndefined();
    expect(caps(["  ", 3, null])).toEqual([]);
    expect(
      parsePlayConfig({ ...BASE, agents: { workshop: { capabilities: "files" } } }).agents?.workshop,
    ).toBeUndefined();
  });

  it("认不认得出这些 id 是能力目录的事：这一层不校验，拼错的也照留", () => {
    expect(caps(["charactor"])).toEqual(["charactor"]);
  });
});

describe("parsePlayConfig：写作参数（craft）与逐剧目生图（image）", () => {
  it("craft 逐字段白名单：拼错的值当没写，不拖累同一段里合法的那些", () => {
    const play = parsePlayConfig({
      ...BASE,
      craft: { beatLength: "mediumm", stopOptions: "two", assets: { background: "library-first", cg: "生成" } },
    });
    expect(play.craft).toEqual({ stopOptions: "two", assets: { background: "library-first" } });
  });

  it("整段都没剩下东西时不留空壳（read 回去看到的是「没写」）", () => {
    expect(parsePlayConfig({ ...BASE, craft: { beatLength: "nope" } }).craft).toBeUndefined();
    expect(parsePlayConfig({ ...BASE, craft: { assets: {} } }).craft).toBeUndefined();
    expect(parsePlayConfig({ ...BASE, craft: "medium" }).craft).toBeUndefined();
  });

  it("image 只做非空字符串这一层，档位的合法性留给生图层", () => {
    const play = parsePlayConfig({ ...BASE, image: { model: " gemini-3.1-flash-image ", size: " 2K ", } });
    expect(play.image).toEqual({ model: "gemini-3.1-flash-image", size: "2K" });
    expect(parsePlayConfig({ ...BASE, image: { model: "  ", size: "" } }).image).toBeUndefined();
  });

  it("scriptLanguage 与 voiceLanguage 同一套规矩：空白当没写", () => {
    expect(parsePlayConfig({ ...BASE, scriptLanguage: "  " }).scriptLanguage).toBeUndefined();
    expect(parsePlayConfig({ ...BASE, scriptLanguage: " ja " }).scriptLanguage).toBe("ja");
  });

  it("出图审批只认 ask / auto，且只留在工坊那张卡上", () => {
    const workshop = (imageApproval: unknown): unknown =>
      parsePlayConfig({ ...BASE, agents: { workshop: { imageApproval } } }).agents?.workshop?.imageApproval;
    expect(workshop("auto")).toBe("auto");
    expect(workshop("ask")).toBe("ask");
    expect(workshop("直接出")).toBeUndefined();
    expect(
      parsePlayConfig({ ...BASE, agents: { playwriter: { imageApproval: "auto" } } }).agents?.playwriter,
    ).toBeUndefined();
  });
});

describe("resolveCraft：与默认值合成", () => {
  it("什么都不给 = 引擎默认口径", () => {
    expect(resolveCraft(undefined)).toEqual(DEFAULT_CRAFT);
  });

  it("逐字段合成：给一个不动其它，assets 逐类合成", () => {
    expect(resolveCraft({ beatLength: "long", assets: { cg: "off" } })).toEqual({
      beatLength: "long",
      stopOptions: DEFAULT_CRAFT.stopOptions,
      assets: { ...DEFAULT_CRAFT.assets, cg: "off" },
    });
  });

  it("合成的结果不与默认对象共享引用（调用方就地改它会污染全局默认）", () => {
    const resolved = resolveCraft(undefined);
    resolved.assets.background = "generate";
    expect(DEFAULT_CRAFT.assets.background).toBe("library-first");
  });
});
