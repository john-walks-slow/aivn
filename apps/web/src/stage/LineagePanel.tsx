import { useCallback, useEffect, useMemo, useState } from "react";
import type { LineageView } from "@stage-ai/core";
import { api } from "../api.js";
import type { AssetIndex } from "./assets.js";
import { buildBeats } from "./beats.js";
import { RouteCanvas, type RouteControls } from "./RouteCanvas.js";
import type { ScriptLine } from "./script.js";

/**
 * 路线视图只留树上才有的世界线写操作。
 * 插一句 / 改台词 / 重演这一轮都在对话框底部的导演栏（锚点由当前行 seq 反查），剧本视图已删——
 * 逐行铺开的那份视图不值得再维护一份渲染。
 * 跳转（jump）与分岔（branch）是其中两个正交动词：前者把世界线挂到已有节点、
 * 不生成内容；后者退到该段之前重写并重新生成。
 */
export interface LineageOps {
  /**
   * Jump: move the world line onto that node; generates nothing.
   * `playFrom: "end"`（默认）= 落到该轮末尾，停止点/选项立刻可见；
   * `playFrom: "start"` = 播放头钉在该轮首句，从头重读一遍。
   */
  jump: (nodeId: string, opts?: { playFrom?: "start" | "end" }) => void;
  /**
   * Fork: open a new branch from that node. `resume: true` = continue playing right after
   * the fork (the director bar's "redo this beat" takes this path); the tree's fork button
   * takes the bare fork - it only moves the world line and leaves the next move to the player.
   */
  fork: (nodeId: string, opts?: { resume?: boolean }) => void;
}

/** 谱系拉取：打开视图与每次操作后刷新（树不随轮广播，避免每轮搬运全量节点）。 */
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
  ops: LineageOps;
}

/**
 * 路线：一棵从左往右读时间的树。x = 时间（树深度），兄弟往下扇开。
 * 画布只管把整片内容区让给树——导航与镜头都归外层侧栏，页面上不再浮一层按钮。
 * 导演动词直接长在每张卡下面，不设检视栏：想动哪一段就在那一段自己的卡上动手。
 */
export function RouteTree(
  props: PanelProps & {
    index: AssetIndex | null;
    lines: readonly ScriptLine[];
    onControls: (controls: RouteControls) => void;
  },
) {
  const { view, names, busy, ops } = props;
  const cards = useMemo(() => (view ? buildBeats(view, props.lines) : []), [view, props.lines]);

  return (
    <div className="route-screen">
      {props.error && <div className="error-banner">{props.error}</div>}
      {!props.view || cards.length === 0 ? (
        <div className="route-blank">
          <div className="overlay">{props.view ? "还没有剧情。演过之后这里才有可回看的分支。" : "读取路线…"}</div>
        </div>
      ) : (
        <RouteCanvas
          cards={cards}
          names={names}
          index={props.index}
          ops={ops}
          busy={busy}
          onControls={props.onControls}
        />
      )}
    </div>
  );
}
