import { useCallback, useEffect, useState } from "react";
import { api } from "../api.js";
import { Icon } from "../ui/Icon.js";

/**
 * 创作口径：剧作家每一拍怎么写都听这一份（memory/always/craft.md）。
 * 与工坊对话改的是同一个文件——用户在这里手写，工坊 agent 也用 write_file 改它。
 */
export function CraftPanel({ playId }: { playId: string }) {
  const [text, setText] = useState("");
  const [isDefault, setIsDefault] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [state, setState] = useState<"idle" | "saved">("idle");

  const reload = useCallback((): void => {
    api
      .craft(playId)
      .then((c) => {
        setText(c.content);
        setIsDefault(c.isDefault);
        setState("idle");
      })
      .catch((e: Error) => setError(e.message));
  }, [playId]);
  useEffect(reload, [reload]);

  const save = (): void => {
    setBusy(true);
    setError(null);
    api
      .saveCraft(playId, text)
      .then(() => {
        setIsDefault(false);
        setState("saved");
      })
      .catch((e: Error) => setError(e.message))
      .finally(() => setBusy(false));
  };

  return (
    <div className="workshop-tab-pane craft-pane">
      <header className="craft-bar">
        <p className="muted small">
          剧作家每一拍都按这份写。自由写，不用挑选项——工坊对话里也能让它改同一份。
        </p>
        <div className="craft-bar-actions">
          {isDefault && <span className="badge">默认口径</span>}
          <button className="ghost-btn small-btn" onClick={reload} disabled={busy}>
            重新载入
          </button>
          <button className="primary small-btn" onClick={save} disabled={busy}>
            <span className="btn-icon">
              <Icon name="save" size={13} /> 保存
            </span>
          </button>
        </div>
      </header>

      {error && (
        <div className="error-banner small" role="alert">
          {error}
        </div>
      )}

      <textarea
        className="craft-editor"
        value={text}
        spellCheck={false}
        onChange={(e) => {
          setText(e.target.value);
          setState("idle");
        }}
      />

      <footer className="craft-foot muted small">
        {state === "saved" ? (
          <span className="craft-saved">已保存——下一拍起生效（演出中会等当前这一拍拍完）。</span>
        ) : (
          <span>保存后重建剧作家，下一拍按新口径写。</span>
        )}
      </footer>
    </div>
  );
}
