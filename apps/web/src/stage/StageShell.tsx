import { useCallback, useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";
import { Icon, type IconName, type StageView, VIEW_LABEL } from "@aivn/stage";

/**
 * 舞台外壳：左侧导航栏 + 右侧内容区。五个视图（舞台 / 回顾 / 路线 / CG / 工坊）共用这一套，
 * 换视图不再像换了一个产品——导航、控件风格、宽屏下的版面全都在这里定死。
 *
 * 为什么是侧栏而不是顶栏：宽屏上顶栏只能占一条横线，剩下的版面还是满屏铺开，
 * 回顾的句子在 1920px 下拉成一条线。侧栏把导航收成一条竖列，内容区就能按
 * 「可读的一栏」排版，路线画布也能把整片宽高让出来。栏宽可拖可折叠。
 *
 * 工坊曾经是盖在舞台上的右侧抽屉，另有一个自带顶栏的独立页——两套外壳并存的代价
 * 是「从标题页进工坊，顶栏整个换掉」。现在工坊是本外壳的五个视图之一：
 * 顶栏（剧目块 + 折叠键）进哪个视图都长一样，进出工坊不跳变。
 */

const WIDTH_KEY = "stage-side-width";
const OPEN_KEY = "stage-side-open";
/** 窄屏阈值：以下侧栏改成盖在内容上的抽屉，不再挤压内容区。 */
const NARROW = "(max-width: 760px)";
const MIN_W = 180;
const MAX_W = 520;
const DEFAULT_W = 232;

function readWidth(): number {
  const raw = Number(localStorage.getItem(WIDTH_KEY));
  return Number.isFinite(raw) && raw >= MIN_W && raw <= MAX_W ? raw : DEFAULT_W;
}

export interface StageShellProps {
  view: StageView;
  onView: (view: StageView) => void;
  /** 退出这场戏（回封面）。侧栏里唯一的出口，不另配「关闭」键。 */
  onExit: () => void;
  title: string;
  saveName: string | null;
  onSaves: () => void;
  /** 当前视图自己的工具（回顾的视图切换、路线的镜头控制）。没有就不留这一段。 */
  tools?: ReactNode;
  children: ReactNode;
}

const NAV: { id: StageView; label: string; icon: IconName }[] = [
  { id: "stage", label: "舞台", icon: "play" },
  { id: "backlog", label: "回顾", icon: "backlog" },
  { id: "route", label: "路线", icon: "fork" },
  { id: "cg", label: "CG", icon: "assets" },
  { id: "workshop", label: "工坊", icon: "workshop" },
];

export function StageShell(props: StageShellProps) {
  const { view, onView, onExit, children } = props;
  const [width, setWidth] = useState(readWidth);
  const [open, setOpen] = useState(() => localStorage.getItem(OPEN_KEY) !== "0");
  const [narrow, setNarrow] = useState(() => window.matchMedia(NARROW).matches);
  const sideRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    const mq = window.matchMedia(NARROW);
    const sync = (): void => setNarrow(mq.matches);
    mq.addEventListener("change", sync);
    return () => mq.removeEventListener("change", sync);
  }, []);

  // 宽屏才谈得上折叠：窄屏下它是抽屉，「关着」就是不在内容上盖东西
  useEffect(() => {
    if (!narrow) return;
    setOpen(false);
  }, [narrow]);

  const setOpenAndRemember = useCallback((next: boolean) => {
    setOpen(next);
    localStorage.setItem(OPEN_KEY, next ? "1" : "0");
  }, []);

  // 拖右边缘改栏宽。指针捕获挂在分隔条上，别让内容区的点击跟着跑。
  const dragRef = useRef<{ x: number; w: number } | null>(null);
  const onResizeDown = (e: React.PointerEvent): void => {
    dragRef.current = { x: e.clientX, w: width };
    e.currentTarget.setPointerCapture(e.pointerId);
  };
  const onResizeMove = (e: React.PointerEvent): void => {
    const drag = dragRef.current;
    if (!drag) return;
    const next = Math.min(MAX_W, Math.max(MIN_W, drag.w + (e.clientX - drag.x)));
    setWidth(next);
  };
  const endResize = (): void => {
    if (!dragRef.current) return;
    dragRef.current = null;
    localStorage.setItem(WIDTH_KEY, String(width));
  };

  // 收起时侧栏只剩图标一条，读不出「这是哪」——补一个 title 就够
  const cls = [
    "stage-shell",
    open ? "side-open" : "side-closed",
    narrow ? "side-narrow" : "",
  ]
    .filter(Boolean)
    .join(" ");

  // H 键折叠/展开侧栏（沉浸模式）。舞台自己不再监听这个键——键位归外壳统一管。
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const t = e.target;
      if (
        t instanceof HTMLElement &&
        (t.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(t.tagName))
      ) {
        return;
      }
      if (e.key !== "h" && e.key !== "H") return;
      setOpenAndRemember(!open);
      e.preventDefault();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, setOpenAndRemember]);

  return (
    <div className={cls} style={{ "--side-w": `${width}px` } as React.CSSProperties}>
      {narrow && open && <div className="side-scrim" onClick={() => setOpenAndRemember(false)} />}

      <aside className="stage-side" ref={sideRef} aria-label="剧目导航">
        <header className="stage-side-head">
          <span className="side-title">{props.title}</span>
          <button
            type="button"
            className="side-collapse"
            onClick={() => setOpenAndRemember(!open)}
            title={open ? "收起侧栏" : "展开侧栏"}
            aria-expanded={open}
            aria-label={open ? "收起侧栏" : "展开侧栏"}
          >
            <Icon name={open ? "shrink" : "unshrink"} size={17} />
          </button>
        </header>

        <nav className="stage-side-nav">
          {NAV.map((item) => (
            <button
              key={item.id}
              type="button"
              className={`side-nav-btn${view === item.id ? " active" : ""}`}
              onClick={() => {
                onView(item.id);
                if (narrow) setOpenAndRemember(false);
              }}
              aria-current={view === item.id ? "page" : undefined}
            >
              <Icon name={item.icon} size={16} />
              <span className="side-label">{item.label}</span>
            </button>
          ))}
        </nav>

        {props.tools && <div className="stage-side-tools">{props.tools}</div>}

        {/* 底栏：这场戏自己的两件事——当前周目、退出。出口不是视图，
            放在导航里读起来像第六个视图，钉在最底下才对。 */}
        <footer className="stage-side-foot">
          {props.saveName && (
            <button
              type="button"
              className="side-foot-btn"
              onClick={props.onSaves}
              title="切换周目"
            >
              <Icon name="files" size={16} />
              <span className="side-label">{props.saveName}</span>
            </button>
          )}
          <button
            type="button"
            className="side-foot-btn side-exit"
            onClick={onExit}
            title={`退出这场戏，回到封面（${props.title}）`}
          >
            <Icon name="exit" size={16} />
            <span className="side-label">退出</span>
          </button>
        </footer>

        {!narrow && (
          <div
            className="side-resizer"
            role="separator"
            aria-orientation="vertical"
            aria-label="调整侧栏宽度"
            onPointerDown={onResizeDown}
            onPointerMove={onResizeMove}
            onPointerUp={endResize}
            onPointerCancel={endResize}
            onDoubleClick={() => {
              setWidth(DEFAULT_W);
              localStorage.setItem(WIDTH_KEY, String(DEFAULT_W));
            }}
          />
        )}
      </aside>

      <main className="stage-main">
        {/* 窄屏抽屉关着时得有唤出它的键。舞台页浮在内容左上角（画面上不能压东西）；
            其余视图它并进视图栏、落在标题左边——那里本来就有一条横栏，再浮一个就是两层 chrome。 */}
        {narrow && !open && view === "stage" && (
          <button
            type="button"
            className="side-drawer-btn"
            onClick={() => setOpenAndRemember(true)}
            title="打开导航"
            aria-label="打开导航"
          >
            <Icon name="unshrink" size={18} />
          </button>
        )}
        {view !== "stage" && (
          <div className="view-bar">
            <div className="view-bar-lead">
              {narrow && !open && (
                <button
                  type="button"
                  className="side-drawer-btn"
                  onClick={() => setOpenAndRemember(true)}
                  title="打开导航"
                  aria-label="打开导航"
                >
                  <Icon name="unshrink" size={16} />
                </button>
              )}
              <h1 className="view-bar-title">{VIEW_LABEL[view]}</h1>
            </div>
            <button
              type="button"
              className="view-bar-close"
              onClick={() => onView("stage")}
              title="回到舞台（Esc）"
              aria-label="回到舞台"
            >
              <Icon name="close" size={15} />
            </button>
          </div>
        )}
        {children}
      </main>
    </div>
  );
}
