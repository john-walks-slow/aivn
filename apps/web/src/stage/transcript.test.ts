import { describe, expect, it } from "vitest";
import type { LineageNodeView, LineageView } from "@aivn/core";
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
    cgs: [],
  }));
  return { nodes, leafId: nodes.at(-1)!.id, pathIds: nodes.map((n) => n.id) };
}

function line(key: string, seq: number, text: string, type: ScriptLine["type"] = "say"): ScriptLine {
  return { key, seq, text, type } as ScriptLine;
}

/** 缓冲里的玩家输入行（player_input 事件落进 ScriptBuilder 的形状）。 */
function inputLine(key: string, seq: number, text: string): ScriptLine {
  return { key, seq, text, type: "input", actorId: "player" } as ScriptLine;
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

  it("分岔/轮边界这些结构节点都不进记录", () => {
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

  it("刚发的输入不等谱系：缓冲里就有，立刻进记录", () => {
    const entries = buildTranscript(view([["n1", "say", 1, "第一句"]]), [
      line("L1", 1, "第一句"),
      inputLine("L2", 2, "（选择了：道歉）"),
    ]);

    expect(entries.map((e) => [e.kind, e.text])).toEqual([
      ["line", "第一句"],
      ["input", "（选择了：道歉）"],
    ]);
  });

  it("谱系追上后按 seq 认回同一条缓冲行，输入不重复出现", () => {
    const entries = buildTranscript(
      view([
        ["n1", "say", 1, "第一句"],
        ["p1", "prompt", 2, "（选择了：道歉）"],
        ["n2", "say", 3, "第二句"],
      ]),
      [
        line("L1", 1, "第一句"),
        inputLine("L2", 2, "（选择了：道歉）"),
        line("L3", 3, "第二句"),
      ],
    );

    const inputs = entries.filter((e) => e.kind === "input");
    expect(inputs).toHaveLength(1);
    expect(inputs[0]).toMatchObject({ key: "L2", nodeId: "p1", seq: 2 });
  });

  it("老档的 prompt 没有 seq：按顺序认回重放出的同文本输入行，回顾里不出现两条", () => {
    const entries = buildTranscript(
      view([
        ["n1", "say", 1, "第一句"],
        ["p1", "prompt", undefined, "（选择了：道歉）"],
      ]),
      [line("L1", 1, "第一句"), inputLine("L2", 2, "（选择了：道歉）")],
    );

    const inputs = entries.filter((e) => e.kind === "input");
    expect(inputs).toHaveLength(1);
    expect(inputs[0]).toMatchObject({ key: "L2", nodeId: "p1" });
    // 位置与谱系一致：输入夹在台词后面，不是被甩到末尾
    expect(entries.map((e) => e.kind)).toEqual(["line", "input"]);
  });

  it("seq 认回的行及时移出兜底池：后面同文本的无 seq 节点不会把同一条再认一次", () => {
    const entries = buildTranscript(
      view([
        ["n1", "say", 1, "第一句"],
        ["p1", "prompt", 2, "（选择了：道歉）"],
        ["n2", "say", 3, "第二句"],
        ["p2", "prompt", undefined, "（选择了：道歉）"],
      ]),
      [line("L1", 1, "第一句"), inputLine("L2", 2, "（选择了：道歉）"), line("L3", 3, "第二句")],
    );

    const inputs = entries.filter((e) => e.kind === "input");
    expect(inputs).toHaveLength(2);
    expect(inputs[0]).toMatchObject({ key: "L2", nodeId: "p1" });
    // 第二条（无 seq、同文本）不得复用已被认走的缓冲行——同 key 两条记录会炸回顾列表
    expect(inputs[1]!.key).not.toBe("L2");
    expect(new Set(entries.map((e) => e.key)).size).toBe(entries.length);
  });
});
