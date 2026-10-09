import type { AgentTool } from "@earendil-works/pi-agent-core";
import { type Static, Type } from "@earendil-works/pi-ai";
import { assetRegister, assetRegisterFields, tighten, type AssetRegisterArgs, type AssetRegistration } from "@aivn/agent";
import type { PlayAssets } from "../playAssets.js";
import { toPi } from "./schema.js";
import { linesResult, reason, textResult } from "./result.js";

/**
 * `import_asset`：把一张**外来的图**登记成剧目素材（只给工坊）。
 *
 * 服务端过去没有这个口：工坊靠 `generate_image` 直落、剧作家靠「引用即导入」。缺了它，
 * 「别的工具产出的图 / 用户自己下的图 / 别人的候选想换一张」就没有入库的路——而这正是
 * 插件那边的原子三件套之一（出候选 →（立绘）抠底 → 登记）。
 *
 * 参数真相源、描述正文与落位归一化都在 `@aivn/agent` 的 `asset.register`；这里只声明服务端的
 * face（pi 的长度收紧）与回执。
 */
const FACE = tighten(assetRegisterFields, {
  source: { minLength: 1, maxLength: 2000 },
  name: { maxLength: 40 },
  spriteId: { maxLength: 40 },
  variant: { maxLength: 40 },
  title: { maxLength: 40 },
  description: { maxLength: 300 },
  prompt: { maxLength: 4000 },
  original: { maxLength: 2000 },
});

const importParams = toPi(FACE);

export interface ImportAssetDeps {
  playAssets?: PlayAssets;
  onAsset: (
    path: string,
    url: string,
    kind: "background" | "cg" | "sprite",
    replaced: boolean,
    toolCallId: string,
  ) => void;
}

export function createImportAssetTool(deps: ImportAssetDeps): AgentTool<typeof importParams> {
  return {
    name: "import_asset",
    label: "登记素材",
    // 共享描述是宿主中立的，`draft:` 句柄是服务端这一面独有的机制，在这里补上：
    // 它是「采用刚出的候选」唯一走法（候选区路径模型拿不到）。
    description:
      `${assetRegister.doc}\n` +
      "服务端还可给 `draft:<草稿id>`——\`generate_image\` 刚出的候选，回执里给的就是这个句柄；采用候选只能这么写。",
    parameters: importParams,
    execute: async (toolCallId, params: Static<typeof importParams>) => {
      if (!deps.playAssets) return textResult("素材未启用（STAGE_ASSETS_ENABLED=false）。");
      // 预览 URL 是服务端的回执知识（能力只给落位），顺手带出来。
      let url = "";
      try {
        const registered = await assetRegister.execute(params as AssetRegisterArgs, {
          register: async (source, location, extra): Promise<AssetRegistration> => {
            const asset = await deps.playAssets!.register(source, location, extra);
            url = asset.url;
            return {
              kind: asset.kind,
              path: asset.path,
              replaced: asset.replaced,
              ...(asset.sourcePath ? { sourcePath: asset.sourcePath } : {}),
            };
          },
        });
        deps.onAsset(registered.path, url, registered.kind, registered.replaced, toolCallId);
        const label = registered.kind === "sprite" ? "立绘" : registered.kind === "background" ? "背景" : "插图";
        return linesResult([
          `${label}已登记：\`${registered.path}\`${registered.replaced ? "（覆盖了同名旧素材）" : ""}`,
          `![${registered.kind}](${url})`,
          registered.sourcePath ? `抠底前原片已留底：\`${registered.sourcePath}\`。` : "",
        ]);
      } catch (error) {
        return textResult(`登记失败：${reason(error)}`);
      }
    },
  };
}
