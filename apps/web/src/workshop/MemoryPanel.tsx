import { useCallback, useEffect, useMemo, useState } from "react";
import { api, type PlayFile } from "../api.js";
import { Icon } from "../ui/Icon.js";
import { memorySections } from "./memoryFiles.js";

/** 创作口径在磁盘上的路径：缺文件时服务端回退内置默认，所以它要单独取。 */
const CRAFT_PATH = "memory/always/craft.md";

/**
 * 记忆页：剧目记忆（`memory/**`）在这里读与改。
 *
 * 与「文件」页的分工：文件页是剧目目录的通用浏览器（什么都能看，能不能写由服务端
 * 白名单裁定）；记忆页只管 `memory/**`，并按「剧作家怎么用」分组讲清楚每张卡的作用——
 * 玩家在这里要知道的不是「有哪些文件」，而是「哪张每轮都进、哪张按需读、哪张碰不得」。
 *
 * 编辑落到 `api.saveFile`，与工坊 agent 的 `write_file` 同一条通道：写完在轮边界重建
 * 剧作家，正在写的那一轮不被打断。
 */
export function MemoryPanel({ playId, revision }: { playId: string; /** 工坊写盘次数：变了就重拉清单。 */ revision: number }) {
  const [files, setFiles] = useState<PlayFile[]>([]);
  const [open, setOpen] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [saved, setSaved] = useState("");
  /** craft.md 缺文件时读的是内置默认（isDefault），保存即落盘成用户自己的口径。 */
  const [isDefault, setIsDefault] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const reload = useCallback((): void => {
    api
      .listFiles(playId)
      .then(setFiles)
      .catch((e: Error) => setError(e.message));
  }, [playId]);
  useEffect(reload, [reload, revision]);

  const sections = useMemo(() => memorySections(files), [files]);

  const select = useCallback(
    (path: string): void => {
      setError(null);
      if (path === CRAFT_PATH) {
        api
          .craft(playId)
          .then((c) => {
            setOpen(path);
            setDraft(c.content);
            setSaved(c.content);
            setIsDefault(c.isDefault);
          })
          .catch((e: Error) => setError(e.message));
        return;
      }
      api
        .readFile(playId, path)
        .then(({ content }) => {
          setOpen(path);
          setDraft(content);
          setSaved(content);
          setIsDefault(false);
        })
        .catch((e: Error) => setError(e.message));
    },
    [playId],
  );

  const save = (): void => {
    if (!open) return;
    setBusy(true);
    setError(null);
    api
      .saveFile(playId, open, draft)
      .then(() => {
        setSaved(draft);
        setIsDefault(false);
        reload();
      })
      .catch((e: Error) => setError(e.message))
      .finally(() => setBusy(false));
  };

  const current = sections.find((s) => s.files.some((f) => f.path === open));
  const readOnly = current?.readOnly === true;
  const writable = !readOnly && (current?.files.find((f) => f.path === open)?.writable ?? false);
  const dirty = open !== null && draft !== saved;

  return (
    <div className="memory-pane">
      <aside className="memory-side">
        {error && <div className="error-banner small">{error}</div>}
        {sections.length === 0 && (
          <p className="muted small">还没有记忆文件。到「对话」里让工坊起草，或到「文件」页新建。</p>
        )}
        {sections.map((section) => (
          <section key={section.id} className="memory-group">
            <header className="memory-group-head">
              <h3>{section.title}</h3>
              {section.readOnly && <span className="badge">只读</span>}
            </header>
            <p className="memory-note">{section.note}</p>
            {section.files.map((file) => (
              <button
                key={file.path}
                className={`file-entry${open === file.path ? " active" : ""}`}
                onClick={() => select(file.path)}
                title={file.path}
              >
                <Icon name={file.path === CRAFT_PATH ? "craft" : "memory"} size={13} />
                {basename(file.path)}
              </button>
            ))}
          </section>
        ))}
      </aside>

      <div className="workshop-file-editor">
        {open === null ? (
          <p className="muted small">选一份记忆开始读或改。</p>
        ) : (
          <>
            <header className="file-editor-bar">
              <span className="file-path">{open}</span>
              {isDefault && <span className="badge">默认口径</span>}
              <span className={`file-state${dirty ? " dirty" : ""}`}>
                {readOnly ? "只读" : dirty ? "未保存" : "已保存"}
              </span>
              {!readOnly && (
                <>
                  <button className="ghost-btn small-btn" disabled={!dirty || busy} onClick={() => setDraft(saved)}>
                    还原
                  </button>
                  <button
                    className="primary small-btn"
                    disabled={!dirty || busy || !writable}
                    onClick={save}
                    title={writable ? "保存即在轮边界重建剧作家" : "服务端白名单不允许写这个文件"}
                  >
                    保存
                  </button>
                </>
              )}
            </header>
            {readOnly && (
              <p className="muted small">
                这一组是纪元压缩自动写的：谱系快照按文件名引用它、按分支过滤防剧透，手改会绕过那道过滤。
              </p>
            )}
            <textarea
              className="file-editor"
              value={draft}
              spellCheck={false}
              readOnly={readOnly || !writable}
              onChange={(e) => setDraft(e.target.value)}
            />
            {!readOnly && (
              <p className="muted small">
                {dirty
                  ? "保存后重建剧作家：正在写的那一轮写完即生效。"
                  : "已与磁盘一致。工坊对话里说一声也能改同一份。"}
              </p>
            )}
          </>
        )}
      </div>
    </div>
  );
}

function basename(path: string): string {
  return path.slice(path.lastIndexOf("/") + 1);
}
