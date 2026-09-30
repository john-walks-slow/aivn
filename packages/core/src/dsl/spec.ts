/**
 * Stage DSL v1 —— 冻结规范（docs/features/260928-stage-ai-mvp 计划 §6）。
 *
 * 语法规则：
 *  1. 标签式：`<tag attr="...">正文</tag>` 或自闭合 `<tag attr="..."/>`。
 *  2. 指令先于台词：场景/立绘/音乐标签必须在对应台词前。
 *  3. 台词正文为原生文本（可含换行），零转义。
 *  4. 消息边界自动闭合：包裹类标签未闭合时收尾保留已流出台词。
 *  5. 每条 assistant 消息独立解析；工具调用轮次对播放透明。
 *  6. stop 即闸门：解析到闭合 <stop> 后丢弃其后本轮的一切事件。
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
  "preload_asset",
  "cg",
  "stop",
  "comment",
] as const;
export type DslTag = (typeof DSL_TAGS)[number];

/** 自闭合指令标签（无正文）。 */
export const VOID_TAGS: ReadonlySet<string> = new Set(["scene", "actor", "sfx", "preload_asset", "cg"]);

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
 * stop 的交互类型（v1.1 冻结）——这是**模型能写的**白名单。
 * 只有两种玩家主权点：选肢（choice）/ 自由表态（free）。
 * 旧版的第三种 pause（「什么都不做就继续」）已从 DSL 删除：模型爱用它收尾，
 * 收出来的是「一切圆满落幕…」这类旁白加一个不知何时出现的「继续」按钮。
 * 没有 stop 的收尾走 beat_end 的 no_stop 分支，客户端呈现为一个普通的「继续」。
 * 编排器自己造的 pause 重试入口不在这个白名单里（见 ws/protocol.ts 的 StopPayload）。
 */
export const STOP_TYPES = ["choice", "free"] as const;
export type StopType = (typeof STOP_TYPES)[number];

/** stop 内唯一的子标签。 */
export const OPTION_TAG = "option";

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

export interface ActorAttrs {
  id: string;
  pos?: string;
  expression?: string;
  action?: string;
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

export interface PreloadAssetAttrs {
  type: "bg" | "cg" | "sprite";
  prompt: string;
  /**
   * 资产 id。
   * - bg/cg：直接是素材 id。
   * - sprite：`<charId>` 或 `<charId>:<expression>`；省略 expression 时默认 `neutral`。
   */
  id: string;
}

export interface CgAttrs {
  id: string;
  caption?: string;
}

export interface StopAttrs {
  type: StopType;
  placeholder?: string;
}

export interface OptionAttrs {
  text: string;
  value?: string;
}
