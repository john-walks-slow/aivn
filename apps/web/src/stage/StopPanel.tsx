import { useEffect, useState } from "react";
import type { StopPayload } from "@stage-ai/core";
import { Icon } from "../ui/Icon.js";
import { Modal } from "../ui/Modal.js";

interface StopPanelProps {
  stop: StopPayload | null;
  isNoStop: boolean;
  /** 这一轮的出口摆成卡片（设置项，默认关；关了点舞台就是继续）。 */
  showContinue: boolean;
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

/** 自己写一句也是选项的一种类型：不是单独一个按钮，而是列表里的最后一张卡。 */
const FREE_CHOICE = "自由输入";

/**
 * 停止点（玩家主权的三种形态，P6.5）：
 * - choice：画面中央悬浮的选肢卡片，选过的打勾留痕；
 * - free：没有剧本选项时，列表里就只有「自由输入」这一张卡——它同样是选项，不是旁路；
 * - pause：只在编排器造出来时出现（轮中分岔被截断 / 空轮报错）——不出按钮，
 *   玩家点舞台即表态续写开新一轮（见 StageTheater.onStageClick）；
 * - 本轮写完（beat_done 无 stop）：默认没有卡片，点舞台就是继续（与翻句同一个动作）；
 *   设置里打开了「（继续）」卡才在这里摆一个普通选项——括号表明它是系统给的，不是角色给的台词。
 * 自由输入的模态窗随时能关：关掉回到列表，「自由输入」那张卡还摆在那里。
 * 提示词 / 改写 / 重新生成 / 分岔在对话框底部的导演栏里，不在此。
 *
 * 本组件挂在**画面区**里（StageTheater 把它放进 `.theater-stage`）：选肢卡片仍然居中、
 * 背景仍然暗化，但台词条、导演栏、侧栏与排队面板都在浮层之外，选肢期间照常能点能用。
 * 唯一被挡住的是「点画面继续」——选项摆着的时候，那一下必须是选中的那张卡。
 */
export function StopPanel({
  stop,
  isNoStop,
  showContinue,
  disabled,
  seenChoices,
  onChoice,
  onFree,
  onContinue,
  onPolish,
}: StopPanelProps) {
  const [draft, setDraft] = useState("");
  /** 自由输入是从选项列表里点开的（纯 free 停止点也有一张）。 */
  const [freeOpen, setFreeOpen] = useState(false);
  /** 润色前的原始输入（非空 = 当前草稿是润色产物，可撤销）。 */
  const [original, setOriginal] = useState<string | null>(null);
  const [polishing, setPolishing] = useState(false);
  const [polishError, setPolishError] = useState<string | null>(null);

  // 换停止点即清场：自由输入是这一轮的一次性入口，草稿不该带到下一轮。
  useEffect(() => {
    setFreeOpen(false);
    setDraft("");
    setOriginal(null);
    setPolishError(null);
  }, [stop, isNoStop]);

  const scripted = stop?.stopType === "choice" ? (stop.options ?? []) : [];
  /** 有选项、或者剧本给的就是一个自由输入停止点：列表才摆出来。 */
  const listing = scripted.length > 0 || stop?.stopType === "free";

  const submitFree = (): void => {
    const text = draft.trim();
    if (text) {
      onFree(text);
      setDraft("");
      setOriginal(null);
      setPolishError(null);
      setFreeOpen(false);
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
      {listing && !freeOpen && (
        <div className="choice-overlay" role="group" aria-label="选项" {...trap}>
          {scripted.map((option, index) => (
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
            title="不说选项，以主角口吻自己写一句"
          >
            <span className="choice-text">{FREE_CHOICE}</span>
          </button>
        </div>
      )}

      {/* 自由输入也是从那张卡点开的（纯 free 停止点只有它一张），所以这里必定有列表可回 */}
      {freeOpen && (
        <Modal
          title="自由输入"
          hint="以主角口吻写一句。"
          width={560}
          onClose={() => setFreeOpen(false)}
          footer={
            <>
              <button
                type="button"
                className="ghost-btn free-back"
                onClick={() => setFreeOpen(false)}
                disabled={disabled}
                title="不自己写了，回去选"
              >
                <Icon name="prev" size={14} />
                返回选项
              </button>
              {polishError && <span className="muted small">润色失败：{polishError}</span>}
              <button type="button" className="primary" onClick={submitFree} disabled={disabled || draft.trim() === ""}>
                说
              </button>
            </>
          }
        >
          <div className="free-box">
            <input
              value={draft}
              placeholder={stop?.stopType === "free" ? (stop.placeholder ?? "你的回应…") : "以主角口吻自己写一句…"}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && submitFree()}
              disabled={disabled}
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
          </div>
        </Modal>
      )}

      {/* pause（轮中截断 / 空轮报错）与默认设置下的本轮写完都不摆按钮：点舞台就是继续，
          与翻下一句同一个动作，生成中沿用同一套 pending/streaming 反馈。 */}
      {/* 设置里打开「（继续）」卡时才摆：跟选肢用同一张卡片样式，不压黑舞台——
          引擎里不存在比轮更大的单位，界面也不该暗示有。 */}
      {isNoStop && showContinue && !stop && (
        <div className="choice-overlay" role="group" aria-label="继续" {...trap}>
          <div className="choices">
            <button type="button" className="choice" onClick={onContinue} disabled={disabled}>
              <Icon name="forward" />
              （继续）
            </button>
          </div>
        </div>
      )}
    </>
  );
}
