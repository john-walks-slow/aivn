import { describe, expect, it } from "vitest";
import type { AgentMessage } from "@earendil-works/pi-agent-core";
import type { Tool } from "@earendil-works/pi-ai";
import { agentInitialMessages, injectionMessages, withInjection } from "../src/promptInjection.js";

const user = (text: string): AgentMessage => ({ role: "user", content: text, timestamp: 0 });

const TOOLS = [{ name: "read", description: "读文件", parameters: { type: "object" } }] as unknown as Tool[];

describe("injectionMessages：四种角色翻译成 pi 的消息", () => {
  it("未启用或没有消息 = 什么都不注入", () => {
    expect(injectionMessages(undefined)).toEqual([]);
    expect(injectionMessages({ messages: [{ role: "user", text: "你好" }] })).toEqual([]);
    expect(injectionMessages({ enabled: true })).toEqual([]);
  });

  it("system / user / assistant 各落一条，顺序原样", () => {
    const messages = injectionMessages({
      enabled: true,
      messages: [
        { role: "system", text: "系统的话" },
        { role: "user", text: "用户的话" },
        { role: "assistant", text: "助手的话" },
      ],
    });
    expect(messages.map((m) => m.role)).toEqual(["system", "user", "assistant"]);
    expect(messages[0]).toMatchObject({ content: "系统的话" });
    expect(messages[1]).toMatchObject({ content: "用户的话" });
    expect(messages[2]).toMatchObject({ content: [{ type: "text", text: "助手的话" }] });
  });

  it("tool 落成「一次调用 + 它的结果」两条：协议要求成对，裸 toolResult 会被上游 400", () => {
    const messages = injectionMessages({
      enabled: true,
      messages: [{ role: "tool", text: "工具返回的内容" }],
    });
    expect(messages.map((m) => m.role)).toEqual(["assistant", "toolResult"]);
    const call = (messages[0] as { content: { type: string; id: string }[] }).content[0]!;
    const result = messages[1] as { toolCallId: string; toolName: string; content: unknown };
    expect(call.type).toBe("toolCall");
    expect(result.toolCallId).toBe(call.id);
    expect(result.toolName).toBe((call as unknown as { name: string }).name);
    expect(result.content).toEqual([{ type: "text", text: "工具返回的内容" }]);
  });
});

describe("withInjection：前置注入不叠第二份", () => {
  const injection = { enabled: true, messages: [{ role: "user", text: "开场铺垫" }] };

  it("空注入原样返回；有注入则排在对话之前", () => {
    const history = [user("第一句")];
    expect(withInjection(history, undefined)).toEqual(history);
    const with_ = withInjection(history, injection);
    expect(with_).toHaveLength(2);
    expect(with_[0]).toMatchObject({ content: "开场铺垫" });
    expect(with_[1]).toMatchObject({ content: "第一句" });
  });

  it("把上一次已经带在里面的那一份先摘掉——重建时传进来的就是现场消息", () => {
    const once = withInjection([user("第一句")], injection);
    const twice = withInjection(once, injection);
    expect(twice).toHaveLength(2);
    expect(twice.map((m) => (m as { content: unknown }).content)).toEqual([
      "开场铺垫",
      "第一句",
    ]);
  });

  it("只在开头完全对得上时才摘：玩家说的相似句子不误伤", () => {
    const history = [user("开场铺垫，但这是我说的"), user("第一句")];
    expect(withInjection(history, injection)).toHaveLength(3);
  });

  it("比对的是「角色 + 正文」整体相等：只改了注入内容时旧的那份认不出来，也就不动它", () => {
    // 去重刻意做成精确比对而不是位置切片——现场消息里排在前面的也可能是玩家真说过的话，
    // 按长度无脑切会把它们吃掉。换注入内容本身走的是重建（从谱系重放），不走这条路。
    const once = withInjection([user("第一句")], injection);
    const next = { enabled: true, messages: [{ role: "user", text: "换一份" }] };
    const messages = withInjection(once, next);
    expect(messages.map((m) => (m as { content: unknown }).content)).toEqual(["换一份", "开场铺垫", "第一句"]);
  });
});

describe("agentInitialMessages：引擎系统提示词恒为第一条", () => {
  const injection = {
    enabled: true,
    messages: [
      { role: "system" as const, text: "注入·系统" },
      { role: "user" as const, text: "注入·用户" },
    ],
  };

  it("注入组以 system 打头也不顶掉引擎提示词（pi 只在首条不是 system 时才自动插入）", () => {
    const messages = agentInitialMessages({
      systemPrompt: "引擎契约",
      tools: TOOLS,
      history: [user("第一句")],
      injection,
    });
    expect(messages.map((m) => m.role)).toEqual(["system", "system", "user", "user"]);
    expect(messages[0]).toMatchObject({ content: "引擎契约" });
    // 工具声明挂在首条系统消息上（pi 的 createInitialSystemMessage 就是把它放这里）
    expect(messages[0]).toMatchObject({ toolsAdded: [{ name: "read" }] });
    expect(messages[1]).toMatchObject({ content: "注入·系统" });
  });

  it("没开注入时就是不带头部的对话体", () => {
    const messages = agentInitialMessages({
      systemPrompt: "引擎契约",
      tools: TOOLS,
      history: [user("第一句")],
    });
    expect(messages.map((m) => m.role)).toEqual(["system", "user"]);
  });

  it("拿上一轮的现场消息重建：头部与注入都不叠第二份", () => {
    const once = agentInitialMessages({
      systemPrompt: "引擎契约",
      tools: TOOLS,
      history: [user("第一句")],
      injection,
    });
    const twice = agentInitialMessages({
      systemPrompt: "引擎契约",
      tools: TOOLS,
      history: once,
      injection,
    });
    expect(twice.map((m) => m.role)).toEqual(["system", "system", "user", "user"]);
  });
});
