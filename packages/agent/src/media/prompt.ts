/**
 * 立绘后缀与垫图锚点：引擎替调用方追加的那一段提示词（两个宿主共用一份）。
 *
 * 分三路：
 * - **立绘**：定妆照与差分走同一个出口 `spriteSuffix`，差别只在「身份」那一段；
 * - **背景 / CG**：垫了图就点明「第几张是谁」——图本身没有名字，模型只看到「第一张、第二张」。
 *   不点明，多人 CG 就会各画各的，而且是**看起来完全正常**地画错：不报错、图也好看，
 *   只是七濑长成了澪。
 */
import { DEFAULT_SPRITE_FRAMING, SPRITE_FRAMING_SHOT, type SpriteFraming } from "@aivn/core";

/** 立绘色键底的两种选色（顺序即工具 schema 的 enum）。 */
export const KEY_BACKGROUND_COLORS = ["green", "magenta"] as const;
export type KeyBackgroundColor = (typeof KEY_BACKGROUND_COLORS)[number];
/** 不给 `keyColor` 时的底色：纯绿。它对深色描边、暖色皮肤、深发色都是最远的色距。 */
export const DEFAULT_KEY_COLOR: KeyBackgroundColor = "green";

export function isKeyBackgroundColor(value: unknown): value is KeyBackgroundColor {
  return (KEY_BACKGROUND_COLORS as readonly unknown[]).includes(value);
}

/**
 * 画风句。定妆照与差分共用同一份——两边各写一句时，两句话只要有一处措辞不同，
 * 出来就是两张画风不同的画，而「同一个人」正是靠这套词锁的。
 */
const STYLE =
  "Japanese anime style 2D illustration, flat cel shading with clean crisp lineart, " +
  "NOT a 3D render, no 3D CGI look";

/**
 * 抠底底色：**单一纯色，且这个颜色不出现在角色身上**。
 *
 * 抠底是纯色键：离底色够近的像素一律算背景，不分内外、不看连通性。所以底色一旦和角色撞色，
 * 角色身上那块就跟着被抠穿——「纯白底 + 白袜子」就是撞色的极端，算法救不了，是出图这一步的责任。
 *
 * **颜色是拼进来的，不是让模型挑的**：不留「除非角色是绿色系就换一个」这种要模型自己判断的
 * 分支——模型会把绿瞳、绿配饰也算成绿色系，底色变得不可预期。换了哪个抠底端不需要知道：
 * 它从整圈边框量出实际底色（`cutout.ts` 还会体检底色是不是真色键色，白底 / 灰底直接报错）。
 *
 * **这一句是底线，定妆照与差分都走它。** 别在别的分支里另写一句「跟参考图同色」——
 * 差分曾经就是这么写的，而差分的垫图是**已经抠过底的透明 PNG**（没有颜色），模型把透明还原成
 * 白底，色键于是把角色身上一切接近白的像素（白袜、白制服、银发）判成背景，整张立绘被打成镂空。
 * 约束被复制就会只改一份，只改一份就是线上事故。
 */
const KEY_BACKGROUND_WORD: Record<KeyBackgroundColor, string> = {
  green: "pure green #00FF00",
  magenta: "pure magenta #FF00FF",
};

function keyBackground(color: KeyBackgroundColor | undefined): string {
  return (
    "Background is one single flat solid colour used as a chroma key, chosen to appear nowhere on the " +
    `character themselves; use ${KEY_BACKGROUND_WORD[color ?? DEFAULT_KEY_COLOR]}`
  );
}

/**
 * 不许渐变、投影、纹理、装饰：色键只认一种颜色，任何过渡都是抠不干净的白边。
 * 与画风句、底色句一样只此一份——拆开写实测只对得上其中几个词。
 */
const NO_ARTIFACTS = "No gradient, no shadow, no texture, no decoration, no text";

/**
 * 留白约束：人形专属。舞台按统一头顶留白摆位。
 *
 * **姿势不在这里规定。** 早先这一段写死正面站桩，而定妆照是所有差分的垫图基准，姿势就此终身固定。
 * 站姿还是坐姿、什么机位属于角色气质，由调用方写，引擎不覆盖。
 *
 * 留在这里的是抠底真要的那条：手臂与躯干之间**不能留窄缝**——色键够不着那条窄缝，
 * 人会被拆成两块轮廓（要么贴住，要么彻底分开、让底色能灌进去）。
 */
const POSE_TAIL =
  "arms either resting against the body or clearly separated from it, never with a narrow sliver of " +
  "background trapped between an arm and the torso" +
  // 人物矮的那一头空间本来就该空得多，不点明的话模型会把所有角色都顶到画幅上沿。
  ". Shorter characters may leave more empty space above the head, and taller characters may leave less, " +
  "so every character keeps some space above the head rather than touching the top edge of the frame";

/**
 * 主体非人（`square`）时的留白约束：只说「完整入画 + 四周留白」。
 * 抠底靠的是「主体四周有一圈底色」，这与人形无关；姿态与「头顶留白」都去掉——猫没有双臂。
 */
const PROP_TAIL =
  "the entire subject fully inside the frame with clear empty background space all around it, " +
  "nothing cropped by the frame edges";

/**
 * 定妆照的前置中性描述：压住角色卡里的表情词（那一条只对当前差分有效），插在调用方的 prompt 之前。
 *
 * **只说表情与气质，不说姿势**：姿势归调用方，这里写死站姿会把调用方写的姿势压掉。
 * **按取景取词，不是一句通吃**：给非人主体（`square`）说 portrait 会得到「猫的肖像照」——
 * portrait 是人形概念，套到猫/道具身上语义不通，模型要么给你一只坐着的人形猫，要么干脆画个人。
 */
export const NEUTRAL_LEAD: Record<SpriteFraming, string> = {
  full: "a calm neutral-expression portrait of the character, in a natural pose that expresses their personality.",
  half:
    "a calm neutral-expression portrait of the character, in a natural pose that expresses their personality, waist up.",
  square: "the subject shown whole, in a neutral state.",
};

/**
 * 差分：只改**表情/状态**，身份特征一律锁死——垫图之外的第二道保险。
 *
 * 「facial expression」也是人形词：猫的差分（睡着的/炸毛的）说「只改面部表情」会让模型
 * 认真去找那张猫脸。所以非人那套说的是「只改状态」。
 */
const HUMAN_IDENTITY =
  "Same character as the reference image: identical hairstyle, hair color, eye color, outfit and body type. " +
  "Change only the facial expression.";
const PROP_IDENTITY =
  "The same subject as the reference image, in the same pose and same colours. Change only its state.";

/**
 * 立绘提示词的**唯一出口**：定妆照与差分拼的是同一个片段序列，差别只在「身份」那一段。
 *
 * 这么写是为了让「底色 / 画风 / 不留杂物」这几条**不可能只在一条分支上生效**——它们曾经分居两处，
 * 绿幕改造只改了其中一条，差分就此带着白底出图、被色键打成镂空。
 *
 * 顺序有讲究：景别与构图在前，身份在后，底色与画风压轴。垫图会带自己的背景与景别，
 * 约束放在它后面才盖得住。
 */
export function spriteSuffix(
  framing: SpriteFraming | undefined,
  neutral: boolean,
  sentReferences: number,
  keyColor: KeyBackgroundColor | undefined,
): string {
  const f = framing ?? DEFAULT_SPRITE_FRAMING;
  // square 是「非人主体」的唯一入口，所以它同时决定了后缀走哪一套。
  // 人与非人的差别只有一处：姿势与头顶留白（人形专属），其余构图与画风约束两边通用。
  const human = f !== "square";
  const parts = [
    // 差分也要点明景别：垫图（neutral 定妆照）是全身时，模型很容易照着垫图把一条
    // 半身差分也画成全身。不点明的代价是图出来了取景对不上，舞台按半身摆却是张全身像。
    neutral ? SPRITE_FRAMING_SHOT[f] : human ? HUMAN_IDENTITY : PROP_IDENTITY,
    ...(neutral ? [] : [SPRITE_FRAMING_SHOT[f]]),
    human ? POSE_TAIL : PROP_TAIL,
    STYLE,
    keyBackground(keyColor),
    NO_ARTIFACTS,
  ];
  // 定妆照垫图时补一句「这就是参考图里那个人」，压在最后：参考图带背景与景别，压后才盖得住。
  if (neutral && sentReferences > 0) parts.push(neutralReferenceTail(f));
  // 标点由这一处说了算：片段自带的尾句点一律削掉再拼，否则 `expression.` 撞上 `". "`
  // 就是 `expression..`——片段各写各的标点时实测出过 30/57 条带双句点的提示词。
  return `${parts.map((p) => p.trim().replace(/\.+$/, "")).join(". ")}.`;
}

/**
 * 定妆照的参考图尾注：拼在构图后缀**之后**，点明这一张要长得像参考图里的那个人。
 *
 * 与差分的 `HUMAN_IDENTITY` / `PROP_IDENTITY` 分工不同——差分垫的是自家 neutral，说的是「只改表情」；
 * 这里垫的是外部图（用户给的既有角色图、原画），要的是「把那个人的样子搬到这张定妆照上」。
 */
function neutralReferenceTail(framing: SpriteFraming): string {
  if (framing === "square") {
    return "Based on the attached reference image: the same subject with identical colors, markings and features";
  }
  return (
    "Based on the attached reference image: the same character — identical face, hairstyle, hair color, " +
    "eye color and outfit — redrawn in the pose and framing described above"
  );
}

/**
 * 参考立绘在提示词里的**序号锚点**：编号从 1 起、顺序与 references 数组严格一致。
 *
 * 非可省：后端把垫图按 `references` 的顺序一个个塞进去，图片本身没有名字，模型只看到
 * 「第一张、第二张……」。不点明谁是谁，多人 CG 就会各画各的。
 */
export function referenceSuffix(names: readonly string[]): string {
  const roster = names.map((name, i) => `${i + 1}) ${name}`).join(", ");
  return (
    `The attached reference images are, in this exact order: ${roster}. ` +
    "Keep each of them recognisably that same person — identical face, hairstyle, hair color, " +
    "eye color and outfit — while placing them in the new scene. Do not merge them into one person."
  );
}

/** 有路径 / 网址这类没有名字的垫图时用它：能报名字的报名字，剩下的叫「reference image」。 */
export function genericReferenceSuffix(names: readonly (string | null | undefined)[]): string {
  const named = names.filter((name) => !!name);
  if (named.length > 0) {
    const roster = names.map((name, i) => `${i + 1}) ${name ? name : "reference image"}`).join(", ");
    return (
      `The attached reference images are, in this exact order: ${roster}. ` +
      "Maintain consistent visual appearance, character identity, hairstyle, facial features, and design elements " +
      "as depicted in the corresponding reference images while adapting them to the scene."
    );
  }
  return (
    "Follow the attached reference image(s) for visual appearance, design details, " +
    "color palette and overall aesthetic while rendering the described scene."
  );
}
