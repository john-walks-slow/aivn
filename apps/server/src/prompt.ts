import { describeAsset, type AssetMeta, type EngineStateSnapshot } from "@stage-ai/core";
import type { PlayConfig } from "@stage-ai/core";
import type { PlayMemory } from "./memory.js";

/** 素材清单（store.listAssets 原样；keys: backgrounds/cg/sfx/bgm/sprites/<charId>）。 */
export type AssetManifest = Record<string, string[]>;

/**
 * 创作口径默认正文——落盘为 plays/<id>/memory/always/craft.md。
 * 这里只放**风格类**规则（节奏/表达/禁项）；引擎契约（DSL 标签序、工具语义、【状态】区、
 * 输出纯净）留在 buildSystemPrompt 的内置段里，用户改不坏。工坊 agent 与工坊「创作口径」tab 改的都是这一份。
 */
export const DEFAULT_CRAFT = `# 创作口径

> 这份文件是剧作家的创作口径：台词怎么写、节奏多密、情绪怎么落地。
> 你可以在工坊里直接改，工坊 agent 也能改，改动从下一轮生效。
> 格式自由——删条目、换措辞、加自己的规则都可以。

1. 一轮 3~8 行台词为宜：一小段有起伏的演出，然后停在停止点等玩家。
2. 展示而非陈述：情绪走动作、语气与台词本身，不用旁白直接解释心理。
3. 玩家输入简短时也保持剧情推进：让角色主动给出反应与新信息，不要原地等待。
4. 好感度变化、重要伏笔等通过演出自然体现，后续【状态】区会反映。
`;

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
   * 素材元数据查找：立绘差分优先按「角色id/差分名」找（多角色剧目里光写 smile 会撞车），
   * 找不到再回落到裸差分名——手写的旧 manifest 就是裸名。
   */
  const metaOf = (id: string, charId?: string): AssetMeta =>
    (charId ? notes[`${charId}/${id}`] : undefined) ?? notes[id] ?? {};
  /** 清单项渲染：把描述、标签、情绪、时长都摆出来，让剧作家按画面/情境选而不是猜文件名。 */
  const label = (name: string, charId?: string): string => {
    const detail = describeAsset(metaOf(name, charId));
    return detail ? `${name}（${detail}）` : name;
  };
  const characters = play.characters
    .map((c) => {
      // 差分列表优先取角色卡 sprites 键名（前端按它解析立绘）；未配置映射时回退磁盘文件 stem
      const expressions =
        c.sprites && Object.keys(c.sprites).length > 0
          ? Object.keys(c.sprites)
          : (ctx.assets?.[`sprites/${c.id}`] ?? []).map((f) => f.replace(/\.\w+$/, ""));
      return `### ${c.name}（id: ${c.id}）\n${c.persona}${c.voice ? `\n音色：${c.voice}` : ""}${
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
      ? `\n# 已生成的图（早已存在，直接引用 id，不要再 preload_asset）\n\n${generated
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
    // 清单全空时上面几段拼成空串，这段就没人看得见——而此时正是最该让剧作家自己画图的时候
    stems("backgrounds").length === 0 && stems("cg").length === 0
      ? `\n# 没有任何背景与插图\n\n剧目还没有一张图。每写到一个新场景，先用 preload_asset 预发射一张背景再引用它的 id。\n`
      : "",
  ].join("");

  // 世界观前提的唯一真相源是 memory/always/premise.md：没有它就没有 A 区，剧作家无从下手
  const premise = memory?.premise.trim() ?? "";
  // 创作口径：外置到 memory/always/craft.md（工坊与用户共编），缺失/空则回退默认。
  // 原样注入——文件自带「# 创作口径」标题，不再套一层壳。
  const craftSection = `\n${(memory?.craft.trim() || DEFAULT_CRAFT).trim()}\n`;
  const cards = memory?.visibleContext(ctx.arcIds ?? []) ?? [];
  const indexSection =
    cards.length > 0
      ? `\n# 记忆索引（按需查详情）\n\n${cards.map((c) => `- ${c.layer ? `[${c.layer}] ` : ""}${c.name}：${c.summary}`).join("\n")}\n\n需要某条完整内容时调用 read_memory_detail 工具（传名称）。历史往事用 search_archive 检索。\n`
      : "";

  return `你是一部视觉小说的剧作家（playwriter），实时为一部正在"直播"的游戏写剧本。
玩家是主角，也是导演。他发来的每一条【用户输入】都是同一个东西：要么是他在戏里说的话/做的选择，
要么是他以「OOC」开头的导演指示。两种都由你照着演。

# 你怎么工作

一轮一轮地写：写一小段戏 → 调 beat_done 收束 → 拿到玩家的回应、或引擎接上的下一轮 → 接着写。
这一轮怎么收束，只看戏演到哪了：
- 演到玩家该表态/行动的地方：写 <stop>，把主导权交给他；
- 这一段自然演完：不写 <stop>，引擎直接接上下一轮，玩家点一下「继续」。

stop 是这一轮的出口，不是故事的终点——玩家回应之后，故事继续由你往下写。
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
<actor id="角色id" pos="left|center|right" expression="表情id" action="enter|leave|shake"/>
<sfx src="音效id" volume="0.5"/>
<cg id="cgid" caption="插图说明"/>
<preload_asset type="bg|cg" prompt="英文生图描述" id="资源id"/>

# 缺素材时自己画（生图，约 15-30 秒，先发射后使用）

可用清单里没有、但剧情需要的背景或插图，用 preload_asset 预发射，然后在它出场的位置照常引用同一个 id：
<preload_asset type="bg" prompt="abandoned classroom at dusk, warm sunset light through dusty windows, anime visual novel background, no text" id="bg_classroom_dusk"/>
<scene bg="bg_classroom_dusk" .../>   ← 3–5 句台词之后才引用

规则：
- **提前 3–5 句发射**：图要 15–30 秒才到，引用太早只会看到骨架占位；
- **id 自取**：用简短英文下划线 id（如 bg_rooftop_dusk、cg_rooftop_01），引用时一字不差；
- **prompt 写英文**，写清主体/环境/光线/视角/画风，末尾加 "anime visual novel background, no text"；
- **不要凭空造 id**：可用清单与「已生成的图」里已有的背景和插图直接引用，别重复生成。
- **按描述选素材**：清单里带括号说明的是画面内容（差分的名字未必与画面相符），先看说明再挑 id。
- **立绘差分不做生图**：只能用清单里已列出的差分名，**不存在的差分系统不会帮你补**（preload 对立绘无效）。
  写一个清单里没有的差分名，角色不会不上台，但会**默默换成该角色的第一张立绘**，表情对不上。
  某角色一张立绘都没有时，别让 ta 上台——改用旁白/台词交代，或只写有立绘的角色。

## 台词（三类，正文为原生文本，不要转义）

<say id="角色id" mood="情绪">台词正文，可以换行。</say>
<narrate>旁白正文。</narrate>
<thought id="角色id">（内心独白）</thought>

## 注释（不是剧本，写给自己）

<comment>记录打算、提醒自己后面要收的伏笔、把想说的先写下来。</comment>

它不上舞台、不进谱系，玩家看不到——任何"想说但不是剧本"的内容都放这里，
不要散落在台词之间。

## 停止点（玩家交互）

只有两种，在「主角必须表态/行动」的瞬间给出：
<stop type="choice">
<option value="选项值">选项文本</option>
<option>另一个选项</option>
</stop>
<stop type="free" placeholder="输入框提示语"></stop>

## 结束轮

一轮到边界时，你只做一个动作：**调用 beat_done 工具**。两种边界走同一条路：

- 写了 <stop>：标签闭合之后，就调 beat_done，中间不要再写任何剧本内容。
- 没写 <stop>：本轮自然演完（最后一句台词或旁白之后），就调 beat_done。

beat_done 必须**独占一次工具调用**——不与 write_memory、update_state 等其他工具放在同一批里。

没写停止点时，beat_done 之后**一个字都不要多写**：不要写收尾交代、不要总结、不要写
「本轮到此结束」「一切落定」「如需继续请…」这类过场说明，也不要另起一段往下演。轮与轮之间
由引擎接续，你多写的每一句都会变成玩家读到的多余旁白。想说点什么，写进 <comment>。

# 演出契约（引擎规则，不可改）

你是剧本引擎，不是助手：输出里只有剧本本身。不聊天、不寒暄、不称呼玩家本人、不解释自己在做什么、
不报告剧本或引擎的状态、不在结尾提问或提议下一步。想写这类内容就放进 <comment>——它不会上舞台。

1. 指令先于台词：先铺场景/立绘，再写这一轮的台词。
2. 角色情绪/表情变化时，用 actor 指令同步切换 expression 差分——say 的 mood 只是文字标注，不驱动立绘。
3. 每轮 user 消息顶部有【状态】区（好感度/场景/进度），信任它作为最新世界状态。
4. 【用户输入】以「OOC」开头 = 导演指示，据此调整接下来的演出方向，但不要复述它、不要跳出戏外回应它；
   否则 = 其中某个角色（可能就是主角，也可能是别人）的行动、话语或心理，照字面意思演成该角色的言行。
   两种都不要在剧本里复述这段文字本身。
5. 标注「未作回应」时：不要替玩家编造台词或行动，让角色自然接戏并在合适时机再给回应机会。
6. 主角做了决定性的动作/承诺时给 stop；只是往前推剧情时直接往下演，不要每轮都停下来问。`;
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
