/**
 * Stage DSL v1 —— 冻结规范（docs/features/260928-stage-ai-mvp 计划 §6）。
 *
 * 语法规则：
 *  1. 标签式：`<tag attr="...">正文</tag>` 或自闭合 `<tag attr="..."/>`。
 *  2. 指令先于台词：场景/立绘/音乐标签必须在对应台词前。
 *  3. 台词正文为原生文本（可含换行），零转义。
 *  4. 消息边界自动闭合：包裹类标签未闭合时收尾保留已流出台词。
 *  5. 每条 assistant 消息独立解析；工具调用轮次对播放透明。
 *  6. stop 即闸门：解析到闭合 <stop> 后丢弃其后本节拍的一切事件。
 *
 * 已知限制（v1 接受）：属性值含 ">" 会使标签头提前截断（解析按首个 ">" 定界，不感知引号）——
 * 受影响的主要是生图 prompt 等自由文本字段，触发时该标签整体降级丢弃（有 warning），可回喂自修正。
 */

export const DSL_TAGS = ["scene", "actor", "say", "narrate", "thought", "sfx", "preload_asset", "cg", "stop"] as const;
export type DslTag = (typeof DSL_TAGS)[number];

/** 自闭合指令标签（无正文）。 */
export const VOID_TAGS: ReadonlySet<string> = new Set(["scene", "actor", "sfx", "preload_asset", "cg"]);

/**
 * stop 的交互类型（v1.1 冻结）。
 * 只有两种玩家主权点：选肢（choice）/ 自由表态（free）。
 * 旧版的第三种 pause（幕间「什么都不做就继续」）已删除——幕末走 beat_end 无 stop，
 * 客户端呈现为黑场 + 「下一幕」按钮，不再占用停止点类型位。
 */
export const STOP_TYPES = ["choice", "free"] as const;
export type StopType = (typeof STOP_TYPES)[number];

/** stop 内唯一的子标签。 */
export const OPTION_TAG = "option";

export interface SceneAttrs {
  bg?: string;
  bgm?: string;
  ambient?: string;
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

export interface PreloadAssetAttrs {
  type: "bg" | "cg" | "sprite";
  prompt: string;
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
