import { useCallback, useEffect, useMemo, useState } from "react";
import type { LineageView } from "@aivn/core";
import { api } from "../api.js";
import type { AssetIndex } from "./assets.js";
import { buildBeats } from "./beats.js";
import { RouteCanvas, type RouteControls } from "./RouteCanvas.js";
import type { ScriptLine } from "./script.js";

/**
 * 路线卡上的三个动词——这就是树上能做的全部世界线写操作。
 * 插一句 / 改台词在对话框底部的导演栏（锚点由当前行 seq 反查）；剧本视图已删——
 * 逐行铺开的那份视图不值得再维护一份渲染。
 */
export interface LineageOps {
  /**
   * 跳转：世界线挂到该节点，**不生成内容**。`playFrom: "start"` = 回到这一段的开头
   * 从头演一遍（卡片上的「跳转」）；`"end"` = 直接落到末尾，选项立刻可见（默认）。
   */
  jump: (nodeId: string, opts?: { playFrom?: "start" | "end" }) => void;
  /**
   * 重写：退到这一段之前，让剧作家**重新生成**这一段（原有内容整段留作旧枝）。
   *
   * `replaced` 是被顶掉的那一拍的首节点（卡片自己知道），新的 fork 标记继承它的来源标签；
   * `instruction` 是可选的一句交代，留空就是纯重写——填了的话它排在重写那一轮开跑之后，
   * 生效于下一次开口（与舞台导演栏的「重写」同一条路）。
   */
  rewrite: (forkFromId: string, opts?: { replaced?: string; instruction?: string }) => void;
  /** 删除：剪掉这一段及其全部后代。确认弹窗在卡片那一层（见 RouteCanvas）。 */
  remove: (nodeId: string) => void;
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
