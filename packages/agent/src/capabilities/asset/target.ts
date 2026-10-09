import { COMMON_SPRITE_VARIANTS, type SpriteFraming, type SpriteStature } from "@aivn/core";
import type { FieldMap } from "../../schema/ir.js";
import type { AssetKind } from "../../media/catalog.js";

/**
 * 素材**落位**的参数面与归一化——「要落成什么」（背景 / 插图 / 立绘、id、差分、取景、体量、标题）。
 *
 * 出图（`image.generate`）与登记（`asset.register`）都要用户交代同一件事，两边各写一遍的话，
 * 「落位」这个概念的措辞迟早会漂（同一格在两个工具里说法不同，模型就得学两遍）。
 * 这里一份，两个能力各自 `pick` 出自己要露的那几格。
 */
export const assetTargetFields = {
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
} as const satisfies FieldMap;

/** 归一化之后的落位：只留真正给了的字段（空串丢掉），不认识的 kind 当场拒绝。 */
export interface AssetLocation {
  kind: AssetKind;
  name?: string;
  spriteId?: string;
  variant?: string;
  framing?: SpriteFraming;
  stature?: SpriteStature;
  title?: string;
}

/** 归一化的输入：两个能力的参数都结构上满足它（多给的字段不看）。 */
export interface AssetLocationArgs {
  kind?: string;
  name?: string;
  spriteId?: string;
  variant?: string;
  framing?: string;
  stature?: string;
  title?: string;
}

function clean(value: string | undefined): string | undefined {
  const text = value?.trim();
  return text ? text : undefined;
}

/**
 * 参数 → 落位。**必填项与缺省在这里一次说完**——立绘要 spriteId、背景与插图要 name、
 * 差分不给按 `neutral`（字段说明就是这么承诺的），免得两个宿主各写一遍校验、还各给一句措辞不同的话。
 */
export function assetLocationOf(args: AssetLocationArgs): AssetLocation {
  const { kind } = args;
  if (kind !== "background" && kind !== "cg" && kind !== "sprite") {
    throw new Error("落位要 kind：background / cg / sprite");
  }
  const name = clean(args.name);
  const spriteId = clean(args.spriteId);
  if (kind === "sprite" && !spriteId) {
    throw new Error("立绘要 spriteId（主体 id，剧本里 `<actor id>` 引用的那个名字）");
  }
  if (kind !== "sprite" && !name) {
    throw new Error(`${kind === "background" ? "背景" : "插图"}要 name（素材 id，剧本里引用的那个名字）`);
  }
  const variant = clean(args.variant);
  return {
    kind,
    ...(name ? { name } : {}),
    ...(spriteId ? { spriteId } : {}),
    ...(kind === "sprite" ? { variant: variant ?? "neutral" } : variant ? { variant } : {}),
    ...(args.framing ? { framing: args.framing as SpriteFraming } : {}),
    ...(args.stature ? { stature: args.stature as SpriteStature } : {}),
    ...(clean(args.title) ? { title: clean(args.title)! } : {}),
  };
}
