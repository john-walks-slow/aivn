import type { AssetMeta } from "@aivn/core";
import type { FieldMap } from "../../schema/ir.js";

/**
 * 素材**元数据**的参数面与归一化——素材表 `assets/manifest.json` 里那份（标题、描述、标签、
 * 情绪、适用场景、是否循环、建议音量）。
 *
 * 元数据不属于「出图 / 出曲」这个动作：`generate_bgm` 曾经带着八格元数据，插件那边却没有出口
 * （同一件事在一侧是赘肉、在另一侧是缺口）。现在元数据只有两个承载体——**落成那一步**
 *（`asset.register` / `asset.generate` 的 `title` / `description` / `tags`）与**事后标注**
 *（`asset.annotate`，也是 BGM 唯一的元数据出口）。生成工具只认「要什么」，不认「怎么描述」。
 */
export const assetMetaFields = {
  title: {
    type: "string",
    description: "标题（素材页与选曲时显示的名字）；立绘就是舞台名牌上那个名字（**没有角色卡的主体必须给**）。不给沿用原标题 / 用 id。",
  },
  description: {
    type: "string",
    description: "一句话：画面画了什么 / 这首曲子垫在哪一段、什么情绪。剧作家挑素材、选曲全靠它。",
  },
  tags: {
    type: "array",
    items: { type: "string", description: "一个标签，原样写" },
    description: "若干标签（如 anime / piano / ambient）。",
  },
  mood: {
    type: "array",
    items: { type: "string", description: "一个情绪词，照素材库里既有的词表填" },
    description: "情绪词（温柔 / 忧伤 / 日常…）：剧作家选曲的主要依据，**照既有词表填，别自造**。",
  },
  scene: {
    type: "array",
    items: { type: "string", description: "一个场景词，照素材库里既有的词表填" },
    description: "适用场景（告白 / 别离 / 回忆 / 日常 / 校园…）：同样照既有词表填。",
  },
  loop: {
    type: "boolean",
    description: "是否适合循环播放。galgame 的 BGM 绝大多数要一直垫在对话下面，默认按 true 走。",
  },
  volume: {
    type: "number",
    description: "建议默认音量（0–1）。素材库既有条目落在 0.35–0.45，不给按 0.4。",
  },
} as const satisfies FieldMap;

/** 归一化后的元数据补丁：空串与空数组不留（下游据此判断「这格没给」）。 */
export type AssetMetaPatch = Pick<AssetMeta, "title" | "description" | "tags" | "mood" | "scene" | "loop" | "volume">;

/** 归一化的输入：只要结构上给了这些格就行（多给的字段不看）。 */
export interface AssetMetaPatchArgs {
  title?: string;
  description?: string;
  tags?: readonly string[];
  mood?: readonly string[];
  scene?: readonly string[];
  loop?: boolean;
  volume?: number;
}

/** 参数 → 补丁：只留真正给了的字段。 */
export function assetMetaPatchOf(args: AssetMetaPatchArgs): AssetMetaPatch {
  const clean = (value: string | undefined): string | undefined => {
    const text = value?.trim();
    return text ? text : undefined;
  };
  const list = (values?: readonly string[]): string[] | undefined => {
    const cleaned = values?.map((value) => value.trim()).filter(Boolean);
    return cleaned && cleaned.length > 0 ? cleaned : undefined;
  };
  const title = clean(args.title);
  const description = clean(args.description);
  const tags = list(args.tags);
  const mood = list(args.mood);
  const scene = list(args.scene);
  return {
    ...(title ? { title } : {}),
    ...(description ? { description } : {}),
    ...(tags ? { tags } : {}),
    ...(mood ? { mood } : {}),
    ...(scene ? { scene } : {}),
    ...(args.loop !== undefined ? { loop: args.loop } : {}),
    ...(args.volume !== undefined ? { volume: args.volume } : {}),
  };
}
