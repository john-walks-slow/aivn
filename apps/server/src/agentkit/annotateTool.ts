import type { AgentTool } from "@earendil-works/pi-agent-core";
import { type Static, Type } from "@earendil-works/pi-ai";
import {
  assetAnnotate,
  assetAnnotateFields,
  assetMetaPatchOf,
  assetSubjectOf,
  tighten,
  type AssetAnnotateArgs,
} from "@aivn/agent";
import type { PlayAssets } from "../playAssets.js";
import type { PlayMusic } from "../playMusic.js";
import { toPi } from "./schema.js";
import { reason, textResult } from "./result.js";

/**
 * `annotate_asset`：给已经入库的素材补 / 改元数据（标题、描述、标签、情绪、场景、循环、音量）。
 *
 * 图片类的元数据可以在登记（`import_asset` / `generate_asset`）时一次给全，这个面负责**事后改**，
 * 也是 BGM 唯一的元数据出口——`generate_bgm` 只写来源标记，不承载元数据（P5-d）。
 * 素材必须真的在：写一条指向空气的元数据，素材页与剧作家都会照着它找不存在的文件。
 */
const FACE = tighten(assetAnnotateFields, {
  name: { minLength: 1, maxLength: 40 },
  spriteId: { minLength: 1, maxLength: 40 },
  variant: { maxLength: 40 },
  title: { maxLength: 40 },
  description: { maxLength: 300 },
  tags: { maxItems: 8 },
  mood: { maxItems: 8 },
  scene: { maxItems: 8 },
  volume: { minimum: 0, maximum: 1 },
});

const annotateParams = toPi(FACE);

export interface AnnotateDeps {
  playAssets?: PlayAssets;
  playMusic?: PlayMusic;
}

export function createAnnotateTool(deps: AnnotateDeps): AgentTool<typeof annotateParams> {
  return {
    name: "annotate_asset",
    label: "标注素材",
    description: assetAnnotate.doc,
    parameters: annotateParams,
    execute: async (_toolCallId, params: Static<typeof annotateParams>) => {
      const args = params as AssetAnnotateArgs;
      try {
        const subject = assetSubjectOf(args);
        const patch = assetMetaPatchOf(args);
        if (Object.keys(patch).length === 0) {
          return textResult(
            "没给要标的内容：至少给 title / description / tags / mood / scene / loop / volume 里的一项。",
          );
        }
        const written =
          subject.kind === "bgm"
            ? deps.playMusic
              ? await deps.playMusic.annotate(subject.name!, patch)
              : null
            : deps.playAssets
              ? await deps.playAssets.annotate(subject, patch)
              : null;
        if (!written) {
          return textResult("素材标注未启用（本实例没有接通素材落盘面）。");
        }
        return textResult(
          `已标注 \`${written.path}\`（${Object.keys(patch).join("、")}）——剧作家挑素材、选曲时就看这几格。`,
        );
      } catch (error) {
        return textResult(`没能标注：${reason(error)}`);
      }
    },
  };
}
