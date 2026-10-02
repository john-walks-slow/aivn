import { useEffect, useState } from "react";
import type { PendingJob, PromptQueueItem } from "@stage-ai/core";
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
 * 默认收起：徽标只给「数字 + 在忙哪几类」，要看细节才点开。
 */
export function PromptQueuePanel({
  items,
  jobs,
  onEdit,
  onDelete,
}: {
  items: readonly PromptQueueItem[];
  /** 正在生成的事（剧作家的轮次 / 背景 / CG / 立绘 / 语音）；空数组 = 这会儿没在生成。 */
  jobs: readonly PendingJob[];
  onEdit: (id: string, text: string) => void;
  onDelete: (id: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  /** 展开了哪一条的提示词（生图才有，点一下开/合）。 */
  const [showPrompt, setShowPrompt] = useState<string | null>(null);
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
    const icons = [...new Set(jobs.map((job) => JOB_ICON[job.kind]))];
    if (waiting.length > 0) icons.push("chat");
    return (
      <button
        type="button"
        className="prompt-queue-badge"
        onClick={() => setOpen(true)}
        title="看看正在生成什么"
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
            <span>{jobs.some((job) => job.state === "running") ? "正在生成" : "刚刚完成"}</span>
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
              <li
                key={job.id}
                className={`prompt-queue-row pending-job${job.state === "done" ? " done" : ""}`}
              >
                <Icon name={JOB_ICON[job.kind]} />
                <span className="prompt-queue-text">{job.label}</span>
                <span className="prompt-queue-meta">
                  {job.state === "done" ? "已完成" : elapsed(job.startedAt, now)}
                </span>
                {job.prompt && (
                  <button
                    type="button"
                    className="prompt-queue-tool"
                    title={showPrompt === job.id ? "收起提示词" : "看提示词"}
                    onClick={() => setShowPrompt(showPrompt === job.id ? null : job.id)}
                  >
                    <Icon name={showPrompt === job.id ? "close" : "zoomIn"} />
                  </button>
                )}
                {showPrompt === job.id && job.prompt && (
                  <p className="pending-job-prompt">{job.prompt}</p>
                )}
              </li>
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