import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { PromptPresets } from "../src/promptPresets.js";
import { createNsfwTools } from "../src/agentkit/nsfwTool.js";
import {
  CAPABILITY_CATALOG,
  capabilityTools,
  defaultCapabilitiesFor,
  installableTools,
} from "../src/agentkit/kit.js";
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
    expect(exit.description).toContain("停止点标签");
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

  it("剧作家默认能力集包含「限制级通道」，它授权的就是这两个工具", () => {
    expect(defaultCapabilitiesFor("playwriter")).toContain("nsfw");
    const nsfw = CAPABILITY_CATALOG.find((cap) => cap.id === "nsfw")!;
    expect(capabilityTools(nsfw, "playwriter")).toEqual(["enter_nsfw", "exit_nsfw"]);
    expect(installableTools("playwriter")).toContain("enter_nsfw");
    expect(installableTools("playwriter")).toContain("exit_nsfw");
    expect(installableTools("workshop")).not.toContain("enter_nsfw");
  });

  it("合规锚点改作出厂自带的一份 preset，不再是写死在装配里的前置轮次", async () => {
    const dir = await mkdtemp(join(tmpdir(), "aivn-presets-"));
    // 写死的 NSFW_PRE_TURNS 已退役：那两句现在是 prompt-presets 的默认内容，
    // 作者挑进通道那组注入即可（见 docs/features/261017-nsfw-channel-v3）
    const presets = new PromptPresets(join(dir, "prompt-presets.json"));
    const [anchor] = await presets.list();
    expect(anchor?.name).toContain("限制级通道");
    expect(anchor?.messages.map((m) => m.role)).toEqual(["user", "assistant"]);
    expect(anchor?.messages[0]?.text).toContain("20 周岁以上");
    expect(anchor?.messages[0]?.text).toContain("above 20");
  });
});
