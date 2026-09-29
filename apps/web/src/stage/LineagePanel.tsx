import { useCallback, useEffect, useMemo, useState } from "react";
import type { LineageView } from "@stage-ai/core";
import { api } from "../api.js";
import { beatAnchors, buildBeats, type BeatCard } from "./beats.js";
import { Icon } from "../ui/Icon.js";
import { RouteCanvas } from "./RouteCanvas.js";
import type { ScriptLine } from "./script.js";

/**
 * 路线视图只留树上才有的世界线写操作。
 * OOC / 编辑搬到了对话框底部的导演栏（锚点由当前行 seq 反查），剧本视图已删——
 * 逐行铺开的那份视图不值得再维护一份渲染。
 */
export interface LineageOps {
  fork: (nodeId: string) => void;
  rewrite: (nodeId: string, granularity: "line" | "beat", instruction?: string) => void;
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

/**
 * 路线：横向时间轴的树。x = 时间（树深度），y = 兄弟序，节点间是真连线。
 * 点节点 = 只读回看（客户端本地，不动世界线）；分岔 / 重生成才是世界线写操作。
 * 导演操作放在底部检视栏，不占树上的位置——树要始终是一棵树。
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
      <header className="panel-bar">
        <span className="panel-title">路线</span>
        <span className="muted panel-note">从左到右是时间；分岔点往下扇开。点节点回看那一拍</span>
        <div className="panel-bar-actions">
          <button type="button" className="ghost-btn small-btn" onClick={props.onReload}>
            <Icon name="refresh" size={14} />
            刷新
          </button>
          <button
            type="button"
            className="ghost-btn small-btn icon-btn icon-btn-sm"
            onClick={props.onBack}
            title="关闭路线"
          >
            <Icon name="close" size={14} />
          </button>
        </div>
      </header>
      {props.error && <div className="error-banner">{props.error}</div>}
      {!props.view ? (
        <div className="overlay">读取路线…</div>
      ) : cards.length === 0 ? (
        <p className="muted route-empty">还没有历史——玩过一阵之后，这里会长出路线树。</p>
      ) : (
        <>
          <RouteCanvas
            cards={cards}
            names={names}
            activeId={active}
            onSelect={(next) => setActive((cur) => (cur === next.id ? null : next.id))}
          />
          {card && (
            <div className="route-inspector">
              <div className="route-inspector-head">
                <span className="route-inspector-no">第 {card.turn} 拍</span>
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
                canRewind={card.onPath}
                lineKey={lineOf.get(card)}
                onRewind={onRewind}
              />
            </div>
          )}
        </>
      )}
    </div>
  );
}

/** 活动路径的卡片 → 舞台行 key（拍首行），废弃分支的行已不在缓冲里，没有可回看的目标。 */
function rewindTargets(cards: BeatCard[], lines: readonly ScriptLine[]): Map<BeatCard, string> {
  const map = new Map<BeatCard, string>();
  for (const [card, line] of beatAnchors(cards, lines)) {
    if (line) map.set(card, line.key);
  }
  return map;
}

function BeatActions({
  card,
  busy,
  ops,
  canRewind,
  lineKey,
  onRewind,
}: {
  card: BeatCard;
  busy: boolean;
  ops: LineageOps;
  canRewind: boolean;
  lineKey?: string;
  onRewind: (lineKey: string) => void;
}) {
  const [note, setNote] = useState("");
  return (
    <div className="lineage-actions">
      {lineKey && (
        <button className="ghost-btn" onClick={() => onRewind(lineKey)}>
          <Icon name="prev" />
          跳到这里回看
        </button>
      )}
      <button className="ghost-btn" disabled={busy} onClick={() => ops.fork(card.id)}>
        <Icon name="fork" />
        {canRewind ? "从这里岔出去" : "岔回去（接回世界线）"}
      </button>
      <button
        className="ghost-btn"
        disabled={busy}
        onClick={() => ops.rewrite(card.id, "beat", note.trim() || undefined)}
      >
        <Icon name="rewrite" />
        重新生成本段
      </button>
      <span className="lineage-inline-input">
        <input
          value={note}
          placeholder="导演意图（可空）"
          onChange={(e) => setNote(e.target.value)}
        />
      </span>
      <p className="beat-tile-warn">重新生成 = 从这一段的起点另开一条线重写，这一段之后的剧情会作废（历史全部保留）。</p>
    </div>
  );
}
