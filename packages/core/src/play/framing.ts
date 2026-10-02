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

/**
 * 三档取景：**全身 / 半身 / 方形**。
 *
 * 没有「胸像」这一档。它曾经存在，但价值已经被 `shot` 运镜吃掉了——把已有素材推近
 * （放大 + 头顶不动、身体长出画面下沿）就是胸像，不需要重新出图。而三种「画到哪儿」
 * 取景之间只差一个躯干，模型在三者之间选错的概率远高于选对，多一档只是多一个出错点。
 *
 * `square` 不是「比半身更近」，它是**为非人 sprite 准备的**：猫、道具、悬浮物没有
 * 头肩腰之分，「全身/半身」这套人形术语套上去语义不通。正方形画幅让这类主体占满画布
 * 又不浪费左右空间——9:16 画一只猫，上下都是空。
 */
export const SPRITE_FRAMINGS = ["full", "half", "square"] as const;
export type SpriteFraming = (typeof SPRITE_FRAMINGS)[number];

export function isSpriteFraming(value: unknown): value is SpriteFraming {
  return typeof value === "string" && (SPRITE_FRAMINGS as readonly string[]).includes(value);
}

/**
 * 取景的显示名（资源库浏览、角色卡编辑器、演出层下拉共用）。
 *
 * 取景目前只在**舞台摆位**上真正生效，出图一律按全身来：
 * 半身靠镜头放大实现（后续再做），所以日常开发与验证都只跑 `full`。
 * 这三档留着不删——play.json 里已有的声明、资源库里已入库的条目都指着它，
 * 删字段等于让存量数据读不出来。
 */
export const SPRITE_FRAMING_LABELS: Record<SpriteFraming, string> = {
  full: "全身",
  half: "半身",
  square: "方形",
};

/**
 * 取景 → 出图提示词里的景别措辞 + 立绘画幅。
 *
 * 画幅跟着取景走：胸像半身脸占画幅近一半，仍用 9:16 竖长画，人物会被拉成一张窄条。
 *
 * 三个画幅必须落在**上游真正支持的取值**内。走 flow2api 时，Google Flow 只有 5 档：
 * 1:1 / 9:16 / 16:9 / 4:3 / 3:4（枚举与编号见 flow2api 的 `flow_frontend.py`）。
 * 2:3、3:2、4:5、5:4、21:9 这些 Gemini 官方取值 Flow **一个都没有**——发过去不报错，
 * 静默退回 16:9，出图直接变成一张横的。原先半身用的 2:3 就是这么废掉的，重试也没用。
 * 三档都在 Gemini 与 OpenAI 都收的白名单里，越方形越接近「主体占满画布」。
 */
export const SPRITE_FRAMING_ASPECT: Record<SpriteFraming, string> = {
  full: "9:16",
  half: "3:4",
  square: "1:1",
};

/** 景别措辞：进 `NEUTRAL_SUFFIX` 的第一段，替代写死的 "full body"。 */
export const SPRITE_FRAMING_SHOT: Record<SpriteFraming, string> = {
  full: "full body, head to toe, entire figure inside the frame",
  half: "medium shot, waist-up, cut off at the hips",
  square: "the entire subject fully inside the frame, nothing cropped, whole subject visible from head to toe",
};

/**
 * 缺省取景 = 全身。存量 play.json 与资源库条目都不带这个字段，
 * 行为必须与加字段之前一模一样（老剧不能因为升级就换了站位）。
 */
export const DEFAULT_SPRITE_FRAMING: SpriteFraming = "full";

/**
 * 已下线的取景 → 现在该读成哪一档。
 *
 * `bust`（胸像）在 261002 去掉了：它的价值已被 `shot` 运镜吃掉，留着只是多一个
 * 模型选错的出口。但**存量 play.json 与资源库条目里真可能写着它**（那批数据是在
 * 这一版之前录的），而 `framingOf` 认不出的值会被 `parseCharacter` 当非法值丢掉
 * ——一张胸像图悄悄按全身摆位画出来，脑袋位置错一整个躯干，用户看不出来发生了什么。
 *
 * 所以这里**不做静默丢弃，而是降级到语义最近的一档**：胸像比半身更近，归 `half`。
 * 摆位略有偏差（胸像按半身的高度贴底），但人物完整可见；反过来把 bust 当非法值
 * 丢掉、退回全身，错得更离谱。
 */
export const LEGACY_SPRITE_FRAMING: Record<string, SpriteFraming> = {
  bust: "half",
};

export function framingOf(value: unknown): SpriteFraming | undefined {
  if (isSpriteFraming(value)) return value;
  if (typeof value === "string") return LEGACY_SPRITE_FRAMING[value];
  return undefined;
}
