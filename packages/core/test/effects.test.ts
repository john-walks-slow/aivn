import { describe, expect, it } from "vitest";
import { StageDslParser, lineageToEvents, type LineageNodeView, type StageEvent } from "../src/index.js";

function parse(text: string): { events: StageEvent[]; warnings: string[] } {
  const events: StageEvent[] = [];
  const parser = new StageDslParser((event) => events.push(event));
  parser.feed(text);
  parser.endMessage();
  return { events, warnings: parser.warnings.map((w) => w.detail) };
}

function fxNode(attrs: Record<string, string>): LineageNodeView {
  return {
    id: "n1",
    parentId: null,
    kind: "fx",
    turn: 0,
    text: "",
    attrs,
    createdAt: 0,
    onPath: true,
    children: 0,
    editedText: null,
    editCount: 0,
    editedAt: undefined,
    cgs: [],
  };
}

describe("<fx> 解析：合法路径", () => {
  it("trigger：flash 带颜色", () => {
    const { events, warnings } = parse('<fx effect="flash" trigger value="red"/>');
    expect(events).toEqual([{ kind: "fx", effect: "flash", verb: "trigger", value: "red" }]);
    expect(warnings).toEqual([]);
  });

  it("on/off：letterbox 无 value", () => {
    expect(parse('<fx effect="letterbox" on/>').events).toEqual([{ kind: "fx", effect: "letterbox", verb: "on" }]);
    expect(parse('<fx effect="vignette" off/>').events).toEqual([{ kind: "fx", effect: "vignette", verb: "off" }]);
  });

  it("on：flash 缺 value 取缺省 white", () => {
    const { events } = parse('<fx effect="flash" on/>');
    expect(events).toEqual([{ kind: "fx", effect: "flash", verb: "on", value: "white" }]);
  });

  it("shake 三种动词都收", () => {
    expect(parse('<fx effect="shake" trigger value="heavy"/>').events).toEqual([
      { kind: "fx", effect: "shake", verb: "trigger", value: "heavy" },
    ]);
    expect(parse('<fx effect="shake" on/>').events).toEqual([{ kind: "fx", effect: "shake", verb: "on", value: "light" }]);
    expect(parse('<fx effect="shake" off/>').events).toEqual([{ kind: "fx", effect: "shake", verb: "off" }]);
  });
});

describe("<fx> 解析：丢弃与降级", () => {
  it("未知 effect → 丢弃", () => {
    expect(parse('<fx effect="explode" trigger/>').events).toEqual([]);
  });

  it("缺 effect → 丢弃", () => {
    const { events, warnings } = parse("<fx trigger/>");
    expect(events).toEqual([]);
    expect(warnings.some((w) => w.includes("缺 effect"))).toBe(true);
  });

  it("缺动词 / 多动词 → 丢弃", () => {
    expect(parse('<fx effect="flash" value="red"/>').events).toEqual([]);
    const { warnings } = parse('<fx effect="flash" on off/>');
    expect(parse('<fx effect="flash" on off/>').events).toEqual([]);
    expect(warnings.some((w) => w.includes("动词"))).toBe(true);
  });

  it("效果不支持的动词 → 丢弃", () => {
    const { events, warnings } = parse('<fx effect="letterbox" trigger/>');
    expect(events).toEqual([]);
    expect(warnings.some((w) => w.includes("不支持"))).toBe(true);
  });

  it("非法 value 退化为缺省，不丢整条效果", () => {
    const { events, warnings } = parse('<fx effect="flash" trigger value="cyan"/>');
    expect(events).toEqual([{ kind: "fx", effect: "flash", verb: "trigger", value: "white" }]);
    expect(warnings.some((w) => w.includes("非法"))).toBe(true);
  });
});

describe("transition 封闭词表（仅 scene）", () => {
  it("合法转场保留", () => {
    const { events } = parse('<scene bg="x" transition="dissolve"/>');
    expect(events).toEqual([{ kind: "scene", bg: "x", transition: "dissolve" }]);
  });

  it("未知转场丢弃属性但保留换景", () => {
    const { events, warnings } = parse('<scene bg="x" transition="bogus"/>');
    expect(events).toEqual([{ kind: "scene", bg: "x" }]);
    expect(warnings.some((w) => w.includes("transition"))).toBe(true);
  });

  it("cg 不再认 transition（属性被忽略）", () => {
    const { events } = parse('<cg id="c1" transition="cut"/>');
    expect(events).toEqual([{ kind: "cg", id: "c1" }]);
  });
});

describe("谱系重放", () => {
  it("fx 节点重放成 fx 事件", () => {
    const out = lineageToEvents([fxNode({ effect: "flash", verb: "trigger", value: "red" })]);
    expect(out.map((e) => e.event)).toEqual([{ kind: "fx", effect: "flash", verb: "trigger", value: "red" }]);
  });

  it("缺 effect 或 verb 非法的 fx 节点被跳过", () => {
    expect(lineageToEvents([fxNode({ effect: "flash", value: "red" })])).toEqual([]);
    expect(lineageToEvents([fxNode({ effect: "flash", verb: "bogus" })])).toEqual([]);
  });
});
