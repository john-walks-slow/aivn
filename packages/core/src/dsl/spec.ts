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
 * **标签集只收「会出现在时间线上」的东西**（`260930-agent-kit` 计划 §2）：
 * 停止点与轮收束并进 `beat_done` 工具参数，生图预发射变成 `generate_image` 工具——
 * 它们是对宿主说的话，不是剧本。三者的 IR 事件（`stop` / `preload_asset`）仍在事件流里，
 * 改由工具产出，client 侧不感知这次迁移。
 *
 * 已知限制（v1 接受）：属性值含 ">" 会使标签头提前截断（解析按首个 ">" 定界，不感知引号）——
 * 受影响的主要是生图 prompt 等自由文本字段，触发时该标签整体降级丢弃（有 warning），可回喂自修正。
 */

export const DSL_TAGS = [
  "scene",
  "actor",
  "say",
  "narrate",
  "thought",
  "sfx",
  "cg",
  "comment",
] as const;
export type DslTag = (typeof DSL_TAGS)[number];

/** 自闭合指令标签（无正文）。 */
export const VOID_TAGS: ReadonlySet<string> = new Set(["scene", "actor", "sfx", "cg"]);

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
 * 已从 DSL 迁进工具的旧标签——**静默降级，不按未知标签原样输出**。
 *
 * 模型对旧形态有肌肉记忆，硬判成未知标签会把 `<stop type="choice">` 当台词原样吐到舞台上，
 * 那比丢掉糟得多。命中即丢弃并挂一条 warning：一次调用静默失效，模型下一轮自己改正。
 * 退出说明：`stop`/`option` 的载荷改由 `beat_done(options, placeholder)` 承载，
 * `preload_asset` 改由 `generate_image` 工具承载。
 */
export const LEGACY_TAGS: ReadonlySet<string> = new Set(["stop", "option", "preload_asset"]);

/**
 * 场景指令属性。
 *
 * 音频属性缺省一律表示**保持当前**——换景不换乐是常事，少写一个属性不该让
 * 音乐凭空消失；真要停乐写 `bgm="none"`。背景 bg 仍按原语义：缺省保持上一张。
 */
export interface SceneAttrs {
  bg?: string;
  /** 背景音乐 id。缺省 = 保持当前；`none` = 停止。 */
  bgm?: string;
  /** 环境音 id（雨声/风声/人声，循环播放）。语义同 bgm。 */
  ambient?: string;
  /** bgm 音量 0–1；缺省 = 保持当前（首次进曲用曲目的建议音量）。 */
  bgm_volume?: number;
  /** ambient 音量 0–1。 */
  ambient_volume?: number;
  transition?: string;
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
  /** 人物表情差分。 */
  expression?: string;
  /**
   * 非人状态差分（完好/破损/发光等）。
   *
   * 与 expression 语义同构（都是换一张图），分开只是为了给模型提示：
   * 写猫写道具时用 state，写人用 expression，模型不会把猫的状态词当成表情。
   */
  state?: string;
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
