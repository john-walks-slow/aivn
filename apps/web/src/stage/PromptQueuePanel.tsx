import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type SyntheticEvent } from "react";
import { createPortal } from "react-dom";
import type { PendingJob, PromptQueueItem } from "@aivn/core";
import { Icon, type IconName } from "@aivn/stage";

/**
 * 每一类在生成的事给一个字形（展开面板里那几行用）：bg 与 cg 同为出图，共用一个字形。
 */
const JOB_ICON: Record<PendingJob["kind"], IconName> = {
  beat: "play",
  bg: "assets",
  cg: "assets",
  sprite: "users",
  voice: "mic",
  /** BGM 在生成：走音量字形而不是 mic——mic 已经被语音合成的「正在出声」占着。 */
  bgm: "volume",
};

/** 展开的面板与触发器之间留的缝。 */
const PANEL_GAP = 8;

/** 舞台那层「点一下就翻句 / 划一下就翻页」的热区很大，里头的控件一律把事件掐在自己这层。 */
function swallow(e: SyntheticEvent): void {
  e.stopPropagation();
}

/**
 * 有活儿可报才摆那枚指示符 + 触发器。宿主拿它决定要不要顶掉台词条底缘的 spinner——
 * 「有没有东西可报」只此一处说了算，宿主不能靠「元素非空」代替（`<X/>` 永远是个对象，
 * 里面渲染 null 时提示器仍在，spinner 就没了）。
 */
export function hasPendingWork(
  items: readonly PromptQueueItem[],
  jobs: readonly PendingJob[],
): boolean {
  return jobs.length > 0 || items.length > 0;
}

/**
 * 待注入队列 + 在生成的事。
 *
 * 演出进行中也能发话：话先落在这里，这一轮收束时才注入。行内可改可撤——
 * 改完的仍是原来那句话，注入时用的就是这一份。已注入的行留在面板里淡出，
 * 让玩家看见「这句进去了」，下一轮到来时退场。
 *
 * 失败项是第三种状态：既不跑也不退场，就挂在面板上等人看。展开看错因，
 * 收摊只能按行尾的删除键——自动清掉的失败等于没报过。
 *
 * 收起态是**一枚指示符 + 触发器**，落点按 `variant` 分两处：
 * - `dialog`（舞台）：嵌在台词条底缘那一格状态位里（宿主经 StageTheater 的
 *   `dialogStatus` 槽位塞进去）。那格本来画 spinner「剧作家正在写」，而这枚
 *   自己就在报在忙什么——同一件事不摆两遍，占了 spinner 的槽位。
 * - `dock`（工坊）：贴内容区底部一条。工坊右上角是各页自己的头（素材页那排
 *   「生成新立绘」就在那儿），浮层会压住真按得着的东西。
 *
 * 展开态是一块压在画面上的浮层。`dialog` 那份走 portal + `position: fixed`：
 * 台词条在窄屏是 `overflow-y: auto` 的滚动区，留在里面会被裁掉；而且台词条
 * 自成一层层叠上下文（z-index 12），留在里面也压不过舞台顶部那几条 chrome。
 */
export function PromptQueuePanel({
  items,
  jobs,
  onEdit,
  onDelete,
  onDismissJob,
  variant = "dialog",
}: {
  items: readonly PromptQueueItem[];
  /** 正在生成的事（剧作家的轮次 / 背景 / CG / 立绘 / 语音）；空数组 = 这会儿没在生成。 */
  jobs: readonly PendingJob[];
  onEdit: (id: string, text: string) => void;
  onDelete: (id: string) => void;
  /** 手动清掉一条失败项（失败项不自动消失，只走这条路）。 */
  onDismissJob: (jobId: string) => void;
  /** 收起态落在哪儿：`dialog` = 台词条底缘那一格状态位（舞台），`dock` = 内容区底部一条（工坊）。 */
  variant?: "dialog" | "dock";
}) {
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  /** 展开了哪一条的详情（失败项展开错因，生图展开提示词）。 */
  const [showDetail, setShowDetail] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());
  /** 触发器在视口里的位置：展开的面板据此锚在它正上方（见下面那段 useLayoutEffect）。 */
  const [anchor, setAnchor] = useState<{ x: number; y: number } | null>(null);
  const chipRef = useRef<HTMLButtonElement | null>(null);

  // 「等了多久」得自己走：这一列是玩家判断还要等多久的唯一依据，静止的数字等于没有。
  useEffect(() => {
    if (jobs.length === 0) return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [jobs.length]);

  // 换了戏就收摊：编辑中的那一行多半已经不在队列里了。
  useEffect(() => {
    if (editing !== null && !items.some((i) => i.id === editing && i.status === "pending")) {
      setEditing(null);
    }
  }, [editing, items]);

  // 展开时量一次触发器的位置。台词条的长短随台词变（--dialog-h 也在动），窄屏还能
  // 内部滚动，所以量的时机不止「刚打开」——resize 与任何一层滚动都重量。
  useLayoutEffect(() => {
    if (!open || variant !== "dialog") {
      setAnchor(null);
      return;
    }
    const place = (): void => {
      const box = chipRef.current?.getBoundingClientRect();
      if (!box) return;
      const x = box.left;
      const y = window.innerHeight - box.top + PANEL_GAP;
      // 滚动是高频事件，位置没动就别再写一次 state（每次写都是一轮重渲染）
      setAnchor((prev) => (prev && prev.x === x && prev.y === y ? prev : { x, y }));
    };
    place();
    window.addEventListener("resize", place);
    window.addEventListener("scroll", place, true);
    return () => {
      window.removeEventListener("resize", place);
      window.removeEventListener("scroll", place, true);
    };
  }, [open, variant]);

  const waiting = items.filter((item) => item.status === "pending");
  const rows = jobs;
  const dock = variant === "dock";

  if (!hasPendingWork(items, jobs)) return null;

  const failed = jobs.some((job) => job.state === "failed");
  const running = jobs.filter((job) => job.state === "running");
  const dot = failed ? "is-failed" : running.length > 0 ? "is-running" : "";
  const chip = (
    <button
      ref={chipRef}
      type="button"
      className={`prompt-queue-badge${failed ? " failed" : ""}${dock ? " prompt-queue-docked" : ""}`}
      aria-expanded={open}
      onClick={(e) => {
        // 台词条整条是「点一下翻句」的热区：开面板不能顺带把那句翻过去。
        e.stopPropagation();
        setOpen(!open);
      }}
      onTouchStart={swallow}
      onTouchEnd={swallow}
      title={
        failed
          ? "有生成项失败了，点击展开详情"
          : open
            ? "收起生成队列与待注入列表"
            : "点击展开生成队列与待注入列表"
      }
    >
      <span className={`status-indicator-dot${dot ? ` ${dot}` : ""}`} />
      <span className="prompt-queue-text">{collapsedSummary(jobs, waiting.length)}</span>
      <Icon name={open ? "up" : "down"} size={12} />
    </button>
  );

  const commit = (): void => {
    const text = draft.trim();
    if (text && editing !== null) onEdit(editing, text);
    setEditing(null);
  };

  const panel = (
    <aside
      className={`prompt-queue${dock ? " prompt-queue-docked" : " is-anchored"}`}
      aria-label="正在生成的与待注入的话"
      // portal 只换了 DOM 的落点，React 事件照旧沿逻辑树冒泡到 `.theater` 的
      // onStageClick / onTouchEnd——面板里的收起、改、删、翻详情都会顺带把那句翻过去。
      // 在根上一次性掐掉，比在每个键上各写一遍可靠。
      onClick={swallow}
      onTouchStart={swallow}
      onTouchEnd={swallow}
      style={
        dock || !anchor
          ? undefined
          : ({
              "--chip-x": `${anchor.x}px`,
              "--chip-y": `${anchor.y}px`,
            } as CSSProperties)
      }
    >
      {rows.length > 0 && (
        <>
          <p className="prompt-queue-head">
            <span>{headLabel(jobs)}</span>
            <button
              type="button"
              className="prompt-queue-tool"
              title="收起"
              onClick={() => setOpen(false)}
            >
              <Icon name="up" />
            </button>
          </p>
          <ul>
            {rows.map((job) => (
              <PendingJobRow
                key={job.id}
                job={job}
                now={now}
                expanded={showDetail === job.id}
                onToggle={() => setShowDetail(showDetail === job.id ? null : job.id)}
                onDismiss={() => onDismissJob(job.id)}
              />
            ))}
          </ul>
        </>
      )}
      {items.length === 0 ? null : (
        <>
      <p className="prompt-queue-title">接下来要说的话</p>
      <ul>
        {items.map((item) => (
          <li key={item.id} className={`prompt-queue-row ${item.status}`}>
            {editing === item.id ? (
              <>
                <input
                  value={draft}
                  autoFocus
                  onChange={(e) => setDraft(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") commit();
                    if (e.key === "Escape") setEditing(null);
                  }}
                />
                <button type="button" disabled={draft.trim() === ""} onClick={commit}>
                  存
                </button>
                <button type="button" className="ghost-btn" onClick={() => setEditing(null)}>
                  撤
                </button>
              </>
            ) : (
              <>
                <span className="prompt-queue-text">{item.text}</span>
                <span className="prompt-queue-meta">
                  {item.status === "pending" ? `第 ${item.beatNo + 1} 轮` : `已进第 ${item.sentBeatNo} 轮`}
                </span>
                {item.status === "pending" && (
                  <>
                    <button
                      type="button"
                      className="prompt-queue-tool"
                      title="改这一句"
                      onClick={() => {
                        setEditing(item.id);
                        setDraft(item.text);
                      }}
                    >
                      <Icon name="pencil" />
                    </button>
                    <button
                      type="button"
                      className="prompt-queue-tool"
                      title="不说了"
                      onClick={() => onDelete(item.id)}
                    >
                      <Icon name="close" />
                    </button>
                  </>
                )}
              </>
            )}
          </li>
        ))}
      </ul>
        </>
      )}
    </aside>
  );

  // 工坊那一条就长在内容流里：收起与展开是同一格位置的两种形态，展开时把收起的那枚换掉。
  if (dock) return open ? panel : chip;

  // 舞台那份：触发器留在台词条底缘（面板量位置靠它，展开时也不该跳走），面板挂到 body 上——
  // 只为跳出台词条的滚动区（窄屏 overflow-y: auto 会把它裁掉）与它自成的层叠上下文。
  return (
    <>
      {chip}
      {open && createPortal(panel, document.body)}
    </>
  );
}

/** 「等了 40 秒」：到分钟换算写法，其余按秒取整。 */
function elapsed(startedAt: number, now: number): string {
  const sec = Math.max(0, Math.round((now - startedAt) / 1000));
  if (sec < 60) return `${sec} 秒`;
  const min = Math.floor(sec / 60);
  return `${min} 分 ${sec % 60} 秒`;
}

/**
 * 收起成徽标时那行字：出事了先报出事，没出事报在忙哪一类（多于一件补个计数），
 * 什么都没在生成才轮到待注入的几条。
 */
function collapsedSummary(jobs: readonly PendingJob[], waitingCount: number): string {
  const failed = jobs.filter((job) => job.state === "failed").length;
  if (failed > 0) return `${failed} 项失败`;
  const running = jobs.filter((job) => job.state === "running");
  const first = running[0];
  if (first) {
    const name = KIND_NAME[first.kind] ?? "任务执行中";
    return running.length > 1 ? `${name} (${running.length})` : name;
  }
  if (waitingCount > 0) return `${waitingCount} 条提示待注入`;
  return `已就绪 (${jobs.length + waitingCount})`;
}

const KIND_NAME: Partial<Record<PendingJob["kind"], string>> = {
  beat: "剧作家创作中",
  bg: "背景生成中",
  cg: "插图生成中",
  sprite: "立绘生成中",
  voice: "语音合成中",
  bgm: "配乐生成中",
};

/**
 * 面板顶上那行：在跑的说在跑，挂了的说挂了几条，两样都没发生才叫「刚刚完成」。
 * 失败项常驻不消，所以这一行的价值就是随时报出还剩几条没人收拾的。
 */
function headLabel(jobs: readonly PendingJob[]): string {
  const parts: string[] = [];
  if (jobs.some((job) => job.state === "running")) parts.push("正在生成");
  const failed = jobs.filter((job) => job.state === "failed").length;
  if (failed > 0) parts.push(`${failed} 项失败`);
  return parts.length > 0 ? parts.join(" · ") : "刚刚完成";
}

/**
 * 「在生成的事」的一行。展开的那块内容按状态分：失败展开错因，生图展开提示词。
 * 失败行多一把删除键——它是唯一能让这一行退场的动作。
 */
function PendingJobRow({
  job,
  now,
  expanded,
  onToggle,
  onDismiss,
}: {
  job: PendingJob;
  now: number;
  expanded: boolean;
  onToggle: () => void;
  onDismiss: () => void;
}) {
  const failed = job.state === "failed";
  // 错因总在，生图提示词未必在；失败行即便没有 prompt 也要有展开键（展开的是 error）
  const detail = failed ? (job.error ?? "（没留下原因）") : job.prompt;
  return (
    <li className={`prompt-queue-row pending-job ${job.state}`}>
      <Icon name={failed ? "alert" : JOB_ICON[job.kind]} />
      <span className="prompt-queue-text">{job.label}</span>
      <span className="prompt-queue-meta">
        {job.state === "running" ? elapsed(job.startedAt, now) : failed ? "失败" : "已完成"}
      </span>
      {detail && (
        <button
          type="button"
          className="prompt-queue-tool"
          title={expanded ? "收起" : failed ? "看失败原因" : "看提示词"}
          onClick={onToggle}
        >
          <Icon name={expanded ? "close" : "zoomIn"} />
        </button>
      )}
      {failed && (
        <button
          type="button"
          className="prompt-queue-tool"
          title="清掉这条"
          onClick={onDismiss}
        >
          <Icon name="close" />
        </button>
      )}
      {expanded && detail && (
        <p className={`pending-job-prompt${failed ? " failed" : ""}`}>{detail}</p>
      )}
    </li>
  );
}
