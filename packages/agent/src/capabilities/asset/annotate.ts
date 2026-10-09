import type { InferArgs } from "../../schema/ir.js";
import type { FieldMap } from "../../schema/ir.js";
import type { Capability } from "../capability.js";
import { assetMetaFields, assetMetaPatchOf, type AssetMetaPatch } from "./meta.js";

/**
 * `asset.annotate` —— 给**已经入库**的素材补 / 改元数据（标题、描述、标签、情绪、场景、循环、音量）。
 *
 * 为什么单独一个面：元数据不属于生成动作。尤其是 BGM——它没有「登记」这一步（生成即入库），
 * 所以生成工具一旦不承载元数据，就必须有**事后标注**这一条路，否则素材表里只有一条来源标记，
 * 剧作家没法按 mood / scene 选曲。
 *
 * 图片类素材的元数据也可以在登记时一次给全（`asset.register` / `asset.generate` 的
 * `title` / `description` / `tags`）；这个面负责事后改，以及 BGM 那种没有登记步的情形。
 * 只改给出的那几格，其余原样保留。
 */

/** 要标注**哪一份**素材：立绘用 `spriteId`（+ 可选 `variant`），其余用 `name`。 */
export const assetSubjectFields = {
  kind: {
    type: "string",
    enum: ["background", "cg", "sprite", "bgm"],
    required: true,
    description: "标注哪一类素材：背景 background / 事件插图 cg / 立绘 sprite / 配乐 bgm。",
  },
  name: {
    type: "string",
    description: "背景、插图、配乐用：素材 id（剧本里 `<scene bg=\"…\">` / `<cg id=\"…\">` / `<scene bgm=\"…\">` 引用的那个）。kind=background/cg/bgm 时必填。",
  },
  spriteId: {
    type: "string",
    description: "立绘的主体 id（`assets/sprites/<spriteId>/` 的目录名）。kind=sprite 时必填。",
  },
  variant: {
    type: "string",
    description: "立绘差分名。不给 = 只标 neutral 那一层；差分自己那份说明要单独标。",
  },
} as const satisfies FieldMap;

/** 参数真相源：主体三格 + 元数据七格（与登记 / 宏共用一份措辞）。 */
export const assetAnnotateFields = {
  ...assetSubjectFields,
  ...assetMetaFields,
} as const satisfies FieldMap;

export type AssetAnnotateArgs = InferArgs<typeof assetAnnotateFields>;

export const ASSET_ANNOTATE_DOC = [
  "给已经入库的素材补 / 改元数据：标题、描述、标签、情绪（mood）、适用场景（scene）、是否循环、建议音量。",
  "**只改给出的那几格**，其余原样保留。",
  "`description` 是剧作家挑素材的依据、`mood` / `scene` 是它选曲的依据——**出完 BGM 顺手标一遍**（BGM 没有别的元数据出口），改图/改曲的定位也靠它。",
  "mood / scene 要照素材库里既有的词表填（别自造词），词表见技能库的音频那篇。",
].join("\n");

/** 归一化之后的主体：`kind` + 定位到那一份素材的键。 */
export interface AssetSubject {
  kind: "background" | "cg" | "sprite" | "bgm";
  name?: string;
  spriteId?: string;
  variant?: string;
}

/** 参数 → 主体。**必填项与缺省在这里一次说完**（与 `assetLocationOf` 同一口径）。 */
export function assetSubjectOf(args: {
  kind?: string;
  name?: string;
  spriteId?: string;
  variant?: string;
}): AssetSubject {
  const clean = (value: string | undefined): string | undefined => {
    const text = value?.trim();
    return text ? text : undefined;
  };
  const { kind } = args;
  if (kind !== "background" && kind !== "cg" && kind !== "sprite" && kind !== "bgm") {
    throw new Error("标注要 kind：background / cg / sprite / bgm");
  }
  const name = clean(args.name);
  const spriteId = clean(args.spriteId);
  if (kind === "sprite" && !spriteId) throw new Error("标注立绘要 spriteId（`assets/sprites/<spriteId>/` 的目录名）");
  if (kind !== "sprite" && !name) throw new Error(`标注${kind === "bgm" ? "配乐" : kind === "cg" ? "插图" : "背景"}要 name（素材 id）`);
  const variant = clean(args.variant);
  return {
    kind,
    ...(name ? { name } : {}),
    ...(spriteId ? { spriteId } : {}),
    ...(variant ? { variant } : {}),
  };
}

/** 宿主那侧的写口：把补丁并进素材表（读-改-写与加锁是宿主的事）。 */
export interface AssetAnnotateDeps {
  /** 返回剧目内相对路径用于回执；素材不存在时抛错（别悄悄写一条指向空气的记录）。 */
  annotate(subject: AssetSubject, patch: AssetMetaPatch): Promise<{ path: string }>;
}

export const assetAnnotate: Capability<typeof assetAnnotateFields, AssetAnnotateDeps, string> = {
  id: "asset.annotate",
  fields: assetAnnotateFields,
  doc: ASSET_ANNOTATE_DOC,
  async execute(args, deps) {
    const subject = assetSubjectOf(args);
    const patch = assetMetaPatchOf(args);
    if (Object.keys(patch).length === 0) {
      return "没给要标的内容：至少给 title / description / tags / mood / scene / loop / volume 里的一项。";
    }
    try {
      const { path } = await deps.annotate(subject, patch);
      return `已标注 \`${path}\`：${Object.keys(patch).join("、")}。`;
    } catch (error) {
      return `没能标注：${error instanceof Error ? error.message : String(error)}`;
    }
  },
};
