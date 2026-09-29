import { useEffect, useState } from "react";
import type { PromptQueueItem } from "@stage-ai/core";
import { Icon } from "../ui/Icon.js";

/**
 * 待注入队列（右上角独立浮层）。
 *
 * 演出进行中也能发话：话先落在这里，这一拍收束时才注入。行内可改可撤——
 * 改完的仍是原来那句话，注入时用的就是这一份。已注入的行留在面板里淡出，
 * 让玩家看见「这句进去了」，下一拍到来时退场。
 */
export function PromptQueuePanel({
  items,
  onEdit,
  onDelete,
}: {
  items: readonly PromptQueueItem[];
  onEdit: (id: string, text: string) => void;
  onDelete: (id: string) => void;
}) {
  const [editing, setEditing] = useState<string | null>(null);
  const [draft, setDraft] = useState("");

  // 换了戏就收摊：编辑中的那一行多半已经不在队列里了。
  useEffect(() => {
    if (editing !== null && !items.some((i) => i.id === editing && i.status === "pending")) {
      setEditing(null);
    }
  }, [editing, items]);

  if (items.length === 0) return null;

  const commit = (): void => {
    const text = draft.trim();
    if (text && editing !== null) onEdit(editing, text);
    setEditing(null);
  };

  return (
    <aside className="prompt-queue" aria-label="待注入的话">
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
                  {item.status === "pending" ? `第 ${item.beatNo + 1} 拍` : `已进第 ${item.sentBeatNo} 拍`}
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
    </aside>
  );
}
