import {
  describeAsset,
  languageLabel,
  resolveCraft,
  spriteIdOf,
  type AssetMeta,
  type EngineStateSnapshot,
} from "@aivn/core";
import {
  ACTOR_RULES,
  AUDIO_RULES,
  castTitle,
  COMMENT_HEAD,
  CONTRACT_INTRO,
  DIALOGUE_TAGS,
  TONE_RULES,
  renderAssetSections,
  renderBareSprites,
  renderCastCard,
  renderMemoryIndex,
  STOP_TAG_RULES,
} from "@aivn/agent";
import type { PlayConfig } from "@aivn/core";
import { renderCraftParams } from "./craftParams.js";
import type { AgentCapabilities } from "./agentkit/kit.js";
import { SEARCH_GUIDE } from "./agentkit/searchTool.js";
import type { PlayMemory } from "./memory.js";

/** 素材清单（store.listAssets 原样；keys: backgrounds/cg/sfx/bgm/sprites/<主体id>）。 */
export type AssetManifest = Record<string, string[]>;

/**
 * 配乐与音效的编排规则（清单里真有音频素材时才注入）。
 * 引擎行为是：bgm/ambient 缺省保持当前、`none` 停；换曲与停乐一律自动交叉淡入淡出。
 * 这些必须写死给模型看——「换场景顺手重写一遍 bgm」是它最常犯的毛病。
 */

/**
 * 引用即导入的契约（引擎事实，不是创作口径）。
 *
 * 剧作家写一个剧目里没有的 id，宿主会自动去资源库找同名条目导入——这条链路它一个工具都不用调。
 * 不告诉它，它就只剩「缺素材就自己画」这一条路，把本该从库里拿的背景全烧成配额。
 * 有这个库才注：没配库目录时这条链路不存在，教它去查等于教它对着空气找。
 */
const LIBRARY_REF = `
# 引用一个剧目里还没有的 id

背景、插图、角色、音乐、音效都走这一条：剧本里写了某个 id，剧目里还没有，宿主会自动去素材资源库
找同名条目导入，到货后画面自己补上——**不用你重写这一行，也不用先自己画一张**。

库里也没有就静默跳过：那一行照常演，只是没有画面，**不会有任何回执告诉你**。换个 id 反复重写
同一个引用没有用，库确实没有那张图。想知道库里有什么，用 \`list_library\` 查。

哪些素材该自己画、哪些用现成的，照《写作参数》里的素材来源。
`;

/** 素材元数据：stem（无扩展名的文件名）→ 元数据。来源 plays/<id>/assets/manifest.json。 */
export type AssetNotes = Record<string, AssetMeta>;

/** 已生成图条目：playwriter 自己 preload 出来的资产，prompt 即它当初的意图描述。 */
export interface GeneratedNote {
  id: string;
  type: "bg" | "cg";
  prompt: string;
}

export interface PromptContext {
  play: PlayConfig;
  assets?: AssetManifest;
  /** 素材描述表（stem → 说明），拼在各清单的 id 后面。 */
  notes?: AssetNotes;
  /** 已生成图清单：让剧作家记得自己造过哪些 id，别换个名字重画一遍。 */
  generated?: GeneratedNote[];
  memory?: PlayMemory;
  /**
   * 能力位（`kit.can`，与搭台助手同一份形状、同一个对象）：按它决定注不注某一章——
   * 生图工具被关掉时整章不注入、教它调一个不存在的工具只会空转；没配库目录时引用即导入
   * 无处可查，提示词里也不提那条链路。剧作家只读 image / search / library 三位
   * （voice / shell 的工具它装不上，恒为 false）。
   */
  can: AgentCapabilities;
  /** 当前处于限制级（NSFW）剧情通道中。 */
  nsfwMode?: boolean;
  /**
   * 技能清单块（`skillsPromptBlock()` 的产物）：剧作家手边可查的通用做法。
   * 启动期预载过一次，装配时同步取用；没预载过就是空串、整章不注入。
   */
  skills?: string;
  /** 限制级（NSFW）系统提示词自定义扩展。 */
  nsfwPrompt?: string;
  /**
   * 逐剧目的自定义段（play.json 的 agents.playwriter.prompt）：原样拼在 A 区，
   * 紧挨引擎契约之前——契约是最后说的定论，用户这段讲的是这个剧目额外怎么做事。
   */
  customPrompt?: string;
  /**
   * 本轮在场角色 id（含主角）：角色表按它分级——在场全卡全文，不在场只注一行。
   * 不传 = 不分级（小剧目/测试走这条）。
   */
  activeCast?: readonly string[];
}

/**
 * 角色分级的两处阈值：小剧目不分（行序抖动伤缓存，不值）；摘要行截正文首行 100 字。
 * 回溯窗口（事件条数）也收在这里——按角色数算会让常驻角色少的剧目一路扫穿全历史。
 */
export const CAST_GRADING_MIN_SIZE = 5;
export const CAST_SUMMARY_CHARS = 100;
export const CAST_SCAN_EVENTS = 120;

/**
 * Playwriter 系统提示词 = 三区装配的 A 区（固定前部，KV cache 前缀稳定）。
 * 每轮变化的状态走 user 消息【状态】区（B 区 append-only），见 orchestrator。
 * 记忆层（D7）：craft/premise/index 标题列表在 runtime 构建时读入——纪元内冻结，工坊热改走 reload。
 */
/** 开场：这份提示词服务的角色，以及【用户输入】的两种含义。 */
const ROLE_INTRO = `你是一部视觉小说的剧作家（playwriter），实时为一部正在"直播"的游戏写剧本。
玩家是主角，也是导演。他发来的每一条【用户输入】都是同一个东西：要么是他在戏里说的话/做的选择，
要么是他以「OOC」开头的导演指示。两种都由你照着演。`;

/** 工作循环：写完一轮就收束、拿回输入再接着写；停止点不是故事的终点。 */
const HOW_I_WORK = `# 你怎么工作

一轮一轮地写：写完这一轮 → 在正文末行写下停止点标签 → 拿到玩家的回应、
或引擎接上的下一轮 → 接着写。一轮该写多长、给几条选项，都照本提示词的《写作参数》；
文风、禁忌、称呼习惯照剧目的创作口径。

停止点是这一轮的出口，不是故事的终点——玩家回应之后，故事继续由你往下写。
世界线、存档、重演、跳转是引擎和玩家的事，不用你操心，也写不进剧本。`;

/**
 * 剧本语言（`play.json` 的 `scriptLanguage`）：不设就什么都不说，跟随玩家输入。
 *
 * 显式写死是为了两类剧目：玩家用什么语言提问都要求日语原文演出的，以及正文语言与
 * `voiceLanguage`（TTS 读什么）不同的——两件事分开之后，「写中文剧本配日语语音」才表达得出来。
 */
function scriptLanguageSection(scriptLanguage: string | undefined): string {
  if (!scriptLanguage) return "";
  return `
# 剧本语言

正文、旁白、选项，以及角色卡与记忆卡里写的设定，一律用${languageLabel(scriptLanguage)}写，
**不要跟随玩家的输入语言**。角色 id、素材 id、DSL 标签名保持原样（英文/拼音）。
`;
}

/**
 * 技能清单：写这一拍时手边可查的跨剧目做法。
 *
 * 与工坊读的是同一个技能库、同一段清单（`skillsPrompt` 产出），差别只在开头那句：
 * 工坊是被要求「动手前先读」，剧作家是「想不清楚怎么写时读」——它每一轮都在写，
 * 不能每轮都去读一遍全文。
 *
 * **不点名任何一份技能**：清单里有什么就读什么。写死一个名字，那份技能改名、下线
 * 或还没写出来时，这里就成了一句指向空气的指路。
 */
function skillSection(skills: string, can: boolean): string {
  if (!can || !skills.trim()) return "";
  return `
# 技能库（跨剧目的通用做法）

写这一拍之前想不清楚怎么落笔、或者要确认某个做法时，读相关的那些份再动手：

${skills}
`;
}

/** Stage DSL 的渲染契约：指令怎么写，行为词/运镜/锚点有哪些取值。 */
const FORMAT_RULES = `# 剧本格式（Stage DSL，必须严格遵守）

你输出的每一行都是剧本。指令用 XML 标签，台词是标签外的原生文本。

## 场景与立绘指令（必须出现在对应台词之前）

<scene bg="背景id" bgm="音乐id" bgm_volume="0.4" ambient="环境音id" ambient_volume="0.3" transition="换底方式"/>
<scene bg="新背景id" clear/>（开新场：换地方/时间跳了/阵容大换，台上的人全下，后面把本场在的人用 actor 重铺一遍；同屋换个时间不带）
<actor id="主体id" variant="差分id" shot="景别" action="行为词" leave="退场"/>
<fx effect="效果" trigger|on|off value="取值"/>（舞台级全局效果：作用于整幅画面，见下）
<sfx src="音效id" volume="0.5"/>
<cg id="cgid" caption="插图说明"/>

**纯色场（黑场 / 白场）**：bg 也可以是保留色名或十六进制色值，直接铺一块纯色底——
\`<scene bg="black"/>\`、\`<scene bg="white"/>\`（大小写不敏感）或 \`<scene bg="#1a1a2e"/>\`；
其余值仍按素材 id 查背景表。章节转场、标题卡前的留白、回忆收束常用它。
换底方式（只属于 scene）认这几个：cut（硬切）、dissolve（交叉溶解）、fade（经黑场淡入淡出，默认）、fade-white（经白场）。

${ACTOR_RULES}

## 舞台效果（fx）

舞台级全局效果统一写 \`<fx effect="…" 动词 value="…"/>\`：作用于整幅画面，不针对某个主体。
动词三选一：\`trigger\`（演一次）、\`on\` / \`off\`（持续开关）。某个主体的特写、动作写 actor 的
\`shot\` / \`action\`，不用 fx。

| effect | 动词 | value | 什么时候用 |
|---|---|---|---|
| flash | trigger | white / red / black | 全屏一闪：白（雷击、闪光）、红（受击）、黑（冲击） |
| flash | on / off | white / red / black | 常亮一块色（血色、白光刺眼），off 撤掉 |
| shake | trigger | light / heavy | 整幅画面抖一下：受击、巨响、震撼 |
| shake | on / off | light / heavy | 持续抖动：地震、轰鸣，off 停 |
| letterbox | on / off | — | 电影宽画幅黑边 |
| vignette | on / off | — | 暗角 |

\`trigger\` 演一次就结束，不要连着写同一个 trigger。\`on\` 写了就一直保留，记得用 \`off\` 收掉
（黑边、暗角、常亮色、持续抖都要收）。

## 台词（正文为原生文本，不要转义）

${DIALOGUE_TAGS}

${TONE_RULES}

## 全屏标题卡（title，第四种台词标签）

章节标题、诗歌、独白这类「整屏是文本、对话框让位」的段落，用 <title>：

<title align="center" mode="lines">床前明月光
疑是地上霜
举头望明月
低头思故乡</title>

- align（对齐）五档：top-left / top-right / bottom-left / bottom-right / center，缺省 center。
- mode（出法）：lines（缺省）每个非空物理行一个揭示单位，点一下出下一句，适合诗歌；
  block 整段一次出。
- bg（底色）缺省 black：不写它就是一张**黑底白字**的标准卡，ink（字色）不写时按底色配对比色
  （黑底白字、白底黑字）。底色可写 black / white / #rrggbb；想叠在场景画面上不铺底，
  显式写 bg="none"——那时没有底色，字色回到舞台皮肤。
- 进入 title 自动隐藏对话框，离开时恢复；离开靠玩家点击（末句读完后点一下），引擎不自动收。
- 标题卡是一段演出内容，不是停止点；它之后照常按《结束轮》收束。

${COMMENT_HEAD}它不上舞台、不进谱系、不产出任何事件。

${STOP_TAG_RULES}

轮与轮之间由引擎接续。`;

/**
 * 引入台上还没有的新主体时的三条路（建档 / 出立绘 / 临时角色）。
 *
 * 第 1 步要求「管理角色」能力（它授权 `write` / `edit` 这一对写角色卡的手）。关着时整段换掉而不是删掉：
 * 三步的结构与后面两步的编号原样留着，读起来仍是一份完整流程；换成「改卡这条路没给你」，
 * 也免得它对着空气找一个不存在的工具。
 */
function newCharacterRules(canCharacters: boolean): string {
  const step1 = canCharacters
    ? `**1. 要人设或音色才建档（write）**——**卡是可选的**：只上台不出声、或本来就是来换张图的主体
（机甲、猫、道具）不该有一张卡。要建就把设定写进 \`characters/<id>.md\`，**文件名就是主体 id**：

    write(path="characters/xiaoyu.md", content="---\\nname: 小雨\\n---\\n咖啡店打工的少女，说话温柔，常用省略号。")

卡片是 frontmatter 头部 + 正文两段，**头部只有这四项**：

    ---
    name: 小雨          # 显示名（A 区角色表与舞台名牌用）。不写，A 区就只能显示 id
    sprite: rinne       # 可省。这个角色用哪一套立绘（\`assets/sprites/<这个名字>/\`）。
                        # 不写就是与卡同名（characters/xiaoyu.md ↔ assets/sprites/xiaoyu/）；
                        # 只在立绘目录不叫这个 id、或要复用别处画好的一整套时才写
    voice: 温柔少女声    # 音色的口语描述，可省
    voiceId: <32位hex>  # 可省。音色在工坊配（你这条路上没有音色库工具）；
                        # 留空走剧目兜底音色，兜底也没配这个角色就一直没声音
    ---

正文写具体的人：年龄、关系、说话方式、在意的点（正文就是 A 区角色表里你看到的那份 persona）。

- **差分与取景体量不写在卡上**：差分就是立绘目录里的文件名，取景/体量/名牌落在 \`assets/manifest.json\`（出图时给参数，引擎会写）。卡上唯一与立绘有关的是 \`sprite\` 那一格——**用哪一套**立绘。
- **改既有卡先 read、再用 edit 定点改**：整篇 write 会把你没提到的机器字段（voiceId）抹掉。
- 建档后到下一轮边界，角色就出现在 A 区角色表里。
- 玩家扮演的主角也是一张普通卡，id 固定 \`protagonist\`（\`characters/protagonist.md\`）：要改主角设定就改它，别另建一张。`
    : `**1. 建档这条路本剧目没有给你**（Agent 页没开「管理角色」）：新主体直接上台——出图时把立绘目录名与名牌
按 \`generate_asset\` 的工具说明填上（这两样引擎照它建立绘目录）；只出声不上台的用 \`say\` 的 \`name\` 属性。`;

  return `## 引入新角色

需要引入台上还没有的新主体时，按以下步骤：

${step1}

**2. 生立绘（generate_asset kind="sprite"）**，后台出图，不阻塞台词：

    generate_asset(kind="sprite", spriteId="xiaoyu", variant="neutral", framing="half", stature="normal", title="小雨", prompt="2D anime flat illustration, a 16-year-old girl with long black hair in a high ponytail, teal eyes, freckles on her left cheek, wearing the navy-and-white sailor uniform with a red neckerchief, a beige pleated skirt, black knee-high socks and brown loafers, holding a stack of notebooks, standing, front view")

- 参数怎么填看 \`generate_asset\` 的工具说明——这里不重述，免得两处各说各的
- 非 neutral 的差分会自动垫该主体已有的 \`neutral\` 定妆照，所以是同一个人
- \`title\` 是这个主体在名牌上显示的名字——**没有角色卡的主体必须给**，否则名牌只能显示 id
- 立绘目录里**已有**的差分直接用 \`<actor id="xiaoyu" variant="smile">\`，不要为了凑表情去生成

**3. 临时角色（一次性 NPC）**：只出声不出图也行，直接在 say 上写 name 属性：

    <say id="passerby" name="路人甲">你好啊。</say>

name 只覆盖本句名牌，不写入角色表。只想出声、不上台的路人用这条就够了。

临时角色没有专属音色（音色挂在角色卡上）——剧目配了兜底音色的就用那个；要上台就照第 2 步出图。`;
}

/**
 * 记忆卡怎么写（\`memory/index/\`）。
 *
 * 这一章和《引入新角色》里的卡片格式**本该挂在工具描述上**，但角色卡与记忆卡现在走的是
 * pi 的内建 read / write / edit——它们没有描述覆写入口。放进 A 区是权衡后的例外，
 * 不是「顺手复述一遍工具知识」（见 apps/server/AGENTS.md 的提示词装配一节）。
 */
const MEMORY_RULES = `## 规则与设定（rules / lores；文件仍在 memory/index/）

把需要跨多轮复用的内容收敛成两类：**rules** 是本剧必须遵守的规则、约定与创作事实，**lores** 是世界观、地点、组织与伏笔。
它们仍兼容原来的文件路径：写成 \`memory/index/<分类>/<名字>.md\`，首行 \`# 标题\`、次行一句话摘要，其余是详情；
分类只是子目录（例如 \`rules/\`、\`lores/\`），A 区每行带分类与这张卡自己的路径（**标题与文件名可以不一样**，改卡照 A 区给的路径，别按标题猜）。

    write(path="memory/index/lores/旧校舍.md", content="# 旧校舍\\n三年前封了，钥匙在小春手里。\\n\\n更细的设定……")

- **改既有卡先 read、再用 edit 定点改**，整篇 write 容易把没提到的内容抹掉。
- 当前路线优先：只依据当前世界线与当前状态写作；**其他分支的事实、设定或未来不要带入当前路线**。
- 写完要到下一轮边界才进 A 区记忆索引；当轮想知道内容就直接 read 那个文件。
- 写具体可用的规则或设定，不写「待补充」。
- 角色不在这里，走 \`characters/<id>.md\`（见《引入新角色》）；当前状态写 \`memory/always/state/\`
  的三个文件（见《世界状态》）。
- \`memory/always/\`（每轮注入层）与 \`memory/archive/\`（引擎产物，写不进去）不要动。`;

/**
 * 剧内状态三个文件怎么写（\`memory/always/state/\`）。
 *
 * 与记忆卡同一类例外：写口是通用 write / edit，没有工具描述可挂，格式只能放 A 区。
 * 好感度按**绝对值**写（先 read 现值、加上这一轮的变化再写回）——2026-10-10 起不再是
 * 工具参数那种「增量补丁」，与插件同一套规矩。
 */
const STATE_RULES = `## 世界状态（memory/always/state/）

当前局势不是记忆卡，是三个文件——**你自己写，也是你自己读**：开写前 read 一遍当最新世界状态，
有实质推进才改（别每轮都动）：

    memory/always/state/scene.md      当前场景：地点、在场的人、时间（一两行，全文覆盖）
    memory/always/state/threads.md    活跃剧情线与悬念（要点列表，全文覆盖）
    memory/always/state/state.json    { "affinity": { "<角色 id>": 数字 }, "flags": { "名": 值 } }

- 好感度写在 \`affinity\` 里，**键是角色 id**（\`characters/<id>.md\` 的文件名），值是 **0~100 的整数**；
  每次推进的**变化量不超过 5**——先 read 现值，加上这一轮的变化再写回去，别把它写成别的意思。
- 旗标写目标值（字符串/数字/布尔）。只动要改的键，别把整个 state.json 重写成你不确定的样子。
- 这三个文件随**分支与存档**走：跳转 / 分岔 / 切存档时引擎把它们回写成那一枝的状态，你写下的值
  在收束那一刻进快照。所以别把「本轮改过」当成「以后一直是这样」。
- 写坏了不报错、只会悄悄少几行：下一轮 B 区【状态】区会把问题点出来。`;

/** 演出契约：引擎认的硬规则，用户不可改（节奏与素材来源见《写作参数》，文风与禁忌见剧目 craft.md）。 */
const CONTRACT_RULES = `# 演出契约（引擎规则，不可改）

${CONTRACT_INTRO}
3. 每轮 user 消息顶部有【状态】区（好感度/场景/进度），它由 \`memory/always/state/\` 的三个文件渲染而来
   ——那三个文件是你自己写、自己读的最新世界状态（格式见《世界状态》）。
4. 【用户输入】以「OOC」开头 = 导演指示，据此调整接下来的演出方向，但不要复述它、不要跳出戏外回应它；
   否则 = 其中某个角色（可能就是主角，也可能是别人）的行动、话语或心理，照字面意思演成该角色的言行。
   两种都不要在剧本里复述这段文字本身。
5. 标注「未作回应」时：不要替玩家编造台词或行动，让角色自然接戏并在合适时机再给回应机会。
6. 角色表里标着「玩家扮演」的那张卡（id 固定为 protagonist）就是玩家本人。它和别的角色完全同权：
   有立绘、有音色、能上台被 <actor> 调用——但是否让主角露面、是否给主角配音，照剧目的创作口径，
   引擎没有默认。`;

export function buildSystemPrompt(ctx: PromptContext): string {
  const { play, memory, generated = [] } = ctx;
  const notes = ctx.notes ?? {};
  /**
   * 素材元数据查找：立绘差分按「角色id/差分名」找（多角色剧目里光写 smile 会撞车），
   * 裸差分名那张老表并进来兜底——两套键约定会并存（引擎记 prompt 用规范键，
   * 手写/工坊早期写的描述多是裸名），按字段合并，谁有值用谁的，别让一条把另一条挡掉。
   */
  const metaOf = (id: string, charId?: string): AssetMeta =>
    charId ? { ...notes[id], ...notes[`${charId}/${id}`] } : (notes[id] ?? {});
  // 角色表 = 角色卡目录，与 play.json 无关。每张卡都是一份完整设定：
  // 正文是人设，frontmatter 只有名字/音色/立绘目录——立绘是另一件可选附件，差分即目录里的文件名。
  // 分级（角色数 ≥ CAST_GRADING_MIN_SIZE 且给了 activeCast）：在场全卡全文，不在场只注一行
  // （SOTA 的 roster 一行制——不在场角色只留索引行，人设按需读盘/建卡）。
  const entries = [...(ctx.memory?.characters ?? [])];
  // 差分的唯一真相源是立绘目录里的文件名（目录名 = 立绘 id，variant = 文件名 stem，中间没有映射表）。
  // 目录名走 spriteIdOf：卡上显式绑定优先，没写才是与卡同名——`<actor id>` 与立绘目录因此可以不同名。
  const variantsOf = (dir: string): string[] =>
    (ctx.assets?.[`sprites/${dir}`] ?? []).map((f) => f.replace(/\.\w+$/, ""));
  const grading = ctx.activeCast && entries.length >= CAST_GRADING_MIN_SIZE;
  const active = grading ? new Set(ctx.activeCast) : null;
  active?.add("protagonist"); // 主角恒算在场：玩家本人的人设不能被折叠
  const fullCards: string[] = [];
  const roster: string[] = [];
  for (const [id, card] of entries) {
    const dir = spriteIdOf(id, card);
    const variants = variantsOf(dir);
    // 路径写进标题：卡的 id 与文件名同源，但模型不该为了改一张卡去推路径——A 区给全，read / edit 直接用
    if (active && !active.has(id)) {
      const firstLine = card.body.split("\n").map((l) => l.trim()).find((l) => l !== "") ?? "";
      roster.push(
        `- ${castTitle(id, card.name)}：${firstLine.length > CAST_SUMMARY_CHARS ? `${firstLine.slice(0, CAST_SUMMARY_CHARS)}…` : firstLine}`,
      );
      continue;
    }
    fullCards.push(
      renderCastCard(
        { id, name: card.name, body: card.body, voice: card.voice, spriteDir: dir, variants },
        metaOf,
      ),
    );
  }
  // 在场全卡在前、折叠名册在后：两类形状不同，混排一段读起来是碎的。
  const characters = [...fullCards, ...(roster.length > 0 ? [roster.join("\n")] : [])].join("\n\n");
  // 只有立绘没有卡的主体（机甲、猫、道具）：它们进不了角色表——角色表就是角色卡目录，
  // 但剧作家得知道它们存在、能按 variant 上台。不给这份清单，它就只会重新出图或干脆不用。
  // 被某张卡绑走的目录不算「没有卡」：那套立绘已经在上面那张卡里列过差分了。
  const bound = new Set(entries.map(([id, card]) => spriteIdOf(id, card)));
  const bare = Object.keys(ctx.assets ?? {})
    .filter((key) => key.startsWith("sprites/"))
    .map((key) => key.slice("sprites/".length))
    .filter((dir) => !bound.has(dir))
    .sort((a, b) => a.localeCompare(b));
  const bareSection =
    bare.length > 0 ? `${renderBareSprites(bare, variantsOf, metaOf)}\n` : "";
  // A 区在纪元内冻结：不因「谁上场了」重建——所以这里只讲事实：
  // 折叠行对已经退场的老角色够用（那是它们上一段戏的存档），
  // 新角色按《引入新角色》建档，轮边界重建后会自动带全卡。
  const castHint =
    roster.length > 0
      ? `\n\n（上面最后几行是最近没出场的人物，只注了一行摘要，照它写即可；${
          ctx.can.characters
            ? "要它的完整人设出场就走《引入新角色》建档，那会自动带上全卡。"
            : "要它的完整人设就先 read `characters/<id>.md`——本剧目没给你改角色卡的口。"
        }）\n`
      : "";

  const generatedSection =
    generated.length > 0
      ? `\n# 已生成的图（早已存在，直接引用 id，不要再 generate_asset）\n\n${generated
          .map((g) => `${g.id}（${g.type}）—— ${g.prompt}`)
          .join("\n")}\n`
      : "";
  // 段与段之间的块状渲染在包里（两个宿主同一份）；这里只加服务端自己的两段：
  // 「已生成的图」与资源库指引。
  const assetSection = [
    renderAssetSections(ctx.assets ?? {}, (id) => metaOf(id), { audioRules: AUDIO_RULES }),
    generatedSection,
    ctx.can.library ? LIBRARY_REF : "",
  ].join("");

  // 世界观前提的唯一真相源是 memory/always/premise.md：没有它就没有 A 区，剧作家无从下手
  const premise = memory?.premise.trim() ?? "";
  // 剧目自己的创作口径：外置到 memory/always/craft.md（工坊与用户共编），默认为空。
  // 原样注入——文件自带什么标题就带什么标题，不再套一层壳。
  // 它承载**只能拿话说的那部分**（文风、禁忌、称呼习惯）；能取确定值的三件事
  // （每轮多长、停止点给几条、素材来源）在 play.json 的 craft 段里，由 `renderCraftParams` 注入，
  // 紧挨这份文件之前——先给参数，再读散文。
  const craft = memory?.craft.trim() ?? "";
  const craftSection = craft ? `\n${craft}\n` : "";
  const craftParamsSection = renderCraftParams(resolveCraft(play.craft), ctx.can);
  const nsfwGuidance = !ctx.can.nsfw
    ? ""
    : ctx.nsfwMode
      ? `\n# 限制级（NSFW）创作指引\n\n你当前正处于限制级剧情通道。\n- 专注于亲密接触中的情感张力、双方的心理起伏、生理与感官细节反应的细腻刻画；\n- 保持角色一贯的性格与说话风格，将人设融入亲密互动中；\n- 结合 Stage DSL：合理使用 <actor action="..." variant="..."> 配合肢体反应与微表情，用 <sfx> 辅助营造氛围；\n- 当这段亲密情节告一段落、即将回归正常日常时，调用 exit_nsfw 退出限制级模式，并在这一轮正文末行照常写下停止点标签。\n${
          memory?.nsfw?.trim() ? `\n## 剧目限制级专属口径\n${memory.nsfw.trim()}\n` : ""
        }${ctx.nsfwPrompt?.trim() ? `\n## 补充限制级提示词\n${ctx.nsfwPrompt.trim()}\n` : ""}`
      : `\n## 亲密/限制级剧情入口（enter_nsfw）\n\n当剧情推进至即将发生亲密、成人或限制级（NSFW）接触时，不要在当前模型下直接描写露骨细节。\n调用 \`enter_nsfw\` 开启限制级剧情通道：调用后写完本轮正文与末行的停止点标签即可停笔，下一轮起将由限制级专用模型和专属提示词接管展开细腻描写。\n`;
  const cards = memory?.visibleContext() ?? [];
  // 每行带路径：卡的标题（`# 标题`）与文件名可以不一样，路径推不出来，只能这里给
  const indexSection =
    cards.length > 0
      ? `\n${renderMemoryIndex(
          cards,
          ctx.can.memory
            ? "需要某条完整内容时 read 每行括号里的路径。历史往事用 search_archive 检索。"
            : "需要某条完整内容时 read 每行括号里的路径；过往剧情问用户，或让工坊在记忆页查。",
        )}\n`
      : "";

  return `${ROLE_INTRO}
${scriptLanguageSection(play.scriptLanguage)}
${HOW_I_WORK}
${skillSection(ctx.skills ?? "", ctx.can.skill)}

# 剧目设定

${premise}

# 角色表

${characters}${castHint}${bareSection}
${assetSection}${craftParamsSection}${craftSection}${nsfwGuidance}${indexSection}
${FORMAT_RULES}

${imageChapter(ctx.can.image)}
${ctx.can.search ? SEARCH_GUIDE : ""}
${ctx.can.memory ? MEMORY_RULES : ""}
${ctx.can.memory ? STATE_RULES : ""}
${newCharacterRules(ctx.can.characters)}${customSection(ctx.customPrompt)}

${CONTRACT_RULES}`;
}

/** 用户自定义段（play.json 的 agents.playwriter.prompt）：原样拼，空值一点痕迹都不留。 */
function customSection(custom: string | undefined): string {
  const text = custom?.trim();
  if (!text) return "";
  return `\n\n# 本剧目的补充要求\n\n${text}`;
}

/**
 * 出图章节（生图工具不可用时换成一句「没有生图」的话，不教它调一个不存在的工具）。
 *
 * 只讲工具本身与它的后果，**不讲什么时候该画**——那是剧目的创作口径。
 * 早先那句「清单里没有就自己画一张背景」撤掉了：它替所有剧目做了同一个决定，
 * 而背景该从库里拿还是该现画，是逐剧目的事。
 */
function imageChapter(can: boolean): string {
  if (!can) {
    return `## 生图

本剧目没有开启生图：不要在剧本里引用清单之外的背景/插图/立绘差分，用旁白和台词交代画面。`;
  }
  return `## 自己出图（generate_asset / generate_image）

哪些素材该出图、出哪几张，照剧目的创作口径。这里只讲这个工具：排一张**发起即返回**，不等它出完；
这一轮就引用到它，舞台先上骨架占位，到货后自动淡入。

    generate_asset(kind="background", name="bg_classroom_dusk", prompt="abandoned classroom at dusk, warm sunset light through dusty windows, anime visual novel background, no text")
    …若干句台词…
    <scene bg="bg_classroom_dusk" .../>

调用的写法（id 怎么起名、prompt 怎么写、画面里有角色时怎么垫立绘）看 generate_asset 的工具说明。

- **不要凭空造 id**：可用清单与「已生成的图」里已有的背景和插图直接引用，别重复生成；
- **按描述选素材**：清单里带括号说明的是画面内容（差分的名字未必与画面相符），先看说明再挑 id。
- **立绘差分**用 generate_asset(kind="sprite") 出。某角色一张立绘都没有、又还没来得及出图时，
  别让 ta 上台——改用旁白/台词交代，或只写有立绘的角色。`;
}

/** user 消息【状态】区（B 区，每轮变化但 append-only）。stateFiles = always/state 谱系级内容（D7）。 */
export function renderStateSection(
  state: EngineStateSnapshot,
  scene: string,
  stateFiles: Record<string, string> = {},
): string {
  const affinity = Object.entries(state.affinity)
    .map(([k, v]) => `${k} ${v}`)
    .join(" | ");
  const flags = Object.entries(state.flags);
  return [
    `场景：${scene}`,
    affinity ? `好感度：${affinity}` : null,
    flags.length > 0 ? `旗标：${flags.map(([k, v]) => `${k}=${v}`).join(" | ")}` : null,
    `进度：第 ${state.turn} 轮`,
    stateFiles.scene?.trim() ? `场景细节：${stateFiles.scene.trim()}` : null,
    stateFiles.threads?.trim() ? `活跃剧情线：${stateFiles.threads.trim()}` : null,
    "（这些就是 memory/always/state/ 那三个文件的内容，由你自己维护。）",
  ]
    .filter(Boolean)
    .join("\n");
}
