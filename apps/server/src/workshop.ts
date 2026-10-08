import type { AgentEvent, AgentMessage, AgentTool, StreamFn } from "@earendil-works/pi-agent-core";
import { Agent } from "@earendil-works/pi-agent-core";
import type { Api, Model } from "@earendil-works/pi-ai";
import { languageLabel, toPiThinkingLevel } from "@aivn/core";
import type { EffectiveCraft, ImageApproval, ThinkingLevel, WorkshopAssetView, WorkshopPart } from "@aivn/core";
import { capDigest, renderTranscriptAs, splitSummary, calibrateTokenScale, type EpochSummary } from "./compaction.js";
import { completeText, type OneShotOptions } from "./llm.js";
import { skillsPrompt } from "./skills.js";
import { SEARCH_GUIDE } from "./agentkit/searchTool.js";
import { renderReadiness } from "./agentkit/readiness.js";
import { describeCraftParams } from "./craftParams.js";
import type { AgentCapabilities } from "./agentkit/kit.js";
import type { Readiness } from "./store.js";

/**
 * 工坊会话层：提示词 + 一轮对话的执行与回灌。
 *
 * 工具不在这里——工坊与剧作家共用 `agentkit/` 的统一基座（`createAgentKit({role:"workshop"})`），
 * 同一份实现、同一份 schema，只有描述与等待策略不同。见 `agentkit/kit.ts`。
 */

/** 工坊对话里的一次写盘。定义在基座的依赖面里。 */
export type { PlayFileWrite } from "./agentkit/deps.js";

/** 工坊 system prompt 的装配输入。 */
export interface WorkshopPromptContext {
  title: string;
  /** 剧目文件清单（每行「可写/只读 路径（sizeB）」）。 */
  files: string;
  readiness: Readiness;
  /**
   * 能力位（`kit.can`）：提示词按它决定注不注某一章。
   * 逐个布尔摆在这一层等于把 `kit.can` 的字段名抄一遍，加一位就要改三处（kit / 会话 / 这里）。
   */
  can: AgentCapabilities;
  /**
   * 剧目语音语言（play.json 的 voiceLanguage）：设了的话台词先译成它再配音，挑音色的语言就得跟着它走；
   * 不设 = 台词按剧本原文配音。
   */
  voiceLanguage?: string;
  /** 剧本语言（play.json 的 scriptLanguage）：写进提示词，免得工坊写 premise 时与剧本语言分家。 */
  scriptLanguage?: string;
  /** 当前生效的写作参数（已与默认值合成）：提示词里报现值，工坊据此回答「现在是什么」。 */
  craft: EffectiveCraft;
  /** 出图审批模式（play.json 的 agents.workshop.imageApproval）：照它决定要不要先问用户。 */
  imageApproval?: ImageApproval;
  /** 早期对话已压成的摘要（A 区回注）：非空即本线程发生过压缩。 */
  digest?: string;
  /** 逐剧目的自定义段（play.json 的 agents.workshop.prompt）：原样拼在固定提示词之后。 */
  customPrompt?: string;
}

/**
 * 职责边界：能做什么、不能做什么，以及「路线」视图里没有输入框这条容易说错的边界。
 *
 * 没开「改剧目文件」时换掉两条：产出物只剩图像素材（外加交给用户的改动清单），
 * 也就谈不上「必须真的调用 write / edit」——留着会教它去调一个没有的工具。
 */
function responsibilityRules(canFiles: boolean): string {
  const produced = canFiles
    ? `- 你产出的东西：世界观前提（premise）、创作口径（craft.md）、角色卡（人设 + 立绘差分映射 + 音色）、地点/设定记忆卡、图像素材。`
    : `- 你产出的东西：图像素材。剧目文件（premise、craft.md、角色卡、记忆卡、play.json）**这条路上没有给你写口**——
  要改就把「改哪个文件、改成什么」整理成清单交给用户，让他在工坊里自己改。`;
  const mustWrite = canFiles
    ? `- 改文件必须真的调用 write / edit 工具；出图必须真的调用 generate_image。只在对话里说"我建议改成…"不算完成。`
    : `- 出图必须真的调用 generate_image。剧目文件只能在对话里讨论、写成清单，不许说"已写入"——你没有那个手。`;
  return `# 职责边界

${produced}
- 你不做的事：不写台词、不排戏、不替玩家表态。演出由另一套系统负责，与你的对话无关。
${mustWrite}
- 故事树（story tree / lineage）你**只能读**。分岔、编辑台词、重写这些结构操作要走舞台的「路线」视图——
  那是玩家的四个动词，不该由你在背后动。需要调整剧情结构时，把节点 id 和你的建议告诉用户去操作。
- **「路线」视图里没有输入框**，只有「回到这里」和「由此分岔」两个按钮，别说「去路线视图里输入…」。
  玩家能打字的地方都在舞台与工坊对话里；不确定界面上哪里有入口时，就说清要改什么，让用户自己找地方操作。`;
}

/**
 * 对话风格：先读后写、整篇覆盖的风险、只准汇报真写过的文件。
 *
 * 这一章讲的全是「怎么改文件」，没开「改剧目文件」时整章收走——留着它只会让模型
 * 以为自己有写口，先 read 再 report 一遍并不存在的落盘。
 */
function talkRules(ctx: WorkshopPromptContext): string {
  if (!ctx.can.files) return "";
  return `# 对话风格

- 先读后写：不确定现状时先读一遍（read；${
    ctx.can.shell ? "命令行开着，grep / jq / git diff 这类比整篇读快得多，" : ""
  }必要时再用别的手段），不要凭空假设文件内容；原文没读准就别改。
- 只改几段用 edit（oldText 抄原文、newText 写新文），整篇重写才用 write——整篇覆盖时一处笔误会把全文写缩水。
- 每次写盘前一句话说明写什么、为什么；写完告诉用户改了什么。
- **只准汇报真写过的文件**：汇报落盘前先看这一轮的工具流水——没调 write / edit 的文件一律不许说"已写入"。
  谎报的后果是用户以为世界观的活干完了、下一轮直接从错误的现状继续（真机实测：说写了四张卡，实际一张没落盘）。
- 中文，简洁，不说客套话。`;
}

/** 生图不可用时的降级说明（换掉整个出图做法，而不是教它调一个没注册的工具）。 */
const NO_IMAGE_GUIDE = `- 生图当前不可用：把该出的图列成清单告诉用户，让用户在素材页自己上传。`;

/** 出图要点里与能力位无关的公共部分。 */
const IMAGE_BASICS = `- **把图给用户看**：\`generate_image\` 的回执里有素材 URL，写成 markdown 图片直接贴进回复
  （\`![alt](/plays/xxx/assets/sprites/<角色id>/neutral.png)\`）——用户要**亲眼看到**才谈得上验收，
  只回一句「已生成」不算交付。
- **画风没有默认值**：用户没说就问，定下来写进 memory/always/craft.md，之后以它为准。别擅自给整部剧目套二次元。
- 素材 id 用英文小写（下划线也行）：背景与 CG 的 id 会被剧本的 \`<scene bg="..."\` / \`<cg id="..."\` 直接引用，起名要有语义（按场景本身命名，如 school_gate_dusk、rooftop_night），别用 bg1、test2。
- 覆盖已有素材会替掉用户导入的图，覆盖前先说清楚。
- **出完图可以顺手把封面指一下**：play.json 的 \`cover\`（\`{"kind":"backgrounds"|"cg","id":"文件名带扩展名"}\`）
  决定剧目库那张牌与标题画面的底图。不设就自动取第一张背景、没有则第一张插图。
  用户说「拿这张当封面」时写进去；换图后记得跟着改，被删掉的图会自动回落到自动挑选。`;

/** 读故事树：演出的行级日志怎么查（`list_saves` / `read_lineage`）；没开这一位时不教它调。 */
function lineageGuide(ctx: WorkshopPromptContext): string {
  if (!ctx.can.lineage) {
    return `# 读故事树

本剧目没开「故事树」：演到哪了、某个角色出现过几次这类问题，请用户去舞台的「路线」视图自己看。`;
  }
  return LINEAGE_GUIDE;
}

const LINEAGE_GUIDE = `# 读故事树（list_saves / read_lineage）

演出的每一行都落在周目（存档）的故事树里一棵。用户在工坊里问「演到哪了」「那个角色后来怎么了」
「这个角色出现过几次」这类问题，读树比读文件准得多。

- list_saves 拿 saveId（标「当前活动档」的是玩家正在看的那个，通常先读它）。
- read_lineage 默认只返回**当前分支路径**上的节点；用户问「有没有走过的另一条线」才加 allBranches=true。
- 节点很多时按 offset 翻页（默认 60 条一页），别指望一次读完。
- 节点 id 是操作故事树的凭据，回复用户时带上 id，他才能去「路线」视图里定位。
- 树是行级事件日志：say 是台词、narrate 旁白、thought 心理、player 玩家表态、stop 停止点、beat_end 本轮收束。
  统计「某角色说了几句」就是数 say 节点。`;

/** 工坊 system prompt：搭台不唱戏；先问后写；出图前先过审。 */
export async function buildWorkshopPrompt(ctx: WorkshopPromptContext): Promise<string> {
  const skills = ctx.can.skill ? await skillsPrompt() : "";
  return `你是这部剧目（《${ctx.title}》）的**搭台者**——负责剧目设定、角色卡与视觉素材的创建与维护。你不写剧本、不参与演出。
${playLanguageNote(ctx)}

${responsibilityRules(ctx.can.files)}

${talkRules(ctx)}

${setupFlow(ctx)}

# 出图要点

${ctx.can.image ? imageGuide(ctx) : NO_IMAGE_GUIDE}
${IMAGE_BASICS}

${skills}
${writingPoints(ctx)}

${workspaceSection(ctx)}${ctx.can.search ? SEARCH_GUIDE : ""}
${lineageGuide(ctx)}

# 当前状态

剧目文件：
${ctx.files || "（空）"}

${renderReadiness(ctx.readiness)}${digestSection(ctx.digest)}${customSection(ctx.customPrompt)}`;
}

/**
 * 剧本语言提示（play.json 的 `scriptLanguage`）：不设就什么都不说，工坊按中文习惯写设定。
 *
 * 只在设了的时候说——写日语剧本的剧目，premise 与角色卡也得是日语，否则剧作家读中文设定、
 * 写日语台词，人物说话的语感与设定分家。
 */
function playLanguageNote(ctx: WorkshopPromptContext): string {
  if (!ctx.scriptLanguage) return "";
  return `\n本剧的剧本语言是${languageLabel(ctx.scriptLanguage)}：premise、角色卡、记忆卡这些**给演出看的内容**都用它写，与用户的对话仍然是中文。\n`;
}

/**
 * 设定流程：第 3 步查资源库那句按库是否可用收条件（工具没注册就别在提示词里教它调），
 * 第 3 步的「拿到批准」与第 4 步的落盘去处都按本剧目的设置分叉。
 */
function setupFlow(ctx: WorkshopPromptContext): string {
  const approval = ctx.imageApproval === "auto" ? "（本剧目免审批，列完直接出）" : "**用户没点头之前，一张都不要 generate_image。**";
  return `# 设定流程（这是你的工作方式，不是可选建议）

用户要开新剧目、或要改现有剧目的设定时，按下面四步走，**不要跳步**：

1. **先问清再动手**：一轮里问 3~5 个问题就把骨架定下来——故事类型与基调、时代与地点、主角是谁、主角想要什么/被什么困住、核心角色 1~2 位、画风与文风、**节奏（想让人物一口气演一段，还是每轮都给玩家选择）**。**每个问题都带上你的具体默认提案**（用户点一下"就按你说的来"就能继续），别让人从零填空。
2. **给完整提案再落盘**：把理解成的 premise（3~6 句）、角色卡、创作口径、写作参数、还缺哪些视觉素材一次性摆给用户看，等一句"可以/就这样"再落盘。
3. **${ctx.imageApproval === "auto" ? "列图单、免审批出图" : "列图单、拿到批准才出图"}**：${ctx.can.library ? "先查资源库（\`list_library\`），" : ""}再告诉用户"接下来要出这几张图：背景 A（说清是什么场景）、立绘 \`<角色id>/neutral\`、…，各是什么画面、为什么要"。${approval}出图要钱也要时间。
${
    ctx.can.files
      ? `4. **落盘后同步记忆**：premise 写进 memory/always/premise.md，**创作口径写进 memory/always/craft.md**、**写作参数用 \`set_craft\`**（下面「剧目写作要点」里说清两者分别装什么；不是只在对话里说一句）。`
      : `4. **交给用户落盘**：本剧目没给你写口——把 premise、创作口径、写作参数、角色卡整理成一份「改哪个文件、写什么」的清单交给用户，让他自己在工坊里改；不要把清单当成已经写进去了。`
  }`;
}

/**
 * 「音色怎么配」那半句：按能力位与剧目语音语言收条件。
 *
 * 语音语言是翻译目标（`playhouse.ts` 只在该字段非空时才建 Translator），所以音色得跟它同语言：
 * 日语音色配中文原文，念出来就是带日语口音的中文。提示词这边给剧目的值，后果写在工具描述里。
 */
function voicePickHint(ctx: WorkshopPromptContext): string {
  if (!ctx.can.voice) return "";
  const language = ctx.voiceLanguage?.trim();
  const scope = language
    ? `本剧语音语言是 \`${language}\`（台词先译成它再配音），先按 \`language="${language}"\` 筛`
    : `本剧语音语言未设（台词按剧本原文配音），先按剧本的书写语言筛（中文剧本用 \`language="zh"\`）`;
  return (
    `voiceId 用 \`list_voices\` 查出来再填（id 是 32 位 hex，猜不出来；填错不报错，演出时那句台词会静默没有声音）；` +
    `${scope}。`
  );
}

/**
 * 剧目写作要点：正文里的音色 / 资源库导入两句按能力位收条件。
 *
 * 整章讲的都是「往哪个文件的哪个字段写什么」，没开「改剧目文件」时只剩讨论的价值——
 * 换成一份清单式 fallback，别教它用 `set_craft`、也别教它手写 play.json。
 */
function writingPoints(ctx: WorkshopPromptContext): string {
  if (!ctx.can.files) {
    return `# 剧目写作要点

本剧目没给搭台者改剧目文件的能力：premise、craft.md、角色卡、记忆卡、play.json 的字段都落不了盘。
把这些内容讨论清楚、整理成清单交给用户（用户在工坊的剧目 / 角色 / 记忆页里自己改），你这边只做讨论与出图。`;
  }
  return `# 剧目写作要点

- premise：3~6 句，交代世界、主角处境、核心张力；不要写成大纲列表。
- 写作参数（play.json 的 \`craft\` 段，**用 \`set_craft\` 工具改**）：**每轮篇幅**、**停止点给几条选项**、
  **素材来源**（背景/插图/立绘/音效逐类）——这三件有确定取值的事。改完立刻生效，用户也能在「剧目」页
  看到同一份值，所以别手写 play.json，也别在 craft.md 里再写一遍。当前生效值：
${craftNow(ctx)}
- 创作口径（memory/always/craft.md）：**剧作家每一轮怎么写，听这一份**，但它只装**拿话说的那部分**——
  文风与禁忌、称呼与口癖、叙述视角与节奏感、场景转换的偏好、
  **主角的呈现**（主角是藏在台后，还是也上台露面、也有立绘与配音）。
  **每轮多长、选项几条、素材从哪来不要写在这里**（那是写作参数，写两处必然打架）。
  这个文件空着，剧作家就少一层口径可听；跟用户对齐完文风就落进去，不要只在对话里说一句「知道了」。
  只写风格条目，不要往里写 DSL 格式或工具用法，那些由引擎保证。
  用户改主意时——「文风再冷一点」改这个文件，「节奏太快」「选项给太多」「每段写短点」「背景别自己画」用 \`set_craft\`。
- 角色卡（\`characters/<id>.md\`，角色的一切都在这张卡里，play.json 不再存角色数据）：
  头部 frontmatter 放机器字段（id / name / sprite / voice / voiceId），正文写具体的人（年龄/关系/说话方式/在意的点）。
  \`sprite\` 是可省的立绘绑定：这个角色用 \`assets/sprites/<这个名字>/\` 那套立绘，不写就是与卡同名——要复用别处画好的一整套才写它。
  ${voicePickHint(ctx)}
  ${ctx.can.library ? "库里已有合适的角色可以先 \`import_asset\`（kind=characters）导进来再改，别从零重写。" : ""}
  玩家扮演的主角也是一张普通角色卡，id 固定 \`protagonist\`（\`characters/protagonist.md\`）：要改主角设定就改这张，别另建。
- play.json（剧目配置，「剧目」页改的也是它）就这些字段：
  \`title\`、\`opening\`（开局指令）、\`scriptLanguage\`（剧本语言，ISO 639-1 如 "ja"；不写 = 跟随玩家输入）、
  \`voiceLanguage\`（语音语言，ISO 639-1 如 "ja"；不写 = 台词按剧本原文配音）、
  \`defaultVoiceId\`（无名角色、临时角色的兜底音色，32 位 hex）、
  \`cover\`（封面图，写法见「出图要点」）、\`initialState\` / \`initialScene\`（开局状态）、
  \`craft\`（写作参数，用 \`set_craft\` 改，不要手写）、\`image\`（逐剧目的生图 model / size，不写跟服务端全局）、
  \`agents\`（两个 agent 的 model / thinking / capabilities / imageApproval）。
  除 \`id\` / \`title\` 外全是可选字段：缺一个不报错，只是那份效果静默消失（缺 \`defaultVoiceId\` 无名角色没声音、
  缺 \`scriptLanguage\` 跟随玩家输入、缺 \`craft\` 走引擎默认、缺 \`agents\` 能力开关回默认）。
  **改它只用 \`edit\` 改点名的字段，不要整篇 \`write\` 覆盖。**
- 记忆卡（memory/index/<名字>.md）：首行 \`# 标题\`，次行一句话摘要，其余是详情。
  index 下可以建子目录分门别类，**建议** \`locations/\` 放地点、\`lore/\` 放世界设定（不是硬要求，
  但分类后 A 区里每行都带 [分类] 前缀，剧作家更容易知道该去哪张卡里查）。
- 记忆卡是给演出用的：写具体可用的设定（地点长什么样、约定是什么），不写"待补充"。
- 素材描述表（assets/manifest.json）：\`{"文件名去扩展名": "画面里有什么"}\`。剧作家只看得懂 id 认不出画面，
  背景/插图/立绘差分配一句具体描述（色调、时间、氛围），差分名与画面不符时在描述里点明。
  立绘差分的键写 \`<角色id>/<差分名>\`（如 \`角色A/neutral\`），出图那一轮就补上，别攒到下次。
  补描述用 \`edit\` 定点改那一条：oldText 抄**那一个键所在的完整一行**（带键名和引号），
  别拿别的条目的行当锚点——替换的是整行，锚错一条就等于抹掉一条描述
  （实测：补 neutral 时把 normal 的描述整行替掉了）。也别整篇覆盖这张表。
  出图用的 prompt 原文由引擎记在 assets/generated.json（你读得到、也改不动）：要重出同一张图，
  先 read 看上一版是怎么写的，在它基础上改，别每次从零重编。`;
}

/** 压缩摘要的 A 区回注段：告诉搭台者「这些早前就定了」，否则它会重问一遍已经答过的问题。 */
function digestSection(digest: string | undefined): string {
  if (!digest || digest.trim() === "") return "";
  return `\n\n# 本会话已确定（早期对话已压缩）\n\n${digest.trim()}\n\n以上是本会话早前已确定的事项，不要重新提问、不要推翻；要改就基于它往下改。`;
}

/**
 * 当前生效的写作参数（缩进成子列表）：工坊回答「现在是什么节奏/素材从哪来」时照它说，
 * 不用去读 play.json——读到的也是同一个值，还得自己补默认。
 */
function craftNow(ctx: WorkshopPromptContext): string {
  return describeCraftParams(ctx.craft)
    .split("\n")
    .map((line) => `  - ${line}`)
    .join("\n");
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

/**
 * 工作区章节（仅在命令行可用时拼进 system prompt）。
 *
 * 讲的是**边界与后果**，不是工具用法——cwd、输出截断、超时都在 pi 的 bash 描述里。
 * 模型得知道 bash 不受文件白名单约束，否则它会以为 `rm` 和删文件工具一样有人拦着。
 */
function workspaceSection(ctx: WorkshopPromptContext): string {
  if (!ctx.can.shell) return "";
  return `# 命令行（bash）

- 工作目录就是这部剧目的目录。read / write / edit 限在剧目目录内（play.json、theme.css、memory/**、assets/**），
  **bash 不受这个限制**：它以本服务的权限运行，这台机器上进程能碰的东西它都能碰、也能改。
- 所以**改文件优先用 write / edit**：它们过 play.json 结构校验，用户在各页能直接看到新内容。
  bash 的改动同样走轮边界重建，要看它改了什么用 \`git diff\`。
- 找内容用 \`grep -rn\`、读 JSON 用 \`jq\`，比整篇 read 快得多。

`;
}

/**
 * 出图章节（仅在生图可用时拼进 system prompt）。
 *
 * 只留**角色职责**：什么时候出图、要不要用户批准、出完怎么汇报。
 * 画幅、并发、垫图链路、差分命名都是工具契约，归 `imageTool.ts` 的描述管——
 * 这里曾把它们抄了一遍，于是 framing 改成三档之后这行还写着「立绘 9:16 竖构图全身」，
 * 一句抄错的画幅直接指挥模型按错误构图出图。
 */
function imageGuide(ctx: WorkshopPromptContext): string {
  const approval =
    ctx.imageApproval === "auto"
      ? `- **本剧目免审批出图**（Agent 页里设的「出图审批」= 自动）：不用等用户点头，该出就出——
  但仍然**一次只出真正需要的那几张**，出完把图贴给他看。`
      : `- **用户没点头之前一张都不要开跑**——出图要花钱、立绘一张要等 100 秒起。`;
  return `${approval}
- **generate_image 只出草稿，不进素材表**：回执给 \`draftId\` 与预览图，要采用它再调 \`commit_asset\`。
  没被采用的草稿留在临时草稿区（一周后自动清），素材页与素材表里看不到它。
- **先出 neutral 定妆照给用户看，而且是 3 张候选**：同一角色首次定妆时按 \`variant="neutral"\` 调 3 次 \`generate_image\`
  （prompt 各不相同），把三张预览一起摆给用户挑；用户挑定后**只 commit 那一张**——\`commit_asset(draftId=…)\` 就把它绑成正式定妆照。
- **定妆照采用之后再派生差分**：非 neutral 的差分自动垫上**已入库的** neutral，同一个角色才是同一个人。
- **出图失败把接口原话带给用户**：回执里带 503 / 额度 / 模型名 / 被拒的尺寸，照抄。
  「生图服务暂时不可用」等于什么都没说，用户没法判断是自己的额度还是网关挂了。`;
}

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
  /** 回灌 agent 上下文的唯一内容，也是旧线程文件里唯一有的东西。 */
  text: string;
  at: number;
  /** 本轮的段落流；旧消息没有这个字段，渲染前用 normalizeParts() 归一。 */
  parts?: WorkshopPart[];
  /** 本条附带的素材图（不带工具调用号的素材走这里）。 */
  images?: WorkshopAssetView[];
}

/** 一轮工坊对话的产物：回复正文 + 由本轮 usage 标定出的 token 系数（拿不到为 null）。 */
export interface WorkshopTurnResult {
  text: string;
  scale: number | null;
}

/** 一次工具调用的起止（参数与结果都往对话流上送）。 */
export interface WorkshopToolStart {
  id: string;
  name: string;
  args: unknown;
}
export interface WorkshopToolEnd {
  id: string;
  /** bash 的改动绕过写盘回调，宿主只能靠这个名字知道「这一轮动过文件」。 */
  name: string;
  result: string;
  isError: boolean;
  ms: number;
}

export interface WorkshopTurnHandlers {
  /** 流式增量：正文。 */
  onDelta: (delta: string) => void;
  /** 流式增量：思考（模型开了思考档位才有）。 */
  onThinking: (delta: string) => void;
  onToolStart: (tool: WorkshopToolStart) => void;
  onToolEnd: (tool: WorkshopToolEnd) => void;
}

export interface WorkshopAgentOptions {
  streamFn: StreamFn;
  model: Model<Api>;
  getApiKey: () => string | undefined;
  /** 统一基座装好的工具（见 `createAgentKit`）。 */
  tools: AgentTool<any>[];
  systemPrompt: string;
  /** 思考档位（play.json 的 agents.workshop.thinking，缺省跟随服务商默认）。 */
  thinkingLevel?: ThinkingLevel;
  /** 用户主动停止：中止当前一轮。 */
  signal?: AbortSignal;
}

/** 单条工具回执落进对话流的上限：read 一个几十 KB 文件的全文进线程文件没有意义。 */
const RESULT_MAX_CHARS = 8000;

/** 工具回执压成一段可展示的文本：图片块记成一行占位。 */
function toolResultText(result: unknown): string {
  const content = (result as { content?: unknown } | null)?.content;
  const text = Array.isArray(content)
    ? content
        .map((block) => {
          const item = block as { type?: string; text?: string };
          return item?.type === "text" ? (item.text ?? "") : "[图片]";
        })
        .join("\n")
    : typeof result === "string"
      ? result
      : JSON.stringify(result ?? null);
  if (text.length <= RESULT_MAX_CHARS) return text;
  return `${text.slice(0, RESULT_MAX_CHARS)}\n…（已截断 ${text.length - RESULT_MAX_CHARS} 字）`;
}

/**
 * 跑一轮工坊对话：每轮新建 Agent（systemPrompt 里带当前文件清单与就绪状态，跑完即弃）。
 * 历史以 user/assistant 文本回灌——工坊是短对话，工具调用历史的重放价值低于其复杂度；
 * 模型想知道文件现状随时可以读一遍。
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
      thinkingLevel: toPiThinkingLevel(opts.thinkingLevel ?? "default"),
      tools: opts.tools,
      messages: historyToMessages(history),
    },
  });
  const timer = setTimeout(() => agent.abort(), TURN_TIMEOUT_MS);
  const onUserStop = (): void => agent.abort();
  opts.signal?.addEventListener("abort", onUserStop, { once: true });
  let streamed = "";
  const startedAt = new Map<string, number>();
  agent.subscribe((event: AgentEvent) => {
    if (event.type === "message_update") {
      const inner = event.assistantMessageEvent;
      if (inner.type === "text_delta") {
        streamed += inner.delta;
        handlers.onDelta(inner.delta);
      } else if (inner.type === "thinking_delta") {
        handlers.onThinking(inner.delta);
      }
    } else if (event.type === "tool_execution_start") {
      startedAt.set(event.toolCallId, Date.now());
      handlers.onToolStart({ id: event.toolCallId, name: event.toolName, args: event.args });
    } else if (event.type === "tool_execution_end") {
      const since = startedAt.get(event.toolCallId);
      handlers.onToolEnd({
        id: event.toolCallId,
        name: event.toolName,
        result: toolResultText(event.result),
        isError: event.isError,
        ms: since === undefined ? 0 : Date.now() - since,
      });
    }
  });
  try {
    await agent.prompt(userText);
    await agent.waitForIdle();
  } finally {
    clearTimeout(timer);
    opts.signal?.removeEventListener("abort", onUserStop);
  }
  // agent_end 的完整消息优先：流式增量可能因重试/工具轮次而拼接不全
  const last = lastAssistant(agent.state.messages);
  if (last && (last.stopReason === "error" || last.stopReason === "aborted")) {
    throw new Error(
      opts.signal?.aborted
        ? "已停止生成"
        : (last.errorMessage ?? "工坊请求失败（模型未返回内容）"),
    );
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
