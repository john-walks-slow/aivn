import type { AgentEvent, AgentMessage, AgentTool, StreamFn } from "@earendil-works/pi-agent-core";
import { Agent } from "@earendil-works/pi-agent-core";
import type { Api, Model } from "@earendil-works/pi-ai";
import type { ThinkingLevel, WorkshopAssetView } from "@stage-ai/core";
import { capDigest, renderTranscriptAs, splitSummary, calibrateTokenScale, type EpochSummary } from "./compaction.js";
import { completeText, type OneShotOptions } from "./llm.js";
import { skillsPrompt } from "./skills.js";
import { SEARCH_GUIDE } from "./agentkit/searchTool.js";
import { renderReadiness } from "./agentkit/readiness.js";
import type { Readiness } from "./store.js";

/**
 * 工坊会话层：提示词 + 一轮对话的执行与回灌。
 *
 * 工具不在这里——工坊与剧作家共用 `agentkit/` 的统一基座（`createAgentKit({role:"workshop"})`），
 * 同一份实现、同一份 schema，只有描述与等待策略不同。见 `agentkit/kit.ts`。
 */

/** 工坊对话里的一次写盘（前端在对话流里内联展示 + 可撤销）。定义在基座的依赖面里。 */
export type { WorkshopWrite } from "./agentkit/deps.js";

/** 工坊 system prompt 的装配输入。 */
export interface WorkshopPromptContext {
  title: string;
  /** 剧目文件清单（每行「可写/只读 路径（sizeB）」）。 */
  files: string;
  readiness: Readiness;
  /** 生图可用（决定出图章节注入与否）。 */
  canGenerate: boolean;
  /** 联网检索可用（无 key 时工具没注册，prompt 里也不提，免得教它调一个不存在的工具）。 */
  canSearch: boolean;
  /** 资源库可用（没配时不装 list_library / import_asset，提示词里也不再教它去查库）。 */
  canBrowseLibrary: boolean;
  /** 音色库可用（没配 TTS 时 list_voices 没注册，提示词里也不提，免得教它调一个不存在的工具）。 */
  canVoices: boolean;
/** 早期对话已压成的摘要（A 区回注）：非空即本线程发生过压缩。 */
  digest?: string;
  /** 逐剧目的自定义段（play.json 的 agents.workshop.prompt）：原样拼在固定提示词之后。 */
  customPrompt?: string;
}

/** 工坊 system prompt：搭台不唱戏；先问后写；出图前先过审。 */
export async function buildWorkshopPrompt(ctx: WorkshopPromptContext): Promise<string> {
  const skills = await skillsPrompt();
  return `你是这部剧目（《${ctx.title}》）的**搭台者**——负责剧目设定、角色卡与视觉素材的创建与维护。你不写剧本、不参与演出。

# 职责边界

- 你产出的东西：世界观前提（premise）、创作口径（craft.md）、角色卡（人设 + 立绘差分映射 + 音色）、地点/设定记忆卡、图像素材。
- 你不做的事：不写台词、不排戏、不替玩家表态。演出由另一套系统负责，与你的对话无关。
- 改文件必须真的调用 write_file / edit_file 工具；出图必须真的调用 generate_image。只在对话里说"我建议改成…"不算完成。
- 故事树（story tree / lineage）你**只能读**。分岔、编辑台词、重写这些结构操作要走舞台的「路线」视图——
  那是玩家的四个动词，不该由你在背后动。需要调整剧情结构时，把节点 id 和你的建议告诉用户去操作。
- **「路线」视图里没有输入框**，只有「回到这里」和「由此分岔」两个按钮，别说「去路线视图里输入…」。
  玩家能真正打字的地方只有这几处，提到它们时请说对：
  - 舞台选肢层最下面那张「自由发挥…」卡（以主角口吻自己写一句）
  - 舞台导演栏的「提示」（演到一半追加行动/台词/指示）
  - 停止点卡片上的自由输入框
  - 舞台选择肢的剧情选项
  - 工坊「对话」（也就是你现在所在的地方）

# 对话风格

- 先读后写：不确定现状时先 list_files / read_file，不要凭空假设文件内容；原文没读准就别改。
- 只改几段用 edit_file（oldText 抄原文、newText 写新文），整篇重写才用 write_file——整篇覆盖时一处笔误会把全文写缩水。
- 每次写盘前一句话说明写什么、为什么；写完告诉用户改了什么。
- **只准汇报真写过的文件**：汇报落盘前先看这一轮的工具流水——没调 write_file / edit_file 的文件一律不许说"已写入"。
  谎报的后果是用户以为世界观的活干完了、下一轮直接从错误的现状继续（真机实测：说写了四张卡，实际一张没落盘）。
- 中文，简洁，不说客套话。

# 设定流程（这是你的工作方式，不是可选建议）

用户要开新剧目、或要改现有剧目的设定时，按下面四步走，**不要跳步**：

1. **先问清再动手**：一轮里问 3~5 个问题就把骨架定下来——故事类型与基调、时代与地点、主角是谁、主角想要什么/被什么困住、核心角色 1~2 位、画风与文风、**节奏（想让人物一口气演一段，还是每轮都给玩家选择）**。**每个问题都带上你的具体默认提案**（用户点一下"就按你说的来"就能继续），别让人从零填空。
2. **给完整提案再落盘**：把理解成的 premise（3~6 句）、角色卡、创作口径、还缺哪些视觉素材一次性摆给用户看，等一句"可以/就这样"再 write_file。
3. **列图单、拿到批准才出图**：${ctx.canBrowseLibrary ? "先查资源库（\`list_library\`），" : ""}再告诉用户"接下来要出这几张图：背景 A（说清是什么场景）、立绘 \`<角色id>/neutral\`、…，各是什么画面、为什么要"。**用户没点头之前，一张都不要 generate_image。** 出图要钱也要时间。
4. **落盘后同步记忆**：premise 写进 memory/always/premise.md，**创作口径写进 memory/always/craft.md**（下面「剧目写作要点」里说清那份文件该写什么；不是只在对话里说一句）。

# 出图要点

${ctx.canGenerate ? imageGuide : "- 生图当前不可用：把该出的图列成清单告诉用户，让用户在素材页自己上传。"}
- **把图给用户看**：\`generate_image\` 的回执里有素材 URL，写成 markdown 图片直接贴进回复
  （\`![alt](/plays/xxx/assets/sprites/<角色id>/neutral.png)\`）——用户要**亲眼看到**才谈得上验收，
  只报一句「已生成」等于让人凭空点头。
- **画风没有默认值**：用户没说就问，定下来写进 memory/always/craft.md，之后以它为准。别擅自给整部剧目套二次元。
- 素材 id 用英文小写（下划线也行）：背景与 CG 的 id 会被剧本的 \`<scene bg="..."\` / \`<cg id="..."\` 直接引用，起名要有语义（按场景本身命名，如 school_gate_dusk、rooftop_night），别用 bg1、test2。
- 覆盖已有素材会替掉用户导入的图，覆盖前先说清楚。
- **出完图可以顺手把封面指一下**：play.json 的 \`cover\`（\`{"kind":"backgrounds"|"cg","id":"文件名带扩展名"}\`）
  决定剧目库那张牌与标题画面的底图。不设就自动取第一张背景、没有则第一张插图。
  用户说「拿这张当封面」时写进去；换图后记得跟着改，被删掉的图会自动回落到自动挑选。

${skills}
# 剧目写作要点

- premise：3~6 句，交代世界、主角处境、核心张力；不要写成大纲列表。
- 创作口径（memory/always/craft.md）：**剧作家每一轮怎么写，唯一听这一份**。引擎自带的口径已经删干净了
  ——一轮该写多长、选项给几条、多久把主导权交回玩家、什么文风、素材从哪来，都不再写死在剧作家的系统提示词里；
  这个文件空着，剧作家就真的没有口径可听。所以每次跟用户对齐完写法，都要把结果落进这个文件，
  不要只在对话里说一句「知道了」。至少写清五件事：**每轮多长**（一段戏演多久、到哪里换画面）、
  **选项给几条**、**交还主导权的密度**（每轮都停，还是连着推几轮才停一次）、**文风与禁忌**、
  **素材来源**（哪些自己画、哪些从资源库里找，见下面「素材来源」那条）。
  只写风格条目，不要往里写 DSL 格式或工具用法，那些由引擎保证。
  用户改主意时（「节奏太快」「别让角色太主动」「选项给太多」「每段写短点」「背景别自己画」）改的就是这个文件。
${assetSourceGuidance(ctx)}
- 角色卡（\`memory/always/characters/<id>.md\`，角色的一切都在这张卡里，play.json 不再存角色数据）：
  头部 frontmatter 放机器字段（id / name / voice / voiceId / framing / sprites），正文写具体的人（年龄/关系/说话方式/在意的点）。
  ${ctx.canVoices ? "voiceId 用 \`list_voices\` 查出来再填（id 是 32 位 hex，猜不出来；填错不报错，演出时那句台词会静默没有声音）；" : ""}
  ${ctx.canBrowseLibrary ? "库里已有合适的角色可以先\n  \\`import_asset\\`（kind=characters）导进来再改，别从零重写。" : ""}
- 记忆卡（memory/index/<名字>.md）：首行 \`# 标题\`，次行一句话摘要，其余是详情。
  index 下可以建子目录分门别类，**建议** \`locations/\` 放地点、\`lore/\` 放世界设定（不是硬要求，
  但分类后 A 区里每行都带 [分类] 前缀，剧作家更容易知道该去哪张卡里查）。
- 记忆卡是给演出用的：写具体可用的设定（地点长什么样、约定是什么），不写"待补充"。
- 素材描述表（assets/manifest.json）：\`{"文件名去扩展名": "画面里有什么"}\`。剧作家只看得懂 id 认不出画面，
  背景/插图/立绘差分配一句具体描述（色调、时间、氛围），差分名与画面不符时在描述里点明。
  立绘差分的键写 \`<角色id>/<差分名>\`（如 \`角色A/neutral\`），出图那一轮就补上，别攒到下次。
  补描述用 \`edit_file\` 定点改那一条：oldText 抄**那一个键所在的完整一行**（带键名和引号），
  别拿别的条目的行当锚点——替换的是整行，锚错一条就等于抹掉一条描述
  （实测：补 neutral 时把 normal 的描述整行替掉了）。也别整篇覆盖这张表。
  出图用的 prompt 原文由引擎记在 assets/generated.json（你读得到、也改不动）：要重出同一张图，
  先 read_file 看上一版是怎么写的，在它基础上改，别每次从零重编。

${ctx.canSearch ? SEARCH_GUIDE : ""}
# 读故事树（list_saves / read_lineage）

演出的每一行都落在周目（存档）的故事树里一棵。用户在工坊里问「演到哪了」「那个角色后来怎么了」
「这个角色出现过几次」这类问题，读树比读文件准得多。

- list_saves 拿 saveId（标「当前活动档」的是玩家正在看的那个，通常先读它）。
- read_lineage 默认只返回**当前分支路径**上的节点；用户问「有没有走过的另一条线」才加 allBranches=true。
- 节点很多时按 offset 翻页（默认 60 条一页），别指望一次读完。
- 节点 id 是操作故事树的凭据，回复用户时带上 id，他才能去「路线」视图里定位。
- 树是行级事件日志：say 是台词、narrate 旁白、thought 心理、player 玩家表态、stop 停止点、beat_end 本轮收束。
  统计「某角色说了几句」就是数 say 节点。

# 当前状态

剧目文件：
${ctx.files || "（空）"}

${renderReadiness(ctx.readiness)}${digestSection(ctx.digest)}${customSection(ctx.customPrompt)}`;
}

/** 压缩摘要的 A 区回注段：告诉搭台者「这些早前就定了」，否则它会重问一遍已经答过的问题。 */
function digestSection(digest: string | undefined): string {
  if (!digest || digest.trim() === "") return "";
  return `\n\n# 本会话已确定（早期对话已压缩）\n\n${digest.trim()}\n\n以上是本会话早前已确定的事项，不要重新提问、不要推翻；要改就基于它往下改。`;
}

/**
 * 素材来源这一维的写法指导：告诉搭台者「哪些自己画、哪些从库里找」该怎么写进 craft.md。
 *
 * 两个工具名都按注册与否收条件，同「剧目写作要点」里那些 `canVoices` / `canBrowseLibrary` 一样：
 * 没配资源库时教它调 `list_library`，它只会对着一个不存在的工具反复空转。
 */
function assetSourceGuidance(ctx: WorkshopPromptContext): string {
  const draw = ctx.canGenerate
    ? "**插图与立绘差分**用 `generate_image` 自己画（插图里有角色时带 `referenceCharacters` 垫立绘，脸才对得上）；**立绘先出 neutral 定妆照**，其余差分都由它垫底"
    : "生图当前不可用，你列的图单剧作家用不上——缺画面的地方只能靠旁白和台词交代";
  const reuse = ctx.canBrowseLibrary
    ? "**背景、配乐、音效从资源库里找**——先用 `list_library` 查清有哪些 id 再写进剧本，不要凭空画背景、不要凭记忆猜 id"
    : "**背景、配乐、音效**只用素材清单里已有的那些；没有的不要凭空造 id，用旁白交代画面";
  return `- 素材来源（craft.md 里的一节，剧作家据此决定什么该自己画、什么该用现成的）：把每类素材的来路写清楚——${draw}；${reuse}。常用到的 id 直接列进这一节，剧作家每一轮都读得到它。`;
}

/**
 * 用户自定义段（play.json 的 agents.workshop.prompt）：原样拼在最后。
 *
 * 放最后而不是放开头——固定段讲的是引擎契约与能力边界，自定义段讲的是这个剧目额外的做事要求，
 * 冲突时后者才是用户的本意。
 */
function customSection(custom: string | undefined): string {
  const text = custom?.trim();
  if (!text) return "";
  return `\n\n# 本剧目的补充要求\n\n${text}`;
}

/** 出图章节（仅在生图可用时拼进 system prompt）：只留"必须知道"的硬规则，展开的画风/构图/差分知识在 skill 里。 */
const imageGuide = `- 调 generate_image 出图，prompt 用英文，只描述画面本身；画风短语放 style 参数（可选）。
- 背景 16:9、CG 16:9、立绘 9:16 竖构图全身。画幅不对会直接作废，别为了构图改画幅。
- 怎么写 prompt（外貌锚点逐条带上、垫图当身份基准、立绘后缀引擎自己拼）看 generate_image 的工具说明，两个角色同一份。
- 立绘是"一个差分一次 generate_image"，非 neutral 的会自动拿该角色的 neutral 定妆照做垫图。
- **一次工具调用只出一张图，但同一批次里的多次调用是并行的**：要出多个差分，就在同一批里调多次
  generate_image（一次一张），不要一个一个串行等。闸门放 6 个并发。
- **同一角色先出 neutral，用户看过认了之后再出其余差分。** 没有 neutral 又有别的差分时系统会直接报错——
  不这么做的话新图和旧差分不是同一个人，演出中会静默换脸。
- **neutral 与其它差分名是两个名字**：出 neutral 不会覆盖 normal，两张文件两张人并存，play.json 里
  会多一个 neutral 键。要改 normal 就再出一次 normal 差分，别指望出新图顺手把旧的换掉。
- **出图失败把接口原话带给用户**：回执里带 503 / token / 额度 / 模型名 / 被拒的尺寸，照抄给用户。
  「生图服务暂时不可用」等于什么都没说，用户没法判断是自己的额度还是网关挂了。
- 立绘出图是同步等待用户的操作（一张约 100 秒起），别在没批准时开跑。`;

/** 单轮工坊对话上限：网关挂死不解除会永久锁住面板（running 无法复位）。一轮里可能要连出几张图，7 分钟。 */
const TURN_TIMEOUT_MS = 420_000;

/**
 * 工坊线程的摘要指令（与演出侧的 EPOCH_SUMMARY_SYSTEM 不是一回事）：
 * 那边压的是「剧情」，这边压的是「搭台过程」——落盘了什么、用户拍板了什么、还欠什么。
 */
const WORKSHOP_DIGEST_SYSTEM = [
  "你是剧目搭建会话的长期上下文整理员。下面是用户与搭台助手（工坊）多轮对话的原文记录（按时间顺序）。",
  "请压缩成一份「本会话已确定事项」，供搭台助手在后续对话里无缝继续。",
  "",
  "输出格式（严格遵守）：",
  "第一行：一句话概括这一段确定了什么（不超过 60 字，不要加 markdown 标题符号）。",
  "空一行后，从「## 已确定」开始分节正文。",
  "",
  "要求：",
  "- 只复述原文已有的事实，绝不新增设定、需求或结论",
  "- 写结论不写叙事：不要复述「用户问…助手答…」的过程，直接写定下来的东西",
  "- 已落盘的文件逐条列出（路径 + 改成了什么样）",
  "- 用户明确表达过的偏好与禁忌单独一节，照原话口径记",
  "- 已出图 / 已导入的素材连 id 一起记（id 后面还要被剧本引用）",
  "- 用户提过但还没做完的事单列「待办」",
  "- 用户否掉的方案也要记（「不要这样做」比「要这样做」更容易被忘）",
].join("\n");

/**
 * 把工坊线程的早期轮次压成一张摘要卡。
 * prevDigest 非空时一并给出，让模型在旧定稿上重写成一份完整文档（而不是把两段叠起来——
 * 叠起来的摘要每压缩一轮就厚一层，几轮之后进 A 区的全是历史噪音）。
 */
export async function summarizeThread(
  opts: OneShotOptions,
  head: readonly WorkshopMessage[],
  prevDigest: string,
): Promise<EpochSummary> {
  const transcript = renderTranscriptAs(historyToMessages([...head]), {
    user: "【用户】",
    assistant: "【搭台助手】",
  });
  const previous =
    prevDigest.trim() === ""
      ? ""
      : `以下是本会话此前已压缩的摘要（已确定事项）。请把它与下面的新增原文合并成一份完整定稿：\n\n${prevDigest.trim()}\n\n---\n\n以下是新增原文：\n\n`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TURN_TIMEOUT_MS);
  try {
    const text = await completeText({ ...opts, signal: controller.signal }, WORKSHOP_DIGEST_SYSTEM, `${previous}${transcript}`);
    return splitSummary(text);
  } finally {
    clearTimeout(timer);
  }
}

/** 单条工坊消息（持久化 + 回放）。 */
export interface WorkshopMessage {
  role: "user" | "assistant";
  text: string;
  at: number;
  /** 本条附带的素材图（工坊生成的图随消息存，翻历史仍看得见）。 */
  images?: WorkshopAssetView[];
}

/** 一轮工坊对话的产物：回复正文 + 由本轮 usage 标定出的 token 系数（拿不到为 null）。 */
export interface WorkshopTurnResult {
  text: string;
  scale: number | null;
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
  /** 统一基座装好的工具（见 `createAgentKit`）。 */
  tools: AgentTool<any>[];
  systemPrompt: string;
  /** 思考档位（play.json 的 agents.workshop.thinking，缺省 off）。 */
  thinkingLevel?: ThinkingLevel;
}

/**
 * 跑一轮工坊对话：每轮新建 Agent（systemPrompt 里带当前文件清单与就绪状态，跑完即弃）。
 * 历史以 user/assistant 文本回灌——工坊是短对话，工具调用历史的重放价值低于其复杂度；
 * 模型想知道文件现状随时可以 read_file。
 *
 * 回传 scale：这一轮的 provider 实测 usage ÷ 本地估算，写回线程供下一轮开跑前计量。
 */
export async function runWorkshopTurn(
  opts: WorkshopAgentOptions,
  history: WorkshopMessage[],
  userText: string,
  handlers: WorkshopTurnHandlers,
): Promise<WorkshopTurnResult> {
  const agent = new Agent({
    streamFn: opts.streamFn,
    getApiKey: opts.getApiKey,
    initialState: {
      systemPrompt: opts.systemPrompt,
      model: opts.model,
      thinkingLevel: opts.thinkingLevel ?? "off",
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
  return { text, scale: calibrateTokenScale(opts.systemPrompt, agent.state.messages) };
}

export function historyToMessages(history: readonly WorkshopMessage[]): AgentMessage[] {
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
