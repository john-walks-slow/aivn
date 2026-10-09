import type { AgentTool } from "@earendil-works/pi-agent-core";
import { type Static, Type } from "@earendil-works/pi-ai";
import { textResult } from "./result.js";
import type { PlaywriterKitDeps } from "./deps.js";
import { parsePlayState, playStateJson, readPlayStateText, writePlayStateText } from "../playState.js";

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

const searchArchiveParams = Type.Object(
  {
    query: Type.String({ maxLength: 200 }),
    limit: Type.Optional(Type.Number()),
  },
  { additionalProperties: false },
);

/**
 * 剧作家的记忆工具组：update_state（引擎校验）/ search_archive。
 * 引擎拥有状态真值，stateFiles 随谱系快照走——工具只改传进来的对象，不自己落盘。
 *
 * **读写口都不在这里**：角色卡与记忆卡都是普通剧目文件，走 read / write / edit（见 `kit.ts`）；
 * A 区《记忆索引》每行都带路径，读一张卡的全文就是 `read` 那一条路径（原先的
 * `read_memory_detail` 已于 2026-10-10 删除，理由见 P6 轴：通用工具能做好就不留专用口）。
 * 留下的两个都有文件工具替代不了的语义——状态随谱系快照回滚、往事按当前分支过滤。
 */
export function createMemoryTools(
  deps: Pick<
    PlaywriterKitDeps,
    "engine" | "memory" | "tree" | "stateFiles" | "files" | "isNsfw"
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
      // P6-d 原型：三个状态文件是工作态载体——**文件是基准**，engine / stateFiles 只做镜像。
      // （迁移那一步工具本身会删掉，这段一起消失；此处双写只为了让现有调用方与测试平滑过渡。）
      const dir = deps.files.root;
      const text = readPlayStateText(dir);
      const live = parsePlayState(text.state);
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
        const current = live.affinity[charId] ?? 0;
        const next = Math.max(0, Math.min(AFFINITY_MAX, current + delta));
        live.affinity[charId] = next;
        applied.push(`${charId} ${delta >= 0 ? "+" : ""}${delta}（${current}→${next}）`);
      }
      for (const [key, value] of Object.entries(flags ?? {})) {
        live.flags[key] = value;
        applied.push(`旗标 ${key}=${String(value)}`);
      }
      for (const [key, value] of [["scene", scene], ["threads", threads]] as const) {
        if (value === undefined) continue;
        text[key] = value.trim();
        applied.push(`${key}.md 已重写`);
      }
      if (applied.length === 0 && rejected.length === 0) return textResult("未提供任何更新。");
      writePlayStateText(dir, { scene: text.scene, threads: text.threads, state: playStateJson(live) });
      // 镜像：原地换内容而不换对象——状态工具的闭包与快照读的是同一个对象
      for (const key of Object.keys(deps.engine.affinity)) delete deps.engine.affinity[key];
      Object.assign(deps.engine.affinity, live.affinity);
      for (const key of Object.keys(deps.engine.flags)) delete deps.engine.flags[key];
      Object.assign(deps.engine.flags, live.flags);
      deps.stateFiles.scene = text.scene;
      deps.stateFiles.threads = text.threads;
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

  const searchArchive: AgentTool<typeof searchArchiveParams> = {
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

  return [updateState, searchArchive];
}
