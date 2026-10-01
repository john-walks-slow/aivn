import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { Icon } from "../ui/Icon.js";
import { stamp } from "../ui/stamp.js";
import type { AssetIndex } from "./assets.js";
import type { BeatCard } from "./beats.js";
import type { LineageOps } from "./LineagePanel.js";
import { layoutRoute, NODE_H, NODE_W, type PlacedCard, type RouteDir } from "./routeTree.js";

interface CanvasProps {
  cards: readonly BeatCard[];
  ops: LineageOps;
  /** 演出进行中：结构性操作会腰斩这一轮，按钮置灰。 */
  busy: boolean;
  names: Readonly<Record<string, string>>;
  /** 素材索引：卡片的背景氛围从这儿取，取不到就是纯文字卡。 */
  index: AssetIndex | null;
  /**
   * 把镜头操作交给外层（侧栏的「工具」段）。画布本身不再浮一层按钮：
   * 导航与镜头都属于侧栏，画布只管把整片宽高让给树。
   */
  onControls: (controls: RouteControls) => void;
}

/** 侧栏「路线工具」段要用的镜头操作。 */
export interface RouteControls {
  zoomIn: () => void;
  zoomOut: () => void;
  fitAll: () => void;
  /** 送最新一拍到视野中央（世界线的叶尖）。 */
  toLatest: () => void;
  /** 回到故事的开头。 */
  toRoot: () => void;
  dir: RouteDir;
  setDir: (dir: RouteDir) => void;
  canGoLatest: boolean;
}

/** 再小也认得出字：低于这个倍数就宁可让玩家横向拖。 */
const MIN_ZOOM = 0.55;
/** 走过这么多像素才算拖动（见 onPointerDown 的注释：别把点按吃成拖动）。 */
const DRAG_SLOP = 4;

/** 镜头：位移 + 缩放。滚轮缩放、拖拽平移、「看全树」把整棵树收进视野。 */
interface Camera {
  x: number;
  y: number;
  k: number;
}

interface Drag {
  px: number;
  py: number;
  cam: Camera;
  /** 越过阈值了吗：没越过就还没抢走指针，click 还得留给卡片里的动词。 */
  armed: boolean;
}

export function RouteCanvas({ cards, ops, busy, names, index, onControls }: CanvasProps) {
  const frameRef = useRef<HTMLDivElement | null>(null);
  const dragRef = useRef<Drag | null>(null);
  /** 玩家自己动过镜头（拖/缩/看全树）吗——动过就不再自动取景抢镜头。 */
  const manual = useRef(false);
  const [camera, setCamera] = useState<Camera>({ x: 24, y: 24, k: 1 });
  /** 玩家点名要的方向；null = 跟着窗口走（宽屏横读、竖屏纵读）。 */
  const [pinned, setPinned] = useState<RouteDir | null>(null);
  const [auto, setAuto] = useState<RouteDir>("horizontal");
  const dir = pinned ?? auto;
  // 布局必须 memo：placed 的对象身份是下面那条「把手柄交给外层」effect 的地基。
  // 每次渲染都重排一次 → focusCard/jumpToLatest/controls 全换身份 → effect 重跑
  // → 外层 setRouteControls 收到新对象再渲染一圈，闭成 Maximum update depth exceeded。
  const layout = useMemo(() => layoutRoute(cards, dir), [cards, dir]);
  const { placed, edges, width, height } = layout;

  // 方向看窗口：宽屏横着读时间、竖屏从上往下。玩家点名过就不再抢。
  useEffect(() => {
    if (pinned) return;
    const sync = (): void =>
      setAuto(window.innerWidth >= window.innerHeight ? "horizontal" : "vertical");
    sync();
    window.addEventListener("resize", sync);
    window.addEventListener("orientationchange", sync);
    return () => {
      window.removeEventListener("resize", sync);
      window.removeEventListener("orientationchange", sync);
    };
  }, [pinned]);

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

  // 拖动阈值：手指/指针走过它才算拖动。
  // 低于阈值就松手的那一下必须留给 click —— 卡片里的「回到这里」「由此分岔」和
  // 侧栏浮层上的按键都在这块画布里，pointerdown 就抢走捕获会把它们的 click 一起吃掉。
  const onPointerDown = (e: React.PointerEvent): void => {
    if (e.button !== 0) return;
    dragRef.current = { px: e.clientX, py: e.clientY, cam: camera, armed: false };
  };
  const onPointerMove = (e: React.PointerEvent): void => {
    const drag = dragRef.current;
    if (!drag) return;
    if (!drag.armed) {
      if (Math.hypot(e.clientX - drag.px, e.clientY - drag.py) < DRAG_SLOP) return;
      drag.armed = true;
      manual.current = true;
      e.currentTarget.setPointerCapture(e.pointerId);
    }
    setCamera({ ...drag.cam, x: drag.cam.x + (e.clientX - drag.px), y: drag.cam.y + (e.clientY - drag.py) });
  };
  const endDrag = (): void => {
    dragRef.current = null;
  };

  // 松手可能发生在画布外（拖到窗口边缘松手、指针被系统截走），那时 pointerup
  // 不会冒到画布上。挂在 window 上收尾，否则残留的 dragRef 会让「只是路过」的
  // pointermove 继续平移画布。
  useEffect(() => {
    const release = (): void => {
      dragRef.current = null;
    };
    window.addEventListener("pointerup", release);
    window.addEventListener("pointercancel", release);
    return () => {
      window.removeEventListener("pointerup", release);
      window.removeEventListener("pointercancel", release);
    };
  }, []);

  const zoomBy = useCallback((factor: number): void => {
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
  }, []);

  /** 把某一轮送到视野中央（「跳到最新」用）。 */
  const focusCard = useCallback(
    (card: BeatCard) => {
      const target = placed.find((p) => p.card.id === card.id);
      const box = frameRef.current?.getBoundingClientRect();
      if (!target || !box) return;
      manual.current = true;
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
    focusCard(leaf);
  }, [cards, focusCard]);

  const toRoot = useCallback(() => {
    manual.current = true; // 玩家点名看开头，之后的视口变化别再抢镜头
    frameFromRoot();
  }, [frameFromRoot]);

  const zoomIn = useCallback(() => zoomBy(1.15), [zoomBy]);
  const zoomOut = useCallback(() => zoomBy(1 / 1.15), [zoomBy]);
  const setDir = useCallback((next: RouteDir) => {
    manual.current = true;
    setPinned(next);
  }, []);
  const canGoLatest = cards.some((c) => c.isLeaf);

  // 把手柄交给外层的侧栏。依赖全是稳定引用或原语值，对象身份稳定，
  // 外层 setState 拿到同一个对象就不会再触发一轮渲染。
  const controls = useMemo<RouteControls>(
    () => ({ zoomIn, zoomOut, fitAll, toLatest: jumpToLatest, toRoot, dir, setDir, canGoLatest }),
    [zoomIn, zoomOut, fitAll, jumpToLatest, toRoot, dir, setDir, canGoLatest],
  );
  useEffect(() => onControls(controls), [onControls, controls]);

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
      </div>
    </div>
  );
}

/**
 * 一张卡 = 这一轮：左上角落笔时刻、正文、左下角是谁说的，两个动词（回到这里 / 由此分岔）长在卡里的右下角。
 * 没有检视栏：想对哪一段动手指，就在那一段自己的卡上动手，不用先去点开它。
 * 回到这里 = 把世界线挂到这张卡上，不生成内容；由此分岔 = 退到这张卡之前重写并重新生成。
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
  // 画面：这一幕出过的 CG 优先于背景。CG 才是这一幕真正给玩家看的那张画，
  // 拿背景顶上来等于告诉玩家「这一幕没出过图」。
  const bg = (card.cgId ? index?.cg(card.cgId) : null) ?? index?.bg(card.sceneBg) ?? null;
  const hint = busy ? "剧作家正在写，暂时不能动这一段" : "";

  return (
    <div className={cls} style={{ left: placed.x, top: placed.y, width: NODE_W, height: NODE_H }}>
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
            title={hint || "由此分岔：世界线移到这一段并留下标记，不重新生成；它之后原有的剧情留作旧分支"}
            onClick={() => ops.fork(card.id)}
          >
            <Icon name="fork" />
            由此分岔
          </button>
        </span>
      </span>
    </div>
  );
}
