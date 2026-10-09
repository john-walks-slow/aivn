import type { AgentTool } from "@earendil-works/pi-agent-core";
import { type Static, Type } from "@earendil-works/pi-ai";
import {
  imageGenerate,
  imageGenerateFields,
  pick,
  resolveImageRefs,
  tighten,
  type ImageGenerateArgs,
} from "@aivn/agent";
import type { PlayAssets } from "../playAssets.js";
import { toPi } from "./schema.js";
import { linesResult, reason, textResult } from "./result.js";

/**
 * `generate_image`：**只产候选**（P5-c）——出图落草稿区，**不抠底、不入库**。
 *
 * 服务端过去这一个 id 扛两种语义（工坊出草稿、剧作家后台排产直落）。现在两种角色共用同一个含义：
 * 「给我一张图看看」。要一步落成素材走 `generate_asset`；立绘要透明就先 `cut` 再 `import_asset`。
 *
 * 参数真相源、写 prompt 的硬约束与垫图规则在 `@aivn/agent` 的 `image.generate`；
 * 这里只声明服务端的 face（pi 的长度收紧）与回执。
 */
const FACE = tighten(
  pick(imageGenerateFields, [
    "kind",
    "name",
    "spriteId",
    "variant",
    "references",
    "framing",
    "stature",
    "title",
    "keyColor",
    "style",
    "prompt",
  ]),
  {
    name: { maxLength: 40 },
    spriteId: { maxLength: 40 },
    variant: { maxLength: 40 },
    references: { minItems: 1, maxItems: 6 },
    title: { maxLength: 40 },
    style: { maxLength: 200 },
    prompt: { minLength: 1, maxLength: 4000 },
  },
);

const generateImageParams = toPi(FACE);

const HOST_NOTE = [
  "",
  "**候选不是素材**：这张图落在草稿区，回执给 `draft:<草稿id>` 与预览。要让它进剧目：",
  "- 背景 / 插图：`import_asset(source=\"draft:<草稿id>\", kind=…, name=…)`；",
  "- 立绘：先 `cut(source=\"draft:<草稿id>\", output=\"assets/sprites/<主体id>/<差分>.png\")` 抠成透明 PNG，再登记那张。",
  "要一条龙（出图 + 立绘抠底 + 登记）直接用 `generate_asset`。",
].join("\n");

export interface GenerateImageDeps {
  playAssets?: PlayAssets;
  onAsset: (
    path: string,
    url: string,
    kind: "background" | "cg" | "sprite",
    replaced: boolean,
    toolCallId: string,
  ) => void;
}

export function createGenerateImageTool(deps: GenerateImageDeps): AgentTool<typeof generateImageParams> {
  return {
    name: "generate_image",
    label: "出候选图",
    description: `${imageGenerate.doc}${HOST_NOTE}`,
    parameters: generateImageParams,
    execute: async (toolCallId, params: Static<typeof generateImageParams>) => {
      if (!deps.playAssets) {
        return textResult("生图未启用（STAGE_IMAGE_ENABLED=false 或后端缺凭据）：把该出的图列给用户，让用户在素材页上传。");
      }
      const args = params as ImageGenerateArgs;
      if (!args.kind) {
        return textResult(
          "本宿主没有通用候选区：出图请给 kind（background / cg / sprite），画幅跟着 kind 与 framing 走。",
        );
      }
      try {
        const draft = await deps.playAssets.draft(
          {
            kind: args.kind,
            name: args.name,
            spriteId: typeof args.spriteId === "string" ? args.spriteId : undefined,
            variant: typeof args.variant === "string" ? args.variant : undefined,
            framing: args.framing,
            stature: args.stature,
            title: typeof args.title === "string" ? args.title : undefined,
            keyColor: args.keyColor,
            references: resolveImageRefs(args),
          },
          args.prompt,
          args.style,
        );
        deps.onAsset(draft.path, draft.url, draft.kind, false, toolCallId);
        return linesResult([
          `草稿已出：\`draft:${draft.draftId}\``,
          `![${draft.draftId}](${draft.url})`,
          "这张**还不是素材**。背景 / 插图直接 `import_asset(source=\"draft:…\", kind=…, name=…)` 采用；",
          "立绘先 `cut(source=\"draft:…\", output=\"assets/sprites/<主体id>/<差分>.png\")` 抠底、再登记那张透明 PNG。",
          "要一条龙就用 `generate_asset`。",
        ]);
      } catch (error) {
        return textResult(`生图失败：${reason(error)}`);
      }
    },
  };
}
