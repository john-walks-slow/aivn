import type { StreamFn } from "@earendil-works/pi-agent-core";
import type { Api, Model } from "@earendil-works/pi-ai";
import { completeText } from "./llm.js";

export const MIN_IMAGE_PROMPT_WORDS = 15;

/** CG / 插图系统提示词：舞台与工坊共用。 */
export const CG_PROMPT_SYSTEM = [
  "你是视觉小说的插图提示词写手：把场景、主体与要求写成一句英文出图提示词，供 AI 出图模型使用。",
  "- 只输出提示词本身：英文、逗号分隔的画面要素；不加引号、不加解释、不写负面词",
  "- 画面重点明确：谁在场、什么动作与表情、什么场景、什么光线与气氛",
  "- 如果有【参考图】，必须按「the 1st character / the 2nd character」或名称准确体现对应主体的发型、瞳色、服装与姿势",
  "- 不要出现任何文字、字幕、对话框、分镜格、漫画式的描述",
  "- 有【要求/指令】时以它为准，其余要素都为它服务",
  "- 长度控制在 60 词上下，句首大写",
].join("\n");

/** 背景系统提示词。 */
export const BG_PROMPT_SYSTEM = [
  "你是视觉小说的场景背景提示词写手：把场景描述与要求写成一句英文出图提示词，供 AI 出图模型使用。",
  "- 只输出提示词本身：英文、逗号分隔的画面要素；不加引号、不加解释、不写负面词",
  "- 专注于场景环境：地点、时间、天气、光线、建筑或自然细节与整体氛围",
  "- 画面中不要出现任何主要人物（empty background / scenery only），不要有文字、字幕",
  "- 有【要求/指令】时以它为准",
  "- 长度控制在 50 词上下，句首大写",
].join("\n");

/** 立绘系统提示词：写主体本尊的外观、服装与当前差分（人的表情、机甲的受损状态同一条路）。 */
export const SPRITE_PROMPT_SYSTEM = [
  "你是视觉小说的立绘提示词写手：根据主体设定、目标差分与要求，写成一句针对该主体立绘的英文出图提示词。",
  "- 只输出提示词本身：英文、逗号分隔的要素；不加引号、不加解释、不写负面词",
  "- 专注于该主体的外观特征（发型、发色、眼睛、服装、体态，非人主体则是形状、材质、颜色）以及这次指定的差分",
  "- 不要写背景（抠底用的纯色底与构图后缀由引擎自动追加），只描述人物本身；只有主体配色与默认绿底撞色时，才在 prompt 末尾点名换一个纯色底（品红/纯蓝）",
  "- 有【要求/指令】时以它为准",
  "- 长度控制在 40-60 词上下，句首大写",
].join("\n");

export interface ImagePromptDeps {
  streamFn: StreamFn;
  model: Model<Api>;
  getApiKey: () => string | undefined;
}

export interface ImagePromptContext {
  instruction?: string;
  craft?: string;
  /** 舞台模式下最近剧情与当前场景 */
  lines?: readonly string[];
  scene?: string;
  useHistory?: boolean;
  /**
   * 参考主体（背景/CG 垫图用）：{ id, name, body }
   * 顺序即垫图的编号顺序（1st, 2nd, ...）。角色卡是可选的——机甲、道具只有立绘，
   * 那时 name 取立绘声明的 title，body 为空。
   */
  referenceSprites?: { id: string; name: string; body?: string }[];
  /** 剧目里所有主体（无特定参考图时提供世界观上下文） */
  allSprites?: { id: string; name: string; body?: string }[];
  /** 立绘专有：目标主体的设定与本次差分 */
  targetSprite?: { id: string; name: string; body?: string };
  variant?: string;
}

export type ImagePromptKind = "cg" | "background" | "sprite";

export async function composeImagePrompt(
  deps: ImagePromptDeps,
  kind: ImagePromptKind,
  ctx: ImagePromptContext,
): Promise<string> {
  const system =
    kind === "sprite"
      ? SPRITE_PROMPT_SYSTEM
      : kind === "background"
        ? BG_PROMPT_SYSTEM
        : CG_PROMPT_SYSTEM;

  const sections: string[] = [];

  if (kind === "sprite") {
    if (ctx.targetSprite) {
      sections.push(
        `【目标主体】\n- ${ctx.targetSprite.name}（id: ${ctx.targetSprite.id}）${
          ctx.targetSprite.body ? `：\n${ctx.targetSprite.body}` : ""
        }`,
      );
    }
    if (ctx.variant) {
      sections.push(`【本次差分/状态】${ctx.variant}`);
    }
  } else {
    // CG 或 背景
    if (ctx.useHistory !== false) {
      if (ctx.scene) sections.push(`【当前场景】${ctx.scene}`);
      if (ctx.lines && ctx.lines.length > 0) {
        sections.push(`【刚才演到的（最新在最后）】\n${ctx.lines.join("\n")}`);
      } else if (ctx.lines !== undefined) {
        sections.push("【刚才演到的】（还没有台词）");
      }
    }

    if (ctx.referenceSprites && ctx.referenceSprites.length > 0) {
      const refList = ctx.referenceSprites
        .map(
          (c, idx) =>
            `- [参考图 ${idx + 1}] ${c.name}（id: ${c.id}）${
              c.body ? `：${c.body.slice(0, 160)}` : ""
            }`,
        )
        .join("\n");
      sections.push(`【参考主体（编号即垫图顺序）】\n${refList}`);
    } else if (ctx.allSprites && ctx.allSprites.length > 0) {
      const charList = ctx.allSprites
        .map(
          (c) =>
            `- ${c.name}（id: ${c.id}）${c.body ? `：${c.body.slice(0, 120)}` : ""}`,
        )
        .join("\n");
      sections.push(`【剧目主体】\n${charList}`);
    }
  }

  if (ctx.craft) {
    sections.push(`【创作口径/画风设定】\n${ctx.craft.slice(0, 800)}`);
  }

  const wanted = ctx.instruction?.trim();
  if (wanted) {
    sections.push(`【要求/指令】${wanted}`);
  }

  const user = sections.filter(Boolean).join("\n\n");
  const text = await completeText(deps, system, user);
  const prompt = text
    .trim()
    .replace(/^```[a-z]*\n?/i, "")
    .replace(/\n?```$/, "")
    .trim();

  if (!prompt) {
    throw new Error("写不出出图提示词（模型没有返回内容）");
  }
  return prompt;
}
