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
    const c = card({ framing: "full", spriteFraming: { wow: "bust", bad: "半身", "": "bust" } });
    expect(c.framing).toBe("full");
    expect(c.spriteFraming).toEqual({ wow: "bust" });
  });

  it("整张表都非法时整个字段消失，不留空对象", () => {
    expect("spriteFraming" in card({ spriteFraming: { bad: "半身" } })).toBe(false);
  });
});
