import { useEffect, useMemo, useState } from "react";
import { countVoicesByLanguage, languageLabel, type VoiceEntry } from "@aivn/core";
import { api } from "../api.js";
import { Icon } from "../ui/Icon.js";
import { useEscape } from "../ui/escape.js";
import type { VoiceCatalogState } from "./useVoiceCatalog.js";

/** Fish 封面图 CDN（cover_image 是 `coverimage/<id>` 相对路径）。 */
const COVER_BASE = "https://public-platform.r2.fish.audio/";

/** 一页渲染多少张卡——窗口最多 1000 条，全量铺开会拖垮滚动。 */
const PAGE_SIZE = 60;

/** chips 里展示多少个高频标签。 */
const TAG_CHIPS = 12;

/** 标签多选上限，与 HTTP 面（≤4 个 tag）一致——超过就是上游 400。 */
const MAX_TAGS = 4;

/**
 * 与语言重名的标签不进 chips——语言下拉已经管这个维度，Fish 数据里就有
 * Japanese / English 这类标签，摆出来只是占位噪音。
 */
const LANGUAGE_TAG_WORDS = new Set([
  "japanese", "english", "chinese", "mandarin", "cantonese", "spanish", "russian", "portuguese",
  "arabic", "french", "german", "italian", "korean", "turkish", "dutch", "polish", "thai",
  "vietnamese", "indonesian", "hindi",
]);

/** 从当前窗口统计高频标签（原样大小写：Fish 的 tag 匹配区分大小写）。 */
function topTagsOf(entries: VoiceEntry[], limit: number): string[] {
  const counts = new Map<string, number>();
  for (const entry of entries) {
    for (const tag of entry.tags) {
      if (LANGUAGE_TAG_WORDS.has(tag.toLowerCase())) continue;
      counts.set(tag, (counts.get(tag) ?? 0) + 1);
    }
  }
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, limit)
    .map(([tag]) => tag);
}

/**
 * 全屏音色库面板：顶部搜索 + 语言下拉 + 标签 chips + 卡片网格。
 *
 * 筛选全部发给服务端按需抓 Fish 对应窗口（每个语言/标签组合各有一个 1000 条窗口，
 * 本地那份热门目录里日语只有 52 条）；关键词走全库标题搜索，能搜到热门榜单外的音色。
 * 选中小语种音色不需要任何服务端改动——voiceId 原样存进角色卡即可。
 *
 * 语言筛选用下拉而不是侧边栏：侧栏在窄屏上会把卡片网格挤到放不下，且手机上要横向
 * 滚动才能看全部语种。默认筛系统语言（中文用户看中文音色），挑过之后以用户的选择为准。
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
  const [tags, setTags] = useState<string[]>([]);
  // null = 用户还没挑过，沿用系统语言；挑过之后以用户的选择为准
  const [picked, setPicked] = useState<string | null>(null);
  const [limit, setLimit] = useState(PAGE_SIZE);
  const [previewingId, setPreviewingId] = useState("");

  const baseEntries = catalog?.entries ?? [];
  const languages = useMemo(() => countVoicesByLanguage(baseEntries), [baseEntries]);

  // 目录是异步到的，所以系统语言只能在基础目录齐了之后再算。
  // 系统语言不在基础目录里（冷门语种）就退回不筛。
  const systemLanguage = useMemo(() => {
    const code = (navigator.language.split("-")[0] ?? "").toLowerCase();
    return languages.some((l) => l.code === code) ? code : undefined;
  }, [languages]);

  const language = picked ?? systemLanguage ?? "";

  // 关键词防抖：停 300ms 再发查询，别一个字母一个请求
  const [title, setTitle] = useState("");
  useEffect(() => {
    const timer = setTimeout(() => setTitle(query.trim()), 300);
    return () => clearTimeout(timer);
  }, [query]);

  // 筛选变化 → 服务端窗口查询（空条件时 search 内部回落到基础目录）
  useEffect(() => {
    search({ language, tags, title });
  }, [search, language, tags, title]);

  // 换筛选条件时回到第一页，否则会停在一个空白的第 N 页
  useEffect(() => setLimit(PAGE_SIZE), [language, tags, title]);

  // 有筛选时网格只认窗口结果（抓取失败/在途不回落到热门目录，免得张冠李戴）；
  // 没筛选时就是基础热门目录本身
  const filterActive = filter.language !== "" || filter.tags.length > 0 || filter.title !== "";
  const entries = filterActive ? (result?.entries ?? []) : baseEntries;
  // 选中的标签一定要在行里：它是取消勾选的唯一入口，跌出高频榜就成了「隐形筛选」。
  // 补在末尾而不是提到队首——点一下整行跳位很难用。
  const topTags = useMemo(() => {
    const popular = topTagsOf(entries, TAG_CHIPS);
    const shown = new Set(popular);
    return [...popular, ...tags.filter((tag) => !shown.has(tag))];
  }, [entries, tags]);

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

  const toggleTag = (tag: string): void => {
    setTags((prev) => {
      if (prev.includes(tag)) return prev.filter((t) => t !== tag);
      if (prev.length >= MAX_TAGS) return prev;
      return [...prev, tag];
    });
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

      {topTags.length > 0 && (
        <div className="picker-tags" role="group" aria-label="标签筛选">
          {topTags.map((tag) => {
            const on = tags.includes(tag);
            return (
              <button
                key={tag}
                className={`chip-btn${on ? " chip-btn-on" : ""}`}
                // 到上限就把没选中的灰掉而不是静默忽略点击：静默忽略读起来像卡了
                disabled={!on && tags.length >= MAX_TAGS}
                title={!on && tags.length >= MAX_TAGS ? `最多同时选 ${MAX_TAGS} 个标签` : tag}
                onClick={() => toggleTag(tag)}
              >
                {tag}
              </button>
            );
          })}
        </div>
      )}

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
            <p className="muted">没有匹配的音色，换个关键词、标签或语言试试。</p>
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
