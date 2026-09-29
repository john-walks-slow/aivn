import type { AgentEvent, AgentTool, StreamFn } from "@earendil-works/pi-agent-core";
import { Agent } from "@earendil-works/pi-agent-core";
import { type Api, type Model, type Static, Type } from "@earendil-works/pi-ai";
import { parsePlayConfig, type WorkshopAssetView } from "@stage-ai/core";
import type { PlayFiles } from "./playFiles.js";
import { readSkill, skillsPrompt } from "./skills.js";
import type { PlayStore, Readiness } from "./store.js";
import type { AssetKind, GeneratedPlayAsset, WorkshopAssets } from "./workshopAssets.js";

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
  /** 素材生成层（生图未启用时为 undefined，工具直接回不可用）。 */
  assets?: WorkshopAssets;
  /** 素材落盘回调：推给前端在对话流里内联展示。 */
  onAsset: (asset: GeneratedPlayAsset) => void;
}

const emptyParams = Type.Object({}, { additionalProperties: false });
const readFileParams = Type.Object({ path: Type.String({ maxLength: 300 }) }, { additionalProperties: false });
const writeFileParams = Type.Object(
  { path: Type.String({ maxLength: 300 }), content: Type.String({ maxLength: 200_000 }) },
  { additionalProperties: false },
);
/** 素材目标用扁平参数：模型少填一层嵌套，填错字段的报错信息也更直白。 */
const generateAssetParams = Type.Object(
  {
    kind: Type.Union([Type.Literal("background"), Type.Literal("cg"), Type.Literal("sprite")]),
    /** 背景/CG 的素材 id，剧本里的 bg/cg id 就是它。 */
    name: Type.Optional(Type.String({ maxLength: 40 })),
    /** 立绘所属角色 id（play.json 里的角色 id）。 */
    characterId: Type.Optional(Type.String({ maxLength: 40 })),
    /** 立绘差分名，如 neutral / smile。 */
    expression: Type.Optional(Type.String({ maxLength: 40 })),
    /** 一整套差分（最多 6 个）：一次调用出一张表情面板再切格，比逐张出图便宜一个量级。 */
    expressions: Type.Optional(Type.Array(Type.String({ maxLength: 40 }), { minItems: 1, maxItems: 6 })),
    /** 画风锚点（可选），如「厚涂写实电影感」「赛璐珞动画」。不给就不预设风格，按角色描述走。 */
    style: Type.Optional(Type.String({ maxLength: 200 })),
    prompt: Type.String({ minLength: 1, maxLength: 4000, description: "英文出图提示词，描述画面本身（不含负面词）" }),
  },
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
const readSkillParams = Type.Object({ name: Type.String({ maxLength: 64 }) }, { additionalProperties: false });

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
      "写入剧目文件（可写范围：play.json、memory/** 的 .md/.json/.txt）。play.json 结构校验不过则不落盘。",
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

  const generateAsset: AgentTool<typeof generateAssetParams> = {
    name: "generate_asset",
    label: "生成剧目素材",
    description:
      "出一张剧目素材并落进 assets/：背景(kind=background) / CG(kind=cg) 给 name，" +
      "立绘(kind=sprite) 给 characterId + expression。立绘会自动抠底成透明 PNG（引擎要靠它叠在场景上）。" +
      "立绘出整套差分改给 expressions（最多 6 个）：一次调用出一张表情面板再切格，比逐张出图便宜一个量级。",
    parameters: generateAssetParams,
    execute: async (_id, params: Static<typeof generateAssetParams>) => {
      if (!deps.assets) {
        return textResult("生图未启用（STAGE_IMAGE_ENABLED=false 或后端缺凭据）：把该出的图列给用户，让用户在素材页上传。");
      }
      try {
        const assets = await deps.assets.generate(
          {
            kind: params.kind as AssetKind,
            name: params.name,
            characterId: params.characterId,
            expression: params.expression,
            expressions: params.expressions,
          },
          params.prompt,
          params.style,
        );
        for (const asset of assets) deps.onAsset(asset);
        const lines = assets.map((asset) =>
          asset.replaced ? `已生成并覆盖原有素材：${asset.path}` : `已生成：${asset.path}`,
        );
        const auto = assets.find((asset) => asset.autoNeutral);
        if (auto) lines.push("该角色原本没有任何差分，已先自动出一张 neutral 定妆照。");
        return textResult(lines.join("\n"));
      } catch (error) {
        return textResult(`生图失败：${reason(error)}`);
      }
    },
  };

  const readSkillTool: AgentTool<typeof readSkillParams> = {
    name: "read_skill",
    label: "读出图技能",
    description:
      "读一份出图技能全文（system prompt 里 <available_skills> 列出的那些）。" +
      "画风怎么定、场景怎么构图、立绘出整套还是单张——对上了就调它。",
    parameters: readSkillParams,
    execute: async (_id, params: Static<typeof readSkillParams>) => {
      try {
        const skill = await readSkill(params.name);
        return textResult(skill.content);
      } catch (error) {
        return textResult(`读取失败：${reason(error)}`);
      }
    },
  };

  return [listFiles, readFile, writeFile, deleteFile, readiness, generateAsset, readSkillTool];
}

export function renderReadiness(r: Readiness): string {
  return [
    `就绪门：${r.ready ? "已就绪，可开演" : "未就绪（缺 premise）"}`,
    `- premise：${r.premise ? "✓" : "✗ 缺（play.json 的 premise，或 memory/always/premise.md）——这是唯一的硬门槛"}`,
    `- 角色立绘映射：${r.characterSprites ? "✓" : "缺（建议补）"}`,
    `- 背景图：${r.background ? "✓" : "缺（建议补）"}`,
    "（立绘与背景不是门槛：没有图也能开演，演出时落氛围底色、没有立绘的角色不上台）",
  ].join("\n");
}

/** 工坊 system prompt：搭台不唱戏；先问后写；出图前先过审。 */
export async function buildWorkshopPrompt(
  title: string,
  files: string,
  readiness: Readiness,
  canGenerate: boolean,
): Promise<string> {
  const skills = await skillsPrompt();
  return `你是这部剧目（《${title}》）的**搭台者**——负责剧目设定、角色卡与视觉素材的创建与维护。你不写剧本、不参与演出。

# 职责边界

- 你产出的东西：世界观前提（premise）、角色卡（人设 + 立绘差分映射 + 音色）、地点/设定记忆卡、图像素材。
- 你不做的事：不写台词、不排戏、不替玩家表态。演出由另一套系统负责，与你的对话无关。
- 改文件必须真的调用 write_file 工具；出图必须真的调用 generate_asset。只在对话里说"我建议改成…"不算完成。

# 对话风格

- 先读后写：不确定现状时先 list_files / read_file，不要凭空假设文件内容。
- 每次写盘前一句话说明写什么、为什么；写完告诉用户改了什么。
- 中文，简洁，不说客套话。

# 设定流程（这是你的工作方式，不是可选建议）

用户要开新剧目、或要改现有剧目的设定时，按下面四步走，**不要跳步**：

1. **先问清再动手**：一轮里问 3~5 个问题就把骨架定下来——故事类型与基调、时代与地点、主角是谁、主角想要什么/被什么困住、核心角色 1~2 位、画风与文风。**每个问题都带上你的具体默认提案**（用户点一下"就按你说的来"就能继续），别让人从零填空。
2. **给完整提案再落盘**：把理解成的 premise（3~6 句）、角色卡、还缺哪些视觉素材一次性摆给用户看，等一句"可以/就这样"再 write_file。
3. **列图单、拿到批准才出图**：告诉用户"接下来要出这几张图：背景 A（黄昏教室）、立绘 koharu/neutral、…，各是什么画面、为什么要"。**用户没点头之前，一张都不要 generate_asset。** 出图要钱也要时间。
4. **落盘后同步记忆**：画风与文风写进 memory/always/craft.md（不是只在对话里说一句），premise 写进 memory/always/premise.md。

# 出图要点

${canGenerate ? imageGuide : "- 生图当前不可用：把该出的图列成清单告诉用户，让用户在素材页自己上传。"}
- **画风没有默认值**：用户没说就问，定下来写进 memory/always/craft.md，之后以它为准。别擅自给整部剧目套二次元。
- 素材 id 用英文小写（下划线也行）：背景与 CG 的 id 会被剧本的 \`<scene bg="..."\` / \`<cg id="..."\` 直接引用，起名要有语义（rooftop、classroom_dusk），别用 bg1、test2。
- 覆盖已有素材会替掉用户导入的图，覆盖前先说清楚。

${skills}

# 剧目写作要点

- premise：3~6 句，交代世界、主角处境、核心张力；不要写成大纲列表。
- 角色卡：id 用英文小写（如 mio），name 是中文名，persona 写具体的人（年龄/关系/说话方式/在意的点）；
  voiceId 从预置音色库挑；sprites 是「表情名 → 立绘文件名」的映射。
- 记忆卡（memory/index/locations| lore/<名字>.md）：首行 \`# 标题\`，次行一句话摘要，其余是详情。
- 记忆卡是给演出用的：写具体可用的设定（地点长什么样、约定是什么），不写"待补充"。

# 当前状态

剧目文件：
${files || "（空）"}

${renderReadiness(readiness)}`;
}

/** 出图章节（仅在生图可用时拼进 system prompt）：只留"必须知道"的硬规则，展开的画风/构图/差分知识在 skill 里。 */
const imageGuide = `- 调 generate_asset 出图，prompt 用英文，只描述画面本身；画风短语放 style 参数（可选）。
- 背景 16:9、CG 16:9、立绘 9:16 竖构图全身。画幅不对会直接作废，别为了构图改画幅。
- 立绘会自动抠底成透明 PNG（引擎靠它叠在场景上），所以提示词里必须有"纯色底、无渐变无投影"。
- 立绘要出整套差分就用 expressions（最多 6 个，一次出一张面板再切格，比逐张出图便宜一个量级）；
  要补单张就用 expression，系统自动拿该角色的 neutral 定妆照做垫图。
- **同一角色先出 neutral，用户看过认了之后再出其余差分。** 没有 neutral 又有别的差分时系统会直接报错——
  不这么做的话新图和旧差分不是同一个人，演出中会静默换脸。
- 立绘出图是同步等待用户的操作（一次 100 秒起，出整套约 15 秒），别在没批准时开跑。`;

/** 单轮工坊对话上限：网关挂死不解除会永久锁住面板（running 无法复位）。一轮里可能要连出几张图，7 分钟。 */
const TURN_TIMEOUT_MS = 420_000;

/** 单条工坊消息（持久化 + 回放）。 */
export interface WorkshopMessage {
  role: "user" | "assistant";
  text: string;
  at: number;
  /** 本条附带的素材图（工坊生成的图随消息存，翻历史仍看得见）。 */
  images?: WorkshopAssetView[];
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