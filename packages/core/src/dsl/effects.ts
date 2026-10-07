/**
 * Stage DSL 演出效果注册表 —— `<fx>` 词表的唯一真相源。
 *
 * `<fx>` 是**舞台级全局效果**：作用于整幅画面，不点名任何主体；针对某个主体的
 * `action` / `shot` / `variant` / `anchor` 写在 `<actor>` 上（由 spec.ts / spriteAction.ts
 * 校验）。剧本只写效果词与取值，永远碰不到时长、曲线、坐标，也不用关心效果落在哪一层
 * ——每个效果的实现层（画面内容变换层 `camera` / 屏幕遮罩层 `screen`）是引擎内部的事
 * （见 director.ts 的 FxState）。详见 docs/features/261007-dsl-effects/。
 *
 * 生命周期：
 *  - `trigger` 一次性：播完即止，靠单调 seq 重播（见 director.ts）。
 *  - `state` 持续保持：写进 VisualState，用 `value="off"` 关掉。
 */

/** `<fx effect="…" value="…"/>` 的载荷（value 已由解析器按注册表归一化）。 */
export interface FxAttrs {
  effect: string;
  value?: string;
}

export type EffectLifecycle = "trigger" | "state";

export interface EffectSpec {
  name: string;
  lifecycle: EffectLifecycle;
  /** 封闭取值；不给 = 该效果不接受 value。 */
  values?: readonly string[];
  /** 缺省取值（`value` 省略或非法时回落到它）。 */
  defaultValue?: string;
}

export const EFFECTS: Readonly<Record<string, EffectSpec>> = {
  /** 一次性全屏闪光：白（雷击/闪光）、红（受击）、黑（冲击）。 */
  flash: {
    name: "flash",
    lifecycle: "trigger",
    values: ["white", "red", "black"],
    defaultValue: "white",
  },
  /** 一次性画面抖动（整幅画面，背景/立绘/CG 一起）。 */
  shake: {
    name: "shake",
    lifecycle: "trigger",
    values: ["light", "heavy"],
    defaultValue: "light",
  },
  /** 持续电影宽画幅黑边。 */
  letterbox: {
    name: "letterbox",
    lifecycle: "state",
    values: ["on", "off"],
    defaultValue: "on",
  },
  /** 持续暗角。 */
  vignette: {
    name: "vignette",
    lifecycle: "state",
    values: ["on", "off"],
    defaultValue: "on",
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
