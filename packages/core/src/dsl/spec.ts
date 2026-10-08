/**
 * Stage DSL v1 —— 冻结规范（docs/features/260928-stage-ai-mvp 计划 §6，2026-09-30 收缩至 v1.1）。
 *
 * 语法规则：
 *  1. 标签式：`<tag attr="...">正文</tag>` 或自闭合 `<tag attr="..."/>`。
 *  2. 指令先于台词：场景/立绘/音乐标签必须在对应台词前。
 *  3. 台词正文为原生文本（可含换行），零转义。
 *  4. 消息边界自动闭合：包裹类标签未闭合时收尾保留已流出台词。
 *  5. 每条 assistant 消息独立解析；工具调用轮次对播放透明。
 *
 * **停止点在 2026-10-06 回到剧本**（`<stop …/>`，见 `STOP_TAG`）：它一度被并进 `beat_done`
 * 工具参数（`260930-agent-kit` 计划 §2），代价是轮尾落成**工具结果**节点——DSH 侧的
 * 「在新对话中分支」只认「本轮最后一条是助手消息」，于是每拍演完分支键都置灰。回到文本之后
 * 轮尾重新是助手消息，舞台重建（只重放助手文本）也带得上停止点。
 * `preload_asset` 仍由 `generate_image` 工具承载——它确实是对宿主说的话，不是剧本。
 *
 * 属性值定界：标签头按**引号之外的首个 ">"** 收尾（`packages/core/src/dsl/parser.ts` 的
 * `findTagEnd`），所以属性值里出现 ">" 不会截断标签——收束散文这类长自由文本可以照写。
 * 引号本身没有转义语法：属性值用双引号声明时不能含双引号，要写含 `"` 的正文请改用单引号
 * （`summary='他说"走吧"'`）。中文散文用「」是常态，不构成阻塞。
 * 单引号这个出口只给**自由文本**（`summary` 这类人会读的话）——`id`/`bg`/`src` 等由宿主拿去
 * 查表键控的属性仍应写成双引号 + 不含 `"` 的值，否则引号会被当成键的一部分。
 */

import type { Transition } from "./effects.js";

export const DSL_TAGS = [
  "scene",
  "actor",
  "fx",
  "say",
  "narrate",
  "thought",
  "title",
  "sfx",
  "cg",
  "stop",
  "ending",
  "comment",
] as const;
export type DslTag = (typeof DSL_TAGS)[number];

/** 自闭合指令标签（无正文）。 */
export const VOID_TAGS: ReadonlySet<string> = new Set(["scene", "actor", "fx", "sfx", "cg", "stop", "ending"]);

/**
 * 停止点标签——**剧本的最后一行**，这一拍就停在玩家能动手的地方：
 *
 *     <stop options="去天台 | 回家"/>      选项面板（`|` 分隔，两端空白去掉；不足两条不算数）
 *     <stop placeholder="想对他说什么？"/>  自由输入框
 *     <stop/>                             这一段自然演完，不设停止点（与不写这个标签等价）
 *
 * 一行写完就停笔：它之后不该再有剧本内容。写成**标签**而不是工具调用是刻意的——
 * 轮尾因此是一条助手消息，DSH 的「在新对话中分支」与舞台重建都只认这种轮尾。
 */
export const STOP_TAG = "stop";

/** 选项分隔符：`<stop options="甲 | 乙"/>`。选项是短句，正文里不该出现它。 */
export const STOP_OPTION_SEPARATOR = "|";

/**
 * 结局标签——**剧本的最后一行**，整部故事 / 这一条路线的终点（不是「这一轮的出口」）：
 *
 *     <ending id="true_sunrise" name="晨光" subtitle="这一次，她没有回头"
 *              summary="她在晨光里回头，把三年的沉默一次说完。"/>   ← 属性值可含 ">"，见文件头
 *
 * 与 `<stop>` 的关系：普通轮用它自己交出出口，只有真正走到终点时才改用 `<ending>`——它**取代**
 * 那一轮的 `<stop>`，所以轮尾仍然是助手消息（DSH 的分支 / 舞台重建都只认这种轮尾）。
 *
 * **它不产生任何画面。** 末行一写就是「这个故事到此为止」的账目：引擎据此落账、拒绝继续、
 * 不让「点舞台继续」冒出来；终幕画面（若有）由剧作家用现成的 `<scene>` / `<title>` / `<narrate>`
 * 自己搭——每部戏想要的终幕本来就不一样。
 *
 * 到达结局后舞台进入**终局态**：不给任何按钮、无法继续，出口交给 DSH 的分支 / 新会话。
 * `id` 是这条结局的身份（跨周目账本的键、多周目引用的名字），**必须能稳定复用**；它之后的内容
 * 引擎一律丢弃（终局必须是确定的，不靠模型自觉停笔）。
 */
export const ENDING_TAG = "ending";

/**
 * 结局属性：**全部只用于归档，一条都不上屏**。
 *
 * 只保留最小三分：`id` 是身份、`name` 是账本里的人话名、`summary` 是整部剧 / 整条路线的归纳；
 * 另有 `subtitle` 作为可选的补充短句。四者之外不加字段——结局的类型学（good/bad/true）是未来
 * 画廊排序 / 配色的需要，届时以可缺省白名单增量加入，不预埋。
 */
export interface EndingAttrs {
  /** 结局 id：字母或数字开头，不含空白与路径分隔符——账本的键。 */
  id: string;
  /** 账本里给这条结局看的人话名；缺省回落 id。归档用，不上屏。 */
  name?: string;
  /** 补充短句（一句氛围 / 主题）；归档用，不上屏。 */
  subtitle?: string;
  /** 归档摘要：对整部剧、整条路线的归纳。归档用，不上屏。 */
  summary?: string;
}

/**
 * 注释标签——**不产出任何 IR 事件**（解析器吞掉正文）。
 *
 * 它的存在是个出口，不是功能：剧作家被要求「输出里只有剧本」，但模型总有想说的
 * 非剧本内容（记录打算、提醒自己伏笔、把话说出来再放下）。给它一个合法的地方写，
 * 「不聊天、不解释、不提问」这条契约才可能绝对化——否则模型只能靠违规来表达。
 * 内容不进谱系、不上舞台；模型自己的 assistant 消息原文仍在它的上下文里，
 * 所以它写下的注释在后续轮次对它自己依然可见。要跨会话留存请走记忆工具。
 */
export const COMMENT_TAG = "comment";

/**
 * 已作废的旧标签——**静默降级，不按未知标签原样输出**。
 *
 * 模型对旧形态有肌肉记忆，硬判成未知标签会把 `<option>…</option>` 当台词原样吐到舞台上，
 * 那比丢掉糟得多。命中即丢弃并挂一条 warning：一次调用静默失效，模型下一轮自己改正。
 *
 * `epilogue` 是这条规则最新的成员：它随结局改口径（`<ending>` 退化为纯归档标签、收束散文改走
 * `summary` 属性）一起作废。它尤其不能走未知标签分支——包裹标签里的正文会被**当台词演出来**，
 * 而 orphan_text 告警也不如 legacy_tag 说得明白。
 *
 * 其余退出说明：`<option>` 子标签随停止点回到 DSL 一起作废（新写法是 `<stop options="…"/>`），
 * `preload_asset` 改由 `generate_image` 工具承载。
 */
export const LEGACY_TAGS: ReadonlySet<string> = new Set(["option", "preload_asset", "epilogue"]);

/**
 * 场景指令属性。
 *
 * 音频属性缺省一律表示**保持当前**——换景不换乐是常事，少写一个属性不该让
 * 音乐凭空消失；真要停乐写 `bgm="none"`。背景 bg 仍按原语义：缺省保持上一张。
 */
export interface SceneAttrs {
  bg?: string;
  /**
   * 开新场：背景换了、台上的人全下，后面把本场在的人重铺一遍。
   * 缺省（不带）= 只换底、人不动（同屋日夜微调走这条）。
   */
  clear?: boolean;
  /** 背景音乐 id。缺省 = 保持当前；`none` = 停止。 */
  bgm?: string;
  /** 环境音 id（雨声/风声/人声，循环播放）。语义同 bgm。 */
  ambient?: string;
  /** bgm 音量 0–1；缺省 = 保持当前（首次进曲用曲目的建议音量）。 */
  bgm_volume?: number;
  /** ambient 音量 0–1。 */
  ambient_volume?: number;
  /** 换底方式（cut/dissolve/fade…）：封闭词表，见 effects.ts 的 TRANSITIONS。 */
  transition?: Transition;
}

/** 运镜档位：作用于**已有立绘**（放大 + 上移），不触发重新生成。 */
export const ACTOR_SHOTS = ["wide", "normal", "close", "extreme"] as const;
export type ActorShot = (typeof ACTOR_SHOTS)[number];

export function isActorShot(value: unknown): value is ActorShot {
  return typeof value === "string" && (ACTOR_SHOTS as readonly string[]).includes(value);
}

/** 对齐基准：图的哪条边锚在 stage 上。默认 bottom（脚踩地）；悬空物写 center。 */
export const ACTOR_ANCHORS = ["bottom", "center", "top"] as const;
export type ActorAnchor = (typeof ACTOR_ANCHORS)[number];

export function isActorAnchor(value: unknown): value is ActorAnchor {
  return typeof value === "string" && (ACTOR_ANCHORS as readonly string[]).includes(value);
}

export interface ActorAttrs {
  id: string;
  /** 显式站位（left/center/right 等；缺省走在场人数自动排布）。 */
  pos?: string;
  /**
   * 此刻的样子：换哪张差分图。
   *
   * 人写表情（smile）、猫写状态（asleep）、机甲写损伤（damaged）——同一个槽位。
   * 不必按主体类型分名字，因为台上一切（人、机甲、道具）本来就同权。
   */
  variant?: string;
  /** 运镜：当前这句台词的景别强调（wide/normal/close/extreme），不重新生图。 */
  shot?: ActorShot;
  /** 对齐基准（bottom 人贴底 / center 悬空物 / top 垂下）。 */
  anchor?: ActorAnchor;
  /**
   * 动作词（nudge/stagger/jump/nod/bow/turn/shake/sway）。
   * 保留旧 action="exit"/"leave" 的兼容。
   */
  action?: string;
  /** 退场动画（fade/walk 等），有它即表示离场。 */
  leave?: string;
}

export interface SfxAttrs {
  src: string;
  volume?: number;
}

/** say 属性：name 可选，覆盖本句名牌（临时显示，不写入角色表）。 */
export interface SayAttrs {
  id: string;
  /** 覆盖本句名牌文字；留空则查角色表，找不到则显示 id 原文。 */
  name?: string;
  mood?: string;
}

export interface CgAttrs {
  id: string;
  caption?: string;
}

/**
 * 全屏文本卡（章节标题 / 诗歌 / 独白）：`<title align="…" mode="…">正文</title>`。
 *
 * 进入 title 隐藏对话框，离开时恢复；正文是多行原生文本，`lines` 模式下每个**非空物理行**
 * 是一个揭示单位（点击出下一行）。句子边界取物理换行而不是标点切分：诗歌的"句"就是换行，
 * 标点在无标点的诗行上完全失效，且作者才最清楚一行到哪儿断。
 *
 * 缺省 `lines`：单行标题在 `lines` 下退化成一个揭示单位、与 `block` 等价，所以缺省 `lines`
 * 对标题场景零损失，却让诗歌不必显式声明；要"整段砸下来"才写 `mode="block"`。
 */
export const TITLE_ALIGNS = ["top-left", "top-right", "bottom-left", "bottom-right", "center"] as const;
export type TitleAlign = (typeof TITLE_ALIGNS)[number];

export const TITLE_MODES = ["block", "lines"] as const;
export type TitleMode = (typeof TITLE_MODES)[number];

export const DEFAULT_TITLE_ALIGN: TitleAlign = "center";
export const DEFAULT_TITLE_MODE: TitleMode = "lines";

export function isTitleAlign(value: unknown): value is TitleAlign {
  return typeof value === "string" && (TITLE_ALIGNS as readonly string[]).includes(value);
}

export function isTitleMode(value: unknown): value is TitleMode {
  return typeof value === "string" && (TITLE_MODES as readonly string[]).includes(value);
}
