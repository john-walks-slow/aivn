import { describe, expect, it } from "vitest";
import { StageDslParser, lineageToEvents, type LineageNodeView, type StageEvent } from "../src/index.js";

function parse(text: string): { events: StageEvent[]; warnings: string[] } {
  const events: StageEvent[] = [];
  const parser = new StageDslParser((event) => events.push(event));
  parser.feed(text);
  parser.endMessage();
  return { events, warnings: parser.warnings.map((w) => w.detail) };
}

describe("<fx> 解析：合法路径", () => {
  it("trigger：flash 带 value", () => {
    const { events, warnings } = parse('<fx target="screen" effect="flash" value="red"/>');
    expect(events).toEqual([{ kind: "fx", target: "screen", effect: "flash", value: "red" }]);
    expect(warnings).toEqual([]);
  });

  it("state：letterbox 缺 value 取缺省 on", () => {
    const { events } = parse('<fx target="screen" effect="letterbox"/>');
    expect(events).toEqual([{ kind: "fx", target: "screen", effect: "letterbox", value: "on" }]);
  });

  it("shake 挂 camera", () => {
    const { events } = parse('<fx target="camera" effect="shake" value="heavy"/>');
    expect(events).toEqual([{ kind: "fx", target: "camera", effect: "shake", value: "heavy" }]);
  });

  it("release 停掉持续效果，不带 effect/value", () => {
    const { events } = parse('<fx target="screen" release/>');
    expect(events).toEqual([{ kind: "fx", target: "screen", release: true }]);
  });
});

describe("<fx> 解析：丢弃与降级", () => {
  it("target 非法整条丢弃", () => {
    const { events, warnings } = parse('<fx target="lucy" effect="flash"/>');
    expect(events).toEqual([]);
    expect(warnings.some((w) => w.includes("target"))).toBe(true);
  });

  it("effect 不适用于该 target → 丢弃", () => {
    const { events, warnings } = parse('<fx target="camera" effect="flash"/>');
    expect(events).toEqual([]);
    expect(warnings.some((w) => w.includes("不适用"))).toBe(true);
  });

  it("未知 effect → 丢弃", () => {
    const { events } = parse('<fx target="camera" effect="explode"/>');
    expect(events).toEqual([]);
  });

  it("缺 effect 且没 release → 丢弃", () => {
    const { events, warnings } = parse('<fx target="camera"/>');
    expect(events).toEqual([]);
    expect(warnings.some((w) => w.includes("缺 effect"))).toBe(true);
  });

  it("非法 value 退化为缺省，不丢整条效果", () => {
    const { events, warnings } = parse('<fx target="screen" effect="flash" value="cyan"/>');
    expect(events).toEqual([{ kind: "fx", target: "screen", effect: "flash", value: "white" }]);
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
    const node: LineageNodeView = {
      id: "n1",
      parentId: null,
      kind: "fx",
      turn: 0,
      text: "",
      attrs: { target: "screen", effect: "flash", value: "red" },
      createdAt: 0,
      onPath: true,
      children: 0,
      editedText: null,
      editCount: 0,
      editedAt: undefined,
      cgs: [],
    };
    const out = lineageToEvents([node]);
    expect(out.map((e) => e.event)).toEqual([{ kind: "fx", target: "screen", effect: "flash", value: "red" }]);
  });

  it("release 节点重放成 release 事件", () => {
    const node: LineageNodeView = {
      id: "n1",
      parentId: null,
      kind: "fx",
      turn: 0,
      text: "",
      attrs: { target: "screen", release: "true" },
      createdAt: 0,
      onPath: true,
      children: 0,
      editedText: null,
      editCount: 0,
      editedAt: undefined,
      cgs: [],
    };
    expect(lineageToEvents([node]).map((e) => e.event)).toEqual([{ kind: "fx", target: "screen", release: true }]);
  });

  it("非法 target 的 fx 节点被跳过", () => {
    const node: LineageNodeView = {
      id: "n1",
      parentId: null,
      kind: "fx",
      turn: 0,
      text: "",
      attrs: { target: "lucy", effect: "flash" },
      createdAt: 0,
      onPath: true,
      children: 0,
      editedText: null,
      editCount: 0,
      editedAt: undefined,
      cgs: [],
    };
    expect(lineageToEvents([node])).toEqual([]);
  });
});
