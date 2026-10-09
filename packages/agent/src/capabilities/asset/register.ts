import type { FieldMap, InferArgs } from "../../schema/ir.js";
import type { Capability } from "../capability.js";
import { assetMetaFields, assetMetaPatchOf, type AssetMetaPatch } from "./meta.js";
import { assetLocationOf, assetTargetFields, type AssetLocation } from "./target.js";
import type { AssetKind } from "../../media/catalog.js";

/**
 * `asset.register` —— 把一张图**登记**成剧目素材（写 `assets/`、补素材表、记台账），**不抠底**。
 *
 * 它是「出图」与「入库」之间的那道缝：出图工具只产候选，登记只认**显式给的落位**——
 * 于是任何来源的图（候选、别的工具产出的、下载的）都走同一条入库路，
 * 宿主也不必再为「草稿采用」单独发明一个动词。
 *
 * 立绘应当已经是**抠好的透明 PNG**：想自动抠底，先走 `image.cutout` 再登记那张。
 * `original` 给抠底前原片，宿主会留底，日后可以原地重抠。
 */

/** 参数真相源：落位七格来自 `assetTargetFields`（与出图共用一份措辞），另加来源与三样登记注记。 */
export const assetRegisterFields = {
  source: {
    type: "string",
    required: true,
    description: "图片来源：剧目内相对路径，或 http(s) 网址（出的候选、别的工具产出的图、下载的图都行）。",
  },
  ...assetTargetFields,
  // 落成那一步能一次给的元数据（余下的 mood / scene / loop / volume 是音乐属性，走 annotate）
  title: assetMetaFields.title,
  description: assetMetaFields.description,
  tags: assetMetaFields.tags,
  prompt: {
    type: "string",
    description: "台账里留档的「当初用什么描述出的」（可省）。",
  },
  original: {
    type: "string",
    description: "立绘抠底**前**的原片路径：给了就留底，日后可以原地重抠。",
  },
} as const satisfies FieldMap;

/** 参数类型：由 `fields` 反推（宿主 face 的 `execute` 用它标注入参）。 */
export type AssetRegisterArgs = InferArgs<typeof assetRegisterFields>;

export const ASSET_REGISTER_DOC = [
  "把一张图**登记**成剧目素材：写 `assets/`、补素材表（呈现声明 + 描述）、记台账。**不抠底**。",
  "`source`：剧目内相对路径 / http(s) 网址——可以是出图给的候选、别的工具产出的图、或下载的图。",
  "落位**始终显式给**：`kind`（background / cg / sprite）必填；背景与插图给 `name`，立绘给 `spriteId`（可再给 `variant` / `framing` / `stature` / `title`）。",
  "**立绘要已抠好的透明 PNG**：外部来源想自动抠底，先抠底、再登记那张透明 PNG。",
  "`original`（可选）：立绘抠底**前**的原片路径，给了就留底，日后可以原地重抠。",
  "**登记前先把预览摆给用户看过、用户点头了才调**——它一进来就是剧目素材了，会覆盖同名的旧图。",
  "`description` 写一句话画面（剧作家挑素材全靠它）；`prompt` 记进台账（可省）。",
].join("\n");

/** 登记的结果：宿主拿它组装各自的回执（预览路径 / URL 是宿主自己的事）。 */
export interface AssetRegistration {
  kind: AssetKind;
  /** 剧目内相对路径（`assets/backgrounds/rooftop.jpg`）。 */
  path: string;
  /** 这个落位此前已有素材（可能是用户自己放的），本次是覆盖。 */
  replaced: boolean;
  /** 立绘抠底前原片在留底库里的剧目内相对路径；没给 `original` 则缺省。 */
  sourcePath?: string;
}

export interface AssetRegisterExtra extends AssetMetaPatch {
  prompt?: string;
  original?: string;
}

/** 宿主那侧的 IO：读来源（本地路径要走自己的权限边界、网址要走 SSRF 防护）、落盘、记账。 */
export interface AssetRegisterDeps {
  register(source: string, location: AssetLocation, extra: AssetRegisterExtra): Promise<AssetRegistration>;
}

export const assetRegister: Capability<typeof assetRegisterFields, AssetRegisterDeps, AssetRegistration> = {
  id: "asset.register",
  fields: assetRegisterFields,
  doc: ASSET_REGISTER_DOC,
  async execute(args, deps) {
    const source = args.source.trim();
    if (!source) throw new Error("登记素材要 source（剧目内相对路径 / http(s) 网址）");
    return deps.register(source, assetLocationOf(args), {
      ...assetMetaPatchOf(args),
      ...(args.prompt?.trim() ? { prompt: args.prompt.trim() } : {}),
      ...(args.original?.trim() ? { original: args.original.trim() } : {}),
    });
  },
};
