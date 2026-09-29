import { useEffect, useState } from "react";
import { Icon } from "../ui/Icon.js";
import { api, type PlaySummary } from "../api.js";
import { navigate } from "../router.jsx";

/** 就绪门缺项文案。 */
function missingItems(r: PlaySummary["readiness"]): string[] {
  const items: string[] = [];
  if (!r.premise) items.push("premise");
  if (!r.characterSprites) items.push("角色立绘映射");
  if (!r.background) items.push("背景图");
  return items;
}

/** 应用首页 = 剧目库：剧目卡片 + 新建 + 剧目包导入。 */
export function LibraryView() {
  const [plays, setPlays] = useState<PlaySummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [newId, setNewId] = useState("");
  const [newTitle, setNewTitle] = useState("");

  const reload = (): void => {
    api
      .listPlays()
      .then(setPlays)
      .catch((e: Error) => setError(e.message));
  };
  useEffect(reload, []);

  const create = (): void => {
    const id = newId.trim();
    if (!id) return;
    api
      .createPlay(id, newTitle.trim() || id)
      .then(() => navigate(`/play/${id}`))
      .catch((e: Error) => setError(e.message));
  };

  const importZip = (file: File): void => {
    api
      .importPlay(file)
      .then(({ id }) => navigate(`/play/${id}`))
      .catch((e: Error) => setError(e.message));
  };

  return (
    <div className="screen library">
      <header className="screen-bar">
        <h1>Stage-AI</h1>
        <span className="muted">剧目库</span>
        <button className="ghost-btn" onClick={() => navigate("/settings")}>
          设置
        </button>
      </header>

      {error && (
        <div className="error-banner" role="alert">
          {error}
        </div>
      )}

      <div className="library-grid">
        {(plays ?? []).map((play) => {
          const missing = missingItems(play.readiness);
          return (
            <button key={play.id} className="card" onClick={() => navigate(`/play/${play.id}`)}>
              <div className="card-head">
                <strong>{play.title}</strong>
                <span className={`badge ${play.readiness.ready ? "ok" : "warn"}`}>
                  {play.readiness.ready ? "可开演" : "未就绪"}
                </span>
              </div>
              <p className="card-premise">{play.premise ? `${play.premise.slice(0, 90)}…` : "（premise 待补）"}</p>
              <p className="muted small">
                {missing.length > 0 ? `缺：${missing.join("、")}` : `id: ${play.id}`}
              </p>
            </button>
          );
        })}

        <div className="card card-new">
          {creating ? (
            <div className="create-form">
              <input placeholder="剧目 id（字母数字_-）" value={newId} onChange={(e) => setNewId(e.target.value)} />
              <input placeholder="标题" value={newTitle} onChange={(e) => setNewTitle(e.target.value)} />
              <span className="row">
                <button onClick={create}>创建</button>
                <button className="ghost-btn" onClick={() => setCreating(false)}>
                  取消
                </button>
              </span>
            </div>
          ) : (
            <div className="new-actions">
              <button onClick={() => setCreating(true)}><span className="btn-icon">
                <Icon name="plus" /> 新建剧目
              </span></button>
              <label className="btn-as-label">
                导入剧目包
                <input
                  type="file"
                  accept=".zip"
                  hidden
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    if (file) importZip(file);
                  }}
                />
              </label>
            </div>
          )}
        </div>
      </div>

      {plays !== null && plays.length === 0 && <p className="muted">还没有剧目——新建或导入一个开始。</p>}
    </div>
  );
}
