import { useEffect, useState } from "react";

import {
  api,
  coverUrl,
  type PlaySummary,
} from "../api.js";
import { navigate } from "../router.jsx";

/** 应用首页 = 剧目库：作品牌 + 底部一条管理入口。 */
export function LibraryView() {
  const [plays, setPlays] = useState<PlaySummary[] | null>(null);
  const [covers, setCovers] = useState<Record<string, string | null>>({});
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [newId, setNewId] = useState("");
  const [newTitle, setNewTitle] = useState("");
  /** 首启引导：网关没配好就直说，别等用户开了一部剧才发现什么都跑不起来。 */
  const [setupIssue, setSetupIssue] = useState<string | null>(null);

  useEffect(() => {
    api
      .agentModels()
      .then(() => setSetupIssue(null))
      .catch((e: Error) => setSetupIssue(e.message));
  }, []);

  const reload = (): void => {
    api
      .listPlays()
      .then((list) => {
        setPlays(list);
        void Promise.all(
          list.map((play) =>
            Promise.all([api.playDetail(play.id), api.listAssets(play.id)])
              .then(([detail, assets]) => [play.id, coverUrl(play.id, detail.play.cover, assets)] as const)
              .catch(() => [play.id, null] as const),
          ),
        ).then((pairs) => setCovers(Object.fromEntries(pairs)));
      })
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
      <header className="screen-bar wordmark-bar">
        <h1 className="wordmark">Stage&#8209;AI</h1>
        <button className="ghost-btn" onClick={() => navigate("/settings")}>
          设置
        </button>
      </header>

      {error && (
        <div className="error-banner" role="alert">
          {error}
        </div>
      )}

      {setupIssue && (
        <div className="warn-banner" role="status">
          还没配好模型网关：{setupIssue}{" "}
          <button className="ghost-btn" onClick={() => navigate("/settings")}>
            去设置
          </button>
        </div>
      )}

      <div className="library-grid">
        {(plays ?? []).map((play) => {
          const saves = play.readiness.saves;
          const cover = covers[play.id];
          return (
            <button key={play.id} className="card" onClick={() => navigate(`/play/${play.id}`)}>
              <span className="card-cover">
                {cover ? <img src={cover} alt="" loading="lazy" /> : <span className="card-cover-blank" />}
                <span className={`badge ${saves > 0 ? "ok" : ""}`}>{saves > 0 ? `${saves} 周目` : "未开演"}</span>
              </span>
              <span className="card-body">
                <strong className="card-name">{play.title}</strong>
                <span className="card-premise">
                  {play.premise.length > 72 ? `${play.premise.slice(0, 72)}…` : play.premise || "（故事前提待补）"}
                </span>
              </span>
            </button>
          );
        })}
      </div>

      {plays !== null && plays.length === 0 && <p className="muted library-empty">还没有剧目——建一个开始。</p>}

      <footer className="library-manage">
        {creating ? (
          <div className="create-form">
            <input placeholder="剧目 id（字母数字_-）" value={newId} onChange={(e) => setNewId(e.target.value)} />
            <input placeholder="标题" value={newTitle} onChange={(e) => setNewTitle(e.target.value)} />
            <span className="row">
              <button className="primary" onClick={create}>
                建这个剧目
              </button>
              <button className="ghost-btn" onClick={() => setCreating(false)}>
                取消
              </button>
            </span>
          </div>
        ) : (
          <>
            <button className="library-verb" onClick={() => setCreating(true)}>
              新建剧目
            </button>
            <label className="library-verb">
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
          </>
        )}
      </footer>
    </div>
  );
}
