import { useEffect, useState } from "react";
import type { StopPayload } from "@stage-ai/core";
import { Icon } from "../ui/Icon.js";

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
 * 浮层上的触摸要就地吃掉：舞台层监听着滑动手势（左右翻句、上滑看回顾），
 * 不拦的话在选肢卡片上滑一下就顺手把视图切走了。
 */
const trap = {
  onClick: (e: React.SyntheticEvent) => e.stopPropagation(),
  onTouchStart: (e: React.TouchEvent) => e.stopPropagation(),
  onTouchEnd: (e: React.TouchEvent) => e.stopPropagation(),
} as const;

/**
 * 停止点（玩家主权的三种形态，P6.5）：
 * - choice：舞台中央悬浮的选肢卡片，数字键 1..9 直选，选过的打勾留痕；
 * - free：对话框形态的入戏输入（可 LLM 润色，撤销保原稿）；
 * - pause：只在编排器造出来时出现（拍中分岔被截断 / 空拍报错）——不出按钮，
 *   玩家点舞台即表态续写开新拍（见 StageTheater.onStageClick）；
 * - 幕末（beat_done 无 stop）：黑场上的「下一幕」按钮——这一拍戏已经讲完，
 *   下一幕不在剧本里，所以只有这一个出口，点了才开新拍。
 * 自由输入是从选项卡点开的，有一个返回键——选了不说的自由，选项还摆在那里。
 * 导演注（OOC）在对话框底部的导演栏里，不在此。
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
  /** 自由输入是从选项里点开的（DSL 没给 free 停止点也能自己说）。 */
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
  /** 从选项点进来的才给返回键；DSL 发的 free 停止点本来就没得选，返回无处可回。 */
  const canBackOut = freeOpen && options.length > 0;

  const backToChoices = (): void => {
    setFreeOpen(false);
    setDraft("");
    setOriginal(null);
    setPolishError(null);
  };

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
        <div className="choice-overlay" role="group" aria-label="选项" {...trap}>
          {options.map((option, index) => (
            <button
              type="button"
              key={`${index}-${option.text}`}
              className="choice"
              disabled={disabled}
              onClick={() => onChoice(index)}
            >
              <span className="choice-text">{option.text}</span>
              {seenChoices?.has(option.text) && (
                <span className="choice-seen">
                  <Icon name="check" /> 已选过
                </span>
              )}
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
        <footer className="stop-panel" {...trap}>
          {canBackOut && (
            <button
              type="button"
              className="free-back"
              onClick={backToChoices}
              disabled={disabled}
              title="不自己写了，回去选"
            >
              <Icon name="prev" />
              返回选项
            </button>
          )}
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
              <Icon name="sparkles" />
              {polishing ? "润色中…" : "润色"}
            </button>
            {original !== null && (
              <button
                type="button"
                className="link-btn"
                onClick={undoPolish}
                disabled={polishing}
                title="退回润色前的原话"
              >
                <Icon name="undo" />
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

      {/* pause（拍中截断 / 空拍报错）不再单列「继续」按钮：点舞台就是继续，
          与翻下一句同一个动作，生成中沿用同一套 pending/streaming 反馈。 */}
      {/* 幕末：黑场 + 下一幕。整个面板盖住舞台，视觉上就是幕与幕之间的黑场。
          这一出留着自己的按钮：幕末没有台词可点，「下一幕」是全屏黑场里唯一的出口。 */}
      {isActEnd && !stop && !freeOpen && (
        <footer className="act-curtain">
          <button type="button" className="act-next" onClick={onContinue} disabled={disabled}>
            下一幕
          </button>
        </footer>
      )}
    </>
  );
}
