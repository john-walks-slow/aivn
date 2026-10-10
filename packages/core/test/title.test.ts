import { describe, expect, it } from "vitest";
import { LineageTree, lineageToEvents, resolveSceneBg, resolveTitleStyle, toNodeView } from "../src/index.js";

const toNode = toNodeView;

describe("谱系重放：全屏标题卡", () => {
  it("title 节点重放成 title_start / title_text / title_end，正文与属性都在", () => {
    const tree = new LineageTree();
    tree.append("title", {
      text: "床前明月光\n疑是地上霜",
      payload: { attrs: { align: "center", mode: "lines" } },
    });
    const events = lineageToEvents(tree.materialize().map(toNode)).map((e) => e.event);
    expect(events.map((e) => e.kind)).toEqual(["title_start", "title_text", "title_end"]);
    expect(events[0]).toMatchObject({ align: "center", mode: "lines", bg: "black" });
    expect(events[1]).toEqual({ kind: "title_text", delta: "床前明月光\n疑是地上霜" });
  });

  it("底色与字色从 attrs 还原，坏值落回默认", () => {
    const tree = new LineageTree();
    tree.append("title", { text: "风起", payload: { attrs: { bg: "#1a1a2e", ink: "white" } } });
    tree.append("title", { text: "雨落", payload: { attrs: { bg: "transparent", ink: "亮白" } } });
    const starts = lineageToEvents(tree.materialize().map(toNode))
      .map((e) => e.event)
      .filter((e) => e.kind === "title_start");
    expect(starts[0]).toMatchObject({ bg: "#1a1a2e", ink: "white" });
    expect(starts[1]).toMatchObject({ bg: "black" });
    expect("ink" in starts[1]!).toBe(false);
  });

  it("坏属性落回默认，不让手改的日志把非法值送到客户端", () => {
    const tree = new LineageTree();
    tree.append("title", { text: "风起", payload: { attrs: { align: "middle", mode: "slow" } } });
    const start = lineageToEvents(tree.materialize().map(toNode))[0]!.event;
    expect(start).toMatchObject({ kind: "title_start", align: "center", mode: "lines" });
  });

  it("空 title 节点只重放 start+end 两个 seq（与现场同规格）", () => {
    const tree = new LineageTree();
    tree.append("title", { text: "", payload: { attrs: { align: "center", mode: "block" } } });
    const events = lineageToEvents(tree.materialize().map(toNode));
    expect(events.map((e) => e.event.kind)).toEqual(["title_start", "title_end"]);
    expect(events.map((e) => e.seq)).toEqual([1, 2]);
  });
});

describe("resolveTitleStyle：底色、字色与投影", () => {
  it("缺省是黑底白字", () => {
    expect(resolveTitleStyle(undefined, undefined)).toEqual({ background: "#000000", ink: "#ffffff" });
  });

  it("字色缺省按底色取对比色", () => {
    expect(resolveTitleStyle("white", undefined)).toEqual({ background: "#ffffff", ink: "#000000" });
    expect(resolveTitleStyle("#1a1a2e", undefined)).toEqual({ background: "#1a1a2e", ink: "#ffffff" });
  });

  it("显式字色优先", () => {
    expect(resolveTitleStyle("black", "#c9a227")).toEqual({ background: "#000000", ink: "#c9a227" });
  });

  it('bg="none" 是不铺底：字色缺省交回舞台皮肤，显式给了就用它', () => {
    expect(resolveTitleStyle("none", undefined)).toEqual({ background: null, ink: null });
    expect(resolveTitleStyle("None", "#333333")).toEqual({ background: null, ink: "#333333" });
  });

  it("非法底色落回黑底", () => {
    expect(resolveTitleStyle("transparent", undefined)).toEqual({ background: "#000000", ink: "#ffffff" });
  });
});

describe("resolveSceneBg：素材 id 与纯色场分流", () => {
  it("保留色名大小写不敏感", () => {
    expect(resolveSceneBg("black")).toEqual({ kind: "color", color: "#000000" });
    expect(resolveSceneBg("White")).toEqual({ kind: "color", color: "#ffffff" });
  });

  it("十六进制色值原样当色场", () => {
    expect(resolveSceneBg("#1a1a2e")).toEqual({ kind: "color", color: "#1a1a2e" });
    expect(resolveSceneBg("#abc")).toEqual({ kind: "color", color: "#abc" });
  });

  it("其余一律当素材 id", () => {
    expect(resolveSceneBg("bg_classroom_sunset")).toEqual({ kind: "asset", id: "bg_classroom_sunset" });
  });

  it("空值与缺省返回 null（保持上一张底）", () => {
    expect(resolveSceneBg(undefined)).toBeNull();
    expect(resolveSceneBg("   ")).toBeNull();
  });

  it("非法十六进制不当色场，退回素材 id", () => {
    expect(resolveSceneBg("#12")).toEqual({ kind: "asset", id: "#12" });
    expect(resolveSceneBg("#12345")).toEqual({ kind: "asset", id: "#12345" });
  });
});
