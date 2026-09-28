import { describe, expect, it, vi } from "vitest";
import { PhraseChunker, normalizeForTts, speechLength } from "../src/speech/chunker.js";

/** 每个用例一个 collector：phrases 收集 + 单一 chunker 实例（可重入 push/flush）。 */
function collector(opts: { maxChars?: number; idleFlushMs?: number } = {}) {
  const phrases: string[] = [];
  const chunker = new PhraseChunker({ onPhrase: (p) => phrases.push(p), ...opts });
  return { phrases, chunker };
}

describe("speechLength", () => {
  it("CJK 计 1，连续拉丁串按词计", () => {
    expect(speechLength("你好世界")).toBe(4);
    expect(speechLength("hello world")).toBe(2);
    expect(speechLength("2024年")).toBe(2);
  });
});

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

describe("PhraseChunker", () => {
  it("强终止标点绝对切分", () => {
    const { phrases, chunker } = collector();
    chunker.push("你好。天气真好！是吧？");
    expect(phrases).toEqual(["你好。", "天气真好！", "是吧？"]);
  });

  it("省略号整组终止（不拆成多个切点）", () => {
    const { phrases, chunker } = collector();
    chunker.push("我……还以为……");
    expect(phrases).toEqual(["我……", "还以为……"]);
  });

  it("换行视为终止", () => {
    const { phrases, chunker } = collector();
    chunker.push("第一行\n第二行");
    chunker.flush();
    expect(phrases).toEqual(["第一行。", "第二行"]);
  });

  it("长句在次级标点处累计超阈值切分", () => {
    const { phrases, chunker } = collector({ maxChars: 30 });
    // 36 字无强终止：前两个逗号点累计不足 30 不切，第三个逗号点超阈值 → 切
    chunker.push("一二三四五六七八九十，一二三四五六七八九十一二，三四五六七八九，结尾");
    chunker.flush();
    expect(phrases).toEqual(["一二三四五六七八九十，一二三四五六七八九十一二，三四五六七八九，", "结尾"]);
  });

  it("阈值未满的次级标点不切", () => {
    const { phrases, chunker } = collector();
    chunker.push("短句，不切，直到结束。");
    expect(phrases).toEqual(["短句，不切，直到结束。"]);
  });

  it("flush 冲刷无尾标点的残余", () => {
    const { phrases, chunker } = collector();
    chunker.push("句子没有结束标点");
    expect(phrases).toEqual([]);
    chunker.flush();
    expect(phrases).toEqual(["句子没有结束标点"]);
  });

  it("分句边界跨 delta：终止标点后重新累计", () => {
    const { phrases, chunker } = collector();
    chunker.push("第一句。");
    chunker.push("第二");
    chunker.push("句！");
    expect(phrases).toEqual(["第一句。", "第二句！"]);
  });

  it("非终止点停顿超 700ms 强制冲刷（fake timers）", () => {
    vi.useFakeTimers();
    try {
      const { phrases, chunker } = collector();
      chunker.push("话说到一半");
      expect(phrases).toEqual([]);
      vi.advanceTimersByTime(701);
      expect(phrases).toEqual(["话说到一半"]);
      // 冲刷后继续喂入：新缓冲正常累计
      chunker.push("然后说完。");
      expect(phrases).toEqual(["话说到一半", "然后说完。"]);
    } finally {
      vi.useRealTimers();
    }
  });

  it("强终止点不受空闲冲刷影响（已完整产出）", () => {
    vi.useFakeTimers();
    try {
      const { phrases, chunker } = collector();
      chunker.push("完整句。");
      chunker.push("悬空半句");
      vi.advanceTimersByTime(701);
      expect(phrases).toEqual(["完整句。", "悬空半句"]);
    } finally {
      vi.useRealTimers();
    }
  });

  it("纯标点短语丢弃（句首省略号停顿不烧 TTS）", () => {
    const { phrases, chunker } = collector();
    chunker.push("……太慢了！");
    expect(phrases).toEqual(["太慢了！"]);
  });

  it("产出前经过 TTS 正则化", () => {
    const { phrases, chunker } = collector();
    chunker.push("胜率50%！冲吧*少年*！");
    expect(phrases).toEqual(["胜率百分之50！", "冲吧少年！"]);
  });

  it("reset 丢弃缓冲与计时器", () => {
    vi.useFakeTimers();
    try {
      const { phrases, chunker } = collector();
      chunker.push("将被丢弃的半句");
      chunker.reset();
      vi.advanceTimersByTime(5000);
      expect(phrases).toEqual([]);
    } finally {
      vi.useRealTimers();
    }
  });
});
