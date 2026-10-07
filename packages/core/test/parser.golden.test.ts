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
      (event.kind === "say_text" ||
        event.kind === "narrate_text" ||
        event.kind === "thought_text" ||
        event.kind === "title_text") &&
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
  '<actor id="mio" pos="center" variant="pout" action="enter"/>',
  "<narrate>放学后的走廊空无一人，夕阳把课桌的影子拉得很长。</narrate>",
  '<say id="mio" mood="annoyed">……太慢了！不是约好立刻集合的吗？</say>',
  '<cg id="cg_rooftop_01" caption="黄昏的天台"/>',
  '<sfx src="wind" volume="0.3"/>',
  '<thought id="mio">（这家伙，到底在想什么呢……）</thought>',
].join("\n");

describe("完整轮", () => {
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

  it("旧标签撕裂喂入也整条丢弃，不半截泄漏", () => {
    const { events, parser } = collect();
    feedTorn(parser, '<option>去天台</option><option>回家</option>', 3);
    expect(events).toEqual([]);
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

describe("停止点 <stop>", () => {
  it("options 按 | 拆，两端空白去掉，空项丢弃", () => {
    const { events, parser } = collect();
    parser.feed('<stop options="去天台 | 回家"/>');
    parser.endMessage();
    expect(events).toEqual([
      {
        kind: "stop",
        stopType: "choice",
        options: [{ text: "去天台" }, { text: "回家" }],
      },
    ]);
  });

  it("选项里不写 | 也能给到两条以上", () => {
    const { events, parser } = collect();
    parser.feed('<stop options="留下|跟她走|装作没听见"/>');
    parser.endMessage();
    expect(events[0]).toMatchObject({ kind: "stop", stopType: "choice" });
    expect((events[0] as { options: unknown[] }).options).toHaveLength(3);
  });

  it("placeholder = 自由输入框", () => {
    const { events, parser } = collect();
    parser.feed('<stop placeholder="想对他说什么？"/><say id="mio">嗯？</say>');
    parser.endMessage();
    expect(events[0]).toEqual({ kind: "stop", stopType: "free", placeholder: "想对他说什么？" });
    expect(events.map((e) => e.kind)).toContain("say_end");
  });

  it("<stop/> = 自然演完：不产出停止点", () => {
    const { events, parser } = collect();
    parser.feed('<say id="mio">今天先到这儿。</say>\n<stop/>');
    parser.endMessage();
    expect(events.map((e) => e.kind)).toEqual(["say_start", "say_text", "say_end"]);
    expect(parser.warnings).toEqual([]);
  });

  it("一条选项不算数：挂警告、不产出停止点", () => {
    const { events, parser } = collect();
    parser.feed('<stop options="留在原地"/>');
    parser.endMessage();
    expect(events).toEqual([]);
    expect(parser.warnings.some((w) => w.type === "malformed_tag" && w.detail.includes("不足两条"))).toBe(true);
  });

  it("options 与 placeholder 同给：按 options 走并挂警告", () => {
    const { events, parser } = collect();
    parser.feed('<stop options="甲 | 乙" placeholder="随便说点什么"/>');
    parser.endMessage();
    expect(events[0]).toMatchObject({ kind: "stop", stopType: "choice" });
    expect(parser.warnings.some((w) => w.type === "malformed_tag" && w.detail.includes("placeholder"))).toBe(true);
  });

  it("撕裂喂入与整段喂入等价", () => {
    const whole = collect();
    whole.parser.feed('<say id="mio">来。</say><stop options="去天台 | 回家"/>');
    whole.parser.endMessage();

    const torn = collect();
    feedTorn(torn.parser, '<say id="mio">来。</say><stop options="去天台 | 回家"/>', 3);
    torn.parser.endMessage();

    expect(mergeDeltas(torn.events)).toEqual(mergeDeltas(whole.events));
    expect(torn.parser.warnings).toEqual([]);
  });
});

describe("已迁进工具的旧标签（静默降级）", () => {
  it("option 子标签整条丢弃，台词与 stop 不受影响", () => {
    const { events, parser } = collect();
    parser.feed(
      '<say id="mio">你终于来了。</say><stop type="choice"><option>天台</option><option>回家</option></stop>',
    );
    parser.endMessage();
    // 旧形态的 stop 只剩一个 type 属性：没有 options / placeholder，按自然演完收场。
    expect(events.map((e) => e.kind)).toEqual(["say_start", "say_text", "say_end"]);
    // 两个 <option> 各一条
    expect(parser.warnings.filter((w) => w.type === "legacy_tag")).toHaveLength(2);
  });

  it("preload_asset 丢弃而不是原样当台词念出去", () => {
    const { events, parser } = collect();
    parser.feed(
      '<preload_asset type="bg" prompt="rooftop at dusk" id="bg_rooftop"/><say id="mio">走。</say>',
    );
    parser.endMessage();
    expect(events.map((e) => e.kind)).toEqual(["say_start", "say_text", "say_end"]);
    expect(parser.warnings.some((w) => w.type === "legacy_tag" && w.detail.includes("preload_asset"))).toBe(true);
  });

  it("preload_asset 的自闭合 / 非自闭合写法都丢弃", () => {
    const { events, parser } = collect();
    parser.feed('<preload_asset type="cg" prompt="x" id="y"/><preload_asset type="cg" prompt="z" id="w">忘了闭合');
    parser.endMessage();
    expect(events).toEqual([]);
    expect(parser.warnings.filter((w) => w.type === "legacy_tag")).toHaveLength(2);
  });

  it("旧标签后仍有正常剧本：不再有 stop 闸门", () => {
    const { events, parser } = collect();
    parser.feed('<option>回家</option><narrate>这一句照常演。</narrate>');
    parser.endMessage();
    expect(events.map((e) => e.kind)).toEqual(["narrate_start", "narrate_text", "narrate_end"]);
  });
});

describe("注释 comment", () => {
  it("正文整体吞掉，不产出任何事件，两侧台词不受影响", () => {
    const { events, parser } = collect();
    parser.feed(
      [
        '<say id="mio">你来了。</say>',
        "<comment>我打算这一轮收在天台，下一轮再写告白；玩家大概会选第二个选项。</comment>",
        '<say id="mio">上来吧。</say>',
      ].join("\n"),
    );
    parser.endMessage();
    expect(events.map((e) => e.kind)).toEqual([
      "say_start",
      "say_text",
      "say_end",
      "say_start",
      "say_text",
      "say_end",
    ]);
    expect(events.map((e) => ("delta" in e ? e.delta : e.kind)).join("")).not.toContain("天台，下一轮");
  });

  it("撕裂喂入与整段喂入等价", () => {
    const source = '<narrate>风停了。</narrate>\n<comment>这里我想快一点过</comment>\n<say id="mio">走吧。</say>';
    const whole = collect();
    whole.parser.feed(source);
    whole.parser.endMessage();
    for (const chunkSize of [1, 2, 3, 5, 7]) {
      const torn = collect();
      feedTorn(torn.parser, source, chunkSize);
      torn.parser.endMessage();
      expect(mergeDeltas(torn.events)).toEqual(mergeDeltas(whole.events));
      expect(torn.parser.warnings).toEqual([]);
    }
  });

  it("未闭合的注释在消息边界结束，不影响后续消息", () => {
    const { events, parser } = collect();
    parser.feed("<comment>先记一下：这局要走坏结局");
    parser.endMessage();
    expect(events).toEqual([]);
    expect(parser.warnings).toEqual([]);

    parser.feed('<say id="mio">别回头。</say>');
    parser.endMessage();
    expect(events.map((e) => e.kind)).toEqual(["say_start", "say_text", "say_end"]);
  });

  it("注释内的标签一律丢弃，穿不出来", () => {
    const { events, parser } = collect();
    parser.feed('<comment>试一下 <say id="mio">不该出现</say> 和 <scene bg="x"/></comment><say id="mio">这句才该演。</say>');
    parser.endMessage();
    expect(events.map((e) => e.kind)).toEqual(["say_start", "say_text", "say_end"]);
    expect(events[1]).toEqual({ kind: "say_text", delta: "这句才该演。" });
    expect(parser.warnings.filter((w) => w.type === "malformed_tag").length).toBeGreaterThan(0);
  });

  it("忘闭合的注释吞到消息边界为止，下一条消息照常解析", () => {
    const { events, parser } = collect();
    parser.feed('<comment>该问她了<say id="mio">你怎么想？</say>');
    parser.endMessage();
    // 注释里写的示范不当场演出来——这是「没有结构标签出口」换来的
    expect(events).toEqual([]);

    parser.feed('<say id="mio">那就问吧。</say>');
    parser.endMessage();
    expect(events.map((e) => e.kind)).toEqual(["say_start", "say_text", "say_end"]);
  });

  it("自闭合注释是空注释，直接忽略", () => {
    const { events, parser } = collect();
    parser.feed('<comment/><say id="mio">嗯。</say>');
    parser.endMessage();
    expect(events.map((e) => e.kind)).toEqual(["say_start", "say_text", "say_end"]);
    expect(parser.warnings).toEqual([]);
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

  it("缺必填属性的标签丢弃（actor 缺 id / sfx 缺 src / cg 缺 id）", () => {
    const { events, parser } = collect();
    parser.feed('<actor pos="left"/><sfx volume="0.2"/><cg caption="无 id"/><scene/>');
    parser.endMessage();
    expect(events).toEqual([{ kind: "scene" }]);
    expect(parser.warnings.filter((w) => w.type === "malformed_tag")).toHaveLength(3);
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

describe("告警是一次性投递（takeWarnings）", () => {
  it("取走即清空：回灌给模型的告警不该和下一轮的混成一堆", () => {
    const { parser } = collect();
    parser.feed("她笑了笑。");
    parser.endMessage();
    expect(parser.warnings.length).toBeGreaterThan(0);

    const taken = parser.takeWarnings();
    expect(taken.some((w) => w.type === "orphan_text")).toBe(true);
    expect(parser.warnings).toEqual([]);
    expect(parser.takeWarnings()).toEqual([]);
  });

  it("resetBeat 不清告警：收束处要拿到的是这一轮攒下的全部问题", () => {
    const { parser } = collect();
    parser.feed("<say id=\"a\">话</narrate>");
    parser.endMessage();
    parser.resetBeat();
    expect(parser.takeWarnings().length).toBeGreaterThan(0);
  });

  it("干净的一轮取到空表：编排器据此不发回灌块", () => {
    const { parser } = collect();
    parser.feed('<narrate>一切正常。</narrate>');
    parser.endMessage();
    expect(parser.takeWarnings()).toEqual([]);
  });
});

describe("差分属性：新名 variant 与旧名 expression / state", () => {
  const actorOf = (tag: string): StageEvent => {
    const { events, parser } = collect();
    parser.feed(tag);
    parser.endMessage();
    return events.find((e) => e.kind === "actor")!;
  };

  it("variant 原样产出", () => {
    expect(actorOf('<actor id="mecha" variant="damaged"/>')).toMatchObject({ variant: "damaged" });
  });

  it("旧剧本的 expression / state 收成 variant，属性名不再往外冒", () => {
    expect(actorOf('<actor id="mio" expression="pout"/>')).toEqual({ kind: "actor", id: "mio", variant: "pout" });
    expect(actorOf('<actor id="cat" state="asleep"/>')).toEqual({ kind: "actor", id: "cat", variant: "asleep" });
  });

  it("三个都写时 variant 优先（其余当噪声）", () => {
    expect(actorOf('<actor id="mio" expression="pout" state="x" variant="smile"/>')).toMatchObject({
      variant: "smile",
    });
  });
});

describe("全屏标题卡 <title>", () => {
  it("缺省 align=center / mode=lines，正文多行保真", () => {
    const { events, parser } = collect();
    parser.feed("<title>床前明月光\n疑是地上霜\n</title>");
    parser.endMessage();
    expect(events.map((e) => e.kind)).toEqual(["title_start", "title_text", "title_end"]);
    expect(events[0]).toMatchObject({ kind: "title_start", align: "center", mode: "lines" });
    expect((events[1] as { delta: string }).delta).toBe("床前明月光\n疑是地上霜\n");
  });

  it("显式 align / mode 原样产出", () => {
    const { events, parser } = collect();
    parser.feed('<title align="top-right" mode="block">三日后</title>');
    parser.endMessage();
    expect(events[0]).toEqual({ kind: "title_start", align: "top-right", mode: "block" });
    expect(events[1]).toEqual({ kind: "title_text", delta: "三日后" });
  });

  it("非法 align / mode 落回默认并挂警告", () => {
    const { events, parser } = collect();
    parser.feed('<title align="middle" mode="slow">风起</title>');
    parser.endMessage();
    expect(events[0]).toMatchObject({ kind: "title_start", align: "center", mode: "lines" });
    expect(parser.warnings.filter((w) => w.type === "malformed_tag")).toHaveLength(2);
  });

  it("空 <title> 不产出事件（不留一个要点掉的全屏空屏）", () => {
    const { events, parser } = collect();
    parser.feed("<title>   \n  </title><say id=\"mio\">嗯。</say>");
    parser.endMessage();
    expect(events.map((e) => e.kind)).toEqual(["say_start", "say_text", "say_end"]);
    expect(parser.warnings.some((w) => w.type === "malformed_tag" && w.detail.includes("<title>"))).toBe(true);
  });

  it("前导空白/换行不丢失：第一段非空白字符才吐出 start", () => {
    const { events, parser } = collect();
    parser.feed("<title>\n  序\n</title>");
    parser.endMessage();
    expect(events.map((e) => e.kind)).toEqual(["title_start", "title_text", "title_end"]);
    expect((events[1] as { delta: string }).delta).toBe("\n  序\n");
  });

  it("自闭合 <title/> 丢弃", () => {
    const { events, parser } = collect();
    parser.feed('<title/><say id="mio">嗯。</say>');
    parser.endMessage();
    expect(events.map((e) => e.kind)).toEqual(["say_start", "say_text", "say_end"]);
    expect(parser.warnings.some((w) => w.type === "malformed_tag")).toBe(true);
  });

  it("撕裂喂入与整段喂入等价", () => {
    const source = '<scene bg="black"/>\n<title align="center">第一章\n风起</title>\n<say id="mio">是你。</say>';
    const whole = collect();
    whole.parser.feed(source);
    whole.parser.endMessage();
    for (const chunkSize of [1, 2, 3, 5, 7]) {
      const torn = collect();
      feedTorn(torn.parser, source, chunkSize);
      torn.parser.endMessage();
      expect(mergeDeltas(torn.events)).toEqual(mergeDeltas(whole.events));
      expect(torn.parser.warnings).toEqual([]);
    }
  });

  it("未闭合的 title 在消息边界自动闭合，保留已流出正文", () => {
    const { events, parser } = collect();
    parser.feed("<title>第一章\n风");
    parser.endMessage();
    expect(events.map((e) => e.kind)).toEqual(["title_start", "title_text", "title_end"]);
    expect((events[1] as { delta: string }).delta).toBe("第一章\n风");
  });
});
