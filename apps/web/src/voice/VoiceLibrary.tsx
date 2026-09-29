import { useEffect, useMemo, useState } from "react";
import { countVoicesByLanguage, languageLabel, type VoiceEntry } from "@stage-ai/core";
import { api } from "../api.js";
import type { VoiceCatalogState } from "./useVoiceCatalog.js";

/** Fish 封面图 CDN（cover_image 是 `coverimage/<id>` 相对路径）。 */
const COVER_BASE = "https://public-platform.r2.fish.audio/";

/** 一页渲染多少张卡——1000 条全量铺开会拖垮滚动。 */
const PAGE_SIZE = 60;

/**
 * 全屏音色库面板：顶部搜索 + 语言下拉 + 卡片网格。
 *
 * 目录来自服务端缓存的 Fish 公共库（热门前 1000），搜索与语言筛选都在本地内存做。
 * 选中小语种音色不需要任何服务端改动——voiceId 原样存进角色卡即可。
 *
 * 语言筛选用下拉而不是侧边栏：侧栏在窄屏上会把卡片网格挤到放不下，且手机上要横向
 * 滚动才能看全部语种。
 */
export function VoiceLibrary({
  playId,
  voices,
  onPick,
  onClose,
}: {
  playId: string;
  voices: VoiceCatalogState;
  onPick: (entry: VoiceEntry) => void;
  onClose: () => void;
}) {
  const { catalog, error, loading, refresh } = voices;
  const [query, setQuery] = useState("");
  const [language, setLanguage] = useState("");
  const [limit, setLimit] = useState(PAGE_SIZE);
  const [previewingId, setPreviewingId] = useState("");

  const entries = catalog?.entries ?? [];
  const languages = useMemo(() => countVoicesByLanguage(entries), [entries]);

  const matched = useMemo(() => {
    const keyword = query.trim().toLowerCase();
    return entries.filter((entry) => {
      if (language && !entry.languages.includes(language)) return false;
      if (!keyword) return true;
      return (
        entry.title.toLowerCase().includes(keyword) ||
        entry.description.toLowerCase().includes(keyword) ||
        entry.tags.some((tag) => tag.includes(keyword))
      );
    });
  }, [entries, language, query]);

  // 换筛选条件时回到第一页，否则会停在一个空白的第 N 页
  useEffect(() => setLimit(PAGE_SIZE), [language, query]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const preview = (entry: VoiceEntry): void => {
    if (previewingId) return;
    setPreviewingId(entry.id);
    api
      .ttsPreview(playId, entry.id)
      .then(({ url }) => void new Audio(url).play().catch(() => {}))
      .catch((e: Error) => window.alert(`试听失败：${e.message}`))
      .finally(() => setPreviewingId(""));
  };

  const visible = matched.slice(0, limit);

  return (
    <div className="voice-library" role="dialog" aria-label="音色库">
      <header className="voice-library-bar">
        <input
          className="voice-library-search"
          placeholder="搜索音色名 / 描述 / 标签（如 narration、female、书记）"
          value={query}
          autoFocus
          onChange={(e) => setQuery(e.target.value)}
        />
        <select
          className="voice-library-lang"
          value={language}
          onChange={(e) => setLanguage(e.target.value)}
        >
          <option value="">全部语言（{entries.length}）</option>
          {languages.map(({ code, count }) => (
            <option key={code} value={code}>
              {languageLabel(code)}（{count}）
            </option>
          ))}
        </select>
        <span className="muted small voice-library-count">
          {catalog
            ? `匹配 ${matched.length} / ${entries.length}${catalog.stale ? "（离线快照）" : ""}`
            : loading
              ? "加载中…"
              : ""}
        </span>
        <div className="voice-library-bar-actions">
          <button className="ghost-btn" disabled={loading} onClick={refresh}>
            {loading ? "抓取中…" : "重新抓取"}
          </button>
          <button className="ghost-btn" onClick={onClose}>
            关闭
          </button>
        </div>
      </header>

      {error ? (
        <div className="error-banner" role="alert">
          音色库加载失败：{error}
        </div>
      ) : (
        <div className="voice-library-grid">
          {visible.map((entry) => (
            <article key={entry.id} className="voice-card">
              <div className="voice-card-cover">
                {entry.cover && (
                  <img
                    src={COVER_BASE + entry.cover}
                    alt=""
                    loading="lazy"
                    onError={(e) => {
                      e.currentTarget.style.visibility = "hidden";
                    }}
                  />
                )}
              </div>
              <div className="voice-card-body">
                <strong>{entry.title}</strong>
                <p className="muted small voice-card-desc">{entry.description}</p>
                <p className="muted small">
                  {entry.languages.map(languageLabel).join(" · ")}
                  {entry.likes > 0 && ` · ♥ ${entry.likes}`}
                </p>
              </div>
              <div className="voice-card-actions">
                <button
                  className="ghost-btn small-btn"
                  disabled={previewingId !== ""}
                  onClick={() => preview(entry)}
                >
                  {previewingId === entry.id ? "合成中…" : "试听"}
                </button>
                <button className="primary small-btn" onClick={() => onPick(entry)}>
                  选用
                </button>
              </div>
            </article>
          ))}
          {visible.length === 0 && !loading && (
            <p className="muted">没有匹配的音色，换个关键词或语言试试。</p>
          )}
          {matched.length > visible.length && (
            <button className="ghost-btn" onClick={() => setLimit((n) => n + PAGE_SIZE)}>
              显示更多（还有 {matched.length - visible.length} 条）
            </button>
          )}
        </div>
      )}
    </div>
  );
}
