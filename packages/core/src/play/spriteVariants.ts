/**
 * 立绘差分名：常用词表 + 「常用 ∪ 这个主体已有的差分」。
 *
 * 差分名就是文件名主体（`assets/sprites/<id>/<variant>.png`），没有映射表可查，
 * 所以词表的作用只是**给人和模型一个照抄用的起点**，不构成白名单——合法字符仍由
 * `assertAssetStem` 单独判。
 *
 * 三处共用同一份：素材页的 chips、`generate_image` 描述里给模型的推荐词、以及
 * 生成对话框里标注「已有」。写成一份的理由与别处一样——同一份词表写三遍必然漂移。
 */

/** 常用差分名（人的表情/状态，机甲的受损这类非人状态同样落在这个槽位）。 */
export const COMMON_SPRITE_VARIANTS = [
  "neutral",
  "smile",
  "laugh",
  "angry",
  "sad",
  "cry",
  "surprised",
  "shy",
  "serious",
  "worried",
  "thinking",
  "sleepy",
  "pain",
  "damaged",
] as const;

export interface SpriteVariantChoice {
  name: string;
  /** 这个主体目录里已经有这条差分了（点了就是覆盖重出）。 */
  existing: boolean;
}

/**
 * 对话框里的候选差分名：**已有的排前面**（改一张比新造一张常见），其余按常用词表序补上；
 * 两边都按名去重。词表外的自定义名不进这里——用户自己敲，敲过的由 `existing` 那条路回来。
 */
export function spriteVariantChoices(existing: readonly string[]): SpriteVariantChoice[] {
  const seen = new Set<string>();
  const choices: SpriteVariantChoice[] = [];
  for (const raw of existing) {
    const name = raw.trim();
    if (!name || seen.has(name)) continue;
    seen.add(name);
    choices.push({ name, existing: true });
  }
  for (const name of COMMON_SPRITE_VARIANTS) {
    if (seen.has(name)) continue;
    seen.add(name);
    choices.push({ name, existing: false });
  }
  return choices;
}
