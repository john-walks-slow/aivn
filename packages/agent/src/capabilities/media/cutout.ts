import type { FieldMap } from "../../schema/ir.js";
import type { CutoutTuning } from "../../media/cutout.js";
import { ASSET_REF_HINT, parseAssetRef, type AssetRefParts } from "../../media/asset-ref.js";
import type { Capability } from "../capability.js";

/**
 * `image.cutout` —— 把一张**纯色底**图变成透明 PNG（两个宿主共用）。
 *
 * 纯图像处理，**只写输出、不改源图**，也不登记素材。服务端在出图与入库的流水线里用它
 *（立绘自动抠），插件还有一个独立工具 `cut` 让用户对着同一张源图反复调参。
 *
 * 五个调参旋钮的**说明**与**症状对应关系**原先两边各写一份（服务端写在 `recut_sprite` 的
 * 嵌套对象里、插件写在 `cut` 的平铺参数里），现在只有这里一份：字段是字段、指南是指南，
 * 面各取所需（服务端嵌在 `cutout` 下、插件平铺）。
 */

/** 五个调参旋钮：范围（0–128 / 0–8 …）是宿主专有的收紧，写在各自的 face 上。 */
export const cutoutTuningFields = {
  tolerance: {
    type: "number",
    description: "色键容差 0–128（默认 48）：离底色不超过它的像素一律算背景。**调大 = 抠得更狠**，也会连发丝一起啃掉。",
  },
  keySmooth: {
    type: "number",
    description:
      "色键降噪 0–8（默认 0.8）：色键跑在一张高斯模糊副本上（alpha 仍从原图解），专治 JPEG 环纹把轮廓啃出缺口。" +
      "调大抗缺口、代价是边缘略毛。",
  },
  edgeBand: {
    type: "number",
    description:
      "反解带宽 1–32（默认 4）：源图抗锯齿过渡带有多宽就得设多宽；不够宽会把渐变像素钉成实心，深色底上是一圈白块。",
  },
  spill: {
    type: "number",
    description: "限色强度 0–255（默认 20）：压掉边缘残存的底色，**发丝一根不少**——边上还有底色残留先调它。",
  },
  solidResidual: {
    type: "number",
    description:
      "实心判据 0–255（默认 48）：胶着带里的像素离「底色 ↔ 邻近前景色」这条线超过它就算实心。**调小 = 更多像素判成实心**；0 = 关掉这条。",
  },
} as const satisfies FieldMap;

/**
 * 抠底调参指南：症状 → 旋钮。两个面共用（服务端的重抠工具与插件的 `cut`）。
 *
 * 放在这里而不是各自的工具描述里：同一批症状两边各写一遍，改一处忘一处，
 * 用户对着两份不同的调参建议试。
 */
export const CUTOUT_TUNING_GUIDE = [
  "调参是 0–255 的通道色差，不是比例；一次只调一两个，五个一起动就看不出是哪个起了作用。默认档（48 / 0.8 / 4 / 20 / 48）是量着真实立绘定的，症状对不上就别动它：",
  "- 人物内部、腿间或腋下该透出背景的地方还糊着一块底色 → `tolerance` 加 4~8（纯色键，调大就是大胆抠）；",
  "- 角色身上被啃掉一块（那块颜色本就与底色接近）→ `tolerance` 减 4~8；底色选错了调参救不了，只能重新出图；",
  "- 头顶 / 两鬓有成片被挖走的缺口 → `keySmooth` 加到 1.0~1.2（治源图 JPEG 环纹把掩膜咬穿）；",
  "- 深色底上一圈白块 / 白边晕 → `edgeBand` 加 1~2；",
  "- 边缘一圈绿（或品红）毛边 → `spill` 加 10~20；",
  "- 描边被压成硬边、边缘发毛（手绘感强的图容易这样）→ `solidResidual` 减到 24~32（0 = 关掉这条）；",
  "- 只在底色残留明显时才加 `tolerance`：它会连发丝一起啃掉。",
].join("\n");

/**
 * 抠底要的那点输入：源图、输出位置（不给就落候选区）、一次性调参。
 *
 * 源图给两种寻址之一：`source`（剧目内相对路径）或 `target`（**素材引用**解出来的身份，
 * 宿主据此去找那张图——留底原片、已入库素材都归它管）。**两者只会有一个**：引用的解析在能力里做完，
 * 宿主不必再认语法。
 */
export interface CutoutRequest {
  source?: string;
  target?: AssetRefParts;
  output?: string;
  tuning?: Partial<CutoutTuning>;
}

export interface CutoutResult {
  /** 剧目内相对路径。 */
  path: string;
  absPath: string;
  coverage: number;
  /** 人物头顶到画布上沿的像素数（归一化后恒为固定 padding）。 */
  figureTop: number;
  figureHeight: number;
}

/**
 * 出图之外的另一件事：**宿主接上自己的写盘与路径解析**（源图必须在剧目内、输出要原子写）。
 *
 * 纯色键算法在 `media/cutout.ts`；这一格接的是「读到那张图、把结果写到哪儿」。
 */
export interface ImageCutoutDeps {
  cut(request: CutoutRequest): Promise<CutoutResult>;
}

/** 参数真相源：`source` 必填，其余可选；五个旋钮平铺（面可以按自己的形状重排）。 */
export const imageCutoutFields = {
  source: {
    type: "string",
    required: true,
    description: `要抠的源图（剧目内相对路径）。纯色底，且底色不与主体撞色。${ASSET_REF_HINT}`,
  },
  output: {
    type: "string",
    description:
      "透明 PNG 写到哪里（剧目内相对路径）。不给就用宿主的默认落点：源是已入库立绘（`assets/sprites/<主体id>/<差分名>.png`）时写回**素材那张**" +
      "（= 原地重抠），源是草稿或其它路径时落候选区——候选区不可读的宿主会要求你显式给 output，回执会说清写到哪。",
  },
  ...cutoutTuningFields,
} as const satisfies FieldMap;

export const IMAGE_CUTOUT_DOC = [
  "抠底：把一张**纯色底**的图（通常是要当立绘的主体）转成透明 PNG，回执给输出路径与抠底体检。",
  "源图给剧目内相对路径（草稿路径，或已入库立绘 `assets/sprites/<主体id>/<差分名>.png`——后者会优先用抠底前留的原片，那是最干净的一次抠底）。",
  "**只写输出、不改源图**；也不登记素材（登记另走一步）。源图要留着：抠脏了就对着同一张再调参跑一次。",
  "**原地重抠已入库的立绘**：`source` 给 `assets/sprites/<主体id>/<差分名>.png`、不给 `output`——宿主拿它的抠底前原片重跑，画面一个像素不变，只改透明边缘。",
  "**源图的底色必须是饱和的色键色**（纯绿 #00FF00 / 纯品红 #FF00FF）：整圈边框量出的底色若通道极差 <96（白底、浅灰底、照片底这类），当场报错——白底当色键会把浅色处抠穿、把画面压灰，不是调参能救的。",
].join("\n");

/** 从参数里挑出真正给了的旋钮（没给的不覆盖默认值）。 */
export function tuningOf(args: {
  tolerance?: number;
  keySmooth?: number;
  edgeBand?: number;
  spill?: number;
  solidResidual?: number;
}): Partial<CutoutTuning> {
  const keys = ["tolerance", "keySmooth", "edgeBand", "spill", "solidResidual"] as const;
  const tuning: Partial<Record<(typeof keys)[number], number>> = {};
  for (const key of keys) {
    const value = args[key];
    if (typeof value === "number") tuning[key] = value;
  }
  return tuning;
}

export const imageCutout: Capability<typeof imageCutoutFields, ImageCutoutDeps, CutoutResult> = {
  id: "image.cutout",
  fields: imageCutoutFields,
  doc: IMAGE_CUTOUT_DOC,
  async execute(args, deps) {
    const source = args.source.trim();
    if (source === "") throw new Error("抠底要 source（一张纯色底图的路径，或素材引用）");
    const tuning = tuningOf(args);
    // 引用与路径在这里分岔一次：命中引用就只把身份交给宿主，宿主不必再认字符串语法。
    const target = parseAssetRef(source);
    return deps.cut({
      ...(target ? { target } : { source }),
      ...(args.output?.trim() ? { output: args.output.trim() } : {}),
      ...(Object.keys(tuning).length > 0 ? { tuning } : {}),
    });
  },
};
