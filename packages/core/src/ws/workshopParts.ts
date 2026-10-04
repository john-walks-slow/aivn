import type { WorkshopAssetView, WorkshopPart } from "./protocol.js";

/**
 * 工坊段落流的拼装规则。服务端（落盘与 done 的权威 parts）与前端（流式期间）共用同一份——
 * 两边各写一遍的话，症状是「流式时看着对，收束后换了样」。
 *
 * 全部按数组末尾就近合并：思考与正文各自续在最后一段同类上，工具调用按 toolCallId 配对。
 */

/** 追加一段正文增量。 */
export function appendText(parts: readonly WorkshopPart[], delta: string): WorkshopPart[] {
  const last = parts.at(-1);
  if (last?.type === "text") return [...parts.slice(0, -1), { type: "text", text: last.text + delta }];
  return [...parts, { type: "text", text: delta }];
}

/** 追加一段思考增量。 */
export function appendThinking(parts: readonly WorkshopPart[], delta: string): WorkshopPart[] {
  const last = parts.at(-1);
  if (last?.type === "thinking") {
    return [...parts.slice(0, -1), { type: "thinking", text: last.text + delta }];
  }
  return [...parts, { type: "thinking", text: delta }];
}

/** 开始一次工具调用。 */
export function startTool(
  parts: readonly WorkshopPart[],
  tool: { id: string; name: string; args: unknown },
): WorkshopPart[] {
  return [...parts, { type: "tool", id: tool.id, name: tool.name, args: tool.args }];
}

/** 结束一次工具调用：按 id 就地补上结果，调用方没给的部分（如已挂的素材）原样留着。 */
export function endTool(
  parts: readonly WorkshopPart[],
  done: { id: string; result: string; isError: boolean; ms: number },
): WorkshopPart[] {
  return parts.map((part) =>
    part.type === "tool" && part.id === done.id ? { ...part, ...done, id: part.id } : part,
  );
}

/** 把素材挂到产出它的那次调用上（按 toolCallId）。 */
export function attachToolAssets(
  parts: readonly WorkshopPart[],
  toolCallId: string,
  assets: readonly WorkshopAssetView[],
): WorkshopPart[] {
  if (assets.length === 0) return [...parts];
  return parts.map((part) =>
    part.type === "tool" && part.id === toolCallId
      ? { ...part, assets: [...(part.assets ?? []), ...assets] }
      : part,
  );
}

/**
 * 归一成段落流。旧线程文件（以及用户消息）只有 text，没有 parts——
 * 渲染路径因此只有一条，不用在组件里到处判空。
 */
export function normalizeParts(message: { text: string; parts?: WorkshopPart[] }): WorkshopPart[] {
  if (message.parts) return message.parts;
  return message.text === "" ? [] : [{ type: "text", text: message.text }];
}
