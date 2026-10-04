import { useCallback, useEffect, useRef, useState } from "react";
import { describeAsset, type AssetKind, type LibraryEntry } from "@aivn/core";
import { api, libraryFileUrl, type ImportResult } from "../api.js";
import { Icon } from "../ui/Icon.js";
import { useEscape } from "../ui/escape.js";
import { ImageLightbox } from "../ui/ImageLightbox.js";

/**
 * 资源库浏览（素材页的「从资源库导入」/ 角色卡与主角卡旁的「导入角色」弹层）。
 *
 * 资源库只读：这里只做一件事——把库里有什么摆出来，让人挑着复制进剧目。
 *
 * 三种入口，两种界面：素材页给分类 tab（角色不在其中——角色有角色页自己的入口，
 * 从素材页导一张角色卡进来，落点说不清）；角色卡与主角卡入口只列角色，不给 tab——
 * 那一栏只有一个可选项，切 tab 只会切出一屏空的。
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
  target,
  only,
  title = "从资源库导入素材",
}: {
  playId: string;
  /** 本剧目已有的条目（kind/id → true），用来标「已导入 / 覆盖」。 */
  imported: (kind: AssetKind, id: string) => boolean;
  onClose: () => void;
  /** 导入成功：回执里带这次建/覆盖了哪些角色卡 id，调用方据此把焦点挪到落点。 */
  onImported: (r: ImportResult) => void;
  /** 落点：角色列表（缺省）或主角卡。主角卡只收 name/persona，立绘与音色不进。 */
  target?: "protagonist";
  /** 锁死类别、不给 tab（角色卡与主角卡入口）。 */
  only?: "characters";
  title?: string;
}) {
  const lockedKind: AssetKind | "" = only === "characters" ? "characters" : "";
  const [kind, setKind] = useState<AssetKind | "">(lockedKind);
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
  const activeKind = lockedKind || kind;

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
    searchTimer.current = setTimeout(() => load(activeKind, query.trim()), 200);
    return () => {
      if (searchTimer.current) clearTimeout(searchTimer.current);
    };
  }, [activeKind, query, load]);

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
        const what =
          entry.kind === "characters"
            ? "角色卡"
            : entry.kind === "sprites"
              ? `立绘 ${r.spriteId}`
              : `${r.files.length} 个文件`;
        setDone((prev) => ({ ...prev, [entry.id]: `已导入 ${what}` }));
        onImported(r);
      })
      .catch((e: Error) => setError(e.message))
      .finally(() => setBusy(null));
  };

  useEscape(onClose);

  return (
    <div className="picker" role="dialog" aria-label={title}>
      <header className="picker-bar">
        {lockedKind ? null : (
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
        )}
        <input
          className="picker-search"
          placeholder="搜描述、标签、情绪，如 黄昏 / 钢琴 / 雨"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        <div className="picker-meta">
          <span className="muted small picker-count">{loading ? "扫描中…" : `匹配 ${total} 条`}</span>
        </div>
        <button className="picker-close" onClick={onClose} title="关闭" aria-label="关闭">
          <Icon name="close" size={15} />
        </button>
      </header>

      {error && (
        <div className="error-banner" role="alert">
          {error}
        </div>
      )}

      <div className="picker-grid picker-grid-wide">
        {entries.map((entry) => {
          const file = entry.files[0];
          const isAudio = AUDIO.has(entry.kind);
          const isCharacter = entry.kind === "characters";
          // 立绘与角色卡都能零媒体（只有卡 / 只有一张图），副标题得说清导的是什么
          const isMulti = isCharacter || entry.kind === "sprites";
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
                </strong>
                {detail && <p className="library-card-desc">{detail}</p>}
                {isMulti && (
                  <p className="library-card-desc">
                    差分：
                    {(Object.keys(entry.meta.variants ?? {}).join("、") ||
                      entry.files.map((f) => f.name).join("、")) ||
                      (isCharacter ? "（无立绘，只导角色卡）" : "（没有图）")}
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
                  title={already ? "本剧目已有同名条目，导入会覆盖它" : "复制进本剧目"}
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
            {query.trim() ? `没有匹配「${query.trim()}」的条目。` : "资源库还是空的。"}
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
