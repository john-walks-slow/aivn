import { useCallback, useEffect, useMemo, useState } from "react";
import type { LineageView } from "@stage-ai/core";
import { api } from "../api.js";
import type { AssetIndex } from "./assets.js";
import { buildBeats, type BeatCard } from "./beats.js";
import { Icon } from "../ui/Icon.js";
import { RouteCanvas } from "./RouteCanvas.js";
import type { ScriptLine } from "./script.js";

/**
 * 路线视图只留树上才有的世界线写操作。
 * OOC / 编辑搬到了对话框底部的导演栏（锚点由当前行 seq 反查），剧本视图已删——
 * 逐行铺开的那份视图不值得再维护一份渲染。
 * 跳（fork）是其中之一：世界线落到目标节点。
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
 * 路线：一棵从左往右读时间的树。x = 时间（树深度），兄弟往下扇开。点节点看详情，检视栏里「跳到这里」把世界线落到它身上。
 * 画布占满整页，导航与镜头浮在它上面——树要始终是一棵树，不该被两条横条挤成一条缝。
 * 导演操作放在底部检视栏，不占树上的位置。
 */
export function RouteTree(props: PanelProps & { index: AssetIndex | null; lines: readonly ScriptLine[] }) {
  const { view, names, busy, ops } = props;
  const cards = useMemo(() => (view ? buildBeats(view, props.lines) : []), [view, props.lines]);
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
          <p className="muted route-empty">还没有历史——玩过一阵之后，这里会长出路线树。</p>
        </div>
      ) : (
        <>
          <RouteCanvas
            cards={cards}
            names={names}
            index={props.index}
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
              <BeatActions card={card} busy={busy} ops={ops} />
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


/**
 * 检视栏里只有一个跳。跳 = 把世界线挂到这张卡上——活节点上是往前走一步，废弃节点上是
 * 回到那条走岔了的线（当前剧情随之作废）。两者是同一个操作，同一个出口，不按死活分说法。
 */
function BeatActions({ card, busy, ops }: { card: BeatCard; busy: boolean; ops: LineageOps }) {
  const [note, setNote] = useState("");
  return (
    <div className="lineage-actions">
      <button className="ghost-btn" disabled={busy} onClick={() => ops.fork(card.id)}>
        <Icon name="fork" />
        跳到这里
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
