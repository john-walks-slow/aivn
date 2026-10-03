import { describe, expect, it } from "vitest";
import { DEFAULT_CRAFT, parsePlayConfig, resolveCraft, type CharacterCard } from "../src/play/config.js";

const BASE = { id: "t", title: "T", characters: [] };

describe("parsePlayConfig（P4 增量字段归一化）", () => {
  it("语音语言缺省/空白不产生字段，非空保留", () => {
    expect(parsePlayConfig({ ...BASE, voiceLanguage: "  " }).voiceLanguage).toBeUndefined();
    expect(parsePlayConfig({ ...BASE, voiceLanguage: " ja " }).voiceLanguage).toBe("ja");
  });
});

describe("parsePlayConfig：立绘取景", () => {
  const card = (extra: Record<string, unknown>): CharacterCard =>
    parsePlayConfig({ ...BASE, characters: [{ id: "a", name: "A", persona: "", ...extra }] }).characters[0]!;

  it("存量角色卡不带取景：原样透传，演出层退回全身", () => {
    expect(card({}).framing).toBeUndefined();
    expect(card({}).spriteFraming).toBeUndefined();
    expect(card({ sprites: { smile: "a.png" } }).sprites).toEqual({ smile: "a.png" });
  });

  it("合法取景照留，非法值当没写", () => {
    expect(card({ framing: "half" }).framing).toBe("half");
    expect(card({ framing: "上半身" }).framing).toBeUndefined();
  });

  it("逐差分的取景逐条校验：坏的那条丢掉，别拖累同表里好的那条", () => {
    const c = card({ framing: "full", spriteFraming: { wow: "square", bad: "半身", "": "square" } });
    expect(c.framing).toBe("full");
    expect(c.spriteFraming).toEqual({ wow: "square" });
  });

  it("逐差分的 bust 也降级成 half（与条目级同规则）", () => {
    // 两条路径必须一致：同一份存量数据在角色卡上降级、在资源库上也降级。
    // 不一致的话用户看到的是「从库里导入后站位变了」，而两边代码都「正确」。
    const c = card({ framing: "full", spriteFraming: { wow: "bust" } });
    expect(c.spriteFraming).toEqual({ wow: "half" });
  });

  it("整张表都非法时整个字段消失，不留空对象", () => {
    expect("spriteFraming" in card({ spriteFraming: { bad: "半身" } })).toBe(false);
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
