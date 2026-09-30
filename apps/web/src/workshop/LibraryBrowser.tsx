import { useCallback, useEffect, useRef, useState } from "react";
import { describeAsset, type AssetKind, type LibraryEntry } from "@stage-ai/core";
import { api, libraryFileUrl } from "../api.js";
import { Icon } from "../ui/Icon.js";
import { useEscape } from "../ui/escape.js";
import { ImageLightbox } from "./ImageLightbox.js";

/**
 * 资源库浏览（素材页「从资源库导入」弹层）。
 *
 * 资源库本身没有管理界面——条目由用户在本地 `library/<kind>/<id>/` 目录里增删改，
 * 这里只做一件事：把库里有什么说清楚，让人挑着导入。导入是**复制**进剧目，所以
 * 「已导入」只是本剧目的现状，不是库里的状态，重复导入就是覆盖。
 */

const KINDS: { key: AssetKind | ""; label: string }[] = [
  { key: "", label: "全部" },
  { key: "backgrounds", label: "背景" },
  { key: "cg", label: "插图" },
  { key: "sprites", label: "立绘" },
  { key: "bgm", label: "音乐" },
  { key: "sfx", label: "音效" },
];

const AUDIO = new Set<AssetKind>(["bgm", "sfx"]);
const IMAGE = /\.(png|jpe?g|webp|gif)$/i;

export function LibraryBrowser({
  playId,
  imported,
  onClose,
  onImported,
}: {
  playId: string;
  /** 本剧目已有的条目（kind/id → true），用来标「已导入 / 覆盖」。 */
  imported: (kind: AssetKind, id: string) => boolean;
  onClose: () => void;
  /** 导入成功后回调：素材页刷新清单。 */
  onImported: () => void;
}) {
  const [kind, setKind] = useState<AssetKind | "">("");
  const [query, setQuery] = useState("");
  const [entries, setEntries] = useState<LibraryEntry[]>([]);
  const [total, setTotal] = useState(0);
  const [counts, setCounts] = useState<Record<string, number>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [done, setDone] = useState<Record<string, string>>({});
  const [zoom, setZoom] = useState<{ url: string; name: string } | null>(null);
  const searchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const load = useCallback((k: AssetKind | "", q: string) => {
    setLoading(true);
    api
      .listLibrary(k, q)
      .then((r) => {
        setEntries(r.entries);
        setTotal(r.total);
        setCounts(r.counts);
        setError(null);
      })
      .catch((e: Error) => setError(e.message))
      .finally(() => setLoading(false));
  }, []);

  // 关键词输入防抖：边打边扫目录，200ms 一次就够，别把磁盘和请求打满
  useEffect(() => {
    if (searchTimer.current) clearTimeout(searchTimer.current);
    searchTimer.current = setTimeout(() => load(kind, query.trim()), 200);
    return () => {
      if (searchTimer.current) clearTimeout(searchTimer.current);
    };
  }, [kind, query, load]);

  const onImport = (entry: LibraryEntry): void => {
    setBusy(entry.id);
    setError(null);
    api
      .importLibraryAsset(playId, { kind: entry.kind, entryId: entry.id })
      .then((r) => {
        setDone((prev) => ({ ...prev, [entry.id]: `已导入 ${r.files.length} 个文件` }));
        onImported();
      })
      .catch((e: Error) => setError(e.message))
      .finally(() => setBusy(null));
  };

  useEscape(onClose);

  return (
    <div className="library-overlay" role="dialog" aria-label="从资源库导入素材">
      <div className="library-panel">
        <header className="library-head">
          <h3>资源库</h3>
          <button className="icon-btn" onClick={onClose} title="关闭" aria-label="关闭">
            <Icon name="close" size={15} />
          </button>
        </header>
        <p className="library-hint">
          导入是把文件复制进本剧目（assets/），并把描述写进素材表，剧作家据此选素材。库里还有
          <code>{total}</code> 条，删掉库里那一份也不影响本剧目。
        </p>

        <div className="library-bar">
          <div className="library-tabs">
            {KINDS.map((k) => (
              <button
                key={k.key || "all"}
                className={`library-tab ${kind === k.key ? "on" : ""}`}
                onClick={() => setKind(k.key)}
              >
                {k.label}
                {k.key && counts[k.key] ? <span className="n">{counts[k.key]}</span> : null}
              </button>
            ))}
          </div>
          <input
            className="library-search"
            placeholder="搜描述、标签、情绪，如 黄昏 / 钢琴 / 雨"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </div>

        {error && (
          <div className="error-banner" role="alert">
            {error}
          </div>
        )}

        <div className="library-grid">
          {entries.map((entry) => {
            const file = entry.files[0];
            const isAudio = AUDIO.has(entry.kind);
            const preview = file ? libraryFileUrl(entry.kind, entry.id, file.name) : "";
            const already = imported(entry.kind, entry.id);
            const note = done[entry.id];
            const detail = describeAsset(entry.meta);
            return (
              <article key={`${entry.kind}/${entry.id}`} className="library-card">
                <div className="library-card-media">
                  {file && !isAudio && IMAGE.test(file.name) ? (
                    <button
                      className="library-thumb"
                      onClick={() => setZoom({ url: preview, name: `${entry.id} / ${file.name}` })}
                      title="点击看大图"
                    >
                      <img src={preview} alt={entry.title} loading="lazy" />
                    </button>
                  ) : file && isAudio ? (
                    <audio className="asset-audio" src={preview} controls preload="none" />
                  ) : (
                    <span className="library-thumb library-thumb-blank" title={entry.id}>
                      <Icon name={isAudio ? "volume" : "assets"} size={18} />
                    </span>
                  )}
                </div>
                <div className="library-card-body">
                  <strong className="library-card-title" title={entry.id}>
                    {entry.title}
                  </strong>
                  {detail && <p className="library-card-desc">{detail}</p>}
                  {entry.kind === "sprites" && (
                    <p className="library-card-desc">
                      差分：
                      {(Object.keys(entry.meta.expressions ?? {}).join("、") ||
                        entry.files.map((f) => f.name).join("、")) || "（未在 meta 里声明，按文件名导入）"}
                    </p>
                  )}
                  {entry.warnings?.map((w) => (
                    <p key={w} className="library-card-warn">
                      ⚠ {w}
                    </p>
                  ))}
                </div>
                <footer className="library-card-foot">
                  {note ? (
                    <span className="library-done">
                      <Icon name="check" size={13} /> {note}
                    </span>
                  ) : (
                    <span className="library-id">{entry.id}</span>
                  )}
                  <button
                    className={`ghost-btn ${already ? "active" : ""}`}
                    disabled={busy === entry.id}
                    onClick={() => onImport(entry)}
                    title={already ? "本剧目已有同名素材，导入会覆盖它" : "复制进本剧目 assets/"}
                  >
                    <span className="btn-icon">
                      <Icon name={already ? "refresh" : "download"} size={13} />
                      {already ? "覆盖" : "导入"}
                    </span>
                  </button>
                </footer>
              </article>
            );
          })}
          {!loading && entries.length === 0 && (
            <p className="library-empty">
              {query.trim() ? `没有匹配「${query.trim()}」的素材。` : "资源库是空的。"}
              <br />
              条目放在服务端配置的素材库目录里（<code>library/&lt;类别&gt;/&lt;素材id&gt;/</code>，
              可选放一份 <code>meta.json</code> 写描述），本页不提供管理。
            </p>
          )}
        </div>
      </div>
      {zoom && <ImageLightbox url={zoom.url} name={zoom.name} onClose={() => setZoom(null)} />}
    </div>
  );
}
