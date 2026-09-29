import { describe, expect, it } from "vitest";
import type { StageEvent } from "../src/index.js";
import { StageDslParser } from "../src/index.js";

function collect(): { events: StageEvent[]; parser: StageDslParser } {
  const events: StageEvent[] = [];
  const parser = new StageDslParser((event) => events.push(event));
  return { events, parser };
}

function feedTorn(parser: StageDslParser, text: string, chunkSize: number): void {
  for (let i = 0; i < text.length; i += chunkSize) {
    parser.feed(text.slice(i, i + chunkSize));
  }
}

/** 聚合连续同类 text delta——撕裂只影响 delta 切分粒度，不影响语义事件序列。 */
function mergeDeltas(events: StageEvent[]): StageEvent[] {
  const merged: StageEvent[] = [];
  for (const event of events) {
    const prev = merged.at(-1);
    if (
      (event.kind === "say_text" || event.kind === "narrate_text" || event.kind === "thought_text") &&
      prev !== undefined &&
      prev.kind === event.kind
    ) {
      (prev as { delta: string }).delta += (event as unknown as { delta: string }).delta;
    } else {
      merged.push({ ...event });
    }
  }
  return merged;
}

/** 聚合某类 text 事件的完整文本。 */
function fullText(events: StageEvent[], kind: "say_text" | "narrate_text" | "thought_text"): string {
  return mergeDeltas(events)
    .filter((e) => e.kind === kind)
    .map((e) => (e as { delta: string }).delta)
    .join("");
}

const SAMPLE_BEAT = [
  '<scene bg="school_hallway" bgm="melancholy_piano" transition="fade"/>',
  '<actor id="mio" pos="center" expression="pout" action="enter"/>',
  "<narrate>放学后的走廊空无一人，夕阳把课桌的影子拉得很长。</narrate>",
  '<say id="mio" mood="annoyed">……太慢了！不是约好立刻集合的吗？</say>',
  '<preload_asset type="cg" prompt="two students on rooftop at sunset" id="cg_rooftop_01"/>',
  '<cg id="cg_rooftop_01" caption="黄昏的天台"/>',
  '<sfx src="wind" volume="0.3"/>',
  '<thought id="mio">（这家伙，到底在想什么呢……）</thought>',
].join("\n");

describe("完整节拍", () => {
  it("整段一次喂入，产出有序事件流", () => {
    const { events, parser } = collect();
    parser.feed(SAMPLE_BEAT);
    parser.endMessage();

    expect(events.map((e) => e.kind)).toEqual([
      "scene",
      "actor",
      "narrate_start",
      "narrate_text",
      "narrate_end",
      "say_start",
      "say_text",
      "say_end",
      "preload_asset",
      "cg",
      "sfx",
      "thought_start",
      "thought_text",
      "thought_end",
    ]);
    const scene = events[0]!;
    expect(scene).toMatchObject({ kind: "scene", bg: "school_hallway", bgm: "melancholy_piano", transition: "fade" });
    const sayText = events.find((e) => e.kind === "say_text")!;
    expect(sayText).toEqual({ kind: "say_text", delta: "……太慢了！不是约好立刻集合的吗？" });
    const thought = events.find((e) => e.kind === "thought_text")!;
    expect(thought).toEqual({ kind: "thought_text", delta: "（这家伙，到底在想什么呢……）" });
  });

  it("正文原生文本保真：换行与省略号不丢失", () => {
    const { events, parser } = collect();
    parser.feed("<say id=\"a\">第一行\n第二行……\n</say>");
    parser.endMessage();
    expect(events.find((e) => e.kind === "say_text")).toEqual({
      kind: "say_text",
      delta: "第一行\n第二行……\n",
    });
  });
});

describe("流式撕裂容错", () => {
  for (const chunkSize of [1, 2, 3, 5, 7]) {
    it(`chunk=${chunkSize} 撕裂喂入与整段喂入语义等价`, () => {
      const whole = collect();
      whole.parser.feed(SAMPLE_BEAT);
      whole.parser.endMessage();

      const torn = collect();
      feedTorn(torn.parser, SAMPLE_BEAT, chunkSize);
      torn.parser.endMessage();

      expect(mergeDeltas(torn.events)).toEqual(mergeDeltas(whole.events));
      expect(torn.parser.warnings).toEqual([]);
    });
  }

  it("stop 标签自身撕裂也能正确闭合", () => {
    const { events, parser } = collect();
    feedTorn(parser, '<stop type="choice"><option>去天台</option><option>回家</option></stop>', 3);
    expect(events).toEqual([
      {
        kind: "stop",
        stopType: "choice",
        options: [
          { text: "去天台", value: undefined },
          { text: "回家", value: undefined },
        ],
      },
    ]);
  });
});

describe("消息边界自动闭合", () => {
  it("包裹标签未闭合：收尾保留已流出台词", () => {
    const { events, parser } = collect();
    parser.feed('<say id="mio" mood="softening">算了……上来吧，');
    parser.endMessage();
    expect(events.map((e) => e.kind)).toEqual(["say_start", "say_text", "say_end"]);
    expect(events[0]).toMatchObject({ kind: "say_start", id: "mio", mood: "softening" });
    expect(events[1]).toEqual({ kind: "say_text", delta: "算了……上来吧，" });
  });

  it("未完成标签在消息边界丢弃，标签前文本保留", () => {
    const { events, parser } = collect();
    parser.feed("<narrate>风停了。</narrate><say id=\"mio\" mo");
    parser.endMessage();
    expect(events.map((e) => e.kind)).toEqual(["narrate_start", "narrate_text", "narrate_end"]);
    expect(parser.warnings.some((w) => w.type === "malformed_tag")).toBe(true);
  });

  it("多消息独立解析：上一条未闭合不影响下一条", () => {
    const { events, parser } = collect();
    parser.feed("<narrate>第一幕落。");
    parser.endMessage();
    parser.feed('<say id="mio" mood="happy">新的一句</say>');
    parser.endMessage();
    expect(events.map((e) => e.kind)).toEqual([
      "narrate_start",
      "narrate_text",
      "narrate_end",
      "say_start",
      "say_text",
      "say_end",
    ]);
  });
});

describe("stop 闸门", () => {
  it("stop 闭合后丢弃其后本节拍的一切事件", () => {
    const { events, parser } = collect();
    parser.feed('<narrate>她笑了笑。</narrate><stop type="free"></stop><narrate>不应出现</narrate><say id="x">也不应出现</say>');
    parser.endMessage();
    expect(events.map((e) => e.kind)).toEqual(["narrate_start", "narrate_text", "narrate_end", "stop"]);
    expect(parser.gated).toBe(true);
  });

  it("闸门跨消息持续，直到 resetBeat", () => {
    const { events, parser } = collect();
    parser.feed('<stop type="free" placeholder="你做什么？"></stop>');
    parser.endMessage();
    parser.feed('<narrate>下一条消息也被吞</narrate>');
    parser.endMessage();
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ kind: "stop", stopType: "free", placeholder: "你做什么？" });

    parser.resetBeat();
    parser.feed('<narrate>新节拍正常</narrate>');
    parser.endMessage();
    expect(events.filter((e) => e.kind === "narrate_text").map((e) => (e as { delta: string }).delta)).toEqual([
      "新节拍正常",
    ]);
  });

  it("stop 前未闭合台词自动闭合（防前端悬空）", () => {
    const { events, parser } = collect();
    parser.feed('<say id="mio">还没说完的话<stop type="free"></stop>');
    parser.endMessage();
    expect(events.map((e) => e.kind)).toEqual(["say_start", "say_text", "say_end", "stop"]);
  });

  it("两种 stop 类型", () => {
    const free = collect();
    free.parser.feed('<stop type="free" placeholder="你的回应？"></stop>');
    expect(free.events[0]).toMatchObject({ kind: "stop", stopType: "free", placeholder: "你的回应？" });

    const selfClosing = collect();
    selfClosing.parser.feed('<stop type="choice"/>');
    expect(selfClosing.events[0]).toMatchObject({ kind: "stop", stopType: "choice" });
  });

  it("pause 已从 stop 类型里移除，幕末由 beat_end/act_end 表达", () => {
    const legacy = collect();
    legacy.parser.feed('<stop type="pause"></stop>');
    expect(legacy.events).toHaveLength(0);
    expect(legacy.parser.gated).toBe(false);
  });

  it("choice 选项带 value 属性", () => {
    const { events, parser } = collect();
    parser.feed('<stop type="choice"><option value="rooftop">去天台</option><option>回家</option></stop>');
    expect(events[0]).toEqual({
      kind: "stop",
      stopType: "choice",
      options: [
        { text: "去天台", value: "rooftop" },
        { text: "回家", value: undefined },
      ],
    });
  });

  it("漏写 </option>：流内 </stop> 收束已流出的选项文本", () => {
    const { events, parser } = collect();
    parser.feed('<stop type="choice"><option>去天台</stop>');
    expect(events[0]).toEqual({
      kind: "stop",
      stopType: "choice",
      options: [{ text: "去天台", value: undefined }],
    });
  });

  it("漏写 </option>：消息边界同样收束", () => {
    const { events, parser } = collect();
    parser.feed('<stop type="choice"><option>回家');
    parser.endMessage();
    expect(events[0]).toEqual({
      kind: "stop",
      stopType: "choice",
      options: [{ text: "回家", value: undefined }],
    });
  });

  it("自闭合 option：无正文立即收束，连续自闭合不丢", () => {
    const { events, parser } = collect();
    parser.feed('<stop type="choice"><option value="a"/><option value="b"/></stop>');
    expect(events[0]).toEqual({
      kind: "stop",
      stopType: "choice",
      options: [
        { text: "", value: "a" },
        { text: "", value: "b" },
      ],
    });
    expect(parser.warnings).toEqual([]);
  });

  it("choice 零选项：事件照发但警告（护栏回喂通道）", () => {
    const { events, parser } = collect();
    parser.feed('<stop type="choice"></stop>');
    expect(events[0]).toEqual({ kind: "stop", stopType: "choice" });
    expect(parser.warnings.some((w) => w.type === "malformed_tag" && w.detail.includes("choice"))).toBe(true);
  });
});

describe("容错与字面文本", () => {
  it("未知标签按字面文本输出，不丢内容", () => {
    const { events, parser } = collect();
    parser.feed("<narrate>a &lt; b 是 <i>斜体</i> 吗？</narrate>");
    parser.endMessage();
    expect(fullText(events, "narrate_text")).toBe("a &lt; b 是 <i>斜体</i> 吗？");
  });

  it("裸 '<' 不构成标签时按字面输出", () => {
    const { events, parser } = collect();
    parser.feed("<narrate>若 a<b 且 b<3 则 <3 也算表情</narrate>");
    parser.endMessage();
    expect(fullText(events, "narrate_text")).toBe("若 a<b 且 b<3 则 <3 也算表情");
  });

  it("属性残缺的标签丢弃但保留后续文本", () => {
    const { events, parser } = collect();
    parser.feed('<narrate>正文。</narrate><say id=broken>不该出现的台词</say><narrate>后续正常。</narrate>');
    parser.endMessage();
    const deltas = events.filter((e) => e.kind === "narrate_text").map((e) => (e as { delta: string }).delta);
    expect(deltas).toEqual(["正文。", "后续正常。"]);
    expect(events.some((e) => e.kind === "say_start")).toBe(false);
    expect(parser.warnings.some((w) => w.type === "malformed_tag")).toBe(true);
  });

  it("标签外裸文本静默丢弃空白、警告非空白", () => {
    const { events, parser } = collect();
    parser.feed("   <scene bg=\"a\"/>   垃圾裸文本");
    parser.endMessage();
    expect(events).toEqual([{ kind: "scene", bg: "a" }]);
    expect(parser.warnings.some((w) => w.type === "orphan_text")).toBe(true);
  });

  it("缺必填属性的标签丢弃（actor 缺 id / preload type 非法）", () => {
    const { events, parser } = collect();
    parser.feed('<actor pos="left"/><preload_asset type="movie" prompt="x" id="y"/><scene/>');
    parser.endMessage();
    expect(events).toEqual([{ kind: "scene" }]);
    expect(parser.warnings.filter((w) => w.type === "malformed_tag")).toHaveLength(2);
  });

  it("stop 内只允许 option，其他标签丢弃", () => {
    const { events, parser } = collect();
    parser.feed('<stop type="choice"><scene bg="x"/><option>甲</option><say id="a">hi</say></stop>');
    expect(events).toEqual([{ kind: "stop", stopType: "choice", options: [{ text: "甲", value: undefined }] }]);
  });

  it("mismatched 闭合标签丢弃，不影响正文", () => {
    const { events, parser } = collect();
    parser.feed("<narrate>台词</narrate></say>");
    parser.endMessage();
    expect(events.map((e) => e.kind)).toEqual(["narrate_start", "narrate_text", "narrate_end"]);
    expect(parser.warnings.some((w) => w.type === "mismatched_close")).toBe(true);
  });

  it("嵌套包裹标签：自动闭合前一个再开新标签", () => {
    const { events, parser } = collect();
    parser.feed('<say id="a">第一句<narrate>第二句</narrate>');
    parser.endMessage();
    expect(events.map((e) => e.kind)).toEqual([
      "say_start",
      "say_text",
      "say_end",
      "narrate_start",
      "narrate_text",
      "narrate_end",
    ]);
    expect(parser.warnings.some((w) => w.type === "nested_wrap")).toBe(true);
  });

  it("空 say 行为 pin：产出 start+end 零文本事件（过滤策略归前端）", () => {
    const { events, parser } = collect();
    parser.feed('<say id="a"></say>');
    parser.endMessage();
    expect(events.map((e) => e.kind)).toEqual(["say_start", "say_end"]);
    expect(parser.warnings).toEqual([]);
  });

  it("指令标签非自闭合：事件照发但警告", () => {
    const { events, parser } = collect();
    parser.feed('<scene bg="x">正文</scene>');
    parser.endMessage();
    expect(events).toEqual([{ kind: "scene", bg: "x" }]);
    expect(parser.warnings.some((w) => w.type === "malformed_tag" && w.detail.includes("自闭合"))).toBe(true);
  });
});
