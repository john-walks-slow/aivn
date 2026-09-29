import type { AgentEvent, AgentTool, StreamFn } from "@earendil-works/pi-agent-core";
import { Agent } from "@earendil-works/pi-agent-core";
import { type Api, type Model, type Static, Type } from "@earendil-works/pi-ai";
import { parsePlayConfig } from "@stage-ai/core";
import type { PlayFiles } from "./playFiles.js";
import type { PlayStore, Readiness } from "./store.js";

/**
 * 工坊 agent（D9）：与 playwriter 并列的**独立 pi 实例**，只管搭台（剧目文件的创建与维护），
 * 不参与演出。工具限于剧目文件白名单 + 就绪检查——它拿不到会话日志、lineage 与 TTS 缓存。
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
}

const emptyParams = Type.Object({}, { additionalProperties: false });
const readFileParams = Type.Object({ path: Type.String({ maxLength: 300 }) }, { additionalProperties: false });
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

  return [listFiles, readFile, writeFile, deleteFile, readiness];
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

- 你产出的东西：世界观前提（premise）、角色卡（人设 + 立绘差分映射 + 音色）、地点/设定记忆卡。
- 你不做的事：不写台词、不排戏、不替玩家表态。演出由另一套系统负责，与你的对话无关。
- 改文件必须真的调用 write_file 工具；只在对话里说"我建议改成…"不算完成。

# 对话风格

- 先读后写：不确定现状时先 list_files / read_file，不要凭空假设文件内容。
- 每次写盘前一句话说明写什么、为什么；写完告诉用户改了什么。
- 用户描述模糊时给**具体提案**（一段可直接用的 premise、一张完整的角色卡），而不是反问一串问题。
- 中文，简洁，不说客套话。

# 剧目写作要点

- premise：3~6 句，交代世界、主角处境、核心张力；不要写成大纲列表。
- 角色卡：id 用英文小写（如 mio），name 是中文名，persona 写具体的人（年龄/关系/说话方式/在意的点）；
  voiceId 从预置音色库挑；sprites 是「表情名 → 立绘文件名」的映射。
- 记忆卡（memory/index/locations| lore/<名字>.md）：首行 \`# 标题\`，次行一句话摘要，其余是详情。
- 记忆卡是给演出用的：写具体可用的设定（地点长什么样、约定是什么），不写"待补充"。
- 素材描述表（assets/manifest.json）：\`{"文件名去扩展名": "画面里有什么"}\`。剧作家只看得懂 id 认不出画面，
  背景/插图/立绘差分配一句具体描述（色调、时间、氛围），差分名与画面不符时在描述里点明。

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