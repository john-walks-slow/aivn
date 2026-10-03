import type { AgentMessage } from "@earendil-works/pi-agent-core";
import { calculateContextTokens, estimateContextTokens, estimateTokens } from "@earendil-works/pi-agent-core";
import { renderBeatDone } from "./agentkit/beatTool.js";

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
 *
 * 预算落在消息中间时先向后顺延到下一条 user（宁可少留也不超预算）。顺延会越界时改为
 * 向前退到本轮开头：对话体尾巴上永远挂着 beat_done 的 toolResult，而它本身没有下一条 user，
 * 只认顺延的话这里恒判「无可压段」——纪元压缩一辈子不触发，长会话会一路涨到模型报错。
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
  let next = cut;
  while (next < messages.length && messages[next]?.role !== "user") next += 1;
  if (next < messages.length) cut = next;
  else while (cut > 1 && messages[cut]?.role !== "user") cut -= 1;
  // 下标 0 是 A 区 system 消息，不能进被压段；退无可退时判为无可压缩
  return messages[cut]?.role !== "user" || cut <= 1 ? 0 : cut;
}

/** 消息列表 → 供摘要模型阅读的纯文本转录（system 消息不在其中，调用方自行切片）。 */
export function renderTranscript(messages: readonly AgentMessage[]): string {
  return renderTranscriptAs(messages, { user: "【玩家/导演】" });
}

/** 转录的说话人标签：工坊那边用户是剧目作者、助手是搭台助手，默认那套是演出口径。 */
export interface TranscriptLabels {
  user: string;
  /** 不给则助手不带标签（演出侧原文如此）。 */
  assistant?: string;
}

export function renderTranscriptAs(
  messages: readonly AgentMessage[],
  labels: TranscriptLabels,
): string {
  const lines: string[] = [];
  for (const message of messages) {
    const line = renderMessage(message, labels);
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

function renderMessage(message: AgentMessage, labels?: TranscriptLabels): string {
  switch (message.role) {
    case "user":
      return truncate(`${labels?.user ?? "【玩家/导演】"}${blockText(message.content)}`);
    case "assistant": {
      const text = blockText(message.content);
      const blocks = Array.isArray(message.content) ? message.content : [];
      const tools = blocks
        .filter((b) => b.type === "toolCall")
        .map((b) => (b.name === "beat_done" ? renderBeatDone(b.arguments) : `[调用 ${b.name}]`));
      const body = [text, ...tools].filter(Boolean).join("\n");
      return truncate(labels?.assistant ? `${labels.assistant}${body}` : body);
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

// ── 工坊线程：同一套治理的另一处落点 ──────────────────────────────
//
// 工坊每轮重建 Agent、全量回灌线程历史（workshop.ts），没有常驻对话体。压缩做的事一样：
// 切掉早期轮次压成一张摘要卡，只是不进 memory（搭台过程不是剧目事实）而落线程元数据。

/** 工坊线程的一轮：结构化类型，不反向依赖 workshop.ts。 */
export interface ThreadTurn {
  role: "user" | "assistant";
  text: string;
}

/**
 * 线程上下文的 token 估算：systemPrompt + 消息列表，整体乘同一个 scale。
 * 与 estimateContextTokens 同一把尺子（pi 的 chars/4 估算 × 标定系数），
 * 只是标定系数得从上一轮的 provider usage 存下来——工坊历史是纯文本，消息里没有 usage。
 */
export function estimateThreadTokens(
  systemPrompt: string,
  messages: readonly AgentMessage[],
  scale = 1,
): number {
  let local = textTokens(systemPrompt);
  for (const message of messages) local += messageTokens(message);
  return Math.round(local * scale);
}

/**
 * 切尾点：返回保留尾部里第一条 user 消息的**相对**下标（切掉 [0, cut)）。
 * 落点必须是 user 消息——保留段以完整一轮开场。scale 与计量同尺。
 * 返回 0 表示无段可压（对话体本身就短于保留预算）。
 */
export function pickThreadCutIndex(
  history: readonly ThreadTurn[],
  keepRecentTokens: number,
  scale = 1,
): number {
  let tokens = 0;
  let cut = history.length;
  while (cut > 0 && tokens < keepRecentTokens) {
    cut -= 1;
    tokens += turnTokens(history[cut]!) * scale;
  }
  if (cut === 0) return 0;
  // 预算落在消息中间时向后顺延到下一条 user（宁可少留也不劈开一轮）；顺延越界则退到本轮开头。
  let next = cut;
  while (next < history.length && history[next]!.role !== "user") next += 1;
  if (next < history.length) cut = next;
  else while (cut > 0 && history[cut]!.role !== "user") cut -= 1;
  return cut > 0 && history[cut]!.role === "user" ? cut : 0;
}

/**
 * 从一轮跑完的 agent 消息里标定 scale：provider 实测 usage ÷ 到那条 assistant 为止的本地估算。
 * 口径与 pi 的 estimateContextTokens 一致（usage 落在最后一条有效 assistant 上）。
 * usage 缺失/全零、系数越界 → 返回 null（调用方按 1 算）。
 */
export function calibrateTokenScale(
  systemPrompt: string,
  messages: readonly AgentMessage[],
): number | null {
  let index = -1;
  let usageTokens = 0;
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    const message = messages[i]!;
    if (
      message.role === "assistant" &&
      message.stopReason !== "aborted" &&
      message.stopReason !== "error" &&
      calculateContextTokens(message.usage) > 0
    ) {
      index = i;
      usageTokens = calculateContextTokens(message.usage);
      break;
    }
  }
  if (index < 0) return null;
  let local = textTokens(systemPrompt);
  for (let i = 0; i <= index; i += 1) {
    // system 消息已由 systemPrompt 计过一遍（这里的口径是「prompt + 不含 system 的消息」）
    if (messages[i]!.role === "system") continue;
    local += messageTokens(messages[i]!);
  }
  if (local <= 0) return null;
  const scale = usageTokens / local;
  if (!Number.isFinite(scale) || scale <= 0 || scale > 10) return null;
  return scale;
}

/** 摘要正文上限：再长就把开头的早期结论挤掉（新一轮摘要是拿这份定稿当底稿重写的）。 */
export const DIGEST_MAX_CHARS = 6000;

/** 摘要正文封顶：从尾部保留（最新状态最该留），丢掉的早期部分留一条标记。 */
export function capDigest(text: string, maxChars = DIGEST_MAX_CHARS): string {
  const trimmed = text.trim();
  if (trimmed.length <= maxChars) return trimmed;
  return `（更早的对话已不再保留）\n${clipTail(trimmed, maxChars)}`;
}

/** 单轮文本的 token 估算：与 pi 的 chars/4 同尺，中文误差由 scale 统一纠正。 */
function turnTokens(turn: ThreadTurn): number {
  return Math.ceil(turn.text.length / 4);
}

function textTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

/**
 * 单条消息的 token 估算。pi 的 estimateTokens 不认 system role（返回 0），
 * 而工坊的 A 区（文件清单 + 技能 + 写作要点）是上下文的大头，不能当零——自己按同一把尺子补上。
 */
function messageTokens(message: AgentMessage): number {
  return message.role === "system" ? textTokens(blockText(message.content)) : estimateTokens(message);
}
