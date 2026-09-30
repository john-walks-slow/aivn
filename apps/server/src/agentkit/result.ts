import type { AgentToolResult } from "@earendil-works/pi-agent-core";

/** 纯文本回执：绝大多数工具的返回形态。 */
export function textResult(text: string): AgentToolResult {
  return { content: [{ type: "text", text }], details: undefined };
}

/** 多段回执（生图那种一行一段的）。 */
export function linesResult(lines: readonly string[]): AgentToolResult {
  return textResult(lines.filter(Boolean).join("\n\n"));
}

/** 异常取一句话（模型要靠它决定重试还是改参数，所以不塞堆栈）。 */
export function reason(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
