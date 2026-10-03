import { describe, expect, it } from "vitest";
import { parsePlayConfig, type CharacterCard } from "../src/play/config.js";

const BASE = { id: "t", title: "T", characters: [] };

describe("parsePlayConfig（P4 增量字段归一化）", () => {
  it("主角卡空白字段归一为 undefined（通用润色模式）", () => {
    const play = parsePlayConfig({ ...BASE, protagonist: { name: "  ", persona: "" } });
    expect(play.protagonist).toBeUndefined();
  });

  it("主角卡保留并去除首尾空白", () => {
    const play = parsePlayConfig({ ...BASE, protagonist: { name: " 你 ", persona: " 转学生 " } });
    expect(play.protagonist).toEqual({ name: "你", persona: "转学生" });
  });

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
