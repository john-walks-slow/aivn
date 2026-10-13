import type { AgentTool } from "@earendil-works/pi-agent-core";
import { type Static, Type } from "@earendil-works/pi-ai";
import { imageCutout, imageCutoutFields, pick, tighten, type InferArgs } from "@aivn/agent";
import type { PlayAssets } from "../playAssets.js";
import { toPi } from "./schema.js";
import { linesResult, reason, textResult } from "./result.js";

/**
 * `cut`：抠底（只给工坊）。两种用法合成同一个动词，寻址方式说了算：
 *
 * - **原地重抠已入库的立绘**：`source` 给 `assets/sprites/<主体id>/<差分名>.png`、不给 `output`——
 *   拿抠底前留的原片本地重跑，覆盖 `assets/` 里那张透明 PNG。画面一个像素不变、不烧配额、几秒出结果；
 *   「图本身挺好、就是抠得脏」只有这条路能救（重新出图出来的是另一张画）。
 * - **抠一张具体的图**：`source` 给草稿或原图路径、`output` 给写到哪（`assets/` 下的路径）。
 *
 * 参数真相源、引用语法与症状对照表在 `@aivn/agent` 的 `image.cutout`（与插件的 `cut` 同一份）；
 * 这里只加服务端这一面的范围收紧（pi 运行时硬校验，DSH 的 schema 子集不认）。
 */
const FACE = tighten(
  pick(imageCutoutFields, ["source", "output", "tolerance", "keySmooth", "edgeBand", "spill", "solidResidual"]),
  {
    source: { minLength: 1, maxLength: 2000 },
    output: { maxLength: 2000 },
    tolerance: { minimum: 0, maximum: 128 },
    keySmooth: { minimum: 0, maximum: 8 },
    edgeBand: { minimum: 1, maximum: 32 },
    spill: { minimum: 0, maximum: 255 },
    solidResidual: { minimum: 0, maximum: 255 },
  },
);

const cutParams = toPi(FACE);

type CutArgs = InferArgs<typeof imageCutoutFields>;

export interface CutDeps {
  playAssets?: PlayAssets;
  onAsset: (
    path: string,
    url: string,
    kind: "background" | "cg" | "sprite",
    replaced: boolean,
    toolCallId: string,
  ) => void;
}

export function createCutTool(deps: CutDeps): AgentTool<typeof cutParams> {
  return {
    name: "cut",
    label: "抠底",
    description: imageCutout.doc,
    parameters: cutParams,
    execute: async (toolCallId, params: Static<typeof cutParams>) => {
      if (!deps.playAssets) return textResult("生图未启用（STAGE_IMAGE_ENABLED=false 或后端缺凭据）。");
      // 回执要的那点宿主知识（URL / 是不是覆盖了旧的）顺手带出来，能力只认路径与体检。
      let receipt: { kind: "background" | "cg" | "sprite"; url: string; replaced: boolean } | null = null;
      try {
        const result = await imageCutout.execute(params as CutArgs, {
          cut: async (request) => {
            const asset = await deps.playAssets!.cut(request);
            receipt = { kind: asset.kind, url: asset.url, replaced: asset.replaced };
            const info = asset.cutout ?? { coverage: 0, figureTop: 0, figureHeight: 0 };
            return { path: asset.path, absPath: asset.absPath, ...info };
          },
        });
        const meta = receipt as { kind: "background" | "cg" | "sprite"; url: string; replaced: boolean } | null;
        if (meta) deps.onAsset(result.path, meta.url, meta.kind, meta.replaced, toolCallId);
        const lines = [
          `已抠底：\`${result.path}\`${meta?.replaced ? "（覆盖了同名旧图）" : ""}`,
          meta ? `![抠好的图](${meta.url})` : "",
          `前景占比 ${(result.coverage * 100).toFixed(1)}%，主体高 ${result.figureHeight}px。`,
        ];
        if (result.coverage < 0.03) {
          lines.push("前景占比过低，可能整张被判成了底色——源图底色是不是与主体撞色了？换一个纯色底重出。");
        }
        return linesResult(lines);
      } catch (error) {
        return textResult(`抠底失败：${reason(error)}`);
      }
    },
  };
}
