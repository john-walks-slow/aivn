import { describe, expect, it } from "vitest";
import { normalizeForTts } from "../src/speech/text.js";

describe("normalizeForTts", () => {
  it("百分比转读法", () => {
    expect(normalizeForTts("赢了50%")).toBe("赢了百分之50");
    expect(normalizeForTts("概率 3.5% 左右")).toBe("概率百分之3.5 左右");
  });

  it("温度符号", () => {
    expect(normalizeForTts("今天26℃")).toBe("今天26摄氏度");
  });

  it("ASCII 标点全角化 + 排版符号剔除", () => {
    expect(normalizeForTts("真的吗?不,不可能!")).toBe("真的吗？不，不可能！");
    expect(normalizeForTts("《**星空**》之下")).toBe("星空之下");
  });

  it("emoji 剔除与空白折叠（CJK 间空白整段去）", () => {
    expect(normalizeForTts("好耶✨  ✨！！")).toBe("好耶！！");
  });
});
