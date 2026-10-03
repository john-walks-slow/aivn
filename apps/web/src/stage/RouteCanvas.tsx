import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useEscape } from "../ui/escape.js";
import { Icon } from "../ui/Icon.js";
import { Modal } from "../ui/Modal.js";
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

/** 正在弹窗的那张卡：重写要交代一句，删除要先看清楚会没掉多少。 */
type Asking = { kind: "rewrite" | "remove"; card: BeatCard };

/**
 * 一张卡及其全部后代（含自己）。
 *
 * 「后代」就是删除会波及的范围——选中时照出来，玩家在动手之前就看得见代价。
 */
function subtreeOf(cards: readonly BeatCard[], rootId: string): Set<string> {
  const doomed = new Set<string>([rootId]);
  const stack = [rootId];
  while (stack.length > 0) {
    const id = stack.pop()!;
    for (const card of cards) {
      if (card.parentId !== id || doomed.has(card.id)) continue;
      doomed.add(card.id);
      stack.push(card.id);
    }
  }
  return doomed;
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
  /** 选中的卡：读树时「这条枝通到哪、删掉会没掉多少」的落点。 */
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [asking, setAsking] = useState<Asking | null>(null);
  const [draft, setDraft] = useState("");
  // 布局必须 memo：placed 的对象身份是下面那条「把手柄交给外层」effect 的地基。
  // 每次渲染都重排一次 → focusCard/jumpToLatest/controls 全换身份 → effect 重跑
  // → 外层 setRouteControls 收到新对象再渲染一圈，闭成 Maximum update depth exceeded。
  const layout = useMemo(() => layoutRoute(cards, dir), [cards, dir]);
  const { placed, edges, width, height } = layout;

  // 选中关系：祖先链（这一段从哪儿来）+ 子树（删掉会没掉哪些）。
  const relation = useMemo(() => {
    const selected = selectedId ? cards.find((card) => card.id === selectedId) : undefined;
    if (!selected) return null;
    const byId = new Map(cards.map((card) => [card.id, card]));
    const kin = new Set<string>();
    let cursor = selected.parentId;
    while (cursor) {
      const parent = byId.get(cursor);
      if (!parent) break;
      kin.add(parent.id);
      cursor = parent.parentId;
    }
    const doomed = subtreeOf(cards, selected.id);
    // 去路不含自己：自己那份由 selected 描边负责，两种描边叠在一张卡上读不出边界
    doomed.delete(selected.id);
    return { selectedId: selected.id, kin, path: new Set([...kin, selected.id]), doomed };
  }, [cards, selectedId]);

  // 点空白取消选中。Esc 走 useEscape 的栈：选中时它占住栈顶，这一下只清选中，
  // 不会顺带把路线视图也关掉（各挂各的 window 监听时，一次 Esc 会连关两层）。
  useEscape(() => setSelectedId(null), selectedId !== null);

  const onViewportClick = (e: React.MouseEvent): void => {
    if ((e.target as HTMLElement).closest(".route-node")) return;
    setSelectedId(null);
  };

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
  // 低于阈值就松手的那一下必须留给 click —— 卡片里的三个动词、卡面的选中和
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

  const openRewrite = useCallback((card: BeatCard) => {
    setDraft("");
    setAsking({ kind: "rewrite", card });
  }, []);
  const openRemove = useCallback((card: BeatCard) => setAsking({ kind: "remove", card }), []);

  const submitRewrite = (): void => {
    if (!asking) return;
    const instruction = draft.trim();
    setAsking(null);
    ops.rewrite(asking.card.forkFromId, {
      ...(asking.card.nodes[0] ? { replaced: asking.card.nodes[0].id } : {}),
      ...(instruction ? { instruction } : {}),
    });
  };

  const confirmRemove = (): void => {
    if (!asking) return;
    const nodeId = asking.card.nodes[0]?.id;
    setAsking(null);
    if (nodeId) ops.remove(nodeId);
  };

  // 删除的代价：改动的这一张卡、以及它之后长出来的全部内容。说清「几轮 / 几个节点」，
  // 光说「以及它之后的所有内容」玩家判断不了值不值。
  const cost = useMemo(() => {
    if (asking?.kind !== "remove") return null;
    const doomed = subtreeOf(cards, asking.card.id);
    const nodes = cards
      .filter((card) => doomed.has(card.id))
      .reduce((sum, card) => sum + card.nodes.length, 0);
    return { rounds: doomed.size, nodes };
  }, [asking, cards]);

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
        onClick={onViewportClick}
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
                className={[
                  "route-edge",
                  edge.live ? "live" : "",
                  edge.dead ? "dead" : "",
                  edge.fork ? "fork" : "",
                  relation && relation.path.has(edge.from) && relation.path.has(edge.to) ? "kin" : "",
                  relation && relation.doomed.has(edge.to) ? "doomed" : "",
                ]
                  .filter(Boolean)
                  .join(" ")}
              />
            ))}
            {placed.map((p) =>
              p.card.onPath ? (
                <circle
                  key={`dot-${p.card.id}`}
                  cx={dir === "horizontal" ? p.x : p.x + NODE_W / 2}
                  cy={dir === "horizontal" ? p.y + NODE_H / 2 : p.y}
                  r={3.5}
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
              selected={relation?.selectedId === p.card.id}
              kin={relation?.kin.has(p.card.id) ?? false}
              doomed={relation?.doomed.has(p.card.id) ?? false}
              onSelect={setSelectedId}
              onRewrite={openRewrite}
              onRemove={openRemove}
            />
          ))}
        </div>
      </div>

      {asking?.kind === "rewrite" && (
        <Modal
          title="重写这一段"
          hint="退到这一段之前，让剧作家重新写一遍这一段；原有内容整段留作旧枝。可以交代一句要求，留空就是纯重写。"
          onClose={() => setAsking(null)}
          footer={
            <>
              <button type="button" className="primary" onClick={submitRewrite}>
                重写
              </button>
              <button type="button" className="ghost-btn" onClick={() => setAsking(null)}>
                取消
              </button>
            </>
          }
        >
          <input
            className="route-modal-input"
            value={draft}
            placeholder="（可留空）例如：让她的反应更冷淡一点"
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") submitRewrite();
            }}
          />
        </Modal>
      )}

      {asking?.kind === "remove" && cost && (
        <Modal
          title="删除这一段"
          hint="删除不能撤销：谱系里不留墓碑，这一段说过的话就此消失。"
          onClose={() => setAsking(null)}
          footer={
            <>
              <button type="button" className="ghost-btn danger-btn" onClick={confirmRemove}>
                删除
              </button>
              <button type="button" className="ghost-btn" onClick={() => setAsking(null)}>
                取消
              </button>
            </>
          }
        >
          <p className="route-modal-note">
            将删除 <b>{cost.rounds}</b> 轮 / <b>{cost.nodes}</b> 个节点：这一段，以及它之后长出来的全部内容。
          </p>
        </Modal>
      )}
    </div>
  );
}

/**
 * 一张卡 = 这一轮：左上角落笔时刻、正文、左下角是谁说的，三个动词（跳转 / 重写 / 删除）长在卡里的右下角。
 *
 * 点卡片即选中：选中时把这一段的来路（祖先链）与去路（它和它的全部后代）一起照出来——
 * 后者正是「删除会没掉多少」。没有检视栏：想对哪一段动手指，就在那一段自己的卡上动手。
 *
 * 三个动词的语义全写在 title 里（卡面只此一处解释），差别只在「生不生成」：
 * 跳转 = 回到这一段开头重演一遍，不重新生成；重写 = 退到这一段之前让剧作家重新写；
 * 删除 = 连这一段带它后面的全部剪掉。
 */
function Node({
  placed,
  names,
  index,
  ops,
  busy,
  selected,
  kin,
  doomed,
  onSelect,
  onRewrite,
  onRemove,
}: {
  placed: PlacedCard;
  names: Readonly<Record<string, string>>;
  index: AssetIndex | null;
  ops: LineageOps;
  busy: boolean;
  selected: boolean;
  kin: boolean;
  doomed: boolean;
  onSelect: (id: string) => void;
  onRewrite: (card: BeatCard) => void;
  onRemove: (card: BeatCard) => void;
}) {
  const { card } = placed;
  const cls = [
    "route-node",
    card.isAbandoned ? "dead" : "",
    card.onPath ? "live" : "",
    card.isLeaf ? "here" : "",
    kin ? "kin" : "",
    doomed ? "doomed" : "",
    selected ? "selected" : "",
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
    <div
      className={cls}
      style={{ left: placed.x, top: placed.y, width: NODE_W, height: NODE_H }}
      onClick={() => onSelect(card.id)}
    >
      {bg && <img className="route-node-bg" src={bg} alt="" aria-hidden />}
      <span className="route-node-head">
        <span className="route-node-stamp">{stamp(card.at)}</span>
        <span className="route-node-who">{who}</span>
      </span>
      <span className="route-node-text">{text}</span>
      <span className="route-node-foot">
        <span className="route-node-tools">
          <button
            type="button"
            className="route-node-tool"
            disabled={busy}
            title={hint || "跳转：回到这一段的开头，从头演一遍。不重新生成，选项照旧。"}
            onClick={() => ops.jump(card.endNodeId, { playFrom: "start" })}
          >
            <Icon name="return" />
            跳转
          </button>
          <button
            type="button"
            className="route-node-tool"
            disabled={busy}
            title={hint || "重写：退到这一段之前，让剧作家重新写一遍这一段（原有内容留作旧枝）。可以交代一句要求。"}
            onClick={() => onRewrite(card)}
          >
            <Icon name="rewrite" />
            重写
          </button>
          <button
            type="button"
            className="route-node-tool"
            disabled={busy}
            title={hint || "删除：剪掉这一段，以及它之后长出来的全部内容。会先让你确认。"}
            onClick={() => onRemove(card)}
          >
            <Icon name="remove" />
            删除
          </button>
        </span>
      </span>
    </div>
  );
}
