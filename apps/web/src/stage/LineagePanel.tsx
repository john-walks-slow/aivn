import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Icon } from "../ui/Icon.js";
import type { LineageNodeView, LineageView } from "@stage-ai/core";
import { api } from "../api.js";
import { beatAnchors, buildBeats, type BeatCard } from "./beats.js";
import { RouteCanvas } from "./RouteCanvas.js";
import type { ScriptLine } from "./script.js";

/** 导演视角的世界线写操作（跳转是纯客户端只读回看，不在这里——它不动物理分支）。 */
export interface LineageOps {
  fork: (nodeId: string) => void;
  edit: (nodeId: string, newText: string) => void;
  rewrite: (nodeId: string, granularity: "line" | "beat", instruction?: string) => void;
  oocAt: (nodeId: string, text: string) => void;
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
    <PanelShell {...props} title="剧本" hint="点任意一行，就地编辑或从这里重演">
      {rows.length === 0 && <p className="muted">还没有台词——先在舞台上演出几拍。</p>}
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

/**
 * 路线：一棵从左往右读时间的树。x = 时间（树深度），兄弟往下扇开，点节点只读回看。
 * 画布占满整页，导航与镜头浮在它上面——树要始终是一棵树，不该被两条横条挤成一条缝。
 * 导演操作放在底部检视栏，不占树上的位置。
 */
export function RouteTree(
  props: PanelProps & { lines: readonly ScriptLine[]; onRewind: (lineKey: string) => void },
) {
  const { view, lines, names, busy, ops, onRewind } = props;
  const cards = useMemo(() => (view ? buildBeats(view, lines) : []), [view, lines]);
  const lineOf = useMemo(() => rewindTargets(cards, lines), [cards, lines]);
  const [active, setActive] = useState<string | null>(null);
  const card = cards.find((c) => c.id === active) ?? null;

  return (
    <div className="route-screen">
      {props.error && <div className="error-banner">{props.error}</div>}
      {!props.view ? (
        <div className="route-blank">
          <BackFloat onBack={props.onBack} />
          <div className="overlay">读取路线…</div>
        </div>
      ) : cards.length === 0 ? (
        <div className="route-blank">
          <BackFloat onBack={props.onBack} />
          <p className="muted route-empty">还没有历史——演出几拍后这里会长出路线树。</p>
        </div>
      ) : (
        <>
          <RouteCanvas
            cards={cards}
            names={names}
            activeId={active}
            onSelect={(next) => setActive((cur) => (cur === next.id ? null : next.id))}
            onBack={props.onBack}
          />
          {card && (
            <div className="route-inspector">
              <div className="route-inspector-head">
                {card.sceneBg && <span className="muted">◈ {card.sceneBg}</span>}
                <span className="muted route-inspector-text">{card.preview || "（无台词）"}</span>
                <button className="ghost-btn" onClick={() => setActive(null)}>
                  收起
                </button>
              </div>
              <BeatActions
                card={card}
                busy={busy}
                ops={ops}
                lineKey={lineOf.get(card.id)}
                onRewind={onRewind}
              />
            </div>
          )}
        </>
      )}
    </div>
  );
}

/** 空态/加载态下画布不在，退回键就浮在空态上，路线页永远回得去。 */
function BackFloat({ onBack }: { onBack: () => void }) {
  return (
    <button className="ghost-btn icon-btn route-float" onClick={onBack} title="回舞台">
      <Icon name="back" />
    </button>
  );
}

/** 活动路径的卡片 → 舞台行 key（拍首行），废弃分支的行已不在缓冲里，没有可回看的目标。 */
function rewindTargets(cards: BeatCard[], lines: readonly ScriptLine[]): Map<string, string> {
  const map = new Map<string, string>();
  for (const [card, line] of beatAnchors(cards, lines)) {
    if (line) map.set(card.id, line.key);
  }
  return map;
}

/**
 * 检视栏里的五动词。分岔只有一件事——从这一拍岔出去，不按死活分两种说法：
 * 「接回世界线」那套概念留着只会让人以为废弃分支是另一种东西。
 */
function BeatActions({
  card,
  busy,
  ops,
  lineKey,
  onRewind,
}: {
  card: BeatCard;
  busy: boolean;
  ops: LineageOps;
  lineKey?: string;
  onRewind: (lineKey: string) => void;
}) {
  const [note, setNote] = useState("");
  return (
    <div className="lineage-actions">
      {lineKey && (
        <button className="ghost-btn" onClick={() => onRewind(lineKey)}>
          <span className="btn-icon">
            <Icon name="undo" /> 跳到这里回看
          </span>
        </button>
      )}
      <button className="ghost-btn" disabled={busy} onClick={() => ops.fork(card.id)}>
        <span className="btn-icon">
          <Icon name="fork" /> 从这里岔出去
        </span>
      </button>
      <button
        className="ghost-btn"
        disabled={busy}
        onClick={() => ops.rewrite(card.id, "beat", note.trim() || undefined)}
      >
        <span className="btn-icon">
          <Icon name="rewrite" /> 重生成这一拍
        </span>
      </button>
      <span className="lineage-inline-input">
        <input
          value={note}
          placeholder="导演意图（可空）"
          onChange={(e) => setNote(e.target.value)}
        />
      </span>
      <p className="beat-tile-warn">重生成 = 从拍首分岔重演，这一拍之后的剧情会作废（历史全部保留）。</p>
    </div>
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
        {props.current && <span className="lineage-leaf" title="当前所在">●</span>}
        {row.text}
        {row.edited && <span className="lineage-edited">（已改）</span>}
      </button>
      {active && <NodeActions row={row} busy={busy} ops={ops} />}
    </div>
  );
}

/** 行内操作条：五动词正交摆在这里，组合权在用户（对照计划 D10）。 */
function NodeActions({ row, busy, ops }: { row: Row; busy: boolean; ops: LineageOps }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(row.text);
  const [note, setNote] = useState("");

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
        <button className="ghost-btn" disabled={busy} onClick={() => setEditing(true)}>
          <span className="btn-icon">
            <Icon name="pencil" /> 改写台词
          </span>
        </button>
      )}
      <button
        className="ghost-btn"
        disabled={busy}
        onClick={() => ops.rewrite(row.id, "beat", note.trim() || undefined)}
      >
        <span className="btn-icon">
          <Icon name="rewrite" /> 重写这一幕
        </span>
      </button>
      <button className="ghost-btn" disabled={busy} onClick={() => ops.fork(row.id)}>
        <span className="btn-icon">
          <Icon name="fork" /> 从此分岔
        </span>
      </button>
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
        <span className="btn-icon">
          <Icon name="ooc" /> 从此 OOC 重演
        </span>
      </button>
      {editing && (
        <span className="lineage-editor">
          <textarea
            value={draft}
            autoFocus
            rows={2}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                e.preventDefault();
                submitEdit();
              } else if (e.key === "Escape") {
                e.preventDefault();
                setEditing(false);
              }
            }}
          />
          <button className="ghost-btn" onClick={submitEdit} title="Ctrl/⌘+Enter">
            保存
          </button>
          <button className="ghost-btn" onClick={() => setEditing(false)} title="Esc">
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
          (node.instruction ?? node.attrs.instruction) ? `：${node.instruction ?? node.attrs.instruction}` : ""
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
  const type = attrs.stopType ?? attrs.type; // 老档存在 type 下
  if (type === "choice") return "◇ 等待玩家选择";
  if (type === "free") return "◇ 等待玩家回应";
  return "◇ 幕末（下一幕）";
}
