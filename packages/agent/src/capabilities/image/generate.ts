import { COMMON_SPRITE_VARIANTS } from "@aivn/core";

import type { FieldMap } from "../../schema/ir.js";
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
  kind: {
    type: "string",
    enum: ["background", "cg", "sprite"],
    required: true,
    description: "要落成什么剧目素材：背景 background / 事件插图 cg / 立绘 sprite。",
  },
  name: {
    type: "string",
    description: "背景与插图的素材 id（剧本里 `<scene bg=\"…\">` / `<cg id=\"…\">` 引用的就是它）。kind=background/cg 时必填。",
  },
  spriteId: {
    type: "string",
    description:
      "立绘的主体 id：`assets/sprites/<spriteId>/` 的目录名，也是 `<actor id>` / `<say id>` 引用的名字。" +
      "有角色卡时读卡上人设写外观；卡上写了 `sprite:` 时立绘在那个目录里（A 区角色表标着「立绘（目录 …）」），别拿角色 id 去撞。" +
      "**没有角色卡也能出**（机甲、道具、猫、只出现一轮的路人都这样）。kind=sprite 时必填。",
  },
  variant: {
    type: "string",
    description:
      `立绘差分名（${COMMON_SPRITE_VARIANTS.join(" / ")}，也可以自己按状态取名）。不给按 neutral。` +
      "**要几个差分就分几次调用**，每张写自己的 prompt（一批共用一个 prompt 只会出成同一张图）。" +
      "非人主体同样用这个槽位，名字按状态取，如机甲的 damaged、猫的 sleepy。",
  },
  references: {
    type: "array",
    items: { type: "string", description: "主体 id、剧目内相对路径，或 http(s) 网址" },
    description:
      "垫图（最多 6 张，顺序即提示词里「第一张、第二张」）：给主体 id 会自动用它的 neutral 立绘；" +
      "给剧目内相对路径（如 assets/backgrounds/ref.png）或 http(s) 网址直接当参考图。" +
      "**非 neutral 的立绘不用给**——身份基准恒为该主体的 neutral。",
  },
  referenceCharacters: {
    type: "array",
    items: { type: "string" },
    description: "兼容别名：等同 references 中传入主体 id 列表。",
  },
  framing: {
    oneOf: [
      { type: "string", const: "full", description: "全身：主体到脚。人物立绘的常规选择" },
      { type: "string", const: "half", description: "半身：到腰。对话时人物更大更清楚" },
      { type: "string", const: "square", description: "方形：正方画幅、主体完整入画。给猫、道具这类非人主体" },
    ],
    description: "立绘取景（只对 kind=sprite 生效）：决定画幅与舞台站位，同一主体保持同一档；不给沿用素材表里的声明，再不给是全身。",
  },
  stature: {
    oneOf: [
      { type: "string", const: "small", description: "小：猫、小道具，贴地面站" },
      { type: "string", const: "normal", description: "标准：与人同高" },
      { type: "string", const: "large", description: "大：比人高一档" },
      { type: "string", const: "huge", description: "巨大：机甲、巨物，顶天立地" },
    ],
    description: "立绘体量（只对 kind=sprite 生效）：只管台上多大，与取景是两件事；不给按 normal。",
  },
  title: {
    type: "string",
    description: "立绘标题（只对 kind=sprite 生效）。**没有角色卡的主体必须给**：舞台名牌显示的就是它，不给就只剩一个 id 摆在那儿。",
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

/** 垫图规则：两个角色都拿得到 `references` 与 `referenceCharacters`，所以它属于共享的工具契约。 */
export const IMAGE_REFERENCE_RULE =
  "画面里需要依据既有形象或素材时用 **references**（或兼容易懂的 referenceCharacters）垫图（可给主体 id、剧目内相对路径或 http(s) 网址；数组顺序即提示词里的先后顺序）：" +
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
  "出一张剧目素材（背景 kind=background / CG kind=cg / 立绘 kind=sprite）的图。",
  "背景与 CG 给 name；立绘给 spriteId + variant（variant 不给按 neutral）。",
  IMAGE_PROMPT_RULES,
  IMAGE_REFERENCE_RULE,
].join("");

/** 垫图张数上限（Gemini 3 系上限 14，这里按产品口径收到 6）。 */
export const MAX_IMAGE_REFERENCES = 6;

/**
 * 合并两个参考图参数（`references` 与兼容别名 `referenceCharacters`）成一份有序列表。
 *
 * 去重与封顶都在这里做：两个字段各自合法时合并起来可能超出生图后端的入参上限。
 */
export function resolveImageRefs(args: {
  references?: readonly string[];
  referenceCharacters?: readonly string[];
}): string[] | undefined {
  const merged: string[] = [];
  for (const field of [args.references, args.referenceCharacters]) {
    if (!Array.isArray(field)) continue;
    for (const item of field) {
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
  kind: "background" | "cg" | "sprite";
  name?: string;
  spriteId?: string;
  variant?: string;
  framing?: "full" | "half" | "square";
  stature?: "small" | "normal" | "large" | "huge";
  title?: string;
  keyColor?: "green" | "magenta";
}): ImageTarget {
  const clean = (value?: string): string | undefined => (value?.trim() ? value.trim() : undefined);
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

/** 一次出图要的全部输入：落位（归一化后）+ prompt 正文 + 垫图 + 画风锚点。 */
export interface ImageGenerateRequest {
  target: ImageTarget;
  prompt: string;
  style?: string;
  references?: string[];
}

/**
 * 出图要的那一件事：**由宿主的 face 接上真正出图与落库的那条路**。
 *
 * 返回值就是给模型的那句回执（同步回「草稿已出 + 预览」、排产回「已排产」、插件回「已入库」），
 * 等待方式与落不落库都在这一格后面，共享文案不分叉。
 */
export interface ImageGenerateDeps {
  run(request: ImageGenerateRequest): Promise<string>;
}

export const imageGenerate: Capability<typeof imageGenerateFields, ImageGenerateDeps, string> = {
  id: "image.generate",
  fields: imageGenerateFields,
  doc: IMAGE_GENERATE_DOC,
  async execute(args, deps) {
    const references = resolveImageRefs(args);
    return deps.run({
      target: imageTargetOf(args),
      prompt: args.prompt,
      ...(args.style?.trim() ? { style: args.style.trim() } : {}),
      ...(references ? { references } : {}),
    });
  },
};
