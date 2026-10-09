import type { FieldMap, InferArgs } from "../../schema/ir.js";
import type { Capability } from "../capability.js";
import { assetLocationOf, type AssetLocation } from "./target.js";
import {
  IMAGE_PROMPT_RULES,
  IMAGE_REFERENCE_RULE,
  imageGenerate,
  imageGenerateFields,
  imageTargetOf,
  type ImageGenerateDeps,
} from "../image/generate.js";
import type { AssetRegisterExtra, AssetRegistration } from "./register.js";

/**
 * `asset.generate` —— **显式宏**：`image.generate`（出图）+（立绘）`image.cutout` + `asset.register`。
 *
 * 「就想要一张能用的图」时用它；要精细控制（先出候选让用户挑、用外部图、单独重抠）就用原子三件套
 * `generate_image` / `cut` / `import_asset`。**它不藏策略**：三个步骤的参数与描述都是那三个能力的，
 * 宏只负责按顺序串起来、并把「同名素材已经有了就不重出」这条明写在文档里。
 *
 * 出图那一步的宿主实现（同步出草稿 / 后台排产）由 `produce` 这一格接；宏不关心等多久。
 */

/**
 * 参数 = 出图那一份（`kind` 重新变必填：宏的终点是素材，没有落位就无从落）+ 一句画面描述。
 *
 * 字段说明直接复用 `imageGenerateFields` 的那几句——同一个概念不在两个工具里各讲一遍。
 */
export const assetGenerateFields = {
  ...imageGenerateFields,
  kind: { ...imageGenerateFields.kind, required: true },
  description: {
    type: "string",
    description: "一句话画面描述，写进素材表；剧作家挑素材全靠它。",
  },
} as const satisfies FieldMap;

export const ASSET_GENERATE_DOC = [
  "**一键**：出图 +（立绘自动抠底）+ 登记成剧目素材，一次完成——`generate_image` +（立绘）`cut` + `import_asset` 的组合。",
  "适合「就想要一张能用的图」。要精细控制（先出候选让用户挑、用外部图 / 下载图、单独重抠、单独登记）就用那三个原子工具。",
  "**同名素材已经有了就直接返回、不重出**（重出会覆盖同名文件）；要另出一张就换个 name / spriteId+variant。",
  "背景与插图给 name，立绘给 spriteId（可给 variant / framing / stature / title）；画幅跟着 kind 与 framing 走。",
  "立绘会自动抠底成透明 PNG（画面里要有纯色键底，配方见技能）；垫图与画风锚点见下面几条。",
  IMAGE_PROMPT_RULES,
  IMAGE_REFERENCE_RULE,
].join("\n");

/** 宏的产物：出成没出、落成了什么。宿主据此组装自己的回执（它才有话术与预览 URL）。 */
export interface AssetGenerateResult {
  /** 归一化后的落位。 */
  target: AssetLocation;
  /** 剧目里已经有同名素材，这一步什么都没做。 */
  skipped: boolean;
  /** 真正落成的那份素材（`skipped` 时缺省）。 */
  registration?: AssetRegistration;
}

export interface AssetGenerateDeps {
  /** 这个落位在剧目里已有素材了吗（宏的「同名跳过」靠它）。 */
  exists(target: AssetLocation): Promise<boolean>;
  /** 出图那一步（候选）：同步出草稿还是后台排产由宿主这一格决定。 */
  produce: ImageGenerateDeps;
  /**
   * 立绘抠底那一步：把候选抠成透明 PNG，返回它的路径。
   *
   * 不给就跳过（宿主没有抠底能力时，立绘登记的是候选原图——那是宿主自己的取舍，
   * 宏不替它发明兜底）。
   */
  cut?(request: { source: string }): Promise<{ path: string }>;
  /** 登记那一步（与 `asset.register` 同一件事）。 */
  register(source: string, location: AssetLocation, extra: AssetRegisterExtra): Promise<AssetRegistration>;
}

export type AssetGenerateArgs = InferArgs<typeof assetGenerateFields>;

export const assetGenerate: Capability<typeof assetGenerateFields, AssetGenerateDeps, AssetGenerateResult> = {
  id: "asset.generate",
  fields: assetGenerateFields,
  doc: ASSET_GENERATE_DOC,
  async execute(args, deps) {
    const target = assetLocationOf(args);
    if (await deps.exists(target)) return { target, skipped: true };

    const produced = await imageGenerate.execute(args, deps.produce);
    // 立绘要透明 PNG 才叠得上舞台：候选先过一遍抠底，原片作为留底一起交给登记。
    const cut = target.kind === "sprite" && deps.cut ? await deps.cut({ source: produced.path }) : undefined;
    const registration = await deps.register(cut?.path ?? produced.path, target, {
      ...(args.description?.trim() ? { description: args.description.trim() } : {}),
      prompt: args.prompt,
      ...(cut ? { original: produced.path } : {}),
    });
    return { target, skipped: false, registration };
  },
};
