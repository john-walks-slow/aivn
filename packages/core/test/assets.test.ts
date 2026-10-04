import { describe, expect, it } from "vitest";
import {
  describeAsset,
  libraryEntryMatches,
  parseAssetMeta,
  parsePlayAssetManifest,
  spriteDeclarationOf,
  spriteTitlesOf,
  StageDslParser,
  type StageEvent,
  type LibraryEntry,
} from "../src/index.js";

/**
 * 素材元数据 + scene 音量的新增量：
 * 解析器对白名单属性是「加不改」的，音量的三态与数值钳位得单钉住。
 */

function parseOne(text: string): { events: StageEvent[]; warnings: string[] } {
  const events: StageEvent[] = [];
  const parser = new StageDslParser((event) => events.push(event));
  parser.feed(text);
  return { events, warnings: parser.warnings.map((w) => w.detail) };
}

describe("parseAssetMeta：库里人手写的 meta.json", () => {
  it("坏字段丢掉、好字段照留", () => {
    const meta = parseAssetMeta({
      title: "  黄昏教室  ",
      description: "",
      tags: ["室内", "", 42, "黄昏"],
      mood: "忧伤",
      durationSec: 92.4,
      loop: "yes",
      volume: 3,
      character: { name: "澪", persona: "  ", voiceId: 7 },
    });
    expect(meta.title).toBe("黄昏教室");
    expect(meta.description).toBeUndefined();
    expect(meta.tags).toEqual(["室内", "黄昏"]);
    expect(meta.mood).toBeUndefined();
    expect(meta.durationSec).toBe(92);
    expect(meta.loop).toBeUndefined();
    expect(meta.volume).toBe(1);
    expect(meta.character).toEqual({ name: "澪" });
  });

  it("一份脏数据不能拖垮整库：非对象与空数组都退回空元数据", () => {
    expect(parseAssetMeta(null)).toEqual({});
    expect(parseAssetMeta([1, 2])).toEqual({});
    expect(parseAssetMeta({ variants: { a: { file: "" } } }).variants).toBeUndefined();
  });

  it("取景：只认三档，人手写错的值当没写（退回全身由演出层负责）", () => {
    expect(parseAssetMeta({ framing: "half" }).framing).toBe("half");
    expect(parseAssetMeta({ framing: "square" }).framing).toBe("square");
    expect(parseAssetMeta({ framing: "full" }).framing).toBe("full");
    expect(parseAssetMeta({ framing: "半身" }).framing).toBeUndefined();
    expect(parseAssetMeta({ framing: "FULL" }).framing).toBeUndefined();
    expect(parseAssetMeta({ framing: 1 }).framing).toBeUndefined();
    expect(parseAssetMeta({}).framing).toBeUndefined();
  });

  it("取景：已下线的 bust 降级成 half，而不是当坏值丢掉", () => {
    // 存量 meta.json 里真可能写着 bust（它曾经是合法档）。丢掉它 = 这张胸像图
    // 被当成「没声明取景」，舞台按全身摆位画出来，人物大小错一整个量级。
    expect(parseAssetMeta({ framing: "bust" }).framing).toBe("half");
  });

  it("取景：差分可以覆盖条目级声明，写错的那条丢掉、好的那条照留", () => {
    const meta = parseAssetMeta({
      framing: "full",
      variants: {
        smile: { file: "a.png", framing: "square" },
        angry: { file: "b.png", framing: "上半身" },
        cry: { file: "c.png", description: "哭" },
      },
    });
    expect(meta.framing).toBe("full");
    expect(meta.variants).toEqual({
      smile: { file: "a.png", framing: "square" },
      angry: { file: "b.png" },
      cry: { file: "c.png", description: "哭" },
    });
  });

  it("旧键 expressions 照旧读成 variants：库里的 meta.json 是手写的，改名不该让差分表消失", () => {
    const meta = parseAssetMeta({ expressions: { smile: { file: "a.png" } } });
    expect(meta.variants).toEqual({ smile: { file: "a.png" } });
  });

  it("体量与对齐：只认表里的值，写别的当没写", () => {
    expect(parseAssetMeta({ stature: "huge" }).stature).toBe("huge");
    expect(parseAssetMeta({ stature: "巨大" }).stature).toBeUndefined();
    expect(parseAssetMeta({ anchor: "bottom" }).anchor).toBe("bottom");
    expect(parseAssetMeta({ anchor: "下" }).anchor).toBeUndefined();
  });
});

describe("parsePlayAssetManifest：新旧两种素材表都收", () => {
  it("旧格式字符串等价于只有 description 的元数据", () => {
    expect(parsePlayAssetManifest({ bg_a: "黄昏教室", bg_b: "  ", bad: 42 })).toEqual({
      bg_a: { description: "黄昏教室" },
    });
  });

  it("空键、空表、非对象一律空表", () => {
    expect(parsePlayAssetManifest(null)).toEqual({});
    expect(parsePlayAssetManifest([1])).toEqual({});
    expect(parsePlayAssetManifest({ "  ": "x" })).toEqual({});
  });
});

describe("spriteDeclarationOf：一个主体的呈现声明", () => {
  const manifest = parsePlayAssetManifest({
    mecha: { framing: "full", stature: "huge", anchor: "center", title: "试作机" },
    "mecha/closeup": { framing: "half" },
    cat: { framing: "square", stature: "small" },
  });

  it("立绘级打底：三轴与名牌一起读出来", () => {
    expect(spriteDeclarationOf(manifest, "mecha")).toEqual({
      framing: "full",
      stature: "huge",
      anchor: "center",
      title: "试作机",
    });
  });

  it("差分级只覆盖它自己写了的那几格，没写的仍听立绘级", () => {
    expect(spriteDeclarationOf(manifest, "mecha", "closeup")).toEqual({
      framing: "half",
      stature: "huge",
      anchor: "center",
      title: "试作机",
    });
    // 差分没声明过：整份就是立绘级那份
    expect(spriteDeclarationOf(manifest, "mecha", "angry")).toMatchObject({ framing: "full" });
  });

  it("没声明过的主体与没写 variant 时都是空对象——缺省值由调用方落，不在这里编", () => {
    expect(spriteDeclarationOf(manifest, "ghost")).toEqual({});
    expect(spriteDeclarationOf(manifest, "ghost", "smile")).toEqual({});
    expect(spriteDeclarationOf(manifest, "mecha", "")).toEqual(spriteDeclarationOf(manifest, "mecha"));
    expect(spriteDeclarationOf({}, "mecha")).toEqual({});
  });

  it("没有卡的主体也有声明：猫按方形小体量站", () => {
    expect(spriteDeclarationOf(manifest, "cat")).toEqual({ framing: "square", stature: "small" });
  });
});

describe("spriteTitlesOf：无卡主体的名牌表", () => {
  it("只收立绘级（键不带斜杠）的 title——差分自己的名字不是主体名", () => {
    const manifest = parsePlayAssetManifest({
      mecha: { title: "试作机" },
      "mecha/closeup": { title: "近景" },
      bg_hall: { title: "礼堂" },
      空名牌: { title: "   " },
      cat: { framing: "square" },
    });
    expect(spriteTitlesOf(manifest)).toEqual({ mecha: "试作机", bg_hall: "礼堂" });
  });
});

describe("describeAsset：剧作家看到的那一行", () => {
  it("音乐条目把情绪、时长、可循环一起摆出来", () => {
    expect(
      describeAsset({ description: "钢琴小品", mood: ["忧伤", "温柔"], durationSec: 92, loop: true, volume: 0.3 }),
    ).toBe("钢琴小品｜情绪：忧伤、温柔｜约 92 秒｜可循环｜建议音量 0.3");
  });

  it("音量 1 与空白描述都不占位", () => {
    expect(describeAsset({ description: "  ", volume: 1 })).toBe("");
    expect(describeAsset({})).toBe("");
  });
});

describe("libraryEntryMatches：资源库搜索", () => {
  const entry = {
    kind: "bgm",
    id: "twilight",
    title: "黄昏",
    description: "钢琴小品",
    meta: { mood: ["忧伤"], tags: ["钢琴"] },
    files: [],
    size: 0,
  } as unknown as LibraryEntry;

  it("匹配 id / 标题 / 描述 / 标签 / 情绪 / 场景，空查询全中", () => {
    expect(libraryEntryMatches(entry, "Twilight")).toBe(true);
    expect(libraryEntryMatches(entry, "钢琴")).toBe(true);
    expect(libraryEntryMatches(entry, "忧伤")).toBe(true);
    expect(libraryEntryMatches(entry, "")).toBe(true);
    expect(libraryEntryMatches(entry, "明快")).toBe(false);
  });
});

describe("scene 音量的新增属性（DSL 加属性不改冻结契约）", () => {
  it("bgm_volume / ambient_volume 解析为数字", () => {
    const { events } = parseOne('<scene bg="a" bgm="b" ambient="c" bgm_volume="0.4" ambient_volume="0.25"/>');
    expect(events[0]).toEqual({
      kind: "scene",
      bg: "a",
      bgm: "b",
      ambient: "c",
      bgm_volume: 0.4,
      ambient_volume: 0.25,
    });
  });

  it("缺省即缺省：不补默认值（保持当前由客户端语义负责）", () => {
    const { events } = parseOne('<scene bg="a"/>');
    expect(events[0]).toEqual({ kind: "scene", bg: "a" });
  });

  it("非数字只丢该属性并告警，不连坐整条 scene", () => {
    const { events, warnings } = parseOne('<scene bg="a" bgm_volume="轻一点" ambient_volume="0.3"/>');
    expect(events[0]).toEqual({ kind: "scene", bg: "a", ambient_volume: 0.3 });
    expect(warnings.join()).toContain("bgm_volume");
  });

  it("音量钳在 0–1：越界的值不报错，收到边界", () => {
    expect(parseOne('<scene bgm_volume="5"/>').events[0]).toEqual({ kind: "scene", bgm_volume: 1 });
    expect(parseOne('<scene ambient_volume="-1"/>').events[0]).toEqual({ kind: "scene", ambient_volume: 0 });
  });

  it("bgm=\"none\" 解析为原值，停止语义由客户端判定", () => {
    expect(parseOne('<scene bgm="none"/>').events[0]).toEqual({ kind: "scene", bgm: "none" });
  });
});
