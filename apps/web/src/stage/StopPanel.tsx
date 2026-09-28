import { useState } from "react";
import type { StopPayload } from "@stage-ai/core";

interface StopPanelProps {
  stop: StopPayload | null;
  isActEnd: boolean;
  disabled: boolean;
  onChoice: (index: number) => void;
  onFree: (text: string) => void;
  onContinue: () => void;
  onOoc: (text: string) => void;
  /** 输入润色（P4）：传原始文本，返回润色文本；失败抛错由本组件就地提示。 */
  onPolish: (text: string) => Promise<string>;
}

/**
 * 停止点面板（玩家输入区）：
 * choice → 选项按钮；free → 文本输入（可 LLM 润色，撤销保原稿）；pause/幕完 → 继续按钮。
 * 导演输入（OOC）在任意 stopped 态可用。
 */
export function StopPanel({ stop, isActEnd, disabled, onChoice, onFree, onContinue, onOoc, onPolish }: StopPanelProps) {
  const [draft, setDraft] = useState("");
  /** 润色前的原始输入（非空 = 当前草稿是润色产物，可撤销）。 */
  const [original, setOriginal] = useState<string | null>(null);
  const [polishing, setPolishing] = useState(false);
  const [polishError, setPolishError] = useState<string | null>(null);
  const [oocDraft, setOocDraft] = useState("");
  const [oocOpen, setOocOpen] = useState(false);

  const submitFree = (): void => {
    const text = draft.trim();
    if (text) {
      onFree(text);
      setDraft("");
      setOriginal(null);
      setPolishError(null);
    }
  };

  /** 润色始终基于原始输入：重按不叠加改写，撤销零损失。 */
  const polish = (): void => {
    const source = (original ?? draft).trim();
    if (!source || polishing) return;
    setPolishing(true);
    setPolishError(null);
    onPolish(source)
      .then((text) => {
        setOriginal(source);
        setDraft(text);
      })
      .catch((e: Error) => setPolishError(e.message))
      .finally(() => setPolishing(false));
  };

  const undoPolish = (): void => {
    if (original === null) return;
    setDraft(original);
    setOriginal(null);
    setPolishError(null);
  };

  const submitOoc = (): void => {
    const text = oocDraft.trim();
    if (text) {
      onOoc(text);
      setOocDraft("");
      setOocOpen(false);
    }
  };

  return (
    <footer className="stop-panel">
      {!oocOpen && (
        <button type="button" className="ooc-toggle" onClick={() => setOocOpen(true)}>
          导演备注
        </button>
      )}

      {oocOpen && (
        <div className="ooc-box">
          <input
            value={oocDraft}
            placeholder="对剧作家说（不改剧情走向的即时指令）…"
            onChange={(e) => setOocDraft(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && submitOoc()}
            autoFocus
          />
          <div className="ooc-actions">
            <button type="button" onClick={submitOoc} disabled={disabled || oocDraft.trim() === ""}>
              发送
            </button>
            <button type="button" className="ghost" onClick={() => setOocOpen(false)}>
              收起
            </button>
          </div>
        </div>
      )}

      {stop?.stopType === "choice" && (
        <div className="choices">
          {stop.options?.map((option, index) => (
            <button
              type="button"
              key={`${index}-${option.text}`}
              className="choice"
              disabled={disabled}
              onClick={() => onChoice(index)}
            >
              {option.text}
            </button>
          ))}
        </div>
      )}

      {stop?.stopType === "free" && (
        <div className="free-box">
          <input
            value={draft}
            placeholder={stop.placeholder ?? "你的回应…"}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && submitFree()}
            disabled={disabled}
            autoFocus
          />
          <button
            type="button"
            className="ghost-btn"
            title="LLM 按主角口吻润色（可撤销）"
            onClick={polish}
            disabled={disabled || polishing || (original ?? draft).trim() === ""}
          >
            {polishing ? "润色中…" : "✨ 润色"}
          </button>
          {original !== null && (
            <button type="button" className="link-btn" onClick={undoPolish} disabled={polishing}>
              撤销
            </button>
          )}
          <button type="button" onClick={submitFree} disabled={disabled || draft.trim() === ""}>
            说
          </button>
          {polishError && <span className="muted small">润色失败：{polishError}</span>}
        </div>
      )}

      {(stop?.stopType === "pause" || (isActEnd && !stop)) && (
        <div className="continue-box">
          <button type="button" onClick={onContinue} disabled={disabled} className="primary">
            {isActEnd && !stop ? "下一幕" : "继续"}
          </button>
        </div>
      )}

      {stop === null && !isActEnd && <div className="stop-hint">演出进行中…</div>}
    </footer>
  );
}
