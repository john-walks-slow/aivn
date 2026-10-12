import { describe, expect, it } from "vitest";
import { normalizeForTts, stripToneTags } from "../src/speech/text.js";

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

describe("stripToneTags（语气标记只上配音、不上屏）", () => {
  it("剥掉行首、句中、连续多个标记，其余文本一字不动", () => {
    expect(stripToneTags("[whispering] 别出声，他在隔壁。")).toBe(" 别出声，他在隔壁。");
    expect(stripToneTags("我才不信。[gasp] 你居然真的做了。[laughing]")).toBe("我才不信。 你居然真的做了。");
    expect(stripToneTags("[soft voice][sigh] 算了。")).toBe(" 算了。");
  });

  it("描述性长标记也认（开放域，不查词表）", () => {
    expect(stripToneTags("[voice breaking, barely holding it together] 我没事。")).toBe(" 我没事。");
  });

  it("流式半路还没等到 ] 的那一截也不给玩家看", () => {
    expect(stripToneTags("别出声[whi")).toBe("别出声");
    expect(stripToneTags("[whispering")).toBe("");
  });

  it("没有标记就原样返回；超过长度的方括号不当标记（可能是台词里的引用）", () => {
    expect(stripToneTags("普通的一句台词。")).toBe("普通的一句台词。");
    expect(stripToneTags("【这是中文括号】不是标记。")).toBe("【这是中文括号】不是标记。");
    const long = `[${"x".repeat(81)}]`;
    expect(stripToneTags(long)).toBe(long);
  });
});
