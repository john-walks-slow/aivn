import type { ReactNode } from "react";
import { Icon } from "@aivn/stage";

/**
 * 舞台上就地展开的面板：回顾 / 路线 / 画廊共用一副框。
 *
 * 舞台本身不卸载（配乐、立绘、播放头原样留着），面板盖在它上面：
 *  - `drawer`：右侧抽屉（回顾）。点抽屉外的画面即关闭，读着读着想回去就点一下。
 *  - `full`：铺满的面板（路线、画廊）。画布本身要拖拽，所以不做「点外面关闭」。
 *
 * 关闭只有一个出口：右上角的 ×（Esc 由外层统一接管）。
 */
export function StagePanel({
  variant,
  title,
  subtitle,
  className,
  actions,
  onClose,
  children,
}: {
  variant: "drawer" | "full";
  title: string;
  subtitle?: string;
  /** 面板自己的修饰类：路线面板用它把镜头控制挪到底部一条（窄屏单手够得到）。 */
  className?: string;
  /** 标题右侧的面板自己的工具（回顾的分段切换、路线的镜头）。 */
  actions?: ReactNode;
  onClose: () => void;
  children: ReactNode;
}) {
  const panel = (
    <section
      className={`stage-panel stage-panel-${variant}${className ? ` ${className}` : ""}`}
      role="dialog"
      aria-label={title}
      onClick={(e) => e.stopPropagation()}
    >
      <header className="stage-panel-head">
        <div className="stage-panel-titles">
          <h2 className="stage-panel-title">{title}</h2>
          {subtitle && <span className="stage-panel-sub">{subtitle}</span>}
        </div>
        {actions && <div className="stage-panel-actions">{actions}</div>}
        <button
          type="button"
          className="stage-panel-close"
          onClick={onClose}
          title="回到游戏（Esc）"
          aria-label="关闭"
        >
          <Icon name="close" size={17} />
        </button>
      </header>
      <div className="stage-panel-body">{children}</div>
    </section>
  );

  return (
    <div className={`stage-panel-scrim stage-panel-scrim-${variant}`} onClick={variant === "drawer" ? onClose : undefined}>
      {panel}
    </div>
  );
}
