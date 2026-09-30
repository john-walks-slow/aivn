import type { AgentTool } from "@earendil-works/pi-agent-core";
import { type Static, Type } from "@earendil-works/pi-ai";
import { textResult } from "./result.js";
import type { PlaywriterKitDeps } from "./deps.js";

/** 好感度单次增量上限与值域（引擎校验，模型只可提议）。 */
const AFFINITY_DELTA_CAP = 5;
const AFFINITY_MAX = 100;

const updateStateParams = Type.Object(
  {
    affinity: Type.Optional(Type.Record(Type.String(), Type.Number())),
    flags: Type.Optional(
      Type.Record(Type.String(), Type.Union([Type.String(), Type.Number(), Type.Boolean()])),
    ),
  },
  { additionalProperties: false },
);

const writeMemoryParams = Type.Object(
  {
    file: Type.Union([
      Type.Literal("scene"),
      Type.Literal("threads"),
      // characters/<id>：建立/更新角色设定（persona/台词风格），同时在 play.json 注册 stub
      Type.String({ pattern: "^characters/[a-zA-Z][a-zA-Z0-9_-]{0,39}$" }),
    ]),
    content: Type.String({ maxLength: 4000 }),
  },
  { additionalProperties: false },
);

const readMemoryDetailParams = Type.Object({ name: Type.String() }, { additionalProperties: false });

const searchArchiveParams = Type.Object(
  {
    query: Type.String({ maxLength: 200 }),
    limit: Type.Optional(Type.Number()),
  },
  { additionalProperties: false },
);

/**
 * 剧作家记忆工具组：update_state（引擎校验）/ write_memory / read_memory_detail / search_archive。
 * 引擎拥有状态真值，stateFiles 随谱系快照走——工具只改传进来的对象，不自己落盘。
 */
export function createMemoryTools(
  deps: Pick<
    PlaywriterKitDeps,
    "engine" | "memory" | "tree" | "stateFiles" | "arcIds" | "writeCharacter"
  > & { characterIds: ReadonlySet<string> },
): AgentTool<any>[] {
  const updateState: AgentTool<typeof updateStateParams> = {
    name: "update_state",
    label: "提议状态更新",
    description:
      "提议更新引擎状态（好感度增量/旗标）。好感度传增量（如 koharu: 2 表示 +2，单次 |增量|≤5，值域 0~100）；旗标传目标值。引擎校验后才生效，【状态】区下轮反映。剧情有实质推进时才调用，不要每轮都调。",
    parameters: updateStateParams,
    execute: async (_toolCallId, params: Static<typeof updateStateParams>) => {
      const { affinity, flags } = params;
      const applied: string[] = [];
      const rejected: string[] = [];
      for (const [charId, delta] of Object.entries(affinity ?? {})) {
        if (!deps.characterIds.has(charId)) {
          rejected.push(`${charId} 不是本剧角色`);
          continue;
        }
        if (!Number.isInteger(delta) || Math.abs(delta) > AFFINITY_DELTA_CAP) {
          rejected.push(`${charId} 增量须为整数且 |Δ|≤${AFFINITY_DELTA_CAP}（收到 ${delta}）`);
          continue;
        }
        const current = deps.engine.affinity[charId] ?? 0;
        const next = Math.max(0, Math.min(AFFINITY_MAX, current + delta));
        deps.engine.affinity[charId] = next;
        applied.push(`${charId} ${delta >= 0 ? "+" : ""}${delta}（${current}→${next}）`);
      }
      for (const [key, value] of Object.entries(flags ?? {})) {
        deps.engine.flags[key] = value;
        applied.push(`旗标 ${key}=${String(value)}`);
      }
      if (applied.length === 0 && rejected.length === 0) return textResult("未提供任何更新。");
      return textResult(
        [
          applied.length > 0 ? `已生效：${applied.join("；")}` : null,
          rejected.length > 0 ? `被拒绝（请修正后重试）：${rejected.join("；")}` : null,
        ]
          .filter(Boolean)
          .join("\n"),
      );
    },
  };

  const writeMemory: AgentTool<typeof writeMemoryParams> = {
    name: "write_memory",
    label: "写记忆文件",
    description:
      "写记忆文件。\n" +
      "- file=\"scene\"：当前场景/在场人物/时间（一两行），每轮有实质变化时更新，全文下轮注入【状态】区。\n" +
      "- file=\"threads\"：活跃剧情线与悬念（要点列表），每轮有实质变化时更新，全文下轮注入【状态】区。\n" +
      "- file=\"characters/<id>\"：建立/更新角色设定（persona、台词风格）。首行建议写 `# 名字`，引擎据此在角色表注册 id 和显示名。下一轮边界角色出现在 A 区【角色表】。",
    parameters: writeMemoryParams,
    execute: async (_toolCallId, params: Static<typeof writeMemoryParams>) => {
      const { file, content } = params;
      if (file === "scene" || file === "threads") {
        deps.stateFiles[file] = content.trim();
        return textResult(`已更新 ${file}.md。`);
      }
      // characters/<id> 分支：落盘 + upsert play.json stub
      if (!deps.writeCharacter) {
        return textResult("（当前运行环境不支持写角色设定，请通过工坊完成。）");
      }
      const charId = file.replace(/^characters\//, "");
      await deps.writeCharacter(charId, content.trim());
      // 从内容首行解析名字（# 名字）
      const nameMatch = /^#\s+(.+)$/m.exec(content);
      const name = nameMatch?.[1]?.trim() ?? charId;
      return textResult(`已写入 ${file}.md，角色「${name}」（id: ${charId}）将在下一拍边界出现在角色表。`);
    },
  };

  const readMemoryDetail: AgentTool<typeof readMemoryDetailParams> = {
    name: "read_memory_detail",
    label: "读记忆卡详情",
    description:
      "读取记忆索引中某条卡的完整内容（系统提示词「记忆索引」列表里的名称，或 [分类] 后的相对路径如 locations/旧校舍）。" +
      "涉及某地点/设定/旧章节时先查再写，避免与既有设定矛盾。",
    parameters: readMemoryDetailParams,
    execute: async (_toolCallId, params: Static<typeof readMemoryDetailParams>) => {
      const { name } = params;
      const arcIds = deps.arcIds();
      const detail = deps.memory.readCard(name, arcIds);
      if (detail) return textResult(detail);
      const available = deps.memory
        .visibleContext(arcIds)
        .map((c) => c.name)
        .join("、");
      return textResult(`未找到「${name}」。可用条目：${available || "（无）"}。`);
    },
  };

  const searchArchive: AgentTool<typeof searchArchiveParams> = {
    name: "search_archive",
    label: "检索历史往事",
    description:
      "全文检索本分支历史演出（过往轮的剧本切片）。需要回看发生过什么、玩家说过什么时调用；只命中当前分支可见的历史，不会召回其他分支。",
    parameters: searchArchiveParams,
    execute: async (_toolCallId, params: Static<typeof searchArchiveParams>) => {
      const { query, limit } = params;
      const hits = deps.memory.searchArchive(
        query,
        deps.tree.pathSet(),
        Math.max(1, Math.min(10, limit ?? 5)),
      );
      if (hits.length === 0) return textResult("（无命中：当前分支历史中未检索到相关内容）");
      return textResult(hits.map((h) => `【第 ${h.turn} 轮】\n${h.summary}`).join("\n\n"));
    },
  };

  return [updateState, writeMemory, readMemoryDetail, searchArchive];
}
