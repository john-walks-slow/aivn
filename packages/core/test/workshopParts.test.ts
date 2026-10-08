import { describe, expect, it } from "vitest";
import {
  appendText,
  appendThinking,
  attachMessageAssets,
  attachToolAssets,
  endTool,
  normalizeParts,
  startTool,
} from "../src/ws/workshopParts.js";

const ASSET = { kind: "cg" as const, path: "assets/cg/a.jpg", url: "/plays/p/assets/cg/a.jpg" };

describe("工坊段落流拼装", () => {
  it("同类增量续在最后一段上，工具调用把它们隔开", () => {
    let parts = appendThinking([], "想");
    parts = appendThinking(parts, "一下");
    expect(parts).toEqual([{ type: "thinking", text: "想一下" }]);

    parts = appendText(parts, "先看文件");
    parts = startTool(parts, { id: "call-2", name: "read", args: { path: "play.json" } });
    parts = endTool(parts, { id: "call-2", result: "文件内容", isError: false, ms: 12 });
    parts = appendText(parts, "看完了");

    // 间隔在，就不会并成一段；调用之前的那句叙述也留得住
    expect(parts.map((p) => p.type)).toEqual(["thinking", "text", "tool", "text"]);
    expect(parts.at(-1)).toEqual({ type: "text", text: "看完了" });
  });

  it("工具按 id 配对：结束只补结果，不动已经挂上的素材", () => {
    let parts = startTool([], { id: "c1", name: "generate_image", args: { prompt: "黄昏天台" } });
    parts = attachToolAssets(parts, "c1", [ASSET]);
    parts = endTool(parts, { id: "c1", result: "已生成", isError: false, ms: 800 });

    expect(parts).toHaveLength(1);
    expect(parts[0]).toMatchObject({ type: "tool", id: "c1", result: "已生成", isError: false, ms: 800 });
    expect((parts[0] as { assets: unknown[] }).assets).toEqual([ASSET]);
  });

  it("配不上的调用号不动作（重复事件、迟到结果都不该改坏别人的行）", () => {
    const parts = startTool([], { id: "c1", name: "read", args: {} });
    expect(endTool(parts, { id: "c9", result: "别人的", isError: true, ms: 1 })).toEqual(parts);
    expect(attachToolAssets(parts, "c9", [ASSET])).toEqual(parts);
  });

  it("消息级素材并回最后一个工具段；没有工具段就原样留着", () => {
    let parts = startTool([], { id: "c1", name: "generate_image", args: {} });
    parts = endTool(parts, { id: "c1", result: "ok", isError: false, ms: 5 });
    parts = appendText(parts, "好了");
    const merged = attachMessageAssets(parts, [ASSET]);
    expect(merged.remaining).toEqual([]);
    const tool = merged.parts.find((p) => p.type === "tool");
    expect((tool as { assets: unknown[] }).assets).toEqual([ASSET]);

    const bare = attachMessageAssets([{ type: "text" as const, text: "hi" }], [ASSET]);
    expect(bare.remaining).toEqual([ASSET]);
    expect(attachMessageAssets(parts, undefined).remaining).toEqual([]);
  });

  it("旧消息（只有 text）归一成一段正文，空消息归一成空的", () => {
    expect(normalizeParts({ text: "你好" })).toEqual([{ type: "text", text: "你好" }]);
    expect(
      normalizeParts({ text: "你好", parts: [{ type: "text", text: "嗨" }] }),
    ).toEqual([{ type: "text", text: "嗨" }]);
    expect(normalizeParts({ text: "" })).toEqual([]);
  });
});
