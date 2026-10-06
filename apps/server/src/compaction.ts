import type { AgentMessage } from "@earendil-works/pi-agent-core";
import { calculateContextTokens, estimateContextTokens, estimateTokens } from "@earendil-works/pi-agent-core";
import { renderBeatDone } from "./agentkit/beatTool.js";

/**
 * 纪元压缩（epoch compaction）：长会话的上下文治理。
 *
 * 三区装配约定下，A 区（system）与 B 区（对话体）在一个纪元内逐 token 稳定以命中前缀缓存；
 * 纪元边界是唯一允许突变对话体的时刻：切掉早期轮次，压成一份摘要。原文早已逐轮落进 archive，
 * 检索层照常命中。
 *
 * **两侧共用**：计量尺子（`estimateMessageTokens` / `localTextTokens`）、切点
 * （`pickCompactionCut`）、转录与摘要整形（`renderTranscript*` / `splitSummary` / `compactionText`）。
 * **记录各持一份**：演出侧落谱系快照（core 的 `CompactionRecord`，重放时由 `rebuild.ts`
 * 投影对话体），工坊侧落线程元数据（`ThreadCompaction`，每轮重建提示词时注入 A 区）——
 * 真相源不同（树上重放 vs 线程文件），这一点不强行合并。
 *
 * 所以这里只管「量」：计量、切点、转录、摘要产物的整形。何时压归两侧各自的会话层，
 * 怎么生效归各自的重建路径。
 */

/** 单条消息在摘要输入里的截断上限：DSL 原文可很长，摘要只需剧情骨架。 */
const TRANSCRIPT_CHARS_PER_MESSAGE = 2000;
/** 摘要输入总量上限（字符）：防止极端窗口下一次性塞爆补全请求。 */
const TRANSCRIPT_CHARS_TOTAL = 120_000;

/** 摘要生成指令：只压事实不续写。首行一句话摘要、其后分节正文，两者都会进压缩记录。 */
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
  /** 上下文总 token：有 usage 时按实测（含 A 区），没有时是 A 区 + 对话体的 CJK 加权下限。 */
  tokens: number;
  /** 本地估算 → 真实 token 的标定系数（无 usage 或异常时为 1）。 */
  scale: number;
}

export function measureContext(messages: readonly AgentMessage[]): ContextMeasure {
  const local = messages.map(estimateMessageTokens);
  const localTotal = local.reduce((sum, n) => sum + n, 0);
  const { usageTokens, lastUsageIndex } = estimateContextTokens([...messages]);
  if (lastUsageIndex === null || usageTokens <= 0) {
    // 没有 usage 可标定（冷启动、从谱系重放出来的对话体）：按 CJK 加权的保守下限。
    // 这里退回 pi 的 chars/4 会让中文对话体（实测 ≈1 token/字）低估 2.4–4 倍，
    // 压缩线永远够不到，长会话会一路涨到模型报错。
    return { tokens: localTotal, scale: 1 };
  }
  let localPrefix = 0;
  for (let i = 0; i <= lastUsageIndex; i += 1) localPrefix += local[i]!;
  const scale = localPrefix > 0 ? usageTokens / localPrefix : 1;
  // 系数异常（网关漏报 usage 等）时退回 1，宁可估算粗一点也不算出负数/天文数字的保留段
  if (!Number.isFinite(scale) || scale <= 0 || scale > 10) return { tokens: localTotal, scale: 1 };
  return { tokens: usageTokens + (localTotal - localPrefix) * scale, scale };
}

/**
 * 单条消息的 token 估算：pi 的尺子 + 中文散文的加权修正。
 *
 * `estimateTokens` 一律按 chars/4 折算，一个汉字只算 0.25 token，而 provider 实测约 1 token/字；
 * 差额只补在正文与思考上，工具结构、图片那些仍用 pi 的估算（两块口径不能混起来算）。
 */
export function estimateMessageTokens(message: AgentMessage): number {
  // bashExecution 一类消息没有 content 字段（它按 command/output 计），取不到就当没有散文
  const prose = proseText((message as { content?: unknown }).content);
  const base = message.role === "system" ? 0 : estimateTokens(message);
  if (prose === "") return base;
  return base + localTextTokens(prose) - Math.ceil(prose.length / 4);
}

/** CJK 加权字数：汉字按 1 token/字，其余按 chars/4。 */
export function localTextTokens(text: string): number {
  let cjk = 0;
  let rest = 0;
  for (const ch of text) {
    if (isCjk(ch)) cjk += 1;
    else rest += 1;
  }
  return cjk + Math.ceil(rest / 4);
}

/** 汉字与全角标点：中日韩表意文字、假名、CJK 标点与全角形式。 */
function isCjk(ch: string): boolean {
  const code = ch.codePointAt(0) ?? 0;
  return (
    (code >= 0x3000 && code <= 0x303f) ||
    (code >= 0x3040 && code <= 0x30ff) ||
    (code >= 0x3400 && code <= 0x4dbf) ||
    (code >= 0x4e00 && code <= 0x9fff) ||
    (code >= 0xf900 && code <= 0xfaff) ||
    (code >= 0xff00 && code <= 0xffef)
  );
}

/** 消息里的散文部分（正文与思考）——中文加权只作用在它上面。 */
function proseText(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  const parts: string[] = [];
  for (const block of content as Array<{ type?: string; text?: string; thinking?: string }>) {
    if (block?.type === "text" && typeof block.text === "string") parts.push(block.text);
    else if (block?.type === "thinking" && typeof block.thinking === "string") {
      parts.push(block.thinking);
    }
  }
  return parts.join("\n");
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

/** 压缩产物：首行一句话摘要（工坊面板的标题行）+ 其余正文。 */
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

/** 拆分模型输出：首行一句话摘要（工坊面板的标题行），其余是正文。 */
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
 * 接力前情提要：并进保留段的第一条 user 消息顶部（不另起一条 user——相邻两条同角色消息
 * 在部分 OpenAI 兼容网关上会被拒或打乱角色结构）。
 *
 * 只用在 `carryOver` 那条路上（工坊改了 A 区、runtime 重建时把最近几轮接给新实例）；
 * 纪元压缩不走这里——它的前情提要由 `rebuild.ts` 在投影时就并进保留段首拍了。
 */
export function withSeed(tail: readonly AgentMessage[], seed: string): AgentMessage[] {
  const head = tail[0];
  if (head?.role !== "user")
    return [{ role: "user", content: seed, timestamp: Date.now() }, ...tail];
  return [{ ...head, content: `${seed}\n\n${blockText(head.content)}` }, ...tail.slice(1)];
}

/**
 * 压缩记录的摘要正文：模型输出的全部内容（只去掉开场那个通用标题）。
 *
 * 剧作家拿到的就是这一份，所以不再拆「一句话 + 正文」——那个形状是给 A 区索引卡用的，
 * 索引卡已经没有了。工坊线程仍走 splitSummary（它的面板要一行标题）。
 */
export function compactionText(raw: string): string {
  const { oneLiner, body } = splitSummary(raw);
  return body === oneLiner ? oneLiner : `${oneLiner}\n\n${body}`;
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
  for (const message of messages) local += estimateMessageTokens(message);
  return Math.round(local * scale);
}

/**
 * 压缩切点：一串「单位」（演出侧 = 一拍，工坊侧 = 一轮）各自多少 token，
 * 返回保留段第一条单位的下标（切掉 [0, keepFrom)）。
 *
 * 两侧共用的语义：
 * - 切点只落在单位边界上，半拍/半轮永远不进保留段；
 * - 连最后一条单位都超预算时只留它（`length - 1`）——宁可压掉太多，也不把整段留在上下文里等着撞窗口；
 * - `null` = 无可压段（只有一条单位，或整段本来就装得下）。
 *
 * 单位从哪来、切点怎么映射回真相源（该拍的 `boundaryId` / 该轮的首条消息下标）归调用方。
 */
export function pickCompactionCut(
  unitTokens: readonly number[],
  keepRecentTokens: number,
): number | null {
  if (unitTokens.length < 2) return null;
  let kept = 0;
  let keepFrom = unitTokens.length;
  while (keepFrom > 0) {
    const cost = unitTokens[keepFrom - 1]!;
    if (kept + cost > keepRecentTokens) break;
    kept += cost;
    keepFrom -= 1;
  }
  if (keepFrom === unitTokens.length) return unitTokens.length - 1;
  return keepFrom === 0 ? null : keepFrom;
}

/**
 * 工坊线程的切点：单位是一轮（一条 user + 它后面的 assistant），
 * 返回保留段第一条**消息**的下标。0 = 无段可压（与 `pickCompactionCut` 的 null 同义）。
 * scale 与计量同尺。
 */
export function pickThreadCutIndex(
  history: readonly ThreadTurn[],
  keepRecentTokens: number,
  scale = 1,
): number {
  const units: { start: number; tokens: number }[] = [];
  for (let i = 0; i < history.length; i += 1) {
    const turn = history[i]!;
    // 一条 user 起一轮；开头的 assistant（不正常的历史）并进第一轮，不另起一条
    if (turn.role === "user" || units.length === 0) units.push({ start: i, tokens: 0 });
    const unit = units[units.length - 1]!;
    unit.tokens += turnTokens(turn) * scale;
  }
  const keepFrom = pickCompactionCut(
    units.map((unit) => unit.tokens),
    keepRecentTokens,
  );
  return keepFrom === null ? 0 : units[keepFrom]!.start;
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
    local += estimateMessageTokens(messages[i]!);
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

/** 单轮文本的 token 估算：与 estimateMessageTokens 同一把 CJK 加权的尺子。 */
function turnTokens(turn: ThreadTurn): number {
  return localTextTokens(turn.text);
}

function textTokens(text: string): number {
  return localTextTokens(text);
}
