import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { Icon } from "../ui/Icon.js";
import type { BeatCard } from "./beats.js";
import { layoutRoute, NODE_H, NODE_W, type PlacedCard, type RouteDir } from "./routeTree.js";

/** 停止点在节点角上的标记：选肢 / 自由表态，一眼看出这一拍是玩家拍板还是模型自己演完。 */
const STOP_MARK: Record<string, string> = { choice: "❖", free: "✎" };

interface CanvasProps {
  cards: readonly BeatCard[];
  activeId: string | null;
  onSelect: (card: BeatCard) => void;
  names: Readonly<Record<string, string>>;
}

/** 再小也认得出字：低于这个倍数就宁可让玩家横向拖。 */
const MIN_ZOOM = 0.55;

/** 镜头：位移 + 缩放。滚轮缩放、拖拽平移、「适应」把整棵树收进视野。 */
interface Camera {
  x: number;
  y: number;
  k: number;
}

export function RouteCanvas({ cards, activeId, onSelect, names }: CanvasProps) {
  const frameRef = useRef<HTMLDivElement | null>(null);
  const dragRef = useRef<{ px: number; py: number; cam: Camera } | null>(null);
  const [camera, setCamera] = useState<Camera>({ x: 24, y: 24, k: 1 });
  const [dir, setDir] = useState<RouteDir>("horizontal");
  const layout = layoutRoute(cards, dir);
  const { placed, edges, width, height } = layout;

  // 方向看窗口：宽屏横着读时间、竖屏从上往下。刻意不看容器——检视栏一弹出容器就变矮，
  // 跟着容器判会让树在点开详情的瞬间整个翻过去
  useEffect(() => {
    const sync = (): void => setDir(window.innerWidth >= window.innerHeight ? "horizontal" : "vertical");
    sync();
    window.addEventListener("resize", sync);
    window.addEventListener("orientationchange", sync);
    return () => {
      window.removeEventListener("resize", sync);
      window.removeEventListener("orientationchange", sync);
    };
  }, []);

  // 默认镜头：整棵树塞得下就全览，塞不下就贴着根读到看得清为止——从根读起是树的读法
  const fit = useCallback(() => {
    const box = frameRef.current?.getBoundingClientRect();
    if (!box || width === 0 || height === 0) return;
    const along = dir === "horizontal" ? box.height : box.width;
    const extent = dir === "horizontal" ? height : width;
    const k = Math.min(1, Math.max(MIN_ZOOM, (along - 48) / extent, 0.9));
    setCamera(
      dir === "horizontal"
        ? { k, x: 24, y: Math.max(24, (box.height - height * k) / 2) }
        : { k, x: Math.max(24, (box.width - width * k) / 2), y: 24 },
    );
  }, [width, height, dir]);

  // 树长出来时自动取景；之后玩家自己拖过就别再抢镜头
  const fitted = useRef(false);
  useLayoutEffect(() => {
    if (placed.length === 0) return;
    if (fitted.current) return;
    fitted.current = true;
    fit();
  }, [placed.length, fit]);
  useEffect(() => {
    if (placed.length > 0) fit();
  }, [dir, fit, placed.length]);

  const onWheel = useCallback((e: React.WheelEvent) => {
    e.preventDefault();
    const box = frameRef.current?.getBoundingClientRect();
    if (!box) return;
    const scale = Math.min(1.6, Math.max(MIN_ZOOM, e.deltaY > 0 ? 0.92 : 1.08));
    setCamera((cur) => {
      const k = Math.min(1.6, Math.max(MIN_ZOOM, cur.k * scale));
      const ratio = k / cur.k;
      // 以指针为中心缩放：内容跟着手走，不跳
      return {
        k,
        x: e.clientX - box.left - (e.clientX - box.left - cur.x) * ratio,
        y: e.clientY - box.top - (e.clientY - box.top - cur.y) * ratio,
      };
    });
  }, []);

  const onPointerDown = (e: React.PointerEvent): void => {
    if (e.button !== 0) return;
    dragRef.current = { px: e.clientX, py: e.clientY, cam: camera };
    e.currentTarget.setPointerCapture(e.pointerId);
  };
  const onPointerMove = (e: React.PointerEvent): void => {
    const drag = dragRef.current;
    if (!drag) return;
    setCamera({ ...drag.cam, x: drag.cam.x + (e.clientX - drag.px), y: drag.cam.y + (e.clientY - drag.py) });
  };
  const endDrag = (): void => {
    dragRef.current = null;
  };

  const zoomBy = (factor: number): void => {
    const box = frameRef.current?.getBoundingClientRect();
    if (!box) return;
    setCamera((cur) => {
      const k = Math.min(1.6, Math.max(0.35, cur.k * factor));
      const ratio = k / cur.k;
      const cx = box.width / 2;
      const cy = box.height / 2;
      return { k, x: cx - (cx - cur.x) * ratio, y: cy - (cy - cur.y) * ratio };
    });
  };

  /** 跳到某一拍并把它摆到视野中央（「定位当前」按钮与选中时用）。 */
  const focusCard = useCallback((card: BeatCard) => {
    const target = placed.find((p) => p.card.id === card.id);
    const box = frameRef.current?.getBoundingClientRect();
    if (!target || !box) return;
    setCamera((cur) => ({
      k: cur.k,
      x: box.width / 2 - (target.x + NODE_W / 2) * cur.k,
      y: box.height / 2 - (target.y + NODE_H / 2) * cur.k,
    }));
  }, [placed]);

  useEffect(() => {
    if (!activeId) return;
    const card = cards.find((c) => c.id === activeId);
    if (card?.isLeaf) focusCard(card);
  }, [activeId, cards, focusCard]);

  return (
    <div className="route-frame">
      <div
        className="route-viewport"
        ref={frameRef}
        onWheel={onWheel}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
      >
        <div
          className="route-scene"
          style={{ transform: `translate(${camera.x}px, ${camera.y}px) scale(${camera.k})` }}
        >
          <svg className="route-edges" width={width} height={height} aria-hidden>
            {edges.map((edge) => (
              <path
                key={edge.id}
                d={edge.d}
                className={`route-edge${edge.live ? " live" : ""}${edge.dead ? " dead" : ""}`}
              />
            ))}
            {placed.map((p) =>
              p.card.onPath ? (
                <circle
                  key={`dot-${p.card.id}`}
                  cx={dir === "horizontal" ? p.x : p.x + NODE_W / 2}
                  cy={dir === "horizontal" ? p.y + NODE_H / 2 : p.y}
                  r={3}
                  className="route-dot"
                />
              ) : null,
            )}
          </svg>
          {placed.map((p) => (
            <Node
              key={p.card.id}
              placed={p}
              names={names}
              active={p.card.id === activeId}
              onSelect={() => onSelect(p.card)}
            />
          ))}
        </div>
      </div>
      <div className="route-tools">
        <button className="ghost-btn icon-btn" onClick={() => zoomBy(1.15)} title="放大">
          <Icon name="zoomIn" />
        </button>
        <button className="ghost-btn icon-btn" onClick={() => zoomBy(1 / 1.15)} title="缩小">
          <Icon name="zoomOut" />
        </button>
        <button className="ghost-btn" onClick={fit} title="回到起点（塞不下时保持可读的最小缩放）">
          <span className="btn-icon">
            <Icon name="origin" /> 回到起点
          </span>
        </button>
        <button
          className="ghost-btn"
          onClick={() => {
            const leaf = cards.find((c) => c.isLeaf);
            if (leaf) {
              onSelect(leaf);
              focusCard(leaf);
            }
          }}
          disabled={!cards.some((c) => c.isLeaf)}
        >
          <span className="btn-icon">
            <Icon name="locate" /> 定位当前
          </span>
        </button>
        <span className="muted route-hint">
          {dir === "horizontal" ? "从左到右是时间" : "从上到下是时间"} · 拖拽平移 · 滚轮缩放
        </span>
      </div>
    </div>
  );
}

function Node({
  placed,
  names,
  active,
  onSelect,
}: {
  placed: PlacedCard;
  names: Readonly<Record<string, string>>;
  active: boolean;
  onSelect: () => void;
}) {
  const { card } = placed;
  const cls = [
    "route-node",
    card.isAbandoned ? "dead" : "",
    card.onPath ? "live" : "",
    card.isLeaf ? "here" : "",
    active ? "active" : "",
  ]
    .filter(Boolean)
    .join(" ");
  const who = card.speakers.map((id) => names[id] ?? id).join("、");

  return (
    <button
      className={cls}
      style={{ left: placed.x, top: placed.y, width: NODE_W, minHeight: NODE_H }}
      onClick={(e) => {
        e.stopPropagation();
        onSelect();
      }}
      title={`第 ${card.turn} 次生成${placed.label ? ` · ${placed.label}` : ""}`}
    >
      <span className="route-node-head">
        <span className="route-node-no">第 {card.turn} 拍</span>
        {placed.label && <span className="route-node-label">{placed.label}</span>}
        {card.stopType && <span className="route-node-stop">{STOP_MARK[card.stopType]}</span>}
        {card.isLeaf && <span className="route-node-here">进行中</span>}
      </span>
      <span className="route-node-text">{card.preview || "（无台词）"}</span>
      <span className="route-node-foot">
        {who && <span className="route-node-who">{who}</span>}
        {placed.branchCount > 1 && <span className="route-node-fork">⑂ {placed.branchCount} 条分支</span>}
      </span>
    </button>
  );
}
