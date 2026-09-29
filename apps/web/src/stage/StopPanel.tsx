import { useEffect, useState } from "react";
import type { StopPayload } from "@stage-ai/core";

interface StopPanelProps {
  stop: StopPayload | null;
  isActEnd: boolean;
  disabled: boolean;
  /** 玩家在这条线路之外选过/说过同款选项的文案（用于「✓ 已选过」留痕）。 */
  seenChoices?: ReadonlySet<string>;
  onChoice: (index: number) => void;
  onFree: (text: string) => void;
  onContinue: () => void;
  /** 输入润色（P4）：传原始文本，返回润色文本；失败抛错由本组件就地提示。 */
  onPolish: (text: string) => Promise<string>;
}

/**
 * 停止点（玩家主权的三种形态，P6.5）：
 * - choice：舞台中央悬浮的选肢卡片，数字键 1..9 直选，选过的打勾留痕；
 * - free：对话框形态的入戏输入（可 LLM 润色，撤销保原稿）；
 * - pause/幕完：推进胶囊。
 * 导演注（OOC）是常驻顶栏，不在此。
 */
export function StopPanel({
  stop,
  isActEnd,
  disabled,
  seenChoices,
  onChoice,
  onFree,
  onContinue,
  onPolish,
}: StopPanelProps) {
  const [draft, setDraft] = useState("");
  /** 自由输入是从选项/继续里点开的（DSL 没给 free 停止点也能自己说）。 */
  const [freeOpen, setFreeOpen] = useState(false);
  /** 润色前的原始输入（非空 = 当前草稿是润色产物，可撤销）。 */
  const [original, setOriginal] = useState<string | null>(null);
  const [polishing, setPolishing] = useState(false);
  const [polishError, setPolishError] = useState<string | null>(null);

  // 换停止点即清场：自由输入是这一拍的一次性入口，草稿不该带到下一拍。
  useEffect(() => {
    setFreeOpen(false);
    setDraft("");
    setOriginal(null);
    setPolishError(null);
  }, [stop, isActEnd]);

  const options = stop?.stopType === "choice" ? (stop.options ?? []) : [];
  const choosing = options.length > 0 && !freeOpen;

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

  return (
    <>
      {choosing && (
        <div className="choice-overlay" role="group" aria-label="选项">
          {options.map((option, index) => (
            <button
              type="button"
              key={`${index}-${option.text}`}
              className="choice"
              disabled={disabled}
              onClick={() => onChoice(index)}
            >
              <span className="choice-text">{option.text}</span>
              {seenChoices?.has(option.text) && <span className="choice-seen">✓ 已选过</span>}
            </button>
          ))}
          <button
            type="button"
            className="choice ghost"
            disabled={disabled}
            onClick={() => setFreeOpen(true)}
            title="不说选项，自己写一句"
          >
            <span className="choice-text">自由发挥…</span>
          </button>
        </div>
      )}

      {(stop?.stopType === "free" || freeOpen) && (
        <footer className="stop-panel">
          <div className="free-box">
            <input
              value={draft}
              placeholder={stop?.stopType === "free" ? (stop.placeholder ?? "你的回应…") : "以主角口吻自己写一句…"}
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
              disabled={disabled || polishing || draft.trim() === ""}
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
        </footer>
      )}

      {(stop?.stopType === "pause" || (isActEnd && !stop)) && !freeOpen && (
        <footer className="stop-panel">
          <div className="continue-box">
            <button type="button" onClick={onContinue} disabled={disabled} className="primary">
              {isActEnd && !stop ? "下一幕" : "继续"}
            </button>
          </div>
        </footer>
      )}
    </>
  );
}
