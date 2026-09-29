import { useCallback, useEffect, useMemo, useState } from "react";
import { notifyThemeChanged } from "../theme.js";
import type { PlayFile } from "../api.js";
import { api, fileUrl } from "../api.js";
import { Icon, type IconName } from "../ui/Icon.js";
import { ImageLightbox } from "./ImageLightbox.js";

/** 二进制文件在树里的图标：一眼分出「能编辑」和「只能看」。 */
const KIND_ICON: Record<string, IconName> = { text: "files", image: "assets", audio: "chat", binary: "files" };

/** 剧目文件浏览器（D9）：工坊目录树 + 文本编辑 + 图片/音频预览。可写面由服务端白名单裁定（PlayFiles）。 */
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
  const [zoom, setZoom] = useState<{ url: string; name: string } | null>(null);

  const reload = useCallback((): void => {
    api
      .listFiles(playId)
      .then(setFiles)
      .catch((e: Error) => setError(e.message));
  }, [playId]);

  useEffect(reload, [reload, revision]);

  const select = useCallback(
    (path: string, kind: PlayFile["kind"] = "text"): void => {
      setError(null);
      if (kind !== "text") {
        setOpen(path);
        setDraft("");
        setSaved("");
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
        if (open === "theme.css") notifyThemeChanged();
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
  const selected = useMemo(() => files.find((f) => f.path === open), [files, open]);

  return (
    <div className="workshop-files">
      <div className="workshop-file-tree">
        <div className="file-tree-bar">
          <button className="ghost-btn tiny-btn" onClick={create} title="新建文件">
            <span className="btn-icon">
              <Icon name="plus" size={13} /> 新建
            </span>
          </button>
          <button className="ghost-btn tiny-btn icon-btn icon-btn-xs" onClick={reload} title="刷新">
            <Icon name="refresh" size={13} />
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
                  onClick={() => select(file.path, file.kind)}
                  title={file.writable ? "可编辑" : "只读"}
                >
                  <Icon name={KIND_ICON[file.kind] ?? "files"} size={13} />
                  {basename(file.path)}
                  {!file.writable && <span className="muted"> 只读</span>}
                </button>
                {file.writable && file.path !== "play.json" && (
                  <button
                    className="ghost-btn tiny-btn icon-btn icon-btn-xs"
                    title="删除"
                    onClick={() => remove(file.path)}
                  >
                    <Icon name="close" size={13} />
                  </button>
                )}
              </div>
            ))}
          </div>
        ))}
        {files.length === 0 && <p className="muted small">（暂无文件）</p>}
      </div>

      <div className="workshop-file-editor">
        {open ? (
          selected && selected.kind !== "text" ? (
            <BinaryPreview
              playId={playId}
              path={open}
              kind={selected.kind}
              onZoom={(url, name) => setZoom({ url, name })}
            />
          ) : (
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
          )
        ) : (
          <p className="muted small">选一个文件开始编辑。</p>
        )}
      </div>

      {zoom && <ImageLightbox url={zoom.url} name={zoom.name} onClose={() => setZoom(null)} />}
    </div>
  );
}

/** 非文本文件不进编辑器：图片给预览 + 点开放大，音频给播放器，其余提示不支持预览。 */
function BinaryPreview({
  playId,
  path,
  kind,
  onZoom,
}: {
  playId: string;
  path: string;
  kind: PlayFile["kind"];
  onZoom: (url: string, name: string) => void;
}) {
  const url = fileUrl(playId, path);
  return (
    <div className="file-preview">
      {kind === "image" ? (
        <button className="file-preview-image" onClick={() => onZoom(url, path)} title="点击看大图">
          <img src={url} alt={path} />
        </button>
      ) : kind === "audio" ? (
        <div className="file-preview-audio">
          <audio src={url} controls />
        </div>
      ) : (
        <p className="muted small">这个格式没法预览。</p>
      )}
    </div>
  );
}

function basename(path: string): string {
  return path.slice(path.lastIndexOf("/") + 1);
}
