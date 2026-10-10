import { useEffect, useRef } from "react";
import { useEscape } from "@aivn/stage";

export interface LightboxImage {
  url: string;
  /** 灯箱底部的一行说明，通常是剧目内相对路径。 */
  caption: string;
  /** caption 下面那段正文（可留空）：画廊里那张图当初照什么生成的。 */
  detail?: string;
}

/**
 * 图片灯箱：点缩略图看大图。
 * 背景/立绘的细节在 120px 的缩略图上根本看不清（差分表情、背景构图都是要盯的），
 * 而「出图对不对」是用户唯一能自己判断的事——没有放大就等于让用户盲签。
 */
export function ImageLightbox({
  images,
  index,
  onIndex,
  onClose,
}: {
  images: LightboxImage[];
  index: number;
  onIndex: (next: number) => void;
  onClose: () => void;
}) {
  const current = images[index];
  const touch = useRef<{ x: number; y: number } | null>(null);

  // Esc 归全局浮层栈（开着它的那一层才是栈顶）；左右翻页是灯箱自己的事
  useEscape(onClose);

  /**
   * 手机上翻页靠划：屏幕上那对箭头是给鼠标留的，指头去戳两枚 26px 的小键
   * 又慢又容易点空。判据是「横向位移够大，且明显大于纵向」——不然上下滚提示词
   * 会被误判成翻页。
   */
  const onTouchStart = (e: React.TouchEvent): void => {
    const t = e.touches[0];
    touch.current = t ? { x: t.clientX, y: t.clientY } : null;
  };

  const onTouchEnd = (e: React.TouchEvent): void => {
    const start = touch.current;
    touch.current = null;
    const t = e.changedTouches[0];
    if (!start || !t || images.length < 2) return;
    const dx = t.clientX - start.x;
    const dy = t.clientY - start.y;
    if (Math.abs(dx) < 48 || Math.abs(dx) < Math.abs(dy) * 1.5) return;
    if (dx < 0 && index < images.length - 1) onIndex(index + 1);
    if (dx > 0 && index > 0) onIndex(index - 1);
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === "ArrowRight" && index < images.length - 1) onIndex(index + 1);
      if (e.key === "ArrowLeft" && index > 0) onIndex(index - 1);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [index, images.length, onIndex]);

  if (!current) return null;
  return (
    <div className="lightbox" role="dialog" aria-label="查看图片" onClick={onClose}>
      <div
        className="lightbox-stage"
        onClick={(e) => e.stopPropagation()}
        onTouchStart={onTouchStart}
        onTouchEnd={onTouchEnd}
      >
        <img src={current.url} alt={current.caption} />
        {images.length > 1 && (
          <div className="lightbox-nav">
            <button
              className="ghost-btn"
              disabled={index === 0}
              onClick={() => onIndex(index - 1)}
              aria-label="上一张"
            >
              ‹
            </button>
            <span className="muted small">
              {index + 1} / {images.length}
            </span>
            <button
              className="ghost-btn"
              disabled={index === images.length - 1}
              onClick={() => onIndex(index + 1)}
              aria-label="下一张"
            >
              ›
            </button>
          </div>
        )}
        <p className="lightbox-caption muted small">{current.caption}</p>
        {current.detail && <p className="lightbox-detail">{current.detail}</p>}
      </div>
      <button className="lightbox-close" onClick={onClose} aria-label="关闭">
        ✕
      </button>
    </div>
  );
}
