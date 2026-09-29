import type { AgentEvent, AgentTool, StreamFn } from "@earendil-works/pi-agent-core";
import { Agent } from "@earendil-works/pi-agent-core";
import { type Api, type Model, type Static, Type } from "@earendil-works/pi-ai";
import { LineageTree, parsePlayConfig, type LineageEvent, type LineageEventKind, type LineageSnapshot } from "@stage-ai/core";
import type { PlayFiles } from "./playFiles.js";
import { assertSaveId, type PlaySaves } from "./saves.js";
import type { PlayStore, Readiness } from "./store.js";

/**
 * 工坊 agent（D9）：与 playwriter 并列的**独立 pi 实例**，只管搭台（剧目文件的创建与维护），
 * 不参与演出。工具限于剧目文件白名单 + 就绪检查——它拿不到会话日志、lineage 与 TTS 缓存。
 * 例外：`list_saves` / `read_lineage` 只读故事树（周目级），不提供任何改写入口。
 */

/** 工坊 agent 的一次写盘（前端在对话流里内联展示 + 可撤销）。 */
export interface WorkshopWrite {
  path: string;
  /** 写盘前的内容（撤销用；文件原本不存在则为 null）。 */
  before: string | null;
  after: string;
}

export interface WorkshopToolDeps {
  files: PlayFiles;
  store: PlayStore;
  /** 写盘回调：推给前端（可见/可撤销），不阻塞 agent。 */
  onWrite: (write: WorkshopWrite) => void;
  /** 周目（存档）枚举——读故事树前先让 agent 知道有哪几棵。 */
  saves: PlaySaves;
  /** 按 saveId 取存档级操作面（会话面），供 read_lineage 读树。 */
  saveStore: (saveId: string) => PlayStore;
}

const emptyParams = Type.Object({}, { additionalProperties: false });
const readFileParams = Type.Object({ path: Type.String({ maxLength: 300 }) }, { additionalProperties: false });
const saveIdParams = Type.Object({ saveId: Type.String({ maxLength: 64 }) }, { additionalProperties: false });
const readLineageParams = Type.Object(
  {
    saveId: Type.String({ maxLength: 64 }),
    /** 从第几条开始（0 起）。节点按 turn 升序，分页游标。 */
    offset: Type.Optional(Type.Number()),
    limit: Type.Optional(Type.Number()),
    /** 只要当前分支路径上的节点（默认）还是全量节点含废弃分支。 */
    allBranches: Type.Optional(Type.Boolean()),
  },
  { additionalProperties: false },
);
const writeFileParams = Type.Object(
  { path: Type.String({ maxLength: 300 }), content: Type.String({ maxLength: 200_000 }) },
  { additionalProperties: false },
);

function textResult(text: string): { content: { type: "text"; text: string }[]; details: undefined } {
  return { content: [{ type: "text" as const, text }], details: undefined };
}

function reason(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * 工坊工具组：list_files / read_file / write_file / delete_file / get_readiness。
 * write_file 对 play.json 走 parsePlayConfig 校验——模型手写 JSON 出错时不落盘、把错误回给模型重试。
 */
export function createWorkshopTools(deps: WorkshopToolDeps): AgentTool<any>[] {
  const listFiles: AgentTool<typeof emptyParams> = {
    name: "list_files",
    label: "列出剧目文件",
    description: "列出剧目里可编辑与可查看的文件（play.json、memory/**、assets/**）。",
    parameters: emptyParams,
    execute: async () => {
      const files = await deps.files.list();
      return textResult(
        files.map((f) => `${f.writable ? "可写" : "只读"} ${f.path}（${f.size}B）`).join("\n") || "（无文件）",
      );
    },
  };

  const readFile: AgentTool<typeof readFileParams> = {
    name: "read_file",
    label: "读剧目文件",
    description: "读取剧目文件全文（限 play.json、memory/**、assets/**）。",
    parameters: readFileParams,
    execute: async (_id, params: Static<typeof readFileParams>) => {
      try {
        return textResult(await deps.files.read(params.path));
      } catch (error) {
        return textResult(`读取失败：${reason(error)}`);
      }
    },
  };

  const writeFile: AgentTool<typeof writeFileParams> = {
    name: "write_file",
    label: "写剧目文件",
    description:
      "写入剧目文件（可写范围：play.json、memory/** 的 .md/.json/.txt、assets/manifest.json）。play.json 结构校验不过则不落盘。",
    parameters: writeFileParams,
    execute: async (_id, params: Static<typeof writeFileParams>) => {
      const { path, content } = params;
      if (path === "play.json") {
        try {
          parsePlayConfig(JSON.parse(content));
        } catch (error) {
          return textResult(`play.json 校验失败，未写入：${reason(error)}`);
        }
      }
      let before: string | null = null;
      try {
        before = await deps.files.read(path);
      } catch {
        before = null;
      }
      try {
        const written = await deps.files.write(path, content);
        deps.onWrite({ path: written, before, after: content });
        return textResult(`已写入 ${written}（${content.length} 字）`);
      } catch (error) {
        return textResult(`写入失败：${reason(error)}`);
      }
    },
  };

  const deleteFile: AgentTool<typeof readFileParams> = {
    name: "delete_file",
    label: "删除剧目文件",
    description: "删除 memory/ 下的文件（play.json 不可删除）。",
    parameters: readFileParams,
    execute: async (_id, params: Static<typeof readFileParams>) => {
      let before: string | null;
      try {
        before = await deps.files.read(params.path);
      } catch (error) {
        return textResult(`删除失败：${reason(error)}`);
      }
      if (params.path === "play.json") return textResult("play.json 不可删除");
      try {
        await deps.files.remove(params.path);
        deps.onWrite({ path: params.path, before, after: "" });
        return textResult(`已删除 ${params.path}`);
      } catch (error) {
        return textResult(`删除失败：${reason(error)}`);
      }
    },
  };

  const readiness: AgentTool<typeof emptyParams> = {
    name: "get_readiness",
    label: "检查就绪门",
    description: "检查剧目是否达到可开演条件（premise / 角色立绘映射 / 背景图）。",
    parameters: emptyParams,
    execute: async () => textResult(renderReadiness(await deps.store.readiness())),
  };

  const listSaves: AgentTool<typeof emptyParams> = {
    name: "list_saves",
    label: "列出周目",
    description:
      "列出这部剧目的全部周目（存档）及其 id、名称、拍数、最后一句。要读故事树时先用它拿 saveId。",
    parameters: emptyParams,
    execute: async () => {
      const list = await deps.saves.list();
      if (list.length === 0) return textResult("（还没有任何周目）");
      return textResult(
        list
          .map((s) => `${s.id}\t${s.name}${s.current ? "（当前活动档）" : ""}\t${s.beats} 拍\t最后：${s.preview || "（无）"}`)
          .join("\n"),
      );
    },
  };

  const readLineage: AgentTool<typeof readLineageParams> = {
    name: "read_lineage",
    label: "读故事树",
    description:
      "只读某个周目的故事树（行级事件日志），按顺序返回节点 id、类型、台词。想改剧情结构（分岔/编辑/重写）请告诉用户去舞台的「路线」视图操作，你没有写权限。",
    parameters: readLineageParams,
    execute: async (_id, params: Static<typeof readLineageParams>) => {
      try {
        // 先验 id 再验存在：非法 id 与不存在的周目是两种错，模型要能分清
        const saveId = assertSaveId(params.saveId);
        if (!(await deps.saves.has(saveId))) {
          return textResult(`周目 ${saveId} 不存在，先用 list_saves 看有哪些周目。`);
        }
        const session = await deps.saveStore(saveId).loadSession();
        if (!session) return textResult(`周目 ${saveId} 还没有演出版本（session.json 不存在或读不出）。`);
        return textResult(renderLineage(saveId, session.store, params));
      } catch (error) {
        return textResult(`读取失败：${reason(error)}`);
      }
    },
  };

  return [listFiles, readFile, writeFile, deleteFile, readiness, listSaves, readLineage];
}

/** 行级事件的中文标签（给 agent 读的，别丢英文 kind 原样给它猜）。 */
const LINEAGE_KIND_LABEL: Record<string, string> = {
  scene: "场景",
  actor: "角色登场",
  say: "台词",
  narrate: "旁白",
  thought: "心理",
  sfx: "音效",
  preload: "预载素材",
  cg: "CG",
  stop: "停止点",
  player: "玩家表态",
  ooc: "导演注",
  beat_end: "幕末",
  edit: "改写行",
  rewrite: "重写请求",
};

function kindLabel(kind: LineageEventKind): string {
  return LINEAGE_KIND_LABEL[kind] ?? kind;
}

/** 一行事件的紧凑文本：id、类型、台词截断。 */
function renderEventLine(
  ev: { id: string; kind: LineageEventKind; text?: string; onPath: boolean; seq?: number; editTargetId?: string | undefined },
  textLimit = 60,
): string {
  const path = ev.onPath ? "" : "（废弃分支）";
  const seq = ev.seq === undefined ? "" : ` seq=${ev.seq}`;
  const target = ev.editTargetId ? ` 改写 ${ev.editTargetId}` : "";
  const text = (ev.text ?? "").replace(/\s+/g, " ").trim();
  const body = text ? (text.length > textLimit ? `${text.slice(0, textLimit)}…` : text) : "";
  return `${ev.id}\t${kindLabel(ev.kind)}${path}${seq}\t${body}${target}`;
}

/** 故事树只读渲染：分页 + 当前分支/全量两态。 */
function renderLineage(
  saveId: string,
  store: { events: LineageEvent[]; leafId: string | null; snapshots: LineageSnapshot[] },
  params: Static<typeof readLineageParams>,
): string {
  // 走 LineageTree.describe() 而不是自己算路径：onPath 标记只有它算得对
  const tmp = new LineageTree();
  tmp.load(store);
  const view = tmp.describe();

  const all = params.allBranches === true;
  const nodes = all ? view.nodes : view.nodes.filter((n) => n.onPath);
  const offset = Math.max(0, params.offset ?? 0);
  const limit = Math.min(200, Math.max(1, params.limit ?? 60));
  const page = nodes.slice(offset, offset + limit);

  const head = [
    `周目 ${saveId}：共 ${nodes.length} 个节点（${all ? "全量含废弃分支" : "当前分支路径"}）`,
    `叶节点：${view.leafId ?? "（空树）"}　快照：${store.snapshots.length} 个`,
    `序号 ${offset}–${offset + page.length - 1}${nodes.length > offset + page.length ? "（还有更多，用 offset 继续翻）" : ""}`,
  ];
  const body = page.map((n) => renderEventLine(n));
  return [...head, ...(body.length > 0 ? body : ["（无节点）"])].join("\n");
}

export function renderReadiness(r: Readiness): string {
  return [
    `就绪门：${r.ready ? "已就绪，可开演" : "未就绪"}`,
    `- premise：${r.premise ? "✓" : "✗ 缺（play.json 的 premise，或 memory/always/premise.md）"}`,
    `- 角色立绘映射：${r.characterSprites ? "✓" : "✗ 缺（角色卡 sprites 映射，且差分文件真实存在）"}`,
    `- 背景图：${r.background ? "✓" : "✗ 缺（assets/backgrounds/ 至少一张图）"}`,
  ].join("\n");
}

/** 工坊 system prompt：搭台不唱戏；先看后写；给具体提案而不是反问。 */
export function buildWorkshopPrompt(title: string, files: string, readiness: Readiness): string {
  return `你是这部剧目（《${title}》）的**搭台者**——负责剧目设定与记忆文件的创建与维护。你不写剧本、不参与演出。

# 职责边界

- 你产出的东西：世界观前提（premise）、创作口径（craft.md）、角色卡（人设 + 立绘差分映射 + 音色）、地点/设定记忆卡。
- 你不做的事：不写台词、不排戏、不替玩家表态。演出由另一套系统负责，与你的对话无关。
- 改文件必须真的调用 write_file 工具；只在对话里说"我建议改成…"不算完成。
- 故事树（story tree / lineage）你**只能读**。分岔、编辑台词、重写这些结构操作要走舞台的「路线」视图——
  那是玩家的五个动词，不该由你在背后动。需要调整剧情结构时，把节点 id 和你的建议告诉用户去操作。

# 对话风格

- 先读后写：不确定现状时先 list_files / read_file，不要凭空假设文件内容。
- 每次写盘前一句话说明写什么、为什么；写完告诉用户改了什么。
- 用户描述模糊时给**具体提案**（一段可直接用的 premise、一张完整的角色卡），而不是反问一串问题。
- 中文，简洁，不说客套话。

# 剧目写作要点

- premise：3~6 句，交代世界、主角处境、核心张力；不要写成大纲列表。
- 创作口径（memory/always/craft.md）：剧作家每一拍怎么写台词都听这一份——节奏多密、情绪怎么落地、
  有什么禁忌。用户说「节奏太快」「别让角色太主动」这类创作口味要求，就改这里（只改风格条目，
  不要往里写 DSL 格式或工具用法，那些由引擎保证）。
- 角色卡：id 用英文小写（如 mio），name 是中文名，persona 写具体的人（年龄/关系/说话方式/在意的点）；
  voiceId 从预置音色库挑；sprites 是「表情名 → 立绘文件名」的映射。
- 记忆卡（memory/index/locations| lore/<名字>.md）：首行 \`# 标题\`，次行一句话摘要，其余是详情。
- 记忆卡是给演出用的：写具体可用的设定（地点长什么样、约定是什么），不写"待补充"。
- 素材描述表（assets/manifest.json）：\`{"文件名去扩展名": "画面里有什么"}\`。剧作家只看得懂 id 认不出画面，
  背景/插图/立绘差分配一句具体描述（色调、时间、氛围），差分名与画面不符时在描述里点明。

# 读故事树（list_saves / read_lineage）

演出的每一行都落在周目（存档）的故事树里一棵。用户在工坊里问「演到哪了」「小春那场戏后来怎么了」
「这个角色出现过几次」这类问题，读树比读文件准得多。

- list_saves 拿 saveId（标「当前活动档」的是玩家正在看的那个，通常先读它）。
- read_lineage 默认只返回**当前分支路径**上的节点；用户问「有没有走过的另一条线」才加 allBranches=true。
- 节点很多时按 offset 翻页（默认 60 条一页），别指望一次读完。
- 节点 id 是操作故事树的凭据，回复用户时带上 id，他才能去「路线」视图里定位。
- 树是行级事件日志：say 是台词、narrate 旁白、thought 心理、player 玩家表态、stop 停止点、beat_end 幕末。
  统计「某角色说了几句」就是数 say 节点。

# 当前状态

剧目文件：
${files || "（空）"}

${renderReadiness(readiness)}`;
}

/** 单轮工坊对话上限：网关挂死不解除会永久锁住面板（running 无法复位）。 */
const TURN_TIMEOUT_MS = 180_000;

/** 单条工坊消息（持久化 + 回放）。 */
export interface WorkshopMessage {
  role: "user" | "assistant";
  text: string;
  at: number;
}

export interface WorkshopTurnHandlers {
  /** 流式增量（前端打字机）。 */
  onDelta: (delta: string) => void;
  /** 工具调用开始（前端显示"正在写入…"）。 */
  onTool: (name: string) => void;
}

export interface WorkshopAgentOptions {
  streamFn: StreamFn;
  model: Model<Api>;
  getApiKey: () => string | undefined;
  tools: AgentTool<any>[];
  systemPrompt: string;
}

/**
 * 跑一轮工坊对话：每轮新建 Agent（systemPrompt 里带当前文件清单与就绪状态，跑完即弃）。
 * 历史以 user/assistant 文本回灌——工坊是短对话，工具调用历史的重放价值低于其复杂度；
 * 模型想知道文件现状随时可以 read_file。
 */
export async function runWorkshopTurn(
  opts: WorkshopAgentOptions,
  history: WorkshopMessage[],
  userText: string,
  handlers: WorkshopTurnHandlers,
): Promise<string> {
  const agent = new Agent({
    streamFn: opts.streamFn,
    getApiKey: opts.getApiKey,
    initialState: {
      systemPrompt: opts.systemPrompt,
      model: opts.model,
      thinkingLevel: "off",
      tools: opts.tools,
      messages: historyToMessages(history),
    },
  });
  const timer = setTimeout(() => agent.abort(), TURN_TIMEOUT_MS);
  let streamed = "";
  agent.subscribe((event: AgentEvent) => {
    if (event.type === "message_update") {
      const inner = event.assistantMessageEvent;
      if (inner.type === "text_delta") {
        streamed += inner.delta;
        handlers.onDelta(inner.delta);
      }
    } else if (event.type === "tool_execution_start") {
      handlers.onTool(event.toolName);
    }
  });
  try {
    await agent.prompt(userText);
    await agent.waitForIdle();
  } finally {
    clearTimeout(timer);
  }
  // agent_end 的完整消息优先：流式增量可能因重试/工具轮次而拼接不全
  const last = lastAssistant(agent.state.messages);
  if (last && (last.stopReason === "error" || last.stopReason === "aborted")) {
    throw new Error(last.errorMessage ?? "工坊请求失败（模型未返回内容）");
  }
  const text = (last?.text ?? streamed).trim();
  if (text === "") throw new Error("工坊请求失败（模型返回空内容）");
  return text;
}

function historyToMessages(history: WorkshopMessage[]): import("@earendil-works/pi-agent-core").AgentMessage[] {
  return history.map((m) =>
    m.role === "user"
      ? { role: "user" as const, content: m.text, timestamp: m.at }
      : {
          role: "assistant" as const,
          content: [{ type: "text" as const, text: m.text }],
          api: "openai-completions" as const,
          provider: "workshop",
          model: "workshop",
          usage: {
            input: 0,
            output: 0,
            cacheRead: 0,
            cacheWrite: 0,
            totalTokens: 0,
            cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
          },
          stopReason: "stop" as const,
          timestamp: m.at,
        },
  );
}

function lastAssistant(
  messages: readonly unknown[],
): { text: string; stopReason?: string; errorMessage?: string } | null {
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    const m = messages[i] as { role?: string; content?: unknown; stopReason?: string; errorMessage?: string };
    if (m.role !== "assistant" || !Array.isArray(m.content)) continue;
    const text = m.content
      .filter((b): b is { type: "text"; text: string } => (b as { type?: string }).type === "text")
      .map((b) => b.text)
      .join("");
    return { text, stopReason: m.stopReason, errorMessage: m.errorMessage };
  }
  return null;
}

/** 线程标题：首条用户消息的前 20 字。 */
export function deriveThreadTitle(text: string): string {
  const flat = text.replace(/\s+/g, " ").trim();
  return flat.length <= 20 ? flat : `${flat.slice(0, 20)}…`;
}