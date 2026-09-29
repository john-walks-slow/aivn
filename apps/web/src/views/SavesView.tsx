import { useCallback, useEffect, useState } from "react";
import { api, type SaveInfo } from "../api.js";
import { navigate } from "../router.jsx";

function stamp(ms: number): string {
  const d = new Date(ms);
  const pad = (n: number): string => String(n).padStart(2, "0");
  return `${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/**
 * 周目页：一剧目并存 N 棵独立故事树。
 * 每张卡就是一次周目——可进入、可改名、可删除；开始新周目只新建不覆盖。
 */
export function SavesView({ playId }: { playId: string }) {
  const [saves, setSaves] = useState<SaveInfo[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [busyId, setBusyId] = useState<string | null>(null);

  const reload = useCallback((): void => {
    api
      .listSaves(playId)
      .then(setSaves)
      .catch((e: Error) => setError(e.message));
  }, [playId]);
  useEffect(reload, [reload]);

  const guard = (id: string, run: () => Promise<unknown>): void => {
    setBusyId(id);
    setError(null);
    run()
      .catch((e: Error) => setError(e.message))
      .finally(() => setBusyId(null));
  };

  const enter = (save: SaveInfo): void => {
    if (busyId) return;
    if (save.current) {
      navigate(`/play/${playId}/stage`);
      return;
    }
    guard(save.id, async () => {
      await api.activateSave(playId, save.id);
      navigate(`/play/${playId}/stage`);
    });
  };

  const startNew = (): void => {
    guard("new", async () => {
      await api.createSave(playId);
      navigate(`/play/${playId}/stage`);
    });
  };

  const commitRename = (save: SaveInfo): void => {
    const name = draft.trim();
    setEditing(null);
    if (!name || name === save.name) return;
    guard(save.id, async () => {
      await api.renameSave(playId, save.id, name);
      reload();
    });
  };

  const remove = (save: SaveInfo): void => {
    if (!window.confirm(`删除周目「${save.name}」？这一整棵树将一并删除，不可恢复。`)) return;
    guard(save.id, async () => {
      await api.deleteSave(playId, save.id);
      reload();
    });
  };

  return (
    <div className="screen saves-screen">
      <header className="screen-bar">
        <button className="ghost-btn" onClick={() => navigate(`/play/${playId}`)}>
          ← 返回
        </button>
        <h2>周目</h2>
        <button className="primary" disabled={busyId !== null} onClick={startNew}>
          开始新周目
        </button>
      </header>

      {error && (
        <div className="error-banner" role="alert">
          {error}
        </div>
      )}

      <p className="muted small saves-hint">
        每个周目是一棵独立的故事树。开始新周目只新建一棵，旧的原封不动；改名只改标签，不动故事。
      </p>

      {saves === null && <p className="muted small">载入中…</p>}

      {saves?.length === 0 && <p className="muted small">还没有周目——点右上角开始第一周目。</p>}

      <div className="saves-list">
        {saves?.map((save) => (
          <div key={save.id} className={`save-card${save.current ? " current" : ""}`}>
            <div className="card-head">
              {editing === save.id ? (
                <input
                  className="save-rename"
                  value={draft}
                  autoFocus
                  onChange={(e) => setDraft(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") commitRename(save);
                    if (e.key === "Escape") setEditing(null);
                  }}
                />
              ) : (
                <span className="save-name">{save.name}</span>
              )}
              {save.current && <span className="badge ok">当前进行中</span>}
            </div>

            <p className="muted small">
              {save.beats} 拍 · {stamp(save.updatedAt)} 更新
            </p>
            {save.preview && <p className="save-preview">{save.preview}</p>}

            <div className="save-actions">
              {editing === save.id ? (
                <>
                  <button className="small-btn primary" onClick={() => commitRename(save)}>
                    保存
                  </button>
                  <button className="small-btn" onClick={() => setEditing(null)}>
                    取消
                  </button>
                </>
              ) : (
                <>
                  <button
                    className={save.current ? "" : "primary"}
                    disabled={busyId !== null}
                    onClick={() => enter(save)}
                  >
                    {save.current ? "回到舞台" : "进入"}
                  </button>
                  <button
                    className="small-btn"
                    disabled={busyId !== null}
                    onClick={() => {
                      setEditing(save.id);
                      setDraft(save.name);
                    }}
                  >
                    重命名
                  </button>
                  <button
                    className="small-btn danger-btn"
                    disabled={busyId !== null}
                    onClick={() => remove(save)}
                  >
                    删除
                  </button>
                </>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
