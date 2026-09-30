import { useEffect } from "react";
import { useEscape } from "./escape.js";

export interface LightboxImage {
  url: string;
  /** 灯箱底部的一行说明，通常是剧目内相对路径。 */
  caption: string;
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

  // Esc 归全局浮层栈（开着它的那一层才是栈顶）；左右翻页是灯箱自己的事
  useEscape(onClose);

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
      <div className="lightbox-stage" onClick={(e) => e.stopPropagation()}>
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
      </div>
      <button className="lightbox-close" onClick={onClose} aria-label="关闭">
        ✕
      </button>
    </div>
  );
}
