import { useCallback, useEffect, useMemo, useState } from "react";
import type { LineageView } from "@stage-ai/core";
import { api } from "../api.js";
import type { AssetIndex } from "./assets.js";
import { buildBeats } from "./beats.js";
import { Icon } from "../ui/Icon.js";
import { RouteCanvas } from "./RouteCanvas.js";
import type { ScriptLine } from "./script.js";

/**
 * 路线视图只留树上才有的世界线写操作。
 * 插一句 / 改台词 / 重来这一幕都在对话框底部的导演栏（锚点由当前行 seq 反查），剧本视图已删——
 * 逐行铺开的那份视图不值得再维护一份渲染。
 * 跳转（jump）与分岔（branch）是其中两个正交动词：前者把世界线挂到已有节点、
 * 不生成内容；后者退到该段之前重写并重新生成。
 */
export interface LineageOps {
  /** Jump: move the world line onto that node; generates nothing. */
  jump: (nodeId: string) => void;
  /**
   * Fork: open a new branch from that node. `resume: true` = continue playing right after
   * the fork (the director bar's "redo this beat" takes this path); the tree's fork button
   * takes the bare fork - it only moves the world line and leaves the next move to the player.
   */
  fork: (nodeId: string, opts?: { resume?: boolean }) => void;
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
 * 路线：一棵从左往右读时间的树。x = 时间（树深度），兄弟往下扇开。
 * 画布占满整页，导航与镜头浮在它上面——树要始终是一棵树，不该被两条横条挤成一条缝。
 * 导演动词直接长在每张卡下面，不设检视栏：想动哪一段就在那一段自己的卡上动手。
 */
export function RouteTree(props: PanelProps & { index: AssetIndex | null; lines: readonly ScriptLine[] }) {
  const { view, names, busy, ops } = props;
  const cards = useMemo(() => (view ? buildBeats(view, props.lines) : []), [view, props.lines]);

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
        <RouteCanvas
          cards={cards}
          names={names}
          index={props.index}
          ops={ops}
          busy={busy}
          onBack={props.onBack}
        />
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
