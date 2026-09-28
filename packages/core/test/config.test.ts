import { describe, expect, it } from "vitest";
import { parsePlayConfig } from "../src/play/config.js";

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
