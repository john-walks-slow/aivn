import { useEffect, useState } from "react";
import type { PendingJob, PromptQueueItem } from "@aivn/core";
import { Icon, type IconName } from "../ui/Icon.js";

/**
 * 分类图标（收起时那枚徽标用）：bg 与 cg 同为出图，共用一个字形。
 */
const JOB_ICON: Record<PendingJob["kind"], IconName> = {
  beat: "play",
  bg: "assets",
  cg: "assets",
  sprite: "users",
  voice: "mic",
};

/**
 * 待注入队列 + 在生成的事（右上角浮层，默认收起成一枚徽标）。
 *
 * 演出进行中也能发话：话先落在这里，这一轮收束时才注入。行内可改可撤——
 * 改完的仍是原来那句话，注入时用的就是这一份。已注入的行留在面板里淡出，
 * 让玩家看见「这句进去了」，下一轮到来时退场。
 *
 * 失败项是第三种状态：既不跑也不退场，就挂在面板上等人看。展开看错因，
 * 收摊只能按行尾的删除键——自动清掉的失败等于没报过。
 *
 * 默认收起：徽标只给「数字 + 在忙哪几类」，要看细节才点开。
 */
export function PromptQueuePanel({
  items,
  jobs,
  onEdit,
  onDelete,
  onDismissJob,
}: {
  items: readonly PromptQueueItem[];
  /** 正在生成的事（剧作家的轮次 / 背景 / CG / 立绘 / 语音）；空数组 = 这会儿没在生成。 */
  jobs: readonly PendingJob[];
  onEdit: (id: string, text: string) => void;
  onDelete: (id: string) => void;
  /** 手动清掉一条失败项（失败项不自动消失，只走这条路）。 */
  onDismissJob: (jobId: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  /** 展开了哪一条的详情（失败项展开错因，生图展开提示词）。 */
  const [showDetail, setShowDetail] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());

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

  const waiting = items.filter((item) => item.status === "pending");
  const rows = jobs;

  if (jobs.length === 0 && items.length === 0) return null;

  if (!open) {
    // 收起态的徽标：分类图标照旧，有失败就压一枚 alert 在最前——收起时是唯一能看出
    // 「出事了」的地方，那一行不会自己退场，徽标也不该若无其事地报个数。
    const failed = jobs.some((job) => job.state === "failed");
    const icons = [
      ...new Set(jobs.filter((job) => job.state !== "failed").map((job) => JOB_ICON[job.kind])),
    ];
    if (failed) icons.unshift("alert");
    if (waiting.length > 0) icons.push("chat");
    return (
      <button
        type="button"
        className={`prompt-queue-badge${failed ? " failed" : ""}`}
        onClick={() => setOpen(true)}
        title={failed ? "有生成项失败了，点开看" : "看看正在生成什么"}
      >
        <span className="prompt-queue-badge-icons">
          {icons.map((name) => (
            <Icon key={name} name={name} />
          ))}
        </span>
        <span>{rows.length + waiting.length}</span>
      </button>
    );
  }

  const commit = (): void => {
    const text = draft.trim();
    if (text && editing !== null) onEdit(editing, text);
    setEditing(null);
  };

  return (
    <aside className="prompt-queue" aria-label="正在生成的与待注入的话">
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
}

/** 「等了 40 秒」：到分钟换算写法，其余按秒取整。 */
function elapsed(startedAt: number, now: number): string {
  const sec = Math.max(0, Math.round((now - startedAt) / 1000));
  if (sec < 60) return `${sec} 秒`;
  const min = Math.floor(sec / 60);
  return `${min} 分 ${sec % 60} 秒`;
}

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