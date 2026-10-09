import { optional, type FieldMap, type InferArgs } from "../../schema/ir.js";
import { assetTargetFields } from "../asset/target.js";
import type { Capability } from "../capability.js";

/**
 * `image.generate` —— 出一张**剧目素材**（背景 / CG / 立绘）的领域动作，两个宿主共用。
 *
 * 这张牌在服务端被两个角色用两种策略调（工坊同步出草稿、剧作家后台排产），在插件里由
 * `generate_asset` 调用（出图 + 抠底 + 入库一条龙）。三种用法共用同一份**参数真相源**、
 * 同一份**写 prompt 的硬约束**与同一套**请求归一化**；等待方式、落不落库、回执长什么样
 * 是宿主那一面的事（规约 R4：按数据传，不按宿主分支）。
 *
 * 能力只管到「把参数收成一个请求」为止：真正出图与落库的实现在包里（`media/*`），
 * 由宿主的 face 通过 `deps.run` 接上——服务端接草稿区、插件接草稿 + 入库。
 */

/** 参数真相源：服务端的两个角色与插件的 `generate_asset` 都 pick 这些格（服务端另加长度收紧）。 */
export const imageGenerateFields = {
  // 落位七格与 `asset.register` 共用一份措辞（见 `capabilities/asset/target.ts`）——同一件事
  // 在两个工具里说法不同，模型就得学两遍。
  ...assetTargetFields,
  // 差别只有一处：**出图允许不给 kind**（通用候选，不绑剧目落位）；宏 `asset.generate` 再把它收紧回必填。
  kind: optional(assetTargetFields.kind),
  references: {
    type: "array",
    items: { type: "string", description: "主体 id、剧目内相对路径，或 http(s) 网址" },
    description:
      "垫图（最多 6 张，顺序即提示词里「第一张、第二张」）：给主体 id 会自动用它的 neutral 立绘；" +
      "给剧目内相对路径（如 assets/backgrounds/ref.png）或 http(s) 网址直接当参考图。" +
      "**非 neutral 的立绘不用给**——身份基准恒为该主体的 neutral。",
  },
  keyColor: {
    oneOf: [
      { type: "string", const: "green", description: "纯绿 #00FF00，默认。除下面那种情况都用它" },
      { type: "string", const: "magenta", description: "纯品红 #FF00FF，**主体自己就是绿色系（绿发 / 绿衣 / 绿瞳）时必须给**" },
    ],
    description:
      "立绘的色键底色（只对 kind=sprite 生效）：抠底是纯色键，底色与角色配色撞上就会把角色身上那块一起抠掉。" +
      "这一项只决定定妆照（neutral）的底色，差分跟着垫图的底色走；**别在 prompt 里自己写底色**。",
  },
  aspectRatio: {
    type: "string",
    enum: ["16:9", "3:4", "1:1", "9:16", "4:3"],
    description: "画幅（**只有不给 kind 的通用候选才用它**）：默认 16:9。剧目素材的画幅跟着 kind 与 framing 走，别用它覆盖。",
  },
  style: {
    type: "string",
    description: "画风锚点（可选），如「厚涂写实电影感」「赛璐璐动画」。不给就不预设风格，按画面描述走。",
  },
  prompt: {
    type: "string",
    required: true,
    description: "英文出图提示词，只描述画面本身（不写负面词、不写画幅与抠底要求）。",
  },
} as const satisfies FieldMap;

/** 写 prompt 的硬约束，两个角色共享。 */
export const IMAGE_PROMPT_RULES = [
  "写 prompt：",
  "画面里出现一个主体时，**逐条带上角色卡的外貌**（非人主体则是形状、材质、配色）——发色、发型与长度、发饰、瞳色、脸上记号（泪痣、眼镜）、",
  "上衣、领巾或领结、裙、袜、鞋、手里拿着的东西，一条一条写进 prompt；角色卡没写的不要自己发明。",
  "只写「a girl with pink hair」这种泛化描述，等于把衣服和配件交给模型默认，出来的人不是卡上那个人",
  "（实测：人设写白百褶裙 + 黑过膝袜 + 颈上拍立得，图里出来藏青裙 + 白中短袜 + 肩上包）。",
  "非 neutral 的立绘会自动垫上该主体的 neutral 定妆照，**垫图就是身份基准**：prompt 里只写这次要改的东西",
  "（表情、姿势、角度），别重新描述长相——重写一遍会和垫图打架。垫图也**不会**把姿势锁回站桩：",
  "实测「垫图 + 明确写姿势机位」照样能出俯视坐姿、拾级而下的动态画面，只垫图不写姿势则一定是正面站桩。",
  "**姿势、机位、景别都要显式写**：只说「她站在天台上」出来是对称站立的正面像，要说清机位（平视/俯视/仰视/侧身回眸）",
  "、动作（坐/走/倚靠栏杆/回头）与景别（full body / medium shot / close-up）——不写景别，袜子、鞋这类细节直接出框。",
  "立绘的**取景用 framing 参数声明**（full 全身 / half 半身 / square 方形）：它决定画幅、构图与舞台上的站位，" +
  "同一个主体要保持同一档。人物用 full 或 half；**猫、道具这类非人主体用 square**——" +
  "「全身/半身」是人形术语，套到它们身上语义不通，正方画幅也让主体占满画布、不浪费上下空间。" +
  "不给就沿用该主体已有的声明。",
  "立绘的**体量用 stature 参数声明**（small 猫/小道具，normal 与人同高，large 高一档，huge 机甲/巨物）：" +
  "它只管台上多大，与取景是两件事——机甲是「全身取景 + 巨大」，猫是「方形取景 + 小」。不给按 normal。",
  "立绘的抠底构图与画风后缀（单一纯色底、平涂、哪里要留白）由引擎自动拼在 prompt 末尾，别在 prompt 里",
  "重复也别改写它；**底色默认纯绿，主体自己就是绿色系（绿发 / 绿衣 / 绿瞳）时用 keyColor 参数点名 " +
    "「magenta」**——撞色的后果是角色身上那片绿色被一起抠掉，不要在 prompt 里自己写底色。背景与 CG 没有这层后缀，构图要求要自己写。",
].join("");

/** 垫图规则：两个角色都拿得到 `references`，所以它属于共享的工具契约。 */
export const IMAGE_REFERENCE_RULE =
  "画面里需要依据既有形象或素材时用 **references** 垫图（可给主体 id、剧目内相对路径或 http(s) 网址；数组顺序即提示词里的先后顺序）：" +
  "出 **neutral 定妆照**时传 references，以给定参考图为基准生成主体初始立绘；" +
  "背景与 CG 里有人物时传入对应立绘或参考图，出来的脸和设定才对得上。" +
  "**非 neutral 的立绘差分不吃 references**——它的身份基准恒为该主体的 neutral 定妆照，要换基准就把 neutral 重出一遍。" +
  "垫了图也不必省略 prompt 里的外貌描述——垫图锁的是脸与核心特征，画面里的动作、姿态、相对位置仍然要 prompt 说。";

/**
 * 这张牌自己的说明（各 face 可以自己加一段头：工坊说草稿、剧作家说排产、插件说一条龙）。
 *
 * 写 prompt 的那两条硬约束与垫图规则**只在包里有**——写在各自的提示词里只会修到一侧
 *（外貌锚点那条就只加过工坊，剧作家出的第一张立绘照样不贴角色卡）。
 */
export const IMAGE_GENERATE_DOC = [
  "**不给 `kind` = 通用候选**：只出一张图给自己看（垫图、试画风），不绑剧目落位、不入库；要落成剧目素材就给 `kind`（或用一键的 `generate_asset`）。",
  "出一张剧目素材（背景 kind=background / CG kind=cg / 立绘 kind=sprite）的图。",
  "背景与 CG 给 name；立绘给 spriteId + variant（variant 不给按 neutral）。",
  IMAGE_PROMPT_RULES,
  IMAGE_REFERENCE_RULE,
].join("");

/** 垫图张数上限（Gemini 3 系上限 14，这里按产品口径收到 6）。 */
export const MAX_IMAGE_REFERENCES = 6;

/** 垫图归一化：去空、去重、封顶（超出后端的入参上限时截断）。 */
export function resolveImageRefs(args: { references?: readonly string[] }): string[] | undefined {
  const merged: string[] = [];
  if (Array.isArray(args.references)) {
    for (const item of args.references) {
      if (typeof item !== "string") continue;
      const value = item.trim();
      if (value && !merged.includes(value)) merged.push(value);
    }
  }
  return merged.length > 0 ? merged.slice(0, MAX_IMAGE_REFERENCES) : undefined;
}

/** 归一化后的落位：立绘是「主体 + 差分」，背景 / CG 是「素材 id」。 */
export interface ImageTarget {
  kind: "background" | "cg" | "sprite";
  name?: string;
  spriteId?: string;
  variant?: string;
  framing?: "full" | "half" | "square";
  stature?: "small" | "normal" | "large" | "huge";
  title?: string;
  keyColor?: "green" | "magenta";
}

/**
 * 把参数收成落位。
 *
 * 两条必填在这里挡（两个宿主原本各写了一句）：立绘要主体 id、背景与 CG 要素材 id——
 * 挡不住的后果是出图后端拿一个空名字去落文件。
 */
export function imageTargetOf(args: {
  kind?: "background" | "cg" | "sprite";
  name?: string;
  spriteId?: string;
  variant?: string;
  framing?: "full" | "half" | "square";
  stature?: "small" | "normal" | "large" | "huge";
  title?: string;
  keyColor?: "green" | "magenta";
}): ImageTarget | undefined {
  const clean = (value?: string): string | undefined => (value?.trim() ? value.trim() : undefined);
  // 不给 kind = 通用候选（一张不绑剧目的图）。produce 面允许它，宏不允许（宏的 kind 必填）。
  if (!args.kind) return undefined;
  if (args.kind === "sprite") {
    const spriteId = clean(args.spriteId);
    if (!spriteId) throw new Error("立绘必须给 spriteId（主体 id，剧本里 <actor id> 引用的那个名字）");
    return {
      kind: "sprite",
      spriteId,
      variant: clean(args.variant) ?? "neutral",
      ...(args.framing ? { framing: args.framing } : {}),
      ...(args.stature ? { stature: args.stature } : {}),
      ...(clean(args.title) ? { title: clean(args.title)! } : {}),
      ...(args.keyColor ? { keyColor: args.keyColor } : {}),
    };
  }
  const name = clean(args.name);
  if (!name) throw new Error("背景/CG 必须给 name（素材 id，剧本里的 bg/cg id 就是它）");
  return { kind: args.kind, name };
}

/** 一次出图要的全部输入：落位（归一化后；通用候选没有）+ prompt 正文 + 垫图 + 画风锚点 + 画幅。 */
export interface ImageGenerateRequest {
  target?: ImageTarget;
  prompt: string;
  style?: string;
  references?: string[];
  aspectRatio?: string;
}

/**
 * 出图这一步的产物：**一张图落在哪儿**（剧目内相对路径）。
 *
 * 只回路径、不回话术——回执怎么写是宿主的事（同步说草稿、排产说已排产、宏说已入库），
 * 而宏（`asset.generate`）需要的正是这条路径：拿到它才能接着抠底、登记。
 */
export interface ProducedImage {
  path: string;
  /** 宿主已经把它落成剧目素材了（排产直落 / 宏的最后一步）；produce 面一律 false。 */
  adopted: boolean;
}

/**
 * 出图要的那一件事：**由宿主的 face 接上真正出图与落库的那条路**。
 *
 * 返回值就是给模型的那句回执（同步回「草稿已出 + 预览」、排产回「已排产」、插件回「已入库」），
 * 等待方式与落不落库都在这一格后面，共享文案不分叉。
 */
export interface ImageGenerateDeps {
  run(request: ImageGenerateRequest): Promise<ProducedImage>;
}

/** 参数类型：由 `fields` 反推（宿主 face 的 `execute` 用它标注入参）。 */
export type ImageGenerateArgs = InferArgs<typeof imageGenerateFields>;

export const imageGenerate: Capability<typeof imageGenerateFields, ImageGenerateDeps, ProducedImage> = {
  id: "image.generate",
  fields: imageGenerateFields,
  doc: IMAGE_GENERATE_DOC,
  async execute(args, deps) {
    const references = resolveImageRefs(args);
    const target = imageTargetOf(args);
    return deps.run({
      ...(target ? { target } : {}),
      prompt: args.prompt,
      ...(args.style?.trim() ? { style: args.style.trim() } : {}),
      ...(references ? { references } : {}),
      ...(args.aspectRatio ? { aspectRatio: args.aspectRatio } : {}),
    });
  },
};
