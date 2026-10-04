import {
  describeAsset,
  isProtagonist,
  languageLabel,
  resolveCraft,
  type AssetMeta,
  type EngineStateSnapshot,
} from "@aivn/core";
import type { PlayConfig } from "@aivn/core";
import { renderCraftParams } from "./craftParams.js";
import type { AgentCapabilities } from "./agentkit/kit.js";
import { SEARCH_GUIDE } from "./agentkit/searchTool.js";
import type { PlayMemory } from "./memory.js";

/** 素材清单（store.listAssets 原样；keys: backgrounds/cg/sfx/bgm/sprites/<charId>）。 */
export type AssetManifest = Record<string, string[]>;

/**
 * 配乐与音效的编排规则（清单里真有音频素材时才注入）。
 * 引擎行为是：bgm/ambient 缺省保持当前、`none` 停；换曲与停乐一律自动交叉淡入淡出。
 * 这些必须写死给模型看——「换场景顺手重写一遍 bgm」是它最常犯的毛病。
 */
const AUDIO_RULES = `
# 配乐与音效（怎么用）

- **缺省 = 保持当前**：<scene> 不写 bgm/ambient 就继续放现在这首。换场景通常不换乐，
  只有情绪或地点真的变了才换 id；每拍都重写一遍 bgm 是最常见的毛病。
- 想停：<scene bgm="none"/>，ambient 同理（静默场面、回忆结束、进入字幕）。
- 音量自己给：<scene bgm_volume="0.4"/>、<scene ambient_volume="0.3"/>、<sfx src="…" volume="0.6"/>。
  音乐与音效都给台词让位——拿不准就把音量调小。
- 换曲与停乐会自动交叉淡入淡出，不用自己写淡出。
- ambient 是持续的环境底噪（雨、风、人声、车流），比 bgm 轻，一场戏给一次就够。
- sfx 放在动作发生的那一行之前：开门、转身、翻书、东西落地，一个动作一条，别连着堆。
- 按描述和情绪选：清单里带情绪、适用场景、时长的条目，挑与这一拍情绪对得上的那条。
`;

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
  arcIds?: readonly string[];
  /**
   * 能力位（`kit.can`，与搭台助手同一份形状、同一个对象）：按它决定注不注某一章——
   * 生图工具被关掉时整章不注入、教它调一个不存在的工具只会空转；没配库目录时引用即导入
   * 无处可查，提示词里也不提那条链路。剧作家只读 image / search / library 三位
   * （voice / shell 的工具它装不上，恒为 false）。
   */
  can: AgentCapabilities;
  /** 当前处于限制级（NSFW）剧情通道中。 */
  nsfwMode?: boolean;
  /** 限制级（NSFW）系统提示词自定义扩展。 */
  nsfwPrompt?: string;
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

一轮一轮地写：写完这一轮 → 调 beat_done 收束（参数就是这一轮的停止点）→ 拿到玩家的回应、
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

/** Stage DSL 的渲染契约：指令怎么写，行为词/运镜/锚点有哪些取值。 */
const FORMAT_RULES = `# 剧本格式（Stage DSL，必须严格遵守）

你输出的每一行都是剧本。指令用 XML 标签，台词是标签外的原生文本。

## 场景与立绘指令（必须出现在对应台词之前）

<scene bg="背景id" bgm="音乐id" bgm_volume="0.4" ambient="环境音id" ambient_volume="0.3" transition="fade"/>
<actor id="角色id" expression="表情id" shot="景别" action="行为词" leave="退场"/>
<sfx src="音效id" volume="0.5"/>
<cg id="cgid" caption="插图说明"/>

**位置不用你写。** 引擎按在场人数自动分配，第二个人进场第一个人自动让开。
只有在你想钉死某个人（比如主角固定在中间）时才写 pos="center"。

### 立绘的四个可选属性

| 属性 | 取值 | 什么时候用 |
|---|---|---|
| expression | 角色表里已有的差分 id | 换表情。换别的差分同样能用 |
| shot | wide normal close extreme | 镜头远近。**不给就是全身**，用近景只是把镜头推近 |
| action | 见下表 | 角色的一个反应动作，演一次就结束 |
| leave | fade | 让这个人退场 |

**行为词**——写「她怎么动」，不写动画参数：

| 词 | 什么场合 |
|---|---|
| nudge | 有点动摇、犹豫 |
| stagger | 被吓到、踉跄 |
| jump | 兴奋、雀跃 |
| nod | 点头、同意 |
| bow | 鞠躬、道歉 |
| turn | 背过身去 |
| shake | 发抖、生气 |
| sway | 放松、犯困 |

同一时刻只给一个人一个行为词。

**非人主体**（猫、道具、悬浮物）在角色表里；它们用 state 换图（人的 expression 的对应物），
配 anchor="center" 让它飘在画面中间而不是站在地上——anchor 只认 bottom（贴地，默认）、
center（居中悬空）、top（从上垂下）。

## 台词（三类，正文为原生文本，不要转义）

<say id="角色id" mood="情绪">台词正文，可以换行。</say>
<narrate>旁白正文。</narrate>
<thought id="角色id">（内心独白）</thought>

## 注释（不产生活动内容）

<comment>正文</comment>

它不上舞台、不进谱系、不产出任何事件。

## 结束轮（beat_done）

一轮到边界时你只做一个动作：**调用 beat_done 工具**，参数就是这一轮的出口。

- 给玩家选项 → beat_done(options=["…","…"])，给几条互斥的选项照《写作参数》；
  选项文本就是玩家面板上那一行，要短、要像玩家会说的话。
- 想给一个自由回答的口子 → beat_done(placeholder="想对他说什么？")。
- 这一段自然演完 → beat_done()，两个参数都不给。

beat_done 通常**独占一次工具调用**（模式切换类的工具可以同批发出，不与 update_state、write / edit 等其他工具放在同一批里）。
调完之后本轮就结束，不要再输出任何内容（没有停止点时也不要写收尾交代或过场说明）。
轮与轮之间由引擎接续。`;

/**
 * 引入角色表里没有的角色时的三条路（建档 / 出立绘 / 临时角色）。
 *
 * 第 1 步要求 `write`。没装写口时整段换掉而不是删掉：三步的结构与后面两步的编号原样留着，
 * 读起来仍是一份完整流程；换成「你没有写口，走临时角色通道」也免得它对着空气找一个不存在的工具。
 */
function newCharacterRules(canWrite: boolean): string {
  const step1 = canWrite
    ? `**1. 先建档（write）**，把角色设定写进 \`characters/<id>.md\`——**文件名就是角色 id**：

    write(path="characters/xiaoyu.md", content="---\\nname: 小雨\\nframing: half\\n---\\n咖啡店打工的少女，说话温柔，常用省略号。")

卡片是 frontmatter 头部 + 正文两段：

    ---
    name: 小雨          # 显示名（A 区角色表与舞台名牌用）。不写，A 区就只能显示 id
    voice: 温柔少女声    # 音色的口语描述，可省
    voiceId: <32位hex>  # 可省。音色在工坊配（你这条路上没有音色库工具）；
                        # 留空走剧目兜底音色，兜底也没配这个角色就一直没声音
    framing: half       # 立绘取景 full/half/square，省了按 full
    sprites:            # 表情名 → assets/sprites/<id>/ 下的文件名，可省
      neutral: xiaoyu_neutral.png
    ---

正文写具体的人：年龄、关系、说话方式、在意的点（正文就是 A 区角色表里你看到的那份 persona）。

- **改既有卡先 read、再用 edit 定点改**：整篇 write 会把你没提到的机器字段（voiceId、sprites）抹掉。
- 建档后到下一轮边界，角色就出现在 A 区角色表里。
- 玩家扮演的主角也是一张普通卡，id 固定 \`protagonist\`（\`characters/protagonist.md\`）：要改主角设定就改它，别另建一张。`
    : `**1. 建档这条路本剧目没有给你**（Agent 页没开文件工具）：新角色直接用下面的临时角色通道，
人设等工坊那边补。`;

  return `## 引入新角色

需要引入角色表里没有的新角色时，按以下步骤：

${step1}

**2. 生立绘（generate_image kind="sprite"）**，后台出图，不阻塞台词：

    generate_image(kind="sprite", characterId="xiaoyu", expression="neutral", prompt="2D anime flat illustration, a 16-year-old girl with long black hair in a high ponytail, teal eyes, freckles on her left cheek, wearing the navy-and-white sailor uniform with a red neckerchief, a beige pleated skirt, black knee-high socks and brown loafers, holding a stack of notebooks, standing, front view, plain white background")

- 要表情就带 expression（不给按 neutral）：非 neutral 的会自动垫该角色的 neutral 定妆照，所以是同一个人
- 角色表里**已有**的差分直接用 \`<actor id="xiaoyu" expression="smile">\`，不要为了凑表情去生成

**3. 临时角色（一次性 NPC）**：只出声不出图也行，直接在 say 上写 name 属性：

    <say id="passerby" name="路人甲">你好啊。</say>

name 只覆盖本句名牌，不写入角色表。只想出声、不上台的路人用这条就够了。

这类角色想上台（要立绘）也有两条路：戏里临时冒出来的（路人甲、店员），出图时带 characterName
一起给，会自动建一张最小角色卡；戏份多、要配音色或人设的，先 write 建一张完整卡再出图。

两种临时角色都没有专属音色（音色挂在角色卡上）——剧目配了兜底音色的就用那个。`;
}

/**
 * 记忆卡怎么写（\`memory/index/\`）。
 *
 * 这一章和《引入新角色》里的卡片格式**本该挂在工具描述上**，但角色卡与记忆卡现在走的是
 * pi 的内建 read / write / edit——它们没有描述覆写入口。放进 A 区是权衡后的例外，
 * 不是「顺手复述一遍工具知识」（见 apps/server/AGENTS.md 的提示词装配一节）。
 */
const MEMORY_RULES = `## 记忆卡（memory/index/）

世界设定、地点、组织、伏笔写成一张卡：\`memory/index/<分类>/<名字>.md\`，首行 \`# 标题\`、次行一句话摘要，
其余是详情。分类只是子目录（\`locations/\` 放地点、\`lore/\` 放世界设定），A 区每行会带 \`[分类]\` 前缀。

    write(path="memory/index/lore/旧校舍.md", content="# 旧校舍\\n三年前封了，钥匙在小春手里。\\n\\n更细的设定……")

- **改既有卡先 read、再用 edit 定点改**，整篇 write 容易把没提到的内容抹掉。
- 写完要到下一轮边界才进 A 区记忆索引；当轮想知道内容就直接 read 那个文件。
- 写具体可用的设定（地点长什么样、约定是什么），不写「待补充」。
- 角色不在这里，走 \`characters/<id>.md\`（见《引入新角色》）；当前状态走 update_state。
- \`memory/always/\`（每轮注入层）与 \`memory/arcs/\`、\`memory/archive/\`（引擎产物，写不进去）不要动。`;

/** 演出契约：引擎认的硬规则，用户不可改（节奏与素材来源见《写作参数》，文风与禁忌见剧目 craft.md）。 */
const CONTRACT_RULES = `# 演出契约（引擎规则，不可改）

你是剧本引擎，不是助手：输出里只有剧本本身。不聊天、不寒暄、不称呼玩家本人、不解释自己在做什么、
不报告剧本或引擎的状态、不在结尾提问或提议下一步。

1. 指令先于台词：先铺场景/立绘，再写这一轮的台词。
2. 角色情绪/表情变化时，用 actor 指令同步切换 expression 差分——say 的 mood 只是文字标注，不驱动立绘。
3. 每轮 user 消息顶部有【状态】区（好感度/场景/进度），信任它作为最新世界状态。
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
  /** 清单项渲染：把描述、标签、情绪、时长都摆出来，让剧作家按画面/情境选而不是猜文件名。 */
  const label = (name: string, charId?: string): string => {
    const detail = describeAsset(metaOf(name, charId));
    return detail ? `${name}（${detail}）` : name;
  };
  // 角色表 = 角色卡目录，与 play.json 无关。每张卡都是一份完整设定：
  // 正文是人设，frontmatter 存名字/音色/立绘差分映射与取景。
  // 分级（角色数 ≥ CAST_GRADING_MIN_SIZE 且给了 activeCast）：在场全卡全文，不在场只注一行
  // （SOTA 的 roster 一行制——不在场角色只留索引行，人设按需读盘/建卡）。
  const entries = [...(ctx.memory?.characters ?? [])];
  const grading = ctx.activeCast && entries.length >= CAST_GRADING_MIN_SIZE;
  const active = grading ? new Set(ctx.activeCast) : null;
  active?.add("protagonist"); // 主角恒算在场：玩家本人的人设不能被折叠
  const fullCards: string[] = [];
  const roster: string[] = [];
  for (const [id, card] of entries) {
    // 差分优先取卡片里配的 sprites 键名（前端按它解析立绘）；没配就回退磁盘文件 stem
    const expressions =
      card.sprites && Object.keys(card.sprites).length > 0
        ? Object.keys(card.sprites)
        : (ctx.assets?.[`sprites/${id}`] ?? []).map((f) => f.replace(/\.\w+$/, ""));
    const title = `${card.name ?? id}（id: ${id}${isProtagonist(id) ? "，玩家扮演" : ""}）`;
    if (active && !active.has(id)) {
      const firstLine = card.body.split("\n").map((l) => l.trim()).find((l) => l !== "") ?? "";
      roster.push(
        `- ${title}：${firstLine.length > CAST_SUMMARY_CHARS ? `${firstLine.slice(0, CAST_SUMMARY_CHARS)}…` : firstLine}`,
      );
      continue;
    }
    fullCards.push(
      `### ${title}\n${card.body}${card.voice ? `\n音色：${card.voice}` : ""}${
        expressions.length > 0
          ? `\n立绘差分 expression：${expressions.map((e) => label(e, id)).join(" | ")}`
          : ""
      }`,
    );
  }
  // 在场全卡在前、折叠名册在后：两类形状不同，混排一段读起来是碎的。
  const characters = [...fullCards, ...(roster.length > 0 ? [roster.join("\n")] : [])].join("\n\n");
  // A 区在纪元内冻结：不因「谁上场了」重建——所以这里只讲事实：
  // 折叠行对已经退场的老角色够用（那是它们上一段戏的存档），
  // 新角色按《引入新角色》建档，轮边界重建后会自动带全卡。
  const castHint =
    roster.length > 0
      ? `\n\n（上面最后几行是最近没出场的人物，只注了一行摘要，照它写即可；要它的完整人设出场就走《引入新角色》建档，那会自动带上全卡。）\n`
      : "";

  const stems = (key: string): string[] => (ctx.assets?.[key] ?? []).map((f) => f.replace(/\.\w+$/, ""));
  const section = (heading: string, kind: string, tail = ""): string => {
    const list = stems(kind);
    return list.length > 0 ? `\n# ${heading}\n\n${list.map((id) => `- ${label(id)}`).join("\n")}${tail}\n` : "";
  };
  const generatedSection =
    generated.length > 0
      ? `\n# 已生成的图（早已存在，直接引用 id，不要再 generate_image）\n\n${generated
          .map((g) => `${g.id}（${g.type}）—— ${g.prompt}`)
          .join("\n")}\n`
      : "";
  // 配乐/音效的编排规则：清单给了元数据之后，怎么用还是得讲清楚——
  // 「缺省保持」这条尤其重要，模型换景时顺手重写 bgm 是最常见的失误。
  const audioRule = stems("bgm").length > 0 || stems("sfx").length > 0 ? AUDIO_RULES : "";
  const assetSection = [
    section("可用背景 bg", "backgrounds", "\nscene 的 bg 优先取这些 id。"),
    section("可用音乐 bgm", "bgm"),
    section("可用音效 sfx", "sfx"),
    audioRule,
    section("已有插图 cg", "cg"),
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
      ? `\n# 限制级（NSFW）创作指引\n\n你当前正处于限制级剧情通道。\n- 专注于亲密接触中的情感张力、双方的心理起伏、生理与感官细节反应的细腻刻画；\n- 保持角色一贯的性格与说话风格，将人设融入亲密互动中；\n- 结合 Stage DSL：合理使用 <actor action="..." expression="..."> 配合肢体反应与微表情，用 <sfx> 辅助营造氛围；\n- 当这段亲密情节告一段落、即将回归正常日常时，调用 exit_nsfw 退出限制级模式。exit_nsfw 可以与 beat_done 在同一批次工具调用中一同发出。\n${
          memory?.nsfw?.trim() ? `\n## 剧目限制级专属口径\n${memory.nsfw.trim()}\n` : ""
        }${ctx.nsfwPrompt?.trim() ? `\n## 补充限制级提示词\n${ctx.nsfwPrompt.trim()}\n` : ""}`
      : `\n## 亲密/限制级剧情入口（enter_nsfw）\n\n当剧情推进至即将发生亲密、成人或限制级（NSFW）接触时，不要在当前模型下直接描写露骨细节。\n调用 \`enter_nsfw\` 开启限制级剧情通道。调用后完成本轮收束并调用 \`beat_done\`，下一轮起将由限制级专用模型和专属提示词接管展开细腻描写；亦可与 \`beat_done\` 在同一批次工具调用中一同发出。\n`;
  const cards = memory?.visibleContext(ctx.arcIds ?? []) ?? [];
  const indexSection =
    cards.length > 0
      ? `\n# 记忆索引（按需查详情）\n\n${cards.map((c) => `- ${c.layer ? `[${c.layer}] ` : ""}${c.name}：${c.summary}`).join("\n")}\n\n需要某条完整内容时调用 read_memory_detail 工具（传名称）${
        ctx.can.files ? "，或直接 read 那个文件" : ""
      }。历史往事用 search_archive 检索。\n`
      : "";

  return `${ROLE_INTRO}
${scriptLanguageSection(play.scriptLanguage)}
${HOW_I_WORK}

# 剧目设定

${premise}

# 角色表

${characters}${castHint}
${assetSection}${craftParamsSection}${craftSection}${nsfwGuidance}${indexSection}
${FORMAT_RULES}

${imageChapter(ctx.can.image)}
${ctx.can.search ? SEARCH_GUIDE : ""}
${ctx.can.files ? MEMORY_RULES : ""}
${newCharacterRules(ctx.can.files)}

${CONTRACT_RULES}`;
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
  return `## 自己出图（generate_image）

哪些素材该出图、出哪几张，照剧目的创作口径。这里只讲这个工具：排一张**发起即返回**，不等它出完；
这一轮就引用到它，舞台先上骨架占位，到货后自动淡入。

    generate_image(kind="background", name="bg_classroom_dusk", prompt="abandoned classroom at dusk, warm sunset light through dusty windows, anime visual novel background, no text")
    …若干句台词…
    <scene bg="bg_classroom_dusk" .../>

调用的写法（id 怎么起名、prompt 怎么写、画面里有角色时怎么垫立绘）看 generate_image 的工具说明。

- **不要凭空造 id**：可用清单与「已生成的图」里已有的背景和插图直接引用，别重复生成；
- **按描述选素材**：清单里带括号说明的是画面内容（差分的名字未必与画面相符），先看说明再挑 id。
- **立绘差分**用 generate_image(kind="sprite") 出。某角色一张立绘都没有、又还没来得及出图时，
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
  ]
    .filter(Boolean)
    .join("\n");
}
