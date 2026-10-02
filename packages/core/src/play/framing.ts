/**
 * 立绘取景：一张立绘图里人物画到哪儿。
 *
 * **必须是声明的，不能靠图算**：实测两类的图像尺寸几乎一样（宽高比 0.54~0.71、人物占画幅
 * 高 80~100%），「半身」和「全身」的差别在于头相对整幅多大——这是语义，不是像素。
 * 任何尺寸启发式都会把 720×1080 的腰上半身和 2200×3500 的全身判成同一类。
 *
 * 舞台按它套一套缩放与落位预设：人物占画幅高的百分比在三档之间接近，但「可见到哪里」
 * 差一个躯干量级，不套预设就是头大小随取景跳。
 */

/** 胸像（头肩）；半身（腰上）；全身（膝上或到脚）。 */
export const SPRITE_FRAMINGS = ["bust", "half", "full"] as const;
export type SpriteFraming = (typeof SPRITE_FRAMINGS)[number];

export function isSpriteFraming(value: unknown): value is SpriteFraming {
  return typeof value === "string" && (SPRITE_FRAMINGS as readonly string[]).includes(value);
}

/** 取景的显示名（资源库浏览、角色卡编辑器、演出层下拉共用）。 */
export const SPRITE_FRAMING_LABELS: Record<SpriteFraming, string> = {
  bust: "胸像",
  half: "半身",
  full: "全身",
};

/**
 * 取景 → 出图提示词里的景别措辞 + 立绘画幅。
 *
 * 画幅跟着取景走：胸像半身脸占画幅近一半，仍用 9:16 竖长画，人物会被拉成一张窄条。
 * 只取 Gemini 与 OpenAI 都收的取值（见 `imageBackend.ts` 的画幅白名单）。
 */
export const SPRITE_FRAMING_ASPECT: Record<SpriteFraming, string> = {
  bust: "3:4",
  half: "2:3",
  full: "9:16",
};

/** 景别措辞：进 `NEUTRAL_SUFFIX` 的第一段，替代写死的 "full body"。 */
export const SPRITE_FRAMING_SHOT: Record<SpriteFraming, string> = {
  bust: "head and shoulders bust shot, upper chest cropped by the frame",
  half: "medium shot, waist-up, cut off at the hips",
  full: "full body, head to toe, entire figure inside the frame",
};

/**
 * 缺省取景 = 全身。存量 play.json 与资源库条目都不带这个字段，
 * 行为必须与加字段之前一模一样（老剧不能因为升级就换了站位）。
 */
export const DEFAULT_SPRITE_FRAMING: SpriteFraming = "full";

export function framingOf(value: unknown): SpriteFraming | undefined {
  return isSpriteFraming(value) ? value : undefined;
}