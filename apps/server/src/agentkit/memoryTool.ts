import { parseCharacterCard } from "@stage-ai/core";
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
    /** 当前场景：地点 / 在场的人 / 时间。全文下轮注入【状态】区。 */
    scene: Type.Optional(Type.String({ maxLength: 2000 })),
    /** 活跃剧情线与悬念（要点列表）。全文下轮注入【状态】区。 */
    threads: Type.Optional(Type.String({ maxLength: 2000 })),
  },
  { additionalProperties: false },
);

const createCharacterParams = Type.Object(
  {
    // characters/<id> —— 文件名主体就是角色 id，建档后下一轮边界进 A 区角色表
    file: Type.String({ pattern: "^characters/[a-zA-Z][a-zA-Z0-9_-]{0,39}$" }),
    content: Type.String({ maxLength: 8000 }),
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
      "写状态文件——本剧目状态的两个写者就是这一个（scene/threads/好感度/旗标）。\n" +
      "- scene：当前场景的地点、在场的人、时间（一两行）。\n" +
      "- threads：活跃剧情线与悬念（要点列表）。\n" +
      "- affinity：好感度**增量**（如 koharu: 2 表示 +2，单次 |增量|≤5，值域 0~100），不是目标值。\n" +
      "- flags：旗标传目标值。\n" +
      "只传要改的那几项，不传的不动。全文下轮注入【状态】区。剧情有实质推进时才调用，不要每轮都调。",
    parameters: updateStateParams,
    execute: async (_toolCallId, params: Static<typeof updateStateParams>) => {
      const { affinity, flags, scene, threads } = params;
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
      for (const [key, value] of [["scene", scene], ["threads", threads]] as const) {
        if (value === undefined) continue;
        deps.stateFiles[key] = value.trim();
        applied.push(`${key}.md 已重写`);
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

  const createCharacter: AgentTool<typeof createCharacterParams> = {
    name: "create_character",
    label: "建角色卡",
    description:
      "建立/更新一张角色卡（memory/always/characters/<id>.md）。角色的一切配置都在这张卡里，play.json 不再存角色数据。\n\n" +
      "content 是完整的文件内容——frontmatter 头部 + 正文，格式：\n\n" +
      "---\nid: xiaoyu            # 与 file 的 id 一致，引擎以文件名为准，这里写错会被忽略\n" +
      "name: 小雨             # 显示名\n" +
      "voice: 温柔少女声      # 音色的���话描述，可省\n" +
      "voiceId: <32位hex>     # 先用 list_voices 查出来再填；填错不报错，演出时那句台词会静默没有声音\n" +
      "framing: half          # 立绘取景 full/half/square，省略按 full（见 play/framing.ts）\n" +
      "sprites:               # 表情名 → assets/sprites/<id>/ 下的文件名，可省\n" +
      "  neutral: xiaoyu_neutral.png\n" +
      "---\n\n" +
      "正文是人设：年龄、关系、说话方式、在意的点（正文 = 剧作家看到的 persona）。\n\n" +
      "建档后到下一轮边界，角色出现在 A 区角色表里。工坊那边写同一个文件用 write_file。",
    parameters: createCharacterParams,
    execute: async (_toolCallId, params: Static<typeof createCharacterParams>) => {
      const { file, content } = params;
      if (!deps.writeCharacter) {
        return textResult("（当前运行环境不支持建角色卡，请通过工坊完成。）");
      }
      const charId = file.replace(/^characters\//, "");
      await deps.writeCharacter(charId, content.trim());
      const name = parseCharacterCard(content).name;
      return textResult(
        name
          ? `已写入角色卡 ${charId}.md（显示名「${name}」），下一拍边界出现在角色表里。`
          : `已写入角色卡 ${charId}.md。下一次建卡记得在 frontmatter 里写 name，否则 A 区只能显示 id。`,
      );
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

  return [updateState, createCharacter, readMemoryDetail, searchArchive];
}
