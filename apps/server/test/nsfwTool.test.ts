import { describe, expect, it, vi } from "vitest";
import { createNsfwTools } from "../src/agentkit/nsfwTool.js";
import { agentToolCatalog, defaultToolsFor } from "../src/agentkit/kit.js";
import { NSFW_PRE_TURNS } from "../src/orchestrator.js";
import { PlayMemory } from "../src/memory.js";
import { LineageTree } from "@aivn/core";

describe("nsfwTool：限制级剧情工具契约", () => {
  it("工具定义具有正确的名称与描述", () => {
    let nsfw = false;
    const onEnter = vi.fn();
    const onExit = vi.fn();
    const tools = createNsfwTools({
      onEnterNsfw: onEnter,
      onExitNsfw: onExit,
      isNsfw: () => nsfw,
    });

    expect(tools.map((t) => t.name).sort()).toEqual(["enter_nsfw", "exit_nsfw"]);
    const enter = tools.find((t) => t.name === "enter_nsfw")!;
    const exit = tools.find((t) => t.name === "exit_nsfw")!;

    expect(enter.description).toContain("即将发生亲密");
    expect(exit.description).toContain("beat_done");
  });

  it("enter_nsfw 在未开启时触发回调，开启后拒绝重复进入", async () => {
    let nsfw = false;
    const onEnter = vi.fn((reason) => {
      nsfw = true;
    });
    const tools = createNsfwTools({
      onEnterNsfw: onEnter,
      onExitNsfw: vi.fn(),
      isNsfw: () => nsfw,
    });
    const enter = tools.find((t) => t.name === "enter_nsfw")!;

    const res1 = await enter.execute("call_1", { reason: "气氛到了" });
    expect(onEnter).toHaveBeenCalledWith("气氛到了");
    expect(res1.content[0]?.type).toBe("text");
    expect((res1.content[0] as { text: string }).text).toContain("已请求进入限制级（NSFW）剧情通道");

    // 重复调用
    const res2 = await enter.execute("call_2", {});
    expect((res2.content[0] as { text: string }).text).toContain("当前已经处于限制级剧情通道中");
  });

  it("exit_nsfw 在未处于限制级时提示无需退出，在限制级时触发退出回调", async () => {
    let nsfw = true;
    const onExit = vi.fn();
    const tools = createNsfwTools({
      onEnterNsfw: vi.fn(),
      onExitNsfw: onExit,
      isNsfw: () => nsfw,
    });
    const exit = tools.find((t) => t.name === "exit_nsfw")!;

    const res1 = await exit.execute("call_1", { summary: "两人度过温存一夜" });
    expect(onExit).toHaveBeenCalledWith("两人度过温存一夜");
    expect((res1.content[0] as { text: string }).text).toContain("已请求退出限制级（NSFW）剧情通道");

    nsfw = false;
    const res2 = await exit.execute("call_2", {});
    expect((res2.content[0] as { text: string }).text).toContain("当前未处于限制级剧情通道中");
  });

  it("剧作家默认工具集包含 enter_nsfw 与 exit_nsfw", () => {
    const defaults = defaultToolsFor("playwriter");
    expect(defaults.has("enter_nsfw")).toBe(true);
    expect(defaults.has("exit_nsfw")).toBe(true);
    const playwriterTools = agentToolCatalog("playwriter").map((t) => t.id);
    expect(playwriterTools).toContain("enter_nsfw");
    expect(playwriterTools).toContain("exit_nsfw");
    expect(agentToolCatalog("workshop").map((t) => t.id)).not.toContain("enter_nsfw");
  });

  it("NSFW 前置合规轮次包含 20 岁以上声明与虚构确认", () => {
    expect(NSFW_PRE_TURNS).toHaveLength(2);
    expect(NSFW_PRE_TURNS[0]!.role).toBe("user");
    expect(String(NSFW_PRE_TURNS[0]!.content)).toContain("20 周岁以上");
    expect(String(NSFW_PRE_TURNS[0]!.content)).toContain("above 20");
    expect(NSFW_PRE_TURNS[1]!.role).toBe("assistant");
    const assistantText = Array.isArray(NSFW_PRE_TURNS[1]!.content)
      ? (NSFW_PRE_TURNS[1]!.content[0] as { text: string }).text
      : String(NSFW_PRE_TURNS[1]!.content);
    expect(assistantText).toContain("20 周岁以上");
  });
});
