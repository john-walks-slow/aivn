import { useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import type { ReactNode } from "react";

/**
 * 模态窗：所有「要打一串字再决定」的动作都走它——插一句（含 OOC）、改台词、
 * 重演这一轮、停止点的自由输入。
 *
 * 为什么不再从底下顶出一条：那条输入行横在画面下沿，一出现就把台词条顶上去、
 * 把立绘的脸盖掉，玩家想看一眼"我现在站在哪"都没地方看。居中的模态窗把输入
 * 收成一次明确的「我现在在写东西」，写完即消失，舞台回到原样。
 *
 * 两处必须自己做、外层替不了的：
 *  1. **吞掉触摸事件**：舞台监听着左右滑（翻句）与上滑（看回顾），不拦的话
 *     在输入框上滑一下就顺手把视图切走了。
 *  2. **吃掉 Esc**：外层 StageScreen 也监听 Esc（关视图），不拦就等于连按两下才关得掉。
 *
 * 挂到 body 上（portal）：台词条带 `backdrop-filter`，那是 fixed 定位的包含块——
 * 直接渲染在它里面的话，模态窗会以台词条为基准居中，而不是屏幕。
 */
export function Modal({
  title,
  hint,
  onClose,
  dismissible = true,
  children,
  footer,
  width = 520,
}: {
  title: string;
  /** 一句话说明这个动作会做什么（放在标题下，不是 tooltip）。 */
  hint?: ReactNode;
  onClose: () => void;
  /**
   * 能不能关掉。false 时没有 ✕、点遮罩与 Esc 都不管用——
   * 用于「不写就出不去」的场合（DSL 发的 free 停止点就是这种：唯一的出口是说一句）。
   */
  dismissible?: boolean;
  children: ReactNode;
  footer?: ReactNode;
  /** 卡片宽度。自由输入给窄一点，插一句给宽一点。 */
  width?: number;
}) {
  const cardRef = useRef<HTMLDivElement | null>(null);

  // 打开就把光标放进输入框（不点一下屏幕就能直接打字）。输入框优先于按钮：
  // 导演栏的「OOC：」快捷前缀排在输入框前面，抢先拿到焦点就等于要先按一下 Tab。
  useEffect(() => {
    const card = cardRef.current;
    const target = card?.querySelector<HTMLElement>("input, textarea, button");
    target?.focus();
    if (target instanceof HTMLInputElement) target.select();
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key !== "Escape") return;
      // 不可关的模态窗（free 停止点）也吃掉 Esc：它已经叫停了外层，
      // 否则按一下就把视图切走了，而这一轮的话还没说。
      e.stopPropagation();
      if (dismissible) onClose();
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [dismissible, onClose]);

  return createPortal(
    <div
      className="modal-scrim"
      role="dialog"
      aria-modal="true"
      aria-label={title}
      onClick={dismissible ? onClose : undefined}
      onTouchStart={(e) => e.stopPropagation()}
      onTouchMove={(e) => e.stopPropagation()}
      onTouchEnd={(e) => e.stopPropagation()}
    >
      <div
        className="modal-card"
        style={{ width }}
        ref={cardRef}
        onClick={(e) => e.stopPropagation()}
      >
        <header className="modal-head">
          <h2 className="modal-title">{title}</h2>
          {dismissible && (
            <button type="button" className="modal-x" onClick={onClose} aria-label="关闭">
              ✕
            </button>
          )}
        </header>
        {hint && <p className="modal-hint">{hint}</p>}
        <div className="modal-body">{children}</div>
        {footer && <footer className="modal-foot">{footer}</footer>}
      </div>
    </div>,
    document.body,
  );
}
