import type { AgentMessage } from "@earendil-works/pi-agent-core";
import { createInitialSystemMessage, toToolDeclaration, type AssistantMessage, type Tool } from "@earendil-works/pi-ai";
import type { InjectionMessage, PromptInjection } from "@aivn/core";

/**
 * 上下文注入（Agent 页的「提示词注入」）在服务端的唯一实现：把 play.json 里那一组
 * `{ role, text }` 翻译成 pi 的消息，并前置到 agent 的消息列表开头。
 *
 * 两个 agent（剧作家 / 工坊）走同一份——同一份配置在两个宿主里各拼一次必然漂。
 *
 * 三条约定：
 * - **只在 `enabled` 为真且真有消息时注入**，关掉即恢复原样（不残留半份）。
 * - **注入是引擎给模型的底色，不是剧目发生过的事**：不落谱系、不进工坊对话记录，
 *   每次组装上下文时现拼。
 * - **`tool` 角色补出一次工具调用**：协议要求工具结果必须紧跟对应的调用（裸 `toolResult`
 *   会被 OpenAI 兼容层 400），所以一条 tool 消息落成 assistant(toolCall) + toolResult 两条。
 */

/** tool 角色补出来的那次调用的名字：它只是承载体，不会出现在任何一方的工具表里。 */
const INJECTED_TOOL_NAME = "injected_context";

/** 注入消息：按 play.json 里的顺序拼成一串 pi 消息。未启用 / 空消息 = 空数组。 */
export function injectionMessages(injection: PromptInjection | undefined): AgentMessage[] {
  if (!injection?.enabled) return [];
  const out: AgentMessage[] = [];
  (injection.messages ?? []).forEach((message, index) => {
    out.push(...messageOf(message, index));
  });
  return out;
}

/**
 * agent 的初始消息列表：**引擎系统提示词永远是第一条**，注入紧随其后，再后面是这一局的对话。
 *
 * 为什么不直接把注入拼在最前面交给 pi：pi 只在 `messages[0]` 不是 system 时才把
 * `initialState.systemPrompt` 落成首条系统消息（pi-agent-core 的 `createMutableAgentState`）。
 * 注入组里打头的 system 会把引擎提示词整段挤掉——DSL 契约、工具声明、能力边界全在里面，
 * 掉了这一条整场演出就散了。所以首条由这里自己落，注入跟在它后面。
 */
export function agentInitialMessages(opts: {
  systemPrompt: string;
  tools: readonly Tool[];
  history: readonly AgentMessage[];
  injection?: PromptInjection;
}): AgentMessage[] {
  const head = createInitialSystemMessage(opts.systemPrompt, opts.tools.map(toToolDeclaration));
  const body = withInjection(withoutOwnHead(opts.history), opts.injection);
  return head ? [head, ...body] : body;
}

/**
 * 摘掉现场消息的第一条——那正是上一轮由 {@link agentInitialMessages} 落的引擎系统提示词。
 * 别的来源（谱系重放、工坊对话体）都不会以 system 开头，所以这里只认第一条。
 */
function withoutOwnHead(history: readonly AgentMessage[]): AgentMessage[] {
  return history[0]?.role === "system" ? [...history.slice(1)] : [...history];
}

/**
 * 把注入前置到对话体开头。
 *
 * 重建时传进来的可能是**上一轮的现场消息**（里面已经带着这一份注入），所以先在开头
 * 认出并摘掉旧的那一份：直接叠加会让同一组消息在上下文里出现两次，而前缀缓存也白丢。
 */
export function withInjection(
  messages: readonly AgentMessage[],
  injection: PromptInjection | undefined,
): AgentMessage[] {
  const prelude = injectionMessages(injection);
  if (prelude.length === 0) return [...messages];
  const body = startsWith(messages, prelude) ? messages.slice(prelude.length) : messages;
  return [...prelude, ...body];
}

function messageOf(message: InjectionMessage, index: number): AgentMessage[] {
  switch (message.role) {
    case "system":
      return [{ role: "system", content: message.text, timestamp: 0 }];
    case "user":
      return [{ role: "user", content: message.text, timestamp: 0 }];
    case "assistant":
      return [assistantMessage([{ type: "text", text: message.text }])];
    case "tool": {
      const toolCallId = `injected-tool-${index}`;
      return [
        assistantMessage([
          { type: "toolCall", id: toolCallId, name: INJECTED_TOOL_NAME, arguments: {} },
        ]),
        {
          role: "toolResult",
          toolCallId,
          toolName: INJECTED_TOOL_NAME,
          content: [{ type: "text", text: message.text }],
          isError: false,
          timestamp: 0,
        },
      ];
    }
  }
}

/** 合成一条 assistant 消息：注入的那条没有真实请求背书，于是用量与停止原因都填零值。 */
function assistantMessage(content: AssistantMessage["content"]): AgentMessage {
  return {
    role: "assistant",
    content,
    api: "openai-completions",
    provider: "aivn-injection",
    model: "injection",
    usage: {
      input: 0,
      output: 0,
      cacheRead: 0,
      cacheWrite: 0,
      totalTokens: 0,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
    },
    stopReason: "stop",
    timestamp: 0,
  };
}

/** 消息列表开头是不是就是这一份注入：按「角色 + 正文」比，不比时间戳与用量。 */
function startsWith(messages: readonly AgentMessage[], prelude: readonly AgentMessage[]): boolean {
  if (messages.length < prelude.length) return false;
  return prelude.every((message, index) => keyOf(message) === keyOf(messages[index]!));
}

function keyOf(message: AgentMessage): string {
  const content = (message as { content?: unknown }).content;
  if (typeof content === "string") return `${message.role}:${content}`;
  if (Array.isArray(content)) {
    const parts = content.map((block) => {
      const item = block as { text?: string; name?: string };
      return item.text ?? item.name ?? "";
    });
    return `${message.role}:${parts.join("\u0000")}`;
  }
  return `${message.role}:`;
}
