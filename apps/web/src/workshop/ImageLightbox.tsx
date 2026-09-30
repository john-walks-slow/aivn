import { Icon } from "../ui/Icon.js";
import { useEscape } from "../ui/escape.js";

/** 图片灯箱：点开看大图，点任意处/Esc 关闭。缩略图太小看不出素材好坏，这是刚需。 */
export function ImageLightbox({
  url,
  name,
  onClose,
}: {
  url: string;
  name: string;
  onClose: () => void;
}) {
  useEscape(onClose);

  return (
    <div className="image-lightbox" onClick={onClose} role="dialog" aria-label={name}>
      <figure className="image-lightbox-figure" onClick={(e) => e.stopPropagation()}>
        <img src={url} alt={name} />
        <figcaption>
          <span className="image-lightbox-name">{name}</span>
          <button className="ghost-btn icon-btn" onClick={onClose} title="关闭">
            <Icon name="close" size={16} />
          </button>
        </figcaption>
      </figure>
    </div>
  );
}
