import type { AgentTool } from "@earendil-works/pi-agent-core";
import { type Static, Type } from "@earendil-works/pi-ai";
import type { PlayAssets } from "../playAssets.js";
import { linesResult, reason, textResult } from "./result.js";

/**
 * `commit_asset`：把一张草稿正式入库（只给工坊）。
 *
 * `generate_image` 在工坊只产**草稿**（media-cache/drafts/ 下的半成品，不写 assets/、不碰素材表），
 * 因为「一次出三张候选让用户挑」这条流程要求没被挑中的候选不留痕迹。挑中了再来这一步：
 * 写 `assets/`、补素材表呈现声明、记生图台账、把留底原片搬进 sprite-sources（重抠要用）。
 *
 * 落位用草稿出图时的意图，所以这里只要一个 draftId——候选之间的差别在画面不在身份
 * （定妆照的三张候选都按 `neutral` 出图，挑中的那张就按 `neutral` 入库）。
 *
 * 剧作家那边没有这个工具也不需要有：它一次调用就声明了最终 id，宿主把 draft + commit 一次做完。
 */

const commitParams = Type.Object(
  {
    /** generate_image 回执里的草稿 id。 */
    draftId: Type.String({ minLength: 1, maxLength: 64 }),
  },
  { additionalProperties: false },
);

const DESCRIPTION = [
  "把一张**草稿**正式入库成剧目素材：写进 `assets/`、补素材表声明、记生图台账。",
  "`draftId` 来自 `generate_image` 的回执；落位（哪个主体的哪个差分 / 哪个背景 id）就用草稿出图时的意图。",
  "**入库前先把候选的预览摆给用户看过、用户点头了才调**——它一进来就是剧目素材了，会覆盖同名的旧图。",
  "同一张草稿重复采用只是把同一个文件再写一遍，不会出问题；没被采用的草稿会在一周后自动清掉。",
].join("");

export interface CommitAssetDeps {
  playAssets?: PlayAssets;
  onAsset: (
    path: string,
    url: string,
    kind: "background" | "cg" | "sprite",
    replaced: boolean,
    toolCallId: string,
  ) => void;
}

export function createCommitAssetTool(deps: CommitAssetDeps): AgentTool<typeof commitParams> {
  return {
    name: "commit_asset",
    label: "采用草稿入库",
    description: DESCRIPTION,
    parameters: commitParams,
    execute: async (toolCallId, params: Static<typeof commitParams>) => {
      if (!deps.playAssets) return textResult("生图未启用（STAGE_IMAGE_ENABLED=false 或后端缺凭据）。");
      try {
        const asset = await deps.playAssets.commit(params.draftId.trim(), { notify: "workshop" });
        deps.onAsset(asset.path, asset.url, asset.kind, asset.replaced, toolCallId);
        return linesResult([
          `${asset.replaced ? "已入库并覆盖原有素材" : "已入库"}：${asset.path}\n![${asset.path}](${asset.url})`,
        ]);
      } catch (error) {
        return textResult(`入库失败：${reason(error)}`);
      }
    },
  };
}
