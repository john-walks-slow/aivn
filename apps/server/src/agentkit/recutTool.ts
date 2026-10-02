import type { AgentTool } from "@earendil-works/pi-agent-core";
import { type Static, Type } from "@earendil-works/pi-ai";
import type { PlayAssets } from "../playAssets.js";
import { linesResult, reason, textResult } from "./result.js";

/**
 * `recut_sprite`：立绘原地重抠底（只给工坊）。
 *
 * 为什么单独一个工具而不是 `generate_image` 上挂抠底参数：抠底参数要在**看过成图**之后才填得出来，
 * 而出图那一刻没人看过图。让模型在出图时顺手填一档参数，它填的是默认值——调了个寂寞，
 * 还让人以为抠底是被控过的。这个工具的触发条件只有一个：用户看了图说抠得不干净。
 *
 * 它能成立的前提是出图时留了底（`PlayAssets` 的留底原片）：拿抠底前的原片本地重跑一遍抠底，
 * 覆盖 assets/ 里那张透明 PNG。画面一个像素不变、几秒出结果、不烧配额——
 * 重新出图做不到这三条，它出来的是另一张画。
 */

/** 抠底调参：0–255 的通道色差 / 像素数 / 像素宽度（见 cutout.ts）。不给就整套用默认值。 */
const cutoutTuning = Type.Object(
  {
    /** 强阈值 0–32：确定是底色的种子。调大=保守少抠。默认 1。 */
    strong: Type.Optional(Type.Integer({ minimum: 0, maximum: 32 })),
    /** 弱阈值 0–64：种子沿轮廓的漫延范围。调大=顺着轮廓多啃几像素、毛边更干净。默认 8。 */
    weak: Type.Optional(Type.Integer({ minimum: 0, maximum: 64 })),
    /** 背景洞面积下限 0–10000：小于它的封闭背景块会填回人物（护眼白）。调小=抠得更狠。默认 200。 */
    minHole: Type.Optional(Type.Integer({ minimum: 0, maximum: 10000 })),
    /** 掩膜降噪 0–8：色键跑在一张高斯模糊副本上（alpha 仍从原图解），专治 JPEG 环纹把轮廓咬出缺口。调大抗缺口、代价是边缘略毛。默认 0.8。 */
    keySmooth: Type.Optional(Type.Number({ minimum: 0, maximum: 8 })),
    /** 反解带宽 1–32：源图抗锯齿过渡带有多宽就得设多宽；不够宽会把渐变像素钉成实心，深色底上是一圈白块。默认 4。 */
    edgeBand: Type.Optional(Type.Integer({ minimum: 1, maximum: 32 })),
  },
  { additionalProperties: false },
);

const recutParams = Type.Object(
  {
    /** 立绘所属角色 id（play.json 里的角色 id）。 */
    characterId: Type.String({ minLength: 1, maxLength: 40 }),
    /** 立绘差分名，如 neutral / smile。不给按 neutral。 */
    expression: Type.Optional(Type.String({ maxLength: 40 })),
    /** 抠底调参。症状对不上默认档才填，见描述里的对应关系。 */
    cutout: Type.Optional(cutoutTuning),
  },
  { additionalProperties: false },
);

const DESCRIPTION = [
  "对已经出好的立绘**原地重抠底**：拿抠底前留的原片本地重跑一遍抠底，覆盖 assets/ 里那张透明 PNG。",
  "画面一个像素都不变（不重新出图、不烧配额、几秒出结果），只有透明边缘会变——",
  "「图本身挺好、就是抠得脏」只有这条路能救，重新出图出来的是另一张画。",
  "",
  "**用户看过成图说抠得不干净时才用**，一次只调一档，看完回执里那张图再决定要不要继续：",
  "- 头顶/两鬓有成片被挖走的缺口 → keySmooth 加到 1.0~1.2（治源图 JPEG 环纹把掩膜咬穿）；",
  "- 深色底上一圈白块/白边晕 → edgeBand 加 1~2；",
  "- 轮廓一圈白毛边削不掉 → weak 加 1~2；",
  "- 眼睛/发梢被啃掉、身上多出不该有的洞 → weak 减 1~2，还啃就 strong 减到 0。",
  "默认档（1/8/200/0.8/4）是量着真实立绘定的，对得上的症状别动它。",
  "没留底原片的（更早出的图、用户自己上传的立绘）会直接报错，那种只能重新出图——如实转告用户，别重画。",
].join("\n");

export interface RecutDeps {
  playAssets?: PlayAssets;
  onAsset: (path: string, url: string, kind: "background" | "cg" | "sprite", replaced: boolean) => void;
}

export function createRecutSpriteTool(deps: RecutDeps): AgentTool<typeof recutParams> {
  return {
    name: "recut_sprite",
    label: "重抠立绘底",
    description: DESCRIPTION,
    parameters: recutParams,
    execute: async (_toolCallId, params: Static<typeof recutParams>) => {
      if (!deps.playAssets) return textResult("生图未启用（STAGE_IMAGE_ENABLED=false 或后端缺凭据）。");
      try {
        const asset = await deps.playAssets.recut(
          {
            kind: "sprite",
            characterId: params.characterId.trim(),
            expression: params.expression?.trim() || "neutral",
          },
          params.cutout,
        );
        deps.onAsset(asset.path, asset.url, asset.kind, asset.replaced);
        return linesResult([
          `已重抠（画面没变，只改了透明边缘）：${asset.path}\n![${asset.path}](${asset.url})`,
        ]);
      } catch (error) {
        return textResult(`重抠失败：${reason(error)}`);
      }
    },
  };
}