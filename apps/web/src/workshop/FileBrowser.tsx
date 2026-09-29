import { useCallback, useEffect, useMemo, useState } from "react";
import type { PlayFile } from "../api.js";
import { api } from "../api.js";
import { ImageLightbox } from "../ui/ImageLightbox.js";

const IMAGE_EXT = /\.(png|jpe?g|webp)$/i;

/** 剧目文件浏览器（D9）：工坊目录树 + 文本编辑。可写面由服务端白名单裁定（PlayFiles）。 */
export function FileBrowser({
  playId,
  revision,
  onSaved,
}: {
  playId: string;
  /** 外部写盘（工坊 agent）触发重载的版本号。 */
  revision: number;
  onSaved: (path: string) => void;
}) {
  const [files, setFiles] = useState<PlayFile[]>([]);
  const [open, setOpen] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [saved, setSaved] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [lightbox, setLightbox] = useState<{ images: { url: string; caption: string }[]; index: number } | null>(
    null,
  );

  const reload = useCallback((): void => {
    api
      .listFiles(playId)
      .then(setFiles)
      .catch((e: Error) => setError(e.message));
  }, [playId]);

  useEffect(reload, [reload, revision]);

  const select = useCallback(
    (path: string): void => {
      setError(null);
      // 图不进编辑器：readFile 是 utf8 通道，2MB 的 PNG 读回来就是一屏乱码
      if (IMAGE_EXT.test(path)) {
        setOpen(path);
        return;
      }
      api
        .readFile(playId, path)
        .then(({ content }) => {
          setOpen(path);
          setDraft(content);
          setSaved(content);
        })
        .catch((e: Error) => setError(e.message));
    },
    [playId],
  );

  const save = useCallback((): void => {
    if (!open) return;
    setBusy(true);
    api
      .saveFile(playId, open, draft)
      .then(() => {
        setSaved(draft);
        onSaved(open);
        reload();
      })
      .catch((e: Error) => setError(e.message))
      .finally(() => setBusy(false));
  }, [playId, open, draft, onSaved, reload]);

  /** 新建文本文件：白名单由服务端裁定，越界会在这里报错。 */
  const create = useCallback((): void => {
    const path = window.prompt("新文件路径（可写：play.json、memory/** 的 .md/.json/.txt）", "memory/index/lore/新条目.md");
    if (!path) return;
    setError(null);
    api
      .saveFile(playId, path, path.endsWith(".md") ? "# 新条目\n一句话摘要。\n\n详情。\n" : "")
      .then(() => {
        reload();
        select(path);
        onSaved(path);
      })
      .catch((e: Error) => setError(e.message));
  }, [playId, reload, select, onSaved]);

  const remove = useCallback(
    (path: string): void => {
      if (!window.confirm(`删除 ${path}？不可恢复。`)) return;
      setError(null);
      api
        .deleteFile(playId, path)
        .then(() => {
          if (open === path) {
            setOpen(null);
            setDraft("");
            setSaved("");
          }
          reload();
        })
        .catch((e: Error) => setError(e.message));
    },
    [playId, open, reload],
  );

  /** 按目录分组（保持服务端排序）。 */
  const tree = useMemo(() => {
    const groups = new Map<string, PlayFile[]>();
    for (const file of files) {
      const dir = file.dir.join("/") || ".";
      const list = groups.get(dir);
      if (list) list.push(file);
      else groups.set(dir, [file]);
    }
    return [...groups.entries()];
  }, [files]);

  const dirty = open !== null && draft !== saved;
  const openIsImage = open !== null && IMAGE_EXT.test(open);
  const images = useMemo(
    () => files.filter((f) => IMAGE_EXT.test(f.path)).map((f) => ({ url: assetUrl(playId, f.path), caption: f.path })),
    [files, playId],
  );

  return (
    <div className="workshop-files">
      <div className="workshop-file-tree">
        <div className="file-tree-bar">
          <button className="ghost-btn tiny-btn" onClick={create} title="新建文件">
            ＋ 新建
          </button>
          <button className="ghost-btn tiny-btn" onClick={reload} title="刷新">
            ⟳
          </button>
        </div>
        {error && <div className="error-banner small">{error}</div>}
        {tree.map(([dir, list]) => (
          <div key={dir} className="file-group">
            <div className="file-group-name">{dir === "." ? "根目录" : dir}</div>
            {list.map((file) => (
              <div key={file.path} className={`file-row${open === file.path ? " active" : ""}`}>
                <button
                  className="file-entry"
                  onClick={() => select(file.path)}
                  title={file.writable ? "可编辑" : "只读"}
                >
                  {basename(file.path)}
                  {!file.writable && <span className="muted"> 只读</span>}
                </button>
                {file.writable && file.path !== "play.json" && (
                  <button className="ghost-btn tiny-btn" title="删除" onClick={() => remove(file.path)}>
                    ✕
                  </button>
                )}
              </div>
            ))}
          </div>
        ))}
        {files.length === 0 && <p className="muted small">（暂无文件）</p>}
      </div>

      <div className="workshop-file-editor">
        {openIsImage ? (
          <>
            <header className="file-editor-bar">
              <span className="file-path">{open}</span>
              <span className="file-state">图片（只读）</span>
              <button
                className="ghost-btn small-btn"
                onClick={() =>
                  setLightbox({ images, index: Math.max(0, images.findIndex((i) => i.caption === open)) })
                }
              >
                放大
              </button>
            </header>
            <div className="file-image-preview">
              <img src={assetUrl(playId, open)} alt={open} />
            </div>
          </>
        ) : open ? (
          <>
            <header className="file-editor-bar">
              <span className="file-path">{open}</span>
              <span className={`file-state${dirty ? " dirty" : ""}`}>{dirty ? "未保存" : "已保存"}</span>
              <button className="primary small-btn" disabled={!dirty || busy} onClick={save}>
                保存
              </button>
              <button className="ghost-btn small-btn" disabled={!dirty} onClick={() => setDraft(saved)}>
                还原
              </button>
            </header>
            <textarea
              className="file-editor"
              value={draft}
              spellCheck={false}
              onChange={(e) => setDraft(e.target.value)}
            />
          </>
        ) : (
          <p className="muted small">选一个文件开始编辑。</p>
        )}
      </div>

      {lightbox && (
        <ImageLightbox
          images={lightbox.images}
          index={lightbox.index}
          onIndex={(index) => setLightbox({ ...lightbox, index })}
          onClose={() => setLightbox(null)}
        />
      )}
    </div>
  );
}

function basename(path: string): string {
  return path.slice(path.lastIndexOf("/") + 1);
}

/** 剧目内相对路径 → 静态服务地址（与 http.ts 的 /plays/:id/assets 路由一致）。 */
function assetUrl(playId: string, path: string): string {
  return `/plays/${playId}/${path.split("/").map(encodeURIComponent).join("/")}`;
}
