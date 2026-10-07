/**
 * Stage DSL 演出效果注册表 —— `<fx>` 词表的唯一真相源。
 *
 * `<fx>` 是**舞台级全局效果**：作用于整幅画面，不点名任何主体；针对某个主体的
 * `action` / `shot` / `variant` / `anchor` 写在 `<actor>` 上（由 spec.ts / spriteAction.ts
 * 校验）。
 *
 * 每条 `<fx>` 形如 `<fx effect="…" VERB [value="…"]/>`，动词三选一：
 *  - `trigger` —— 演一次即止，靠单调 seq 重播（见 director.ts）。
 *  - `on` / `off` —— 持续效果的开关（开了就保留，直到 off）。
 * 每个效果声明自己支持哪些动词：flash / shake 三种都支持，letterbox / vignette 只有开关。
 * `value` 只表达「口味」（flash 的颜色、shake 的轻重），不承担开关语义。
 *
 * 效果落在哪一层（画面内容变换层 `camera` / 屏幕遮罩层 `screen`）是引擎内部的事
 * （见 director.ts 的 FxState）。详见 docs/features/261007-dsl-effects/。
 */

export const FX_VERBS = ["trigger", "on", "off"] as const;
export type FxVerb = (typeof FX_VERBS)[number];

export function isFxVerb(value: unknown): value is FxVerb {
  return typeof value === "string" && (FX_VERBS as readonly string[]).includes(value);
}

/** `<fx effect="…" trigger|on|off value="…"/>` 的载荷（value 已由解析器按注册表归一化）。 */
export interface FxAttrs {
  effect: string;
  verb: FxVerb;
  value?: string;
}

export interface EffectSpec {
  name: string;
  /** 该效果支持的动词；不在其中的动词会被解析器丢弃。 */
  verbs: readonly FxVerb[];
  /** 封闭取值（口味）；不给 = 该效果不接受 value。 */
  values?: readonly string[];
  /** 缺省取值（`value` 省略或非法时回落到它）。 */
  defaultValue?: string;
}

export const EFFECTS: Readonly<Record<string, EffectSpec>> = {
  /** 全屏色闪：trigger 闪一次 / on 常亮一块色 / off 撤掉。口味=颜色。 */
  flash: {
    name: "flash",
    verbs: ["trigger", "on", "off"],
    values: ["white", "red", "black"],
    defaultValue: "white",
  },
  /** 画面抖动：trigger 抖一下 / on 持续抖（地震、轰鸣）/ off 停。口味=轻重。 */
  shake: {
    name: "shake",
    verbs: ["trigger", "on", "off"],
    values: ["light", "heavy"],
    defaultValue: "light",
  },
  /** 持续电影宽画幅黑边：on / off。 */
  letterbox: {
    name: "letterbox",
    verbs: ["on", "off"],
  },
  /** 持续暗角：on / off。 */
  vignette: {
    name: "vignette",
    verbs: ["on", "off"],
  },
};

export function effectSpec(name: string): EffectSpec | null {
  return EFFECTS[name] ?? null;
}

/**
 * 转场：换层时旧画面如何变成新画面。需要旧画面快照，是唯一需要两层 DOM 的一类
 * （见调研 §4.1）；不走 `<fx>`，只作 `<scene transition>`。
 */
export const TRANSITIONS = ["cut", "dissolve", "fade", "fade-white"] as const;
export type Transition = (typeof TRANSITIONS)[number];

export function isTransition(value: unknown): value is Transition {
  return typeof value === "string" && (TRANSITIONS as readonly string[]).includes(value);
}

/** 未写 transition 时的缺省：经过黑场的淡入淡出（gal 惯例）。 */
export const DEFAULT_TRANSITION: Transition = "fade";

/** 转场经过的纯色（cut/dissolve 无）；渲染层据此给 veil 上色。 */
export function transitionVeilColor(name: Transition): string | null {
  if (name === "fade") return "#000";
  if (name === "fade-white") return "#fff";
  return null;
}
