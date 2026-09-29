import { describe, expect, it } from "vitest";
import type { LineageNodeView, LineageView } from "@stage-ai/core";
import type { ScriptLine } from "./script.js";
import { buildTranscript } from "./transcript.js";

type NodeSpec = [
  id: string,
  kind: LineageNodeView["kind"],
  seq?: number,
  text?: string,
  attrs?: Record<string, string>,
];

function view(specs: NodeSpec[]): LineageView {
  const nodes = specs.map(([id, kind, seq, text, attrs = {}], index) => ({
    id,
    parentId: index > 0 ? specs[index - 1]![0] : null,
    turn: 1,
    kind,
    text: text ?? "",
    attrs,
    createdAt: 1_700_000_000_000 + index,
    onPath: true,
    children: 0,
    editTargetId: undefined,
    granularity: undefined,
    instruction: undefined,
    seq,
  }));
  return { nodes, leafId: nodes.at(-1)!.id, pathIds: nodes.map((n) => n.id) };
}

function line(key: string, seq: number, text: string, type: ScriptLine["type"] = "say"): ScriptLine {
  return { key, seq, text, type } as ScriptLine;
}

describe("buildTranscript 会话记录", () => {
  it("记下玩家的选择与导演注，布景指令不进记录", () => {
    const entries = buildTranscript(
      view([
        ["n1", "say", 1, "「放学一起走吧。」"],
        ["n2", "scene"],
        ["n3", "player", undefined, "我点点头"],
        ["n4", "sfx"],
        ["n5", "ooc", undefined, "别让她太快动心"],
        ["n6", "narrate", 6, "风把窗帘吹起来。"],
      ]),
      [],
    );

    expect(entries.map((e) => e.kind)).toEqual(["line", "player", "ooc", "line"]);
    expect(entries[1]).toMatchObject({ text: "我点点头", type: "say", actorId: "player", seq: null });
    expect(entries[2]).toMatchObject({ text: "别让她太快动心", type: "narrate", actorId: null });
  });

  it("一条 OOC 同时记了 player 与 ooc，只留一条", () => {
    const entries = buildTranscript(
      view([
        ["n1", "say", 1, "……"],
        ["p1", "player", undefined, "让雨下大点"],
        ["o1", "ooc", undefined, "让雨下大点"],
      ]),
      [],
    );

    expect(entries).toHaveLength(2);
    expect(entries[1]).toMatchObject({ kind: "ooc", text: "让雨下大点" });
  });

  it("「继续」不冒充玩家发言", () => {
    const entries = buildTranscript(
      view([
        ["n1", "say", 1, "……"],
        ["p1", "player", undefined, "（继续）"],
      ]),
      [],
    );

    expect(entries).toHaveLength(1);
  });

  it("编辑过的句子以缓冲里的文本为准，语音键仍是那一行", () => {
    const entries = buildTranscript(view([["n1", "say", 1, "我讨厌你"]]), [line("L7", 1, "我不讨厌你")]);

    expect(entries[0]).toMatchObject({ key: "L7", text: "我不讨厌你", seq: 1, nodeId: "n1" });
  });

  it("谱系还没追上缓冲时，末尾的台词不能缺", () => {
    const entries = buildTranscript(view([["n1", "say", 1, "第一句"]]), [
      line("L1", 1, "第一句"),
      line("L2", 2, "刚演出来的第二句"),
    ]);

    expect(entries.map((e) => e.text)).toEqual(["第一句", "刚演出来的第二句"]);
  });

  it("没有谱系时退回缓冲，只留说出口的话", () => {
    const entries = buildTranscript(null, [
      line("L1", 1, "台词"),
      { key: "L2", seq: 2, text: "背景 · 校门口", type: "scene" } as ScriptLine,
    ]);

    expect(entries.map((e) => e.text)).toEqual(["台词"]);
  });
});
