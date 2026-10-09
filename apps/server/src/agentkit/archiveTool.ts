import type { AgentTool } from "@earendil-works/pi-agent-core";
import { type Static, Type } from "@earendil-works/pi-ai";
import { textResult } from "./result.js";
import type { PlaywriterKitDeps } from "./deps.js";

const searchArchiveParams = Type.Object(
  {
    query: Type.String({ maxLength: 200 }),
    limit: Type.Optional(Type.Number()),
  },
  { additionalProperties: false },
);

/**
 * 剧作家的往事检索：`search_archive`。
 *
 * 记忆组里只剩它一个专用口——`update_state` 与 `read_memory_detail` 分别在 P6-d / P6-a 删掉：
 * 世界状态改由**剧目文件**承载（`memory/always/state/` 三个文件，B 区【状态】区每轮现读），
 * 记忆卡全文走通用 `read`（A 区《记忆索引》每行都带路径）。
 *
 * 留下的这一个有文件工具替代不了的语义：**按当前分支过滤**（`tree.pathSet()`——兄弟 / 废弃分支
 * 的切片不可召回）+ NSFW 过滤 + 相关性排序；而它读的 `memory/archive/` 是引擎产物，通用读口
 * 对剧作家是关着的（`PlayEnv` 的 `readGenerated`）。
 */
export function createArchiveTool(
  deps: Pick<PlaywriterKitDeps, "memory" | "tree" | "isNsfw">,
): AgentTool<typeof searchArchiveParams> {
  return {
    name: "search_archive",
    label: "检索历史往事",
    description:
      "全文检索本分支历史演出（过往轮的剧本切片）。需要回看发生过什么、玩家说过什么时调用；只命中当前分支可见的历史，不会召回其他分支。",
    parameters: searchArchiveParams,
    execute: async (_toolCallId, params: Static<typeof searchArchiveParams>) => {
      const { query, limit } = params;
      const hits = deps.memory.searchArchive(query, deps.tree.pathSet(), {
        limit: Math.max(1, Math.min(10, limit ?? 5)),
        nsfw: deps.isNsfw(),
      });
      if (hits.length === 0) return textResult("（无命中：当前分支历史中未检索到相关内容）");
      return textResult(hits.map((h) => `【第 ${h.turn} 轮】\n${h.summary}`).join("\n\n"));
    },
  };
}
