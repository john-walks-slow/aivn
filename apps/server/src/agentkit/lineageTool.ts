import type { AgentTool } from "@earendil-works/pi-agent-core";
import { LineageTree, ROOT_ID, type LineageEvent, type LineageEventKind, type LineageSnapshot } from "@aivn/core";
import { type Static, Type } from "@earendil-works/pi-ai";
import { assertSaveId } from "../saves.js";
import type { WorkshopKitDeps } from "./deps.js";
import { reason, textResult } from "./result.js";

/**
 * 故事树只读工具组（仅工坊）：list_saves / read_lineage。
 *
 * 演出的每一行都落在周目（存档）的故事树里一棵，工坊靠它回答「演到哪了」。
 * **只读**是硬边界：分岔、编辑台词、重写这些结构操作是玩家的四个动词（舞台「路线」视图），
 * 不该由 agent 在背后动。
 */

const emptyParams = Type.Object({}, { additionalProperties: false });
const readLineageParams = Type.Object(
  {
    saveId: Type.String({ maxLength: 64 }),
    /** 从第几条开始（0 起）。节点按 turn 升序，分页游标。 */
    offset: Type.Optional(Type.Number()),
    limit: Type.Optional(Type.Number()),
    /** 只要当前分支路径上的节点（默认）还是全量节点含废弃分支。 */
    allBranches: Type.Optional(Type.Boolean()),
  },
  { additionalProperties: false },
);

export function createLineageTools(
  deps: Pick<WorkshopKitDeps, "saves" | "saveStore">,
): AgentTool<any>[] {
  const listSaves: AgentTool<typeof emptyParams> = {
    name: "list_saves",
    label: "列出周目",
    description: "列出这部剧目的全部周目（存档）及其 id、名称、轮数、最后一句。要读故事树时先用它拿 saveId。",
    parameters: emptyParams,
    execute: async () => {
      const list = await deps.saves.list();
      if (list.length === 0) return textResult("（还没有任何周目）");
      return textResult(
        list
          .map((s) => `${s.id}\t${s.name}${s.current ? "（当前活动档）" : ""}\t${s.beats} 轮\t最后：${s.preview || "（无）"}`)
          .join("\n"),
      );
    },
  };

  const readLineage: AgentTool<typeof readLineageParams> = {
    name: "read_lineage",
    label: "读故事树",
    description:
      "只读某个周目的故事树（行级事件日志），按顺序返回节点 id、类型、台词。想改剧情结构（分岔/编辑/重写）请告诉用户去舞台的「路线」视图操作，你没有写权限。",
    parameters: readLineageParams,
    execute: async (_id, params: Static<typeof readLineageParams>) => {
      try {
        // 先验 id 再验存在：非法 id 与不存在的周目是两种错，模型要能分清
        const saveId = assertSaveId(params.saveId);
        if (!(await deps.saves.has(saveId))) {
          return textResult(`周目 ${saveId} 不存在，先用 list_saves 看有哪些周目。`);
        }
        const session = await deps.saveStore(saveId).loadSession();
        if (!session) return textResult(`周目 ${saveId} 还没有演出版本（session.json 不存在或读不出）。`);
        return textResult(renderLineage(saveId, session.store, params));
      } catch (error) {
        return textResult(`读取失败：${reason(error)}`);
      }
    },
  };

  return [listSaves, readLineage];
}

/** 行级事件的中文标签（给 agent 读的，别丢英文 kind 原样给它猜）。 */
const LINEAGE_KIND_LABEL: Record<string, string> = {
  scene: "场景",
  actor: "角色登场",
  say: "台词",
  narrate: "旁白",
  thought: "心理",
  sfx: "音效",
  preload: "预载素材",
  cg: "CG",
  stop: "停止点",
  player: "玩家表态",
  ooc: "导演注",
  beat_end: "本轮收束",
  edit: "改写行",
  rewrite: "重写请求",
};

function kindLabel(kind: LineageEventKind): string {
  return LINEAGE_KIND_LABEL[kind] ?? kind;
}

/** 一行事件的紧凑文本：id、类型、台词截断。 */
function renderEventLine(
  ev: { id: string; kind: LineageEventKind; text?: string; onPath: boolean; seq?: number; editTargetId?: string | undefined },
  textLimit = 60,
): string {
  const path = ev.onPath ? "" : "（废弃分支）";
  const seq = ev.seq === undefined ? "" : ` seq=${ev.seq}`;
  const target = ev.editTargetId ? ` 改写 ${ev.editTargetId}` : "";
  const text = (ev.text ?? "").replace(/\s+/g, " ").trim();
  const body = text ? (text.length > textLimit ? `${text.slice(0, textLimit)}…` : text) : "";
  return `${ev.id}\t${kindLabel(ev.kind)}${path}${seq}\t${body}${target}`;
}

/** 故事树只读渲染：分页 + 当前分支/全量两态。 */
function renderLineage(
  saveId: string,
  store: { events: LineageEvent[]; leafId: string | null; snapshots: LineageSnapshot[] },
  params: Static<typeof readLineageParams>,
): string {
  // 走 LineageTree.describe() 而不是自己算路径：onPath 标记只有它算得对
  const tmp = new LineageTree();
  tmp.load(store);
  const view = tmp.describe();

  const all = params.allBranches === true;
  // 哨兵根是脚手架的挂点，不是一行剧情：它没有文本，kind 也不在中文标签表里，
  // 混进列表就是一行 `root	root` 的垃圾，还把节点总数与分页序号整体撑大一位。
  const nodes = (all ? view.nodes : view.nodes.filter((n) => n.onPath)).filter((n) => n.id !== ROOT_ID);
  const offset = Math.max(0, params.offset ?? 0);
  const limit = Math.min(200, Math.max(1, params.limit ?? 60));
  const page = nodes.slice(offset, offset + limit);

  const head = [
    `周目 ${saveId}：共 ${nodes.length} 个节点（${all ? "全量含废弃分支" : "当前分支路径"}）`,
    `叶节点：${view.leafId ?? "（空树）"}　快照：${store.snapshots.length} 个`,
    `序号 ${offset}–${offset + page.length - 1}${nodes.length > offset + page.length ? "（还有更多，用 offset 继续翻）" : ""}`,
  ];
  const body = page.map((n) => renderEventLine(n));
  return [...head, ...(body.length > 0 ? body : ["（无节点）"])].join("\n");
}
