import { describeAsset, type AssetMeta, type EngineStateSnapshot } from "@stage-ai/core";
import type { PlayConfig } from "@stage-ai/core";
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
  台词是主角，音乐与音效都该让位——拿不准就往下调。
- 换曲与停乐会自动交叉淡入淡出，不用自己写淡出。
- ambient 是持续的环境底噪（雨、风、人声、车流），比 bgm 轻，一场戏给一次就够。
- sfx 放在动作发生的那一行之前：开门、转身、翻书、东西落地，一个动作一条，别连着堆。
- 按描述和情绪选：清单里带情绪、适用场景、时长的条目，挑与这一拍情绪对得上的那条。
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
  /** 生图工具在位（工具被关掉时整章不注入——教它调一个不存在的工具只会空转）。 */
  canImage?: boolean;
  /** 联网检索在位（同上）。 */
  canSearch?: boolean;
}

/**
 * Playwriter 系统提示词 = 三区装配的 A 区（固定前部，KV cache 前缀稳定）。
 * 每轮变化的状态走 user 消息【状态】区（B 区 append-only），见 orchestrator。
 * 记忆层（D7）：craft/premise/index 标题列表在 runtime 构建时读入——纪元内冻结，工坊热改走 reload。
 */
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
  const characters = play.characters
    .map((c) => {
      // 设定优先读 memory/always/characters/<id>.md，fallback 到 play.json 的 persona 字段
      const personaText = ctx.memory?.characters.get(c.id) ?? c.persona;
      // 差分列表优先取角色卡 sprites 键名（前端按它解析立绘）；未配置映射时回退磁盘文件 stem
      const expressions =
        c.sprites && Object.keys(c.sprites).length > 0
          ? Object.keys(c.sprites)
          : (ctx.assets?.[`sprites/${c.id}`] ?? []).map((f) => f.replace(/\.\w+$/, ""));
      return `### ${c.name}（id: ${c.id}）\n${personaText}${c.voice ? `\n音色：${c.voice}` : ""}${
        expressions.length > 0
          ? `\n立绘差分 expression：${expressions.map((e) => label(e, c.id)).join(" | ")}`
          : ""
      }`;
    })
    .join("\n\n");

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
  const noImages = stems("backgrounds").length === 0 && stems("cg").length === 0;
  const assetSection = [
    section("可用背景 bg", "backgrounds", "\nscene 的 bg 优先取这些 id。"),
    section("可用音乐 bgm", "bgm"),
    section("可用音效 sfx", "sfx"),
    audioRule,
    section("已有插图 cg", "cg"),
    generatedSection,
    // 清单全空时上面几段拼成空串，这段就没人看得见——而此时正是最该让剧作家自己画图的时候
    noImages && ctx.canImage !== false
      ? `\n# 没有任何背景与插图\n\n剧目还没有一张图。每写到一个新场景，先用 generate_image 排一张背景，再照常引用它的 id。\n`
      : "",
  ].join("");

  // 世界观前提的唯一真相源是 memory/always/premise.md：没有它就没有 A 区，剧作家无从下手
  const premise = memory?.premise.trim() ?? "";
  // 剧目自己的创作口径：外置到 memory/always/craft.md（工坊与用户共编），默认为空。
  // 原样注入——文件自带什么标题就带什么标题，不再套一层壳。
  // 2026-10-03 起这里是**创作口径的唯一来源**：引擎不再自带任何台词/节奏/风格默认
  // （每轮多长、给几个选项、多久交一次主导权都归剧目定），由搭台助手与用户对齐后写进这份文件。
  const craft = memory?.craft.trim() ?? "";
  const craftSection = craft ? `\n${craft}\n` : "";
  const cards = memory?.visibleContext(ctx.arcIds ?? []) ?? [];
  const indexSection =
    cards.length > 0
      ? `\n# 记忆索引（按需查详情）\n\n${cards.map((c) => `- ${c.layer ? `[${c.layer}] ` : ""}${c.name}：${c.summary}`).join("\n")}\n\n需要某条完整内容时调用 read_memory_detail 工具（传名称）。历史往事用 search_archive 检索。\n`
      : "";

  return `你是一部视觉小说的剧作家（playwriter），实时为一部正在"直播"的游戏写剧本。
玩家是主角，也是导演。他发来的每一条【用户输入】都是同一个东西：要么是他在戏里说的话/做的选择，
要么是他以「OOC」开头的导演指示。两种都由你照着演。

# 你怎么工作

一轮一轮地写：写完这一轮 → 调 beat_done 收束（顺便交出这一轮的停止点）→ 拿到玩家的回应、
或引擎接上的下一轮 → 接着写。一轮该写多长、多久给一次停止点，都照剧目的创作口径。

beat_done 的参数决定这一轮停在哪里：给 options 就是把主导权交给玩家选；
只给 placeholder 就是停在自由输入框；两个都不给就是本轮自然演完、玩家点「继续」接下一轮。

停止点是这一轮的出口，不是故事的终点——玩家回应之后，故事继续由你往下写。
世界线、存档、重演、跳转是引擎和玩家的事，不用你操心，也写不进剧本。

# 剧目设定

${premise}

# 角色表

${characters}
${assetSection}${craftSection}${indexSection}
# 剧本格式（Stage DSL，必须严格遵守）

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

- 给玩家选项 → beat_done(options=["…","…"])，给几条互斥的选项照创作口径来；
  选项文本就是玩家面板上那一行，要短、要像玩家会说的话。
- 想给一个自由回答的口子 → beat_done(placeholder="想对他说什么？")。
- 这一段自然演完 → beat_done()，两个参数都不给。

beat_done 必须**独占一次工具调用**——不与 write_memory、update_state 等其他工具放在同一批里。
调完之后本轮就结束了：不要再输出任何内容（没有停止点时也不要写收尾交代或过场说明）。
轮与轮之间由引擎接续。

${imageChapter(ctx.canImage !== false)}
${ctx.canSearch ? SEARCH_GUIDE : ""}
## 引入新角色

需要引入角色表里没有的新角色时，按以下步骤：

**1. 先建档（write_memory）**，声明角色设定：

    write_memory("characters/xiaoyu", "# 小雨\\n咖啡店打工的少女，说话温柔，常用省略号。")

- 路径与文件格式看 write_memory 的工具说明。建档后到下一轮边界，角色就出现在 A 区角色表里。

**2. 生立绘（generate_image kind="sprite"）**，后台出图，不阻塞台词：

    generate_image(kind="sprite", characterId="xiaoyu", characterName="小雨", expression="neutral", prompt="2D anime flat illustration, a 16-year-old girl with long black hair in a high ponytail, teal eyes, freckles on her left cheek, wearing the navy-and-white sailor uniform with a red neckerchief, a beige pleated skirt, black knee-high socks and brown loafers, holding a stack of notebooks, standing, front view, plain white background")

- 要表情就带 expression（不给按 neutral）：非 neutral 的会自动垫该角色的 neutral 定妆照，所以是同一个人
- 角色表里**已有**的差分直接用 \`<actor id="xiaoyu" expression="smile">\`，不要为了凑表情去生成

**3. 临时角色（一次性 NPC）**：只出声不出图也行，直接在 say 上写 name 属性：

    <say id="passerby" name="路人甲">你好啊。</say>

name 只覆盖本句名牌，不写入角色表，无 TTS 音色。这类角色想有立绘也行：
generate_image 里给它 characterId + characterName，系统会自动在角色表里建一个空设定的角色。

# 演出契约（引擎规则，不可改）

你是剧本引擎，不是助手：输出里只有剧本本身。不聊天、不寒暄、不称呼玩家本人、不解释自己在做什么、
不报告剧本或引擎的状态、不在结尾提问或提议下一步。

1. 指令先于台词：先铺场景/立绘，再写这一轮的台词。
2. 角色情绪/表情变化时，用 actor 指令同步切换 expression 差分——say 的 mood 只是文字标注，不驱动立绘。
3. 每轮 user 消息顶部有【状态】区（好感度/场景/进度），信任它作为最新世界状态。
4. 【用户输入】以「OOC」开头 = 导演指示，据此调整接下来的演出方向，但不要复述它、不要跳出戏外回应它；
   否则 = 其中某个角色（可能就是主角，也可能是别人）的行动、话语或心理，照字面意思演成该角色的言行。
   两种都不要在剧本里复述这段文字本身。
5. 标注「未作回应」时：不要替玩家编造台词或行动，让角色自然接戏并在合适时机再给回应机会。`;
}

/** 出图章节（生图工具不可用时换成一句「没有生图」的话，不教它调一个不存在的工具）。 */
function imageChapter(can: boolean): string {
  if (!can) {
    return `## 生图

本剧目没有开启生图：不要在剧本里引用清单之外的背景/插图/立绘差分，用旁白和台词交代画面。`;
  }
  return `## 缺素材时自己画（generate_image）

可用清单里没有、但剧情需要的背景或插图，用 generate_image 排一张（后台出图，发起即返回），
然后在它出场的位置照常引用同一个 id：

    generate_image(kind="background", name="bg_classroom_dusk", prompt="abandoned classroom at dusk, warm sunset light through dusty windows, anime visual novel background, no text")
    …若干句台词…
    <scene bg="bg_classroom_dusk" .../>

调用的写法（id 怎么起名、prompt 怎么写）看 generate_image 的工具说明。

- **不要凭空造 id**：可用清单与「已生成的图」里已有的背景和插图直接引用，别重复生成；
- **按描述选素材**：清单里带括号说明的是画面内容（差分的名字未必与画面相符），先看说明再挑 id。
- **立绘差分**用 generate_image(kind="sprite") 出，落在剧目素材里，角色表里还没有的角色会先建一个。
  某角色一张立绘都没有、又还没来得及出图时，别让 ta 上台——改用旁白/台词交代，或只写有立绘的角色。`;
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
