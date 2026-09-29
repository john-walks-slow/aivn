import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { LineageNodeView, LineageView } from "@stage-ai/core";
import { api } from "../api.js";

/** 导演视角的四原语出口（与 useStageSocket 的 send 同源，正交可组合）。 */
export interface LineageOps {
  jump: (nodeId: string) => void;
  fork: (nodeId: string) => void;
  edit: (nodeId: string, newText: string) => void;
  rewrite: (nodeId: string, granularity: "line" | "beat", instruction?: string) => void;
  oocAt: (nodeId: string, text: string) => void;
  bookmark: (nodeId: string, name: string) => void;
  unbookmark: (bookmarkId: string) => void;
}

/** 谱系拉取：打开视图与每次操作后刷新（树不随节拍广播，避免每拍搬运全量节点）。 */
export function useLineage(playId: string, nonce: number): {
  view: LineageView | null;
  error: string | null;
  reload: () => void;
} {
  const [view, setView] = useState<LineageView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const reload = useCallback(() => {
    api
      .lineage(playId)
      .then((next) => {
        setView(next);
        setError(null);
      })
      .catch((err: unknown) => setError(err instanceof Error ? err.message : String(err)));
  }, [playId]);
  useEffect(reload, [reload, nonce]);
  return { view, error, reload };
}

interface PanelProps {
  view: LineageView | null;
  error: string | null;
  names: Readonly<Record<string, string>>;
  busy: boolean;
  onReload: () => void;
  onBack: () => void;
  ops: LineageOps;
}

/** 剧本视图：当前分支逐行铺开，台词可直接改写，四个原语挂在行内。 */
export function BranchScript(props: PanelProps) {
  const { view, names, busy, ops } = props;
  const rows = useMemo(() => (view ? branchRows(view, names) : []), [view, names]);
  const [active, setActive] = useState<string | null>(null);
  const bottomRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if (active) return;
    bottomRef.current?.scrollIntoView({ block: "end" });
  }, [rows.length, active]);

  return (
    <PanelShell {...props} title="剧本" hint="点任意一行，就地编辑 / 重写 / 分岔">
      {rows.map((row) => (
        <Row
          key={row.id}
          row={row}
          active={active === row.id}
          busy={busy}
          onSelect={() => setActive((cur) => (cur === row.id ? null : row.id))}
          ops={ops}
        />
      ))}
      <div ref={bottomRef} />
    </PanelShell>
  );
}

/** 路线树视图：全量历史（含废弃分支），可直接跳转到任意节点。 */
export function RouteTree(props: PanelProps) {
  const { view, names, busy, ops } = props;
  const rows = useMemo(() => (view ? treeRows(view, names) : []), [view, names]);
  const [active, setActive] = useState<string | null>(null);
  const bookmarkOf = useMemo(() => {
    const map = new Map<string, string>();
    for (const bookmark of view?.bookmarks ?? []) map.set(bookmark.nodeId, bookmark.id);
    return map;
  }, [view]);

  return (
    <PanelShell {...props} title="路线" hint="历史全部保留：点任意节点可跳转或分岔重演">
      {view && view.bookmarks.length > 0 && (
        <div className="tree-bookmarks">
          {view.bookmarks.map((bookmark) => (
            <span key={bookmark.id} className="tree-bookmark">
              <button className="ghost-btn" disabled={busy} onClick={() => ops.jump(bookmark.nodeId)}>
                ⭐ {bookmark.name}
              </button>
              <button
                className="ghost-btn"
                title="删除书签"
                onClick={() => {
                  ops.unbookmark(bookmark.id);
                  props.onReload();
                }}
              >
                ×
              </button>
            </span>
          ))}
        </div>
      )}
      {rows.map((row) => (
        <Row
          key={row.id}
          row={row}
          active={active === row.id}
          busy={busy}
          depth={row.depth}
          branchPoint={row.branch}
          current={row.id === view?.leafId}
          bookmarked={bookmarkOf.has(row.id)}
          onSelect={() => setActive((cur) => (cur === row.id ? null : row.id))}
          ops={props.ops}
        />
      ))}
    </PanelShell>
  );
}

// —— 行渲染 ——

interface Row {
  id: string;
  kind: LineageNodeView["kind"];
  /** 显示文本（编辑过的台词取改后文本）。 */
  text: string;
  cls: string;
  editable: boolean;
  edited: boolean;
  depth?: number;
  branch?: boolean;
}

function PanelShell(
  props: PanelProps & { title: string; hint: string; children: React.ReactNode },
) {
  return (
    <div className="screen stage-screen">
      <header className="screen-bar">
        <button className="ghost-btn" onClick={props.onBack}>
          ← 舞台
        </button>
        <span className="muted">{props.title}</span>
        <span className="muted">{props.hint}</span>
        <button className="ghost-btn" onClick={props.onReload}>
          刷新
        </button>
      </header>
      {props.error && <div className="error-banner">{props.error}</div>}
      {!props.view && <div className="overlay">读取路线…</div>}
      <div className="lineage-view">{props.view && props.children}</div>
    </div>
  );
}

function Row(props: {
  row: Row;
  active: boolean;
  busy: boolean;
  current?: boolean;
  bookmarked?: boolean;
  branchPoint?: boolean;
  depth?: number;
  onSelect: () => void;
  ops: LineageOps;
}) {
  const { row, active, busy, ops } = props;
  return (
    <div
      className={`lineage-row ${row.cls}${active ? " active" : ""}${props.current ? " current" : ""}`}
      style={props.depth ? { marginLeft: `${Math.min(props.depth, 6) * 10}px` } : undefined}
    >
      <button className="lineage-text" onClick={props.onSelect} disabled={busy}>
        {props.branchPoint && <span className="lineage-fork" title="此处有多个版本">⑂</span>}
        {props.bookmarked && <span title="已标记">⭐</span>}
        {props.current && <span className="lineage-leaf" title="当前所在">●</span>}
        {row.text}
        {row.edited && <span className="lineage-edited">（已改）</span>}
      </button>
      {active && <NodeActions row={row} busy={busy} ops={ops} />}
    </div>
  );
}

/** 行内操作条：四原语正交摆在这里，组合权在用户（对照计划 D10）。 */
function NodeActions({ row, busy, ops }: { row: Row; busy: boolean; ops: LineageOps }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(row.text);
  const [note, setNote] = useState("");
  const [naming, setNaming] = useState(false);
  const [name, setName] = useState("");

  useEffect(() => {
    setDraft(row.text);
  }, [row.text]);

  const submitEdit = (): void => {
    const text = draft.trim();
    if (!text || text === row.text) return setEditing(false);
    ops.edit(row.id, text);
    setEditing(false);
  };

  return (
    <div className="lineage-actions">
      {row.editable && !editing && (
        <>
          <button className="ghost-btn" disabled={busy} onClick={() => setEditing(true)}>
            ✎ 改写台词
          </button>
          <button
            className="ghost-btn"
            disabled={busy}
            onClick={() => ops.rewrite(row.id, "line", note.trim() || undefined)}
          >
            ↺ 重写此句
          </button>
        </>
      )}
      <button
        className="ghost-btn"
        disabled={busy}
        onClick={() => ops.rewrite(row.id, "beat", note.trim() || undefined)}
      >
        ↺ 重写这一幕
      </button>
      <button className="ghost-btn" disabled={busy} onClick={() => ops.fork(row.id)}>
        🌿 从此分岔
      </button>
      <button className="ghost-btn" disabled={busy} onClick={() => ops.jump(row.id)}>
        ⤴ 跳转
      </button>
      {naming ? (
        <span className="lineage-inline-input">
          <input
            value={name}
            autoFocus
            placeholder="书签名"
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && name.trim()) {
                ops.bookmark(row.id, name.trim());
                setNaming(false);
                setName("");
              }
              if (e.key === "Escape") setNaming(false);
            }}
          />
        </span>
      ) : (
        <button className="ghost-btn" disabled={busy} onClick={() => setNaming(true)}>
          ⭐ 书签
        </button>
      )}
      <span className="lineage-inline-input">
        <input
          value={note}
          placeholder="导演注（可空）"
          onChange={(e) => setNote(e.target.value)}
        />
      </span>
      <button
        className="ghost-btn"
        disabled={busy || !note.trim()}
        onClick={() => {
          ops.oocAt(row.id, note.trim());
          setNote("");
        }}
      >
        💬 从此 OOC 重演
      </button>
      {editing && (
        <span className="lineage-editor">
          <textarea value={draft} autoFocus rows={2} onChange={(e) => setDraft(e.target.value)} />
          <button className="ghost-btn" onClick={submitEdit}>
            保存
          </button>
          <button className="ghost-btn" onClick={() => setEditing(false)}>
            取消
          </button>
        </span>
      )}
    </div>
  );
}

// —— 谱系 → 行 ——

/** 当前分支逐行铺开；edit 事件就地改写目标行文本（物化语义，剧本所见即所演）。 */
function branchRows(view: LineageView, names: Record<string, string>): Row[] {
  const byId = new Map(view.nodes.map((node) => [node.id, node]));
  const overrides = new Map<string, string>();
  for (const id of view.pathIds) {
    const node = byId.get(id);
    if (node?.kind === "edit" && node.editTargetId) overrides.set(node.editTargetId, node.text);
  }
  return view.pathIds
    .map((id) => byId.get(id))
    .filter((node): node is LineageNodeView => !!node)
    .filter((node) => node.kind !== "preload" && node.kind !== "edit")
    .map((node) => {
      const row = describeRow(node, names);
      const text = overrides.get(node.id);
      return text === undefined ? row : { ...row, text, edited: true };
    });
}

/** 全量事件按时间铺开，按父子缩进表达分支；分叉点标 ⑂、当前叶标 ●。 */
function treeRows(view: LineageView, names: Record<string, string>): Row[] {
  const byId = new Map(view.nodes.map((node) => [node.id, node]));
  const depth = new Map<string, number>();
  for (const node of view.nodes) {
    let level = 0;
    let cursor = node.parentId;
    while (cursor && level < 12) {
      level += 1;
      cursor = byId.get(cursor)?.parentId ?? null;
    }
    depth.set(node.id, level);
  }
  const overrides = new Map<string, string>();
  for (const node of view.nodes) {
    if (node.kind === "edit" && node.editTargetId) overrides.set(node.editTargetId, node.text);
  }
  return view.nodes
    .filter((node) => node.kind !== "preload")
    .map((node) => {
      const row = describeRow(node, names);
      const text = overrides.get(node.id);
      const base = text === undefined ? row : { ...row, text, edited: true };
      return {
        ...base,
        depth: depth.get(node.id) ?? 0,
        branch: node.children > 1,
        cls: `${base.cls}${node.onPath ? "" : " abandoned"}`,
      };
    });
}

function describeRow(node: LineageNodeView, names: Readonly<Record<string, string>>): Row {
  const who = names[node.attrs.id ?? ""] ?? node.attrs.id ?? "";
  const text = node.text || "";
  switch (node.kind) {
    case "say":
      return { ...base(node), cls: "line-say", text: `${who}：${text}`, editable: true };
    case "thought":
      return { ...base(node), cls: "line-thought", text: `${who}（心声）：${text}`, editable: true };
    case "narrate":
      return { ...base(node), cls: "line-narrate", text, editable: true };
    case "scene":
      return {
        ...base(node),
        cls: "line-scene",
        text: `◈ ${node.attrs.bg ?? "——"}${node.attrs.bgm ? ` · ♪ ${node.attrs.bgm}` : ""}`,
      };
    case "actor":
      return {
        ...base(node),
        cls: "line-scene",
        text: `○ ${who} 就位${node.attrs.pos ? ` · ${node.attrs.pos}` : ""}${
          node.attrs.expression ? ` · ${node.attrs.expression}` : ""
        }`,
      };
    case "cg":
      return { ...base(node), cls: "line-scene", text: `▣ ${node.attrs.id ?? ""}` };
    case "sfx":
      return { ...base(node), cls: "line-scene", text: `♪ ${node.attrs.src ?? ""}` };
    case "stop":
      return { ...base(node), cls: "line-player", text: stopLabel(node.attrs) };
    case "player":
      return { ...base(node), cls: "line-player", text: `▸ ${text}` };
    case "ooc":
      return { ...base(node), cls: "line-player", text: `🎬 ${text}` };
    case "rewrite":
      return {
        ...base(node),
        cls: "line-mark",
        text: `↺ 重写此${node.granularity === "beat" ? "幕" : "句"}${
          node.attrs.instruction ? `：${node.attrs.instruction}` : ""
        }`,
      };
    case "beat_end":
      return { ...base(node), cls: "line-mark", text: "———" };
    default:
      return { ...base(node), cls: "line-mark", text: text || node.kind };
  }
}

function base(node: LineageNodeView): Row {
  return { id: node.id, kind: node.kind, text: node.text, cls: "line-mark", editable: false, edited: false };
}

function stopLabel(attrs: Record<string, string>): string {
  if (attrs.stopType === "choice") return "◇ 等待玩家选择";
  if (attrs.stopType === "free") return "◇ 等待玩家回应";
  return "◇ 等待继续";
}
