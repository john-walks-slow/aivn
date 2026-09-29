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
    editedText: null,
    editCount: 0,
    editedAt: undefined,
    seq,
  }));
  return { nodes, leafId: nodes.at(-1)!.id, pathIds: nodes.map((n) => n.id) };
}

function line(key: string, seq: number, text: string, type: ScriptLine["type"] = "say"): ScriptLine {
  return { key, seq, text, type } as ScriptLine;
}

describe("buildTranscript 会话记录", () => {
  it("记下玩家发来的话，布景指令不进记录", () => {
    const entries = buildTranscript(
      view([
        ["n1", "say", 1, "「放学一起走吧。」"],
        ["n2", "scene"],
        ["n3", "prompt", undefined, "我点点头"],
        ["n4", "sfx"],
        ["n5", "prompt", undefined, "OOC：别让她太快动心"],
        ["n6", "narrate", 6, "风把窗帘吹起来。"],
      ]),
      [],
    );

    expect(entries.map((e) => e.kind)).toEqual(["line", "input", "input", "line"]);
    expect(entries[1]).toMatchObject({ text: "我点点头", type: "say", actorId: "player", seq: null });
  });

  it("分岔/拍边界这些结构节点都不进记录", () => {
    const entries = buildTranscript(
      view([
        ["n1", "say", 1, "……"],
        ["p1", "prompt", undefined, "我点点头"],
        ["f1", "fork"],
        ["n2", "say", 2, "重演的第一句"],
        ["b1", "beat_end"],
        ["p2", "prompt", undefined, "让雨下大点"],
      ]),
      [],
    );

    expect(entries.map((e) => e.key)).toEqual(["n1", "p1", "n2", "p2"]);
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
