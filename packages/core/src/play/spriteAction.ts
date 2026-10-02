/**
 * 立绘行为词：剧本写「她有点动摇」，不写动画参数。
 *
 * **为什么不给自由参数**：Ren'Py 的教训是同一个对象多个属性同时变化时行为未定义、
 * 引擎不检查只声明（见引擎调研 §1.8）。反过来 `shake="0.3"` 这种自由数字会让模型
 * 去猜，猜出来的全是坏的。所以这里只给**行为词 → 固定配方**，一个词对应一段
 * 已经调好的关键帧序列，剧本永远碰不到毫秒、曲线和 z-index。
 *
 * 配方用 CSS 自定义属性 `--act-*` 传给 `@keyframes`，各词只填自己用到的那几个：
 * 上下位移 `--act-dy`、左右位移 `--act-dx`、水平压扁 `--act-sx`、旋转 `--act-rot`。
 * 没填的键不是 0 就不该动——所以每个配方都显式写全四个键，缺一个就等于那条通道不动。
 *
 * 演一次就走：`action` 是**一次性**事件，不是常驻状态（常驻的是呼吸与说话者高亮，
 * 见 StageTheater）。同一时刻只放一个行为词，两个叠着演会互相打架（未定义）。
 */

/** 行为词全集。加词只改这里 + app.css 里对应的 @keyframes。 */
export const ACTOR_ACTIONS = [
  /** 极轻地左右动摇——「她有点动摇」。 */
  "nudge",
  /** 整个人一歪再回落——被吓到、踉跄。 */
  "stagger",
  /** 上弹回落——兴奋、雀跃。 */
  "jump",
  /** 点头——同意、认账。 */
  "nod",
  /** 上身前倾——鞠躬、道歉。 */
  "bow",
  /** 横向压扁再展开——背过身去（2D 立绘没有真背面，业界通用做法）。 */
  "turn",
  /** 高频小幅抖动——发抖、生气。 */
  "shake",
  /** 缓慢左右摇摆——放松、犯困、被抱着晃。 */
  "sway",
] as const;
export type ActorAction = (typeof ACTOR_ACTIONS)[number];

export function isActorAction(value: unknown): value is ActorAction {
  return typeof value === "string" && (ACTOR_ACTIONS as readonly string[]).includes(value);
}

/** 行为词的中文说法，写进剧作家的提示词里。 */
export const ACTION_LABELS: Record<ActorAction, string> = {
  nudge: "极轻地动摇",
  stagger: "被吓到、踉跄一歪",
  jump: "兴奋地弹一下",
  nod: "点头",
  bow: "鞠躬、上身前倾",
  turn: "转过身去（背对镜头）",
  shake: "发抖、生气地抖",
  sway: "放松地缓慢摇摆",
};

/**
 * 行为词 → CSS 动画名。认不出来返回 null（什么都不演）而不是回落到某个词。
 *
 * 与站位同理：演错一个动作只是不演，不会让人消失，所以宁可什么都不做。
 */
export function actionAnimation(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const key = value.trim().toLowerCase();
  return isActorAction(key) ? `sprite-act-${key}` : null;
}
