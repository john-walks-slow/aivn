import { useCallback, useEffect, useState } from "react";
import { Icon, Modal } from "@aivn/stage";
import { api, type PlayDetail, type SaveInfo } from "../api.js";
import { navigate } from "../router.jsx";
import { relativeTime } from "../ui/text.js";

/** 周目与存档管理页：卡片矩阵展示各独立故事树，支持进入、改名与删除 */
export function SavesView({ playId }: { playId: string }) {
  const [saves, setSaves] = useState<SaveInfo[] | null>(null);
  const [detail, setDetail] = useState<PlayDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [busyId, setBusyId] = useState<string | null>(null);
  const [deletingSave, setDeletingSave] = useState<SaveInfo | null>(null);

  const reload = useCallback((): void => {
    api
      .listSaves(playId)
      .then(setSaves)
      .catch((e: Error) => setError(e.message));
    api
      .playDetail(playId)
      .then(setDetail)
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

  const doDelete = (): void => {
    if (!deletingSave) return;
    const target = deletingSave;
    setDeletingSave(null);
    guard(target.id, async () => {
      await api.deleteSave(playId, target.id);
      reload();
    });
  };

  return (
    <div className="screen saves-screen">
      <header className="saves-top">
        <div className="saves-top-left">
          <button
            type="button"
            className="ghost-btn btn-compact"
            onClick={() => navigate(`/play/${playId}`)}
            title="返回标题画面"
          >
            <Icon name="back" size={14} /> 标题
          </button>
          <div className="saves-header-titles">
            <h2 className="saves-header-title">周目一览</h2>
            <span className="saves-header-sub">{detail?.play.title ?? playId}</span>
          </div>
        </div>

        <button type="button" className="primary btn-compact" disabled={busyId !== null} onClick={startNew}>
          <Icon name="plus" size={13} /> 开始新周目
        </button>
      </header>

      {/* 顶部周目指标栏 */}
      <section className="saves-metrics-bar">
        <div className="metric-tile">
          <span className="metric-tile-label">SAVES COUNT</span>
          <div className="metric-tile-val">
            <span className="metric-num">{saves?.length ?? 0}</span>
            <span className="metric-sub">个周目</span>
          </div>
        </div>

        <div className="metric-tile">
          <span className="metric-tile-label">ACTIVE SAVE</span>
          <div className="metric-tile-val">
            <span className="metric-pip is-success" />
            <span className="metric-status-text">{saves?.find((s) => s.current)?.name ?? "无"}</span>
          </div>
        </div>

        <div className="metric-tile">
          <span className="metric-tile-label">TOTAL BEATS</span>
          <div className="metric-tile-val">
            <span className="metric-num">
              {saves?.reduce((acc, s) => acc + (s.beats || 0), 0) ?? 0}
            </span>
            <span className="metric-sub">轮推进</span>
          </div>
        </div>
      </section>

      {error && (
        <div className="error-banner" role="alert">
          {error}<button type="button" className="notice-close" aria-label="收起这条" onClick={() => setError(null)}><Icon name="close" size={12} /></button>
        </div>
      )}

      <main className="saves-content">
        <div className="saves-grid">
          {saves?.map((save, i) => (
            <div key={save.id} className={`save-item-card${save.current ? " is-current" : ""}`}>
              <div className="save-card-top">
                <div className="save-title-cluster">
                  <span className="save-index-pill">#{String(i + 1).padStart(2, "0")}</span>
                  {editing === save.id ? (
                    <input
                      className="save-rename-input"
                      value={draft}
                      autoFocus
                      onChange={(e) => setDraft(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") commitRename(save);
                        if (e.key === "Escape") setEditing(null);
                      }}
                    />
                  ) : (
                    <h3 className="save-title">{save.name}</h3>
                  )}
                </div>
                <div className="save-status-badge">
                  <span className={`status-pip ${save.current ? "is-success" : "is-neutral"}`} />
                  <span>{save.current ? "进行中" : "归档"}</span>
                </div>
              </div>

              <div className="save-card-meta">
                <span>{save.beats} 轮推进</span>
                <span className="meta-sep">·</span>
                <span>{relativeTime(save.updatedAt)}</span>
              </div>

              {save.preview ? (
                <p className="save-excerpt">{save.preview}</p>
              ) : (
                <p className="save-excerpt is-empty">（暂无剧情文本摘要）</p>
              )}

              <div className="save-card-actions">
                {editing === save.id ? (
                  <>
                    <button type="button" className="primary btn-compact" onClick={() => commitRename(save)}>
                      保存
                    </button>
                    <button type="button" className="ghost-btn btn-compact" onClick={() => setEditing(null)}>
                      取消
                    </button>
                  </>
                ) : (
                  <>
                    <button
                      type="button"
                      className="ghost-btn btn-compact"
                      disabled={busyId !== null}
                      onClick={() => {
                        setEditing(save.id);
                        setDraft(save.name);
                      }}
                      title="重命名周目"
                    >
                      改名
                    </button>
                    <button
                      type="button"
                      className="ghost-btn btn-compact danger-text"
                      disabled={busyId !== null}
                      onClick={() => setDeletingSave(save)}
                      title="删除该周目存档"
                    >
                      删除
                    </button>
                    <button
                      type="button"
                      className={`btn-compact ${save.current ? "primary" : "ghost-btn"}`}
                      disabled={busyId !== null}
                      onClick={() => enter(save)}
                    >
                      {save.current ? "回到舞台 →" : "进入周目 →"}
                    </button>
                  </>
                )}
              </div>
            </div>
          ))}
        </div>

        {saves?.length === 0 && (
          <div className="saves-empty-state">
            <p className="muted">还没有周目记录，点击右上角开始新周目。</p>
          </div>
        )}
      </main>

      {deletingSave && (
        <Modal
          title="删除周目"
          kicker={null}
          hint={<>删除周目「{deletingSave.name}」将永久移除这棵故事树的所有分支与记录，无法恢复。</>}
          width={420}
          onClose={() => setDeletingSave(null)}
          footer={
            <>
              <button type="button" onClick={() => setDeletingSave(null)}>
                取消
              </button>
              <button type="button" className="primary danger-btn" onClick={doDelete}>
                确认删除
              </button>
            </>
          }
        >
          <p className="muted small">只删本周目，剧目与其他周目不受影响。</p>
        </Modal>
      )}
    </div>
  );
}
