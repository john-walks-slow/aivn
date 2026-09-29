import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { Icon } from "../ui/Icon.js";
import { stamp } from "../ui/stamp.js";
import type { AssetIndex } from "./assets.js";
import type { BeatCard } from "./beats.js";
import type { LineageOps } from "./LineagePanel.js";
import { layoutRoute, NODE_H, NODE_W, type PlacedCard, type RouteDir } from "./routeTree.js";

interface CanvasProps {
  cards: readonly BeatCard[];
  ops: LineageOps;
  /** 演出进行中：结构性操作会腰斩这一幕，按钮置灰。 */
  busy: boolean;
  onBack: () => void;
  names: Readonly<Record<string, string>>;
  /** 素材索引：卡片的背景氛围从这儿取，取不到就是纯文字卡。 */
  index: AssetIndex | null;
}

/** 再小也认得出字：低于这个倍数就宁可让玩家横向拖。 */
const MIN_ZOOM = 0.55;

/** 镜头：位移 + 缩放。滚轮缩放、拖拽平移、「看全树」把整棵树收进视野。 */
interface Camera {
  x: number;
  y: number;
  k: number;
}

export function RouteCanvas({ cards, ops, busy, onBack, names, index }: CanvasProps) {
  const frameRef = useRef<HTMLDivElement | null>(null);
  const dragRef = useRef<{ px: number; py: number; cam: Camera } | null>(null);
  /** 玩家自己动过镜头（拖/缩/看全树）吗——动过就不再自动取景抢镜头。 */
  const manual = useRef(false);
  const [camera, setCamera] = useState<Camera>({ x: 24, y: 24, k: 1 });
  const [dir, setDir] = useState<RouteDir>("horizontal");
  const layout = layoutRoute(cards, dir);
  const { placed, edges, width, height } = layout;

  // 方向看窗口：宽屏横着读时间、竖屏从上往下
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

  // 打开路线时的取景：贴着根开始读。基本塞得下就整棵塞下（差个边角就露半张卡片很难看），
  // 塞不下就只按摊开方向收，宁可超屏让人拖，也不把字缩到看不清。
  const frameFromRoot = useCallback(() => {
    const box = frameRef.current?.getBoundingClientRect();
    if (!box || width === 0 || height === 0) return;
    const along = dir === "horizontal" ? box.height : box.width;
    const extent = dir === "horizontal" ? height : width;
    const whole = Math.min((box.width - 48) / width, (box.height - 48) / height);
    const k = Math.min(1, Math.max(MIN_ZOOM, whole >= 0.85 ? whole : (along - 48) / extent));
    setCamera(
      dir === "horizontal"
        ? { k, x: 24, y: Math.max(24, (box.height - height * k) / 2) }
        : { k, x: Math.max(24, (box.width - width * k) / 2), y: 24 },
    );
  }, [width, height, dir]);

  // 「看全树」：两条轴一起收，整棵树收进视野——只在这里允许缩到看不清的倍数
  const fitAll = useCallback(() => {
    const box = frameRef.current?.getBoundingClientRect();
    if (!box || width === 0 || height === 0) return;
    manual.current = true;
    const k = Math.min(
      1,
      Math.max(MIN_ZOOM, Math.min((box.width - 48) / width, (box.height - 48) / height)),
    );
    setCamera({ k, x: (box.width - width * k) / 2, y: (box.height - height * k) / 2 });
  }, [width, height]);

  // 取景跟着视口走：转屏、缩窗口都重新取景；玩家一旦自己拖过/缩过（manual），之后就不再抢镜头。
  useLayoutEffect(() => {
    const el = frameRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => {
      if (!manual.current) frameFromRoot();
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [frameFromRoot]);

  const onWheel = useCallback((e: React.WheelEvent) => {
    e.preventDefault();
    const box = frameRef.current?.getBoundingClientRect();
    if (!box) return;
    const scale = Math.min(1.6, Math.max(MIN_ZOOM, e.deltaY > 0 ? 0.92 : 1.08));
    manual.current = true;
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
    manual.current = true;
    setCamera({ ...drag.cam, x: drag.cam.x + (e.clientX - drag.px), y: drag.cam.y + (e.clientY - drag.py) });
  };
  const endDrag = (): void => {
    dragRef.current = null;
  };

  const zoomBy = (factor: number): void => {
    const box = frameRef.current?.getBoundingClientRect();
    if (!box) return;
    manual.current = true;
    setCamera((cur) => {
      const k = Math.min(1.6, Math.max(MIN_ZOOM, cur.k * factor));
      const ratio = k / cur.k;
      const cx = box.width / 2;
      const cy = box.height / 2;
      return { k, x: cx - (cx - cur.x) * ratio, y: cy - (cy - cur.y) * ratio };
    });
  };

  /** 把某一拍送到视野中央（「跳到最新」用）。 */
  const focusCard = useCallback(
    (card: BeatCard) => {
      const target = placed.find((p) => p.card.id === card.id);
      const box = frameRef.current?.getBoundingClientRect();
      if (!target || !box) return;
      setCamera((cur) => ({
        k: cur.k,
        x: box.width / 2 - (target.x + NODE_W / 2) * cur.k,
        y: box.height / 2 - (target.y + NODE_H / 2) * cur.k,
      }));
    },
    [placed],
  );

  /** 世界线的叶尖就是现在演到哪儿，一键送过去。 */
  const jumpToLatest = useCallback(() => {
    const leaf = cards.find((c) => c.isLeaf);
    if (!leaf) return;
    manual.current = true; // 玩家点名要去那儿，之后的视口变化别再把镜头拽回根
    focusCard(leaf);
  }, [cards, focusCard]);

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
                className={`route-edge${edge.live ? " live" : ""}${edge.dead ? " dead" : ""}${edge.fork ? " fork" : ""}`}
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
              index={index}
              ops={ops}
              busy={busy}
            />
          ))}
        </div>

        {/* 画布占满整页：导航与镜头浮在它上面，不跟树抢版面 */}
        <div className="route-overlay">
          <div className="route-overlay-top">
            <button className="ghost-btn icon-btn route-float" onClick={onBack} title="回舞台">
              <Icon name="back" />
            </button>
            <span className="muted route-hint">
              {dir === "horizontal" ? "从左到右是时间" : "从上到下是时间"} · 分岔点往下扇开 · 每张卡右下角就管这一段
            </span>
          </div>
          <div className="route-overlay-bottom">
            <div className="route-zoom" title="拖拽平移 · 滚轮缩放">
              <button className="ghost-btn icon-btn" onClick={() => zoomBy(1.15)} title="放大">
                <Icon name="zoomIn" />
              </button>
              <button className="ghost-btn icon-btn" onClick={() => zoomBy(1 / 1.15)} title="缩小">
                <Icon name="zoomOut" />
              </button>
              <button className="ghost-btn icon-btn" onClick={fitAll} title="看全树">
                <Icon name="expand" />
              </button>
              <button
                className="ghost-btn icon-btn"
                onClick={jumpToLatest}
                disabled={!cards.some((c) => c.isLeaf)}
                title="跳到最新"
              >
                <Icon name="locate" />
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

/**
 * 一张卡 = 这一拍：左上角落笔时刻、正文、左下角是谁说的，两个动词（跳转 / 分岔）长在卡里的右下角。
 * 没有检视栏：想对哪一段动手指，就在那一段自己的卡上动手，不用先去点开它。
 * 跳转 = 把世界线挂到这张卡上，不生成内容；分岔 = 退到这张卡之前重写并重新生成。
 */
function Node({
  placed,
  names,
  index,
  ops,
  busy,
}: {
  placed: PlacedCard;
  names: Readonly<Record<string, string>>;
  index: AssetIndex | null;
  ops: LineageOps;
  busy: boolean;
}) {
  const { card } = placed;
  const cls = [
    "route-node",
    card.isAbandoned ? "dead" : "",
    card.onPath ? "live" : "",
    card.isLeaf ? "here" : "",
  ]
    .filter(Boolean)
    .join(" ");
  const who = card.speakers.map((id) => names[id] ?? id).join("、");
  const text = card.preview || "（无台词）";
  const bg = index?.bg(card.sceneBg) ?? null;
  const hint = busy ? "剧作家正在写，暂时不能动这一段" : "";

  return (
    <div className={cls} style={{ left: placed.x, top: placed.y, width: NODE_W, height: NODE_H }} title={text}>
      {bg && <img className="route-node-bg" src={bg} alt="" aria-hidden />}
      <span className="route-node-stamp">{stamp(card.at)}</span>
      <span className="route-node-text">{text}</span>
      <span className="route-node-foot">
        <span className="route-node-who">{who}</span>
        <span className="route-node-tools">
          <button
            type="button"
            className="route-node-tool"
            disabled={busy}
            title={hint || "回到这里：世界线落到这一段，不生成新内容"}
            onClick={() => ops.jump(card.id)}
          >
            <Icon name="return" />
            回到这里
          </button>
          <button
            type="button"
            className="route-node-tool"
            disabled={busy}
            title={hint || "从这一幕分岔：另开一条线，它之后的剧情留作旧分支"}
            onClick={() => ops.fork(card.id)}
          >
            <Icon name="fork" />
            分岔
          </button>
        </span>
      </span>
    </div>
  );
}
