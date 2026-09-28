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
}

/**
 * 停止点面板（玩家输入区）：
 * choice → 选项按钮；free → 文本输入；pause/幕完 → 继续按钮。
 * 导演输入（OOC）在任意 stopped 态可用。
 */
export function StopPanel({ stop, isActEnd, disabled, onChoice, onFree, onContinue, onOoc }: StopPanelProps) {
  const [draft, setDraft] = useState("");
  const [oocDraft, setOocDraft] = useState("");
  const [oocOpen, setOocOpen] = useState(false);

  const submitFree = (): void => {
    const text = draft.trim();
    if (text) {
      onFree(text);
      setDraft("");
    }
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
          <button type="button" onClick={submitFree} disabled={disabled || draft.trim() === ""}>
            说
          </button>
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
