import { useEffect, useMemo, useState } from "react";
import { Icon } from "@aivn/stage";
import { api, coverUrl, type PlaySummary } from "../api.js";
import { navigate } from "../router.jsx";
import { plainSummary } from "../ui/text.js";
import { useDismissible } from "../ui/useDismissible.js";

/** 剧目库的三个分类：全部 / 已开演 / 草稿中。 */
type FilterMode = "all" | "active" | "draft";

/**
 * 空结果的文案：空的是「筛选」还是「关键词」，说到点子上——
 * 只切了筛选却写「没有找到与“”相关的剧目。」，是拿空关键词解释筛选结果。
 */
function emptyHintOf(filterMode: FilterMode, search: string): string {
  return filterMode === "active" && search.trim() === ""
    ? "暂无已开演剧目"
    : `没有找到与“${search}”相关的剧目。`;
}

/** 应用首页 = 剧目库（现代启动器风格）：作品牌网格 + 顶部搜索与管理 */
export function LibraryView() {
  const [plays, setPlays] = useState<PlaySummary[] | null>(null);
  const [covers, setCovers] = useState<Record<string, string | null>>({});
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [creating, setCreating] = useState(false);
  const [newId, setNewId] = useState("");
  const [newTitle, setNewTitle] = useState("");
  const [setupIssue, setSetupIssue] = useState<string | null>(null);
  /** 网关没配好这条只是提示，可以收起来。 */
  const issueHidden = useDismissible(setupIssue);

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
              .then(
                ([detail, assets]) =>
                  [
                    play.id,
                    coverUrl(play.id, detail.play.cover, assets),
                  ] as const,
              )
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

  const [filterMode, setFilterMode] = useState<FilterMode>("all");

  const counts = useMemo(() => {
    if (!plays) return { total: 0, active: 0, draft: 0 };
    const total = plays.length;
    const active = plays.filter((p) => p.readiness.started).length;
    return { total, active, draft: total - active };
  }, [plays]);

  const filtered = useMemo(() => {
    if (!plays) return null;
    let list = plays;
    if (filterMode === "active")
      list = list.filter((p) => p.readiness.started);
    if (filterMode === "draft")
      list = list.filter((p) => !p.readiness.started);
    const q = search.trim().toLowerCase();
    if (!q) return list;
    return list.filter(
      (p) =>
        p.title.toLowerCase().includes(q) ||
        p.premise.toLowerCase().includes(q) ||
        p.id.toLowerCase().includes(q),
    );
  }, [plays, search, filterMode]);

  return (
    <div className="screen library-screen">
      <header className="library-top">
        <div className="library-brand">
          <span className="library-logo">AIVN</span>
          <span className="library-subtitle">CONSOLE</span>
        </div>

        <div className="library-search-box">
          <Icon name="search" size={14} />
          <input
            type="search"
            className="library-search-input"
            placeholder="搜索剧目标题、设定、ID…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>

        <div className="library-top-actions">
          <button
            type="button"
            className="primary btn-compact"
            onClick={() => setCreating(true)}
          >
            <Icon name="plus" size={13} /> 新建剧目
          </button>

          <label className="ghost-btn btn-compact library-upload-btn">
            <Icon name="download" size={13} /> 导入
            <input
              type="file"
              accept=".zip,.html,.htm"
              hidden
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) importZip(file);
              }}
            />
          </label>

          <button
            type="button"
            className="ghost-btn btn-compact icon-only-btn"
            onClick={() => navigate("/settings")}
            title="全局系统设置"
            aria-label="全局设置"
          >
            <Icon name="settings" size={15} />
          </button>
        </div>
      </header>

      {/* OMC 风格紧凑工具栏：Segmented 选项卡 + 快捷计数 */}
      <div className="library-toolbar">
        <div className="library-filter-tabs" role="tablist">
          <button
            type="button"
            className={`filter-tab-btn${filterMode === "all" ? " is-active" : ""}`}
            onClick={() => setFilterMode("all")}
          >
            全部 <span className="tab-count">{counts.total}</span>
          </button>
          <button
            type="button"
            className={`filter-tab-btn${filterMode === "active" ? " is-active" : ""}`}
            onClick={() => setFilterMode("active")}
          >
            已开演 <span className="tab-count">{counts.active}</span>
          </button>
          <button
            type="button"
            className={`filter-tab-btn${filterMode === "draft" ? " is-active" : ""}`}
            onClick={() => setFilterMode("draft")}
          >
            草稿中 <span className="tab-count">{counts.draft}</span>
          </button>
        </div>

        <span className="library-filter-summary">
          显示 {filtered?.length ?? 0} 部剧目
        </span>
      </div>

      <div className="notice-layer">
        {error && (
          <div className="error-banner" role="alert">
            {error}
            <button
              type="button"
              className="notice-close"
              aria-label="收起这条"
              onClick={() => setError(null)}
            >
              <Icon name="close" size={12} />
            </button>
          </div>
        )}

        {setupIssue && !issueHidden.hidden && (
          <div className="warn-banner" role="status">
            <span>模型网关未配置或连接异常：{setupIssue}</span>
            <button className="link-btn" onClick={() => navigate("/settings")}>
              前往设置
            </button>
            <button
              type="button"
              className="notice-close"
              aria-label="收起这条"
              onClick={issueHidden.dismiss}
            >
              <Icon name="close" size={12} />
            </button>
          </div>
        )}
      </div>

      <main className="library-content">
        {creating && (
          <div className="create-card-banner">
            <div className="create-card-header">
              <h3>新建剧目</h3>
              <p className="muted small">
                填一个唯一 ID 与标题，创建后直接进工坊。
              </p>
            </div>
            <div className="create-form-row">
              <input
                className="input-text"
                placeholder="剧目 ID（英文、数字、中划线，如 my-story）"
                value={newId}
                autoFocus
                onChange={(e) => setNewId(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && create()}
              />
              <input
                className="input-text"
                placeholder="剧目标题（如《星海余晖》）"
                value={newTitle}
                onChange={(e) => setNewTitle(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && create()}
              />
              <div className="create-btns">
                <button
                  type="button"
                  className="primary"
                  onClick={create}
                  disabled={!newId.trim()}
                >
                  创建并前往
                </button>
                <button
                  type="button"
                  className="ghost-btn"
                  onClick={() => setCreating(false)}
                >
                  取消
                </button>
              </div>
            </div>
          </div>
        )}

        <div className="library-grid">
          {(filtered ?? []).map((play) => {
            const started = play.readiness.started;
            const cover = covers[play.id];
            const summary = plainSummary(play.premise, play.title, 80);

            return (
              <div
                key={play.id}
                className="play-card"
                onClick={() => navigate(`/play/${play.id}`)}
                role="button"
                tabIndex={0}
                onKeyDown={(e) =>
                  e.key === "Enter" && navigate(`/play/${play.id}`)
                }
              >
                <div className="play-card-cover">
                  {cover ? (
                    <img src={cover} alt="" loading="lazy" />
                  ) : (
                    <div className="play-card-cover-blank">
                      <Icon name="drama" size={28} />
                    </div>
                  )}
                  <span className="play-card-id-tag">{play.id}</span>
                  <div className={`play-badge ${started ? "active" : ""}`}>
                    <span
                      className={`status-pip ${started ? "is-success" : "is-neutral"}`}
                    />
                    <span>{started ? "已开演" : "未开演"}</span>
                  </div>
                  <div className="play-card-hover-actions">
                    <span className="hover-play-btn">
                      <Icon name="play" size={14} /> 启动
                    </span>
                  </div>
                </div>

                <div className="play-card-body">
                  <h3 className="play-card-title">{play.title}</h3>
                  <p className="play-card-premise">
                    {summary || "（点击进入设定世界观与故事背景）"}
                  </p>
                </div>
              </div>
            );
          })}
        </div>

        {plays !== null && plays.length === 0 && (
          <div className="library-empty-state">
            <div className="empty-state-icon">
              <Icon name="drama" size={48} />
            </div>
            <h3>剧场空空如也</h3>
            <p>
              还没有剧目。新建一个，或导入现成的剧目包。
            </p>
            <div className="empty-state-actions">
              <button
                type="button"
                className="primary"
                onClick={() => setCreating(true)}
              >
                <Icon name="plus" size={14} /> 新建第一个剧目
              </button>
            </div>
          </div>
        )}

        {filtered !== null &&
          filtered.length === 0 &&
          plays &&
          plays.length > 0 && (
            <div className="library-empty-state">
              <p>{emptyHintOf(filterMode, search)}</p>
              {/* 没搜过就没有可清的：空结果的成因在筛选上，这颗键点下去什么也不会发生 */}
              {search.trim() !== "" && (
                <button
                  type="button"
                  className="ghost-btn"
                  onClick={() => setSearch("")}
                >
                  清除搜索
                </button>
              )}
            </div>
          )}
      </main>
    </div>
  );
}
