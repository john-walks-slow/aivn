import { useCallback, useEffect, useRef, useState } from "react";
import { describeAsset, type AssetKind, type LibraryEntry } from "@stage-ai/core";
import { api, libraryFileUrl } from "../api.js";
import { Icon } from "../ui/Icon.js";
import { useEscape } from "../ui/escape.js";
import { ImageLightbox } from "../ui/ImageLightbox.js";

/**
 * 资源库浏览（素材页 / 角色卡旁的「从资源库导入」弹层）。
 *
 * 资源库本身没有管理界面——条目由用户在本地 `library/<kind>/<id>/` 目录里增删改，
 * 这里只做一件事：把库里有什么说清楚，让人挑着导入。导入是**复制**进剧目，所以
 * 「已导入」只是本剧目的现状，不是库里的状态，重复导入就是覆盖。
 */

const KINDS: { key: AssetKind | ""; label: string }[] = [
  { key: "", label: "全部" },
  { key: "backgrounds", label: "背景" },
  { key: "cg", label: "插图" },
  { key: "characters", label: "角色" },
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
  target,
  filter,
  title = "从资源库导入素材",
}: {
  playId: string;
  /** 本剧目已有的条目（kind/id → true），用来标「已导入 / 覆盖」。 */
  imported: (kind: AssetKind, id: string) => boolean;
  onClose: () => void;
  /** 导入成功后回调：素材页刷新清单。 */
  onImported: () => void;
  /** 落点：角色列表（缺省）或主角卡。 */
  target?: "protagonist";
  /** 只列满足条件的条目——主角卡入口只看标了 protagonist 的角色。 */
  filter?: (entry: LibraryEntry) => boolean;
  title?: string;
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
      .importLibraryAsset(playId, {
        kind: entry.kind,
        entryId: entry.id,
        ...(target ? { target } : {}),
      })
      .then((r) => {
        const what = entry.kind === "characters" ? "角色卡" : `${r.files.length} 个文件`;
        setDone((prev) => ({ ...prev, [entry.id]: `已导入 ${what}` }));
        onImported();
      })
      .catch((e: Error) => setError(e.message))
      .finally(() => setBusy(null));
  };

  useEscape(onClose);

  const shown = filter ? entries.filter(filter) : entries;

  return (
    <div className="picker" role="dialog" aria-label={title}>
      <header className="picker-bar">
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
          className="picker-search"
          placeholder="搜描述、标签、情绪，如 黄昏 / 钢琴 / 雨"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        <div className="picker-meta">
          <span className="muted small picker-count">
            {loading ? "扫描中…" : filter ? `可选 ${shown.length} 个角色` : `匹配 ${total} 条`}
          </span>
        </div>
        <button
          className="picker-close"
          onClick={onClose}
          title="关闭"
          aria-label="关闭"
        >
          <Icon name="close" size={15} />
        </button>
      </header>

      <p className="picker-note">
        {target === "protagonist"
          ? "导入会把这个角色的人设写进本剧目的主角卡（覆盖现有的），条目里的立绘一并复制。"
          : "导入是把内容复制进本剧目（素材落 assets/，角色卡写进 play.json），删掉库里那一份不影响本剧目。"}
      </p>

      {error && (
        <div className="error-banner" role="alert">
          {error}
        </div>
      )}

      <div className="picker-grid picker-grid-wide">
          {shown.map((entry) => {
            const file = entry.files[0];
            const isAudio = AUDIO.has(entry.kind);
            const isCharacter = entry.kind === "characters";
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
                    <span className="library-thumb library-thumb-blank" title={isCharacter ? "只有角色卡，没有立绘" : entry.id}>
                      <Icon name={isAudio ? "volume" : "assets"} size={18} />
                    </span>
                  )}
                </div>
                <div className="library-card-body">
                  <strong className="library-card-title" title={entry.id}>
                    {entry.title}
                    {entry.meta.character?.protagonist && <span className="tag">主角</span>}
                  </strong>
                  {detail && <p className="library-card-desc">{detail}</p>}
                  {isCharacter && (
                    <p className="library-card-desc">
                      差分：
                      {(Object.keys(entry.meta.expressions ?? {}).join("、") ||
                        entry.files.map((f) => f.name).join("、")) || "（无立绘，只导角色卡）"}
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
          {!loading && shown.length === 0 && (
            <p className="library-empty">
              {filter
                ? "资源库里没有标为「主角」的角色。在条目的 meta.json 里给 character 写 protagonist: true，它就会出现在这里。"
                : query.trim()
                  ? `没有匹配「${query.trim()}」的素材。`
                  : "资源库是空的。"}
              <br />
              条目放在服务端配置的素材库目录里（<code>library/&lt;类别&gt;/&lt;素材id&gt;/</code>，
              可选放一份 <code>meta.json</code> 写描述），本页不提供管理。
            </p>
          )}
        </div>
      {zoom && (
        <ImageLightbox
          images={[{ url: zoom.url, caption: zoom.name }]}
          index={0}
          onIndex={() => {}}
          onClose={() => setZoom(null)}
        />
      )}
    </div>
  );
}
