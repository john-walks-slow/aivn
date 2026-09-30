import type { AgentMessage } from "@earendil-works/pi-agent-core";
import { estimateContextTokens, estimateTokens } from "@earendil-works/pi-agent-core";

/**
 * 纪元压缩（epoch compaction）：长会话的上下文治理。
 *
 * 三区装配约定下，A 区（system）与 B 区（对话体）在一个纪元内逐 token 稳定以命中前缀缓存；
 * 纪元边界是唯一允许突变对话体的时刻：切掉早期轮次，压缩成一张 arcs 摘要卡（A 区新增一行，
 * 仍纪元内冻结），原文早已逐轮落进 archive，检索层照常命中。
 */

/** 单条消息在摘要输入里的截断上限：DSL 原文可很长，摘要只需剧情骨架。 */
const TRANSCRIPT_CHARS_PER_MESSAGE = 2000;
/** 摘要输入总量上限（字符）：防止极端窗口下一次性塞爆补全请求。 */
const TRANSCRIPT_CHARS_TOTAL = 120_000;

/** 摘要生成指令：只压事实不续写，输出首行一句话摘要 + 分节正文（首行即 arcs 卡的 summary）。 */
export const EPOCH_SUMMARY_SYSTEM = [
  "你是一部视觉小说的长期上下文整理员。下面是一段「玩家与剧作家」多轮演出的原文记录（按时间顺序）。",
  "请把它压缩成一份前情提要，供剧作家在后续创作中无缝续演。",
  "",
  "输出格式（严格遵守）：",
  "第一行：一句话概括这一段发生了什么（不超过 60 字，不要加 markdown 标题符号）。",
  "空一行后，从「## 剧情进展」开始分节正文。",
  "",
  "要求：",
  "- 只复述原文已有的事实，绝不新增剧情、动作或设定",
  "- 保留具体的角色名、地点、道具、已立下的状态与旗标名",
  "- 玩家的每一次表态与选择必须单独列出（这是玩家主权痕迹，不能概括掉）",
  "- 未回收的伏笔与悬念单列一节，方便后续接续",
].join("\n");

/** 单条消息渲染上限外的省略号。 */
const TRUNCATED = "…（略）";

/**
 * 对话体的 token 计量。触发判定与切尾点必须用**同一把尺子**，否则中文内容下
 * （pi 的字符启发式按 chars/4 折算，一个汉字只算 0.25 token，而 provider 实测约 1 token/字）
 * 会算出「预算 20000 token = 8 万汉字」，切尾点一路退到对话体开头，压缩永远判为「无可压段」。
 * 做法：拿 provider 报告的 usage 标定本地估算的系数，触发与切尾都乘同一个系数。
 */
export interface ContextMeasure {
  /** 对话体总 token（真实口径）。 */
  tokens: number;
  /** 本地估算 → 真实 token 的标定系数（无 usage 或异常时为 1）。 */
  scale: number;
}

export function measureContext(messages: readonly AgentMessage[]): ContextMeasure {
  const { tokens, usageTokens, trailingTokens, lastUsageIndex } = estimateContextTokens([
    ...messages,
  ]);
  if (lastUsageIndex === null || usageTokens <= 0) return { tokens, scale: 1 };
  let localPrefix = 0;
  for (let i = 0; i <= lastUsageIndex; i += 1) localPrefix += estimateTokens(messages[i]!);
  const scale = localPrefix > 0 ? usageTokens / localPrefix : 1;
  // 系数异常（网关漏报 usage 等）时退回 1，宁可估算粗一点也不算出负数/天文数字的保留段
  if (!Number.isFinite(scale) || scale <= 0 || scale > 10) return { tokens, scale: 1 };
  return { tokens: usageTokens + trailingTokens * scale, scale };
}

/**
 * 切尾点：返回保留尾部里第一条消息的下标（切掉 [0, cut)）。
 * 落点必须是一条 user 消息——保留段以完整的一轮开场，工具调用对不被劈开。
 * scale 为 measureContext 标定的系数，与触发判定同尺。
 * 返回 0 表示无段可压（对话体本身就短于保留预算）。
 */
export function pickCutIndex(
  messages: readonly AgentMessage[],
  keepRecentTokens: number,
  scale = 1,
): number {
  let tokens = 0;
  let cut = messages.length;
  while (cut > 0 && tokens < keepRecentTokens) {
    cut -= 1;
    tokens += estimateTokens(messages[cut]!) * scale;
  }
  while (cut < messages.length && messages[cut]?.role !== "user") cut += 1;
  // 下标 0 是 A 区 system 消息，不能进被压段；退无可退时判为无可压缩
  return cut >= messages.length || cut <= 1 ? 0 : cut;
}

/** 消息列表 → 供摘要模型阅读的纯文本转录（system 消息不在其中，调用方自行切片）。 */
export function renderTranscript(messages: readonly AgentMessage[]): string {
  const lines: string[] = [];
  for (const message of messages) {
    const line = renderMessage(message);
    if (line) lines.push(line);
  }
  let text = lines.join("\n\n");
  if (text.length > TRANSCRIPT_CHARS_TOTAL) {
    // 从尾部截断：最近的剧情比最早的更该进摘要
    text = `${TRUNCATED}\n${clipTail(text, TRANSCRIPT_CHARS_TOTAL)}`;
  }
  return text;
}

/** 压缩产物：首行一句话摘要（写进 arcs 卡）+ 其余正文。 */
export interface EpochSummary {
  oneLiner: string;
  body: string;
}

/** 模型爱加的通用标题：不是摘要本身，跳过它们再找第一行正文。 */
const GENERIC_TITLES = new Set([
  "前情提要",
  "摘要",
  "纪元摘要",
  "剧情概览",
  "概览",
  "小结",
  "总结",
  "剧情回顾",
]);

/** 拆分模型输出：首行 = 一句话摘要（index 卡的 summary），其余 = 详情（read_memory_detail 返回）。 */
export function splitSummary(text: string): EpochSummary {
  const lines = text.split("\n");
  let first = lines.findIndex((l) => l.trim() !== "");
  if (first === -1) return { oneLiner: "（本纪元无有效摘要）", body: text.trim() };
  // 轻量模型常先吐一个 markdown 标题；拿它当摘要会让 A 区索引变成「纪元 1：前情提要」
  while (first < lines.length && isGenericTitle(lines[first]!)) first += 1;
  if (first >= lines.length) first = 0;
  const oneLiner = lines[first]!.replace(/^#+\s*/, "").trim();
  const body = lines
    .slice(first + 1)
    .join("\n")
    .trim();
  return { oneLiner, body: body === "" ? oneLiner : body };
}

function isGenericTitle(line: string): boolean {
  const bare = line
    .trim()
    .replace(/^#+\s*/, "")
    .trim();
  return bare === "" || GENERIC_TITLES.has(bare);
}

/**
 * 压缩后回注对话体的前情提要：并进保留段的第一条 user 消息顶部（不另起一条 user——
 * 相邻两条同角色消息在部分 OpenAI 兼容网关上会被拒或打乱角色结构）。
 */
export function withSeed(tail: readonly AgentMessage[], seed: string): AgentMessage[] {
  const head = tail[0];
  if (head?.role !== "user")
    return [{ role: "user", content: seed, timestamp: Date.now() }, ...tail];
  return [{ ...head, content: `${seed}\n\n${blockText(head.content)}` }, ...tail.slice(1)];
}

/** 压缩后回注对话体的前情提要正文：告诉剧作家「这些已经是前情，别重演」。 */
export function renderSeed(epochNo: number, beatNo: number, body: string): string {
  return [
    `【前情提要·纪元 ${epochNo}】（截至第 ${beatNo} 轮的早期演出已压缩归档）`,
    "",
    body,
    "",
    "以上是已经发生的既定事实。请直接从当前场景继续往后写，不要重演、不要推翻已确立的情节。",
  ].join("\n");
}

function renderMessage(message: AgentMessage): string {
  switch (message.role) {
    case "user":
      return truncate(`【玩家/导演】${blockText(message.content)}`);
    case "assistant": {
      const text = blockText(message.content);
      const blocks = Array.isArray(message.content) ? message.content : [];
      const tools = blocks.filter((b) => b.type === "toolCall").map((b) => `[调用 ${b.name}]`);
      return truncate([text, ...tools].filter(Boolean).join("\n"));
    }
    case "toolResult":
      return truncate(`【记忆工具 ${message.toolName}】${blockText(message.content)}`);
    default:
      return "";
  }
}

function blockText(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .filter(
      (block): block is { type: "text"; text: string } =>
        (block as { type?: string })?.type === "text",
    )
    .map((block) => block.text)
    .join("\n")
    .trim();
}

function truncate(text: string): string {
  const trimmed = text.trim();
  if (trimmed.length <= TRANSCRIPT_CHARS_PER_MESSAGE) return trimmed;
  return `${clipHead(trimmed, TRANSCRIPT_CHARS_PER_MESSAGE)}${TRUNCATED}`;
}

/** 按码点裁剪（slice 会拦腰截断 emoji 的代理对，产生乱码字符）。 */
function clipHead(text: string, maxChars: number): string {
  return text.length <= maxChars ? text : [...text].slice(0, maxChars).join("");
}

/** 按码点保留尾部 maxChars 个字符。 */
function clipTail(text: string, maxChars: number): string {
  return text.length <= maxChars ? text : [...text].slice(-maxChars).join("");
}
