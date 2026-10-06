/**
 * Stage DSL 演出效果注册表 —— 动效 / 转场的唯一真相源。
 *
 * 一个演出效果 = 目标（谁）+ 生命周期（一次性 / 持续保持）+ 固定配方。剧本只写效果词，
 * 永远碰不到时长、曲线、坐标（见 docs/features/261007-dsl-effects/）。
 *
 * 本文件只登记**舞台级**效果（走 `<fx>`）；绑定到某个角色的效果（`action` / `shot` / `variant` /
 * `anchor`）写在 `<actor>` 上，由 spec.ts / spriteAction.ts 校验，不进这里的 `<fx>` 目标集
 * ——`<fx>` 不点名具体角色，绕开「一个目标到底指谁」的歧义。
 *
 * 生命周期：
 *  - `trigger` 一次性：播完即止，靠单调 seq 重播（见 director.ts）。
 *  - `state` 持续保持：写进 VisualState，直到被改写或 `<fx target="…" release/>` 清空。
 */

/**
 * `<fx>` 的两个目标，语义不同：
 *  - `camera` —— **画面内容的变换层**：效果让画面本身动（背景/立绘/CG 一起），例如抖动。
 *  - `screen` —— **屏幕遮罩层**：效果是叠加在画面之上的层（闪光、黑边、暗角），画面内容不动。
 * 每个效果只挂一个自然目标，不提供「同效果挂多个目标」。
 */
export const EFFECT_TARGETS = ["camera", "screen"] as const;
export type EffectTarget = (typeof EFFECT_TARGETS)[number];
export const FX_TARGETS = EFFECT_TARGETS;
export type FxTarget = EffectTarget;

export function isEffectTarget(value: unknown): value is EffectTarget {
  return typeof value === "string" && (EFFECT_TARGETS as readonly string[]).includes(value);
}

export const isFxTarget = isEffectTarget;

/**
 * `<fx target="…" effect="…" value="…"/>` 的载荷（value 已由解析器按注册表归一化）。
 * `release` 缺省表示「停掉该 target 上的全部持续效果」——它**不是**一个 effect，
 * 所以 release 时没有 effect/value。
 */
export interface FxAttrs {
  target: FxTarget;
  effect?: string;
  value?: string;
  release?: boolean;
}

export type EffectLifecycle = "trigger" | "state";

export interface EffectSpec {
  name: string;
  lifecycle: EffectLifecycle;
  /** 合法目标集；`<fx>` 只认其中的 FxTarget，越界即丢弃（不猜）。 */
  targets: readonly EffectTarget[];
  /** 封闭取值；不给 = 该效果不接受 value。 */
  values?: readonly string[];
  /** 缺省取值（`value` 省略或非法时回落到它）。 */
  defaultValue?: string;
  /** 需要旧画面快照：目前只有转场（另见 TRANSITIONS）。 */
  dual?: boolean;
  /** 写进剧作家提示词的中文说法。 */
  label: string;
}

export const EFFECTS: Readonly<Record<string, EffectSpec>> = {
  /** 一次性全屏闪光：白（雷击/闪光）、红（受击）、黑（冲击）。 */
  flash: {
    name: "flash",
    lifecycle: "trigger",
    targets: ["screen"],
    values: ["white", "red", "black"],
    defaultValue: "white",
    label: "闪光（白/红/黑）",
  },
  /** 一次性画面抖动（整幅画面，背景/立绘/CG 一起）。 */
  shake: {
    name: "shake",
    lifecycle: "trigger",
    targets: ["camera"],
    values: ["light", "heavy"],
    defaultValue: "light",
    label: "画面抖动",
  },
  /** 持续电影宽画幅黑边。 */
  letterbox: {
    name: "letterbox",
    lifecycle: "state",
    targets: ["screen"],
    values: ["on", "off"],
    defaultValue: "on",
    label: "电影宽画幅（上下黑边）",
  },
  /** 持续暗角。 */
  vignette: {
    name: "vignette",
    lifecycle: "state",
    targets: ["screen"],
    values: ["on", "off"],
    defaultValue: "on",
    label: "暗角",
  },
};

export function effectSpec(name: string): EffectSpec | null {
  return EFFECTS[name] ?? null;
}

export function isEffectName(value: unknown): boolean {
  return typeof value === "string" && EFFECTS[value] !== undefined;
}

export function effectAppliesTo(name: string, target: EffectTarget): boolean {
  return EFFECTS[name]?.targets.includes(target) === true;
}

/**
 * 转场：换层时旧画面如何变成新画面。**dual** —— 需要旧画面快照，
 * 所以它是 effect 里唯一需要两层 DOM 的一类（见调研 §4.1）。
 * `fade` 与 `fade-black` 同义（经过黑场），保留两种写法照顾直觉。
 */
export const TRANSITIONS = [
  "cut",
  "dissolve",
  "fade",
  "fade-black",
  "fade-white",
] as const;
export type Transition = (typeof TRANSITIONS)[number];

export function isTransition(value: unknown): value is Transition {
  return typeof value === "string" && (TRANSITIONS as readonly string[]).includes(value);
}

/** 未写 transition 时的缺省：经过黑场的淡入淡出（gal 惯例）。 */
export const DEFAULT_TRANSITION: Transition = "fade";

/** 转场经过的纯色（cut/dissolve 无）；渲染层据此给 veil 上色。 */
export function transitionVeilColor(name: Transition): string | null {
  if (name === "fade" || name === "fade-black") return "#000";
  if (name === "fade-white") return "#fff";
  return null;
}
