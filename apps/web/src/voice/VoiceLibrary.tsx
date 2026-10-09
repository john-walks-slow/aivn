import { useEffect, useMemo, useState } from "react";
import { countVoicesByLanguage, languageLabel, type VoiceEntry } from "@aivn/core";
import { api } from "../api.js";
import { Icon, useEscape } from "@aivn/stage";
import { effectiveVoiceLanguage, type VoiceCatalogState } from "./useVoiceCatalog.js";

/** Fish 封面图 CDN（cover_image 是 `coverimage/<id>` 相对路径）。 */
const COVER_BASE = "https://public-platform.r2.fish.audio/";

/** 一页渲染多少张卡——窗口最多 1000 条，全量铺开会拖垮滚动。 */
const PAGE_SIZE = 60;

/**
 * 全屏音色库面板：顶部搜索 + 语言下拉 + 卡片网格。
 *
 * 筛选全部发给服务端按需抓 Fish 对应窗口（`language` 各有一个 1000 条窗口，
 * 本地那份热门目录里日语只有 52 条）；关键词走全库标题搜索，能搜到热门榜单外的音色。
 * 选中小语种音色不需要任何服务端改动——voiceId 原样存进角色卡即可。
 *
 * **面板不放标签筛选**：toy 阶段那排 chips 要占掉手机上五六行，而挑音色靠搜索与试听
 * 更直接（标签筛选仍在 `/api/voices?tag=` 与 `list_voices` 上，agent 侧照常用）。
 *
 * 语言筛选用下拉而不是侧边栏：侧栏在窄屏上会把卡片网格挤到放不下，且手机上要横向
 * 滚动才能看全部语种。默认筛系统语言（中文用户看中文音色），但**它只是浏览起点**：
 * 一旦有关键词就摘掉（用户挑过语言则以他的选择为准），搜索始终是全库标题搜索。
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
  const { catalog, error, loading, refresh, search, filter, result, searching, searchError } = voices;
  const [query, setQuery] = useState("");
  // null = 用户还没挑过，沿用系统语言；挑过之后以用户的选择为准
  const [picked, setPicked] = useState<string | null>(null);
  const [limit, setLimit] = useState(PAGE_SIZE);
  const [previewingId, setPreviewingId] = useState("");

  const baseEntries = catalog?.entries ?? [];
  const languages = useMemo(() => countVoicesByLanguage(baseEntries), [baseEntries]);

  // 关键词防抖：停 300ms 再发查询，别一个字母一个请求
  const [title, setTitle] = useState("");
  useEffect(() => {
    const timer = setTimeout(() => setTitle(query.trim()), 300);
    return () => clearTimeout(timer);
  }, [query]);

  // 目录是异步到的，所以系统语言只能在基础目录齐了之后再算。
  // 系统语言不在基础目录里（冷门语种）就退回不筛。
  const systemLanguage = useMemo(() => {
    const code = (navigator.language.split("-")[0] ?? "").toLowerCase();
    return languages.some((l) => l.code === code) ? code : undefined;
  }, [languages]);

  // 系统语言只是浏览起点：一有关键词就摘掉它，搜索才是全库的（见 effectiveVoiceLanguage）
  const language = effectiveVoiceLanguage({ picked, system: systemLanguage, keyword: title });

  // 筛选变化 → 服务端窗口查询（空条件时 search 内部回落到基础目录）
  useEffect(() => {
    search({ language, title });
  }, [search, language, title]);

  // 换筛选条件时回到第一页，否则会停在一个空白的第 N 页
  useEffect(() => setLimit(PAGE_SIZE), [language, title]);

  // 有筛选时网格只认窗口结果（抓取失败/在途不回落到热门目录，免得张冠李戴）；
  // 没筛选时就是基础热门目录本身
  const filterActive = filter.language !== "" || filter.title !== "";
  const entries = filterActive ? (result?.entries ?? []) : baseEntries;

  useEscape(onClose);

  const preview = (entry: VoiceEntry): void => {
    if (previewingId) return;
    setPreviewingId(entry.id);
    api
      .ttsPreview(playId, entry.id)
      .then(({ url }) => void new Audio(url).play().catch(() => {}))
      .catch((e: Error) => window.alert(`试听失败：${e.message}`))
      .finally(() => setPreviewingId(""));
  };

  const visible = entries.slice(0, limit);
  const busy = loading || searching;

  return (
    <div className="picker" role="dialog" aria-label="音色库">
      <header className="picker-bar">
        <input
          className="picker-search"
          placeholder="搜索音色名（全库）"
          value={query}
          autoFocus
          onChange={(e) => setQuery(e.target.value)}
        />
        <select
          className="voice-library-lang"
          value={language}
          onChange={(e) => setPicked(e.target.value)}
        >
          {/* 「全部语言」= 不筛语言（基础热门目录本身）。必须能选回来：切到日语之后
              没有这一项就再也回不到全局热门列表了。
              各语言的计数不摆出来——每个语言是各自独立的 1000 条窗口，与热门目录不同源，
              计数只会误导。 */}
          <option value="">全部语言</option>
          {languages.map(({ code }) => (
            <option key={code} value={code}>
              {languageLabel(code)}
            </option>
          ))}
        </select>
        <div className="picker-meta">
          <span className="muted small picker-count">
            {searching
              ? "筛选中…"
              : entries.length > 0 || filterActive
                ? `${entries.length} 条${!filterActive && catalog?.stale ? "（离线快照）" : ""}`
                : loading
                  ? "加载中…"
                  : ""}
          </span>
          <button className="ghost-btn small-btn" disabled={busy} onClick={refresh}>
            {busy ? "抓取中…" : "重新抓取"}
          </button>
        </div>
        <button
          className="picker-close"
          aria-label="关闭音色库"
          title="关闭"
          onClick={onClose}
        >
          <Icon name="close" size={15} />
        </button>
      </header>

      {error ? (
        <div className="error-banner" role="alert">
          音色库加载失败：{error}
        </div>
      ) : searchError ? (
        <div className="error-banner" role="alert">
          筛选失败：{searchError}（可重试或换个条件）
        </div>
      ) : (
        <div className="picker-grid">
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
          {visible.length === 0 && !busy && (
            <p className="muted">没有匹配的音色，换个关键词或语言试试。</p>
          )}
          {entries.length > visible.length && (
            <button className="ghost-btn" onClick={() => setLimit((n) => n + PAGE_SIZE)}>
              显示更多（还有 {entries.length - visible.length} 条）
            </button>
          )}
        </div>
      )}
    </div>
  );
}
