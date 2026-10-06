import type { ReactNode } from "react";
import type { LightboxImage } from "../ui/ImageLightbox.js";
import { compiler } from "markdown-to-jsx";

/**
 * 工坊对话的markdown渲染：使用轻量库 markdown-to-jsx 实现常见markdown语法，
 * 仅允许本地剧目素材图片点击打开灯箱，外部图片一律不渲染。
 */

/**
 * 只认同源的剧目素材路径（assets/ 或生图草稿 drafts/），外链与 javascript: 一律当普通文本，
 * 不给模型往页面里塞任意 src 的机会。
 *
 * 草稿要认：`generate_image` 在工坊只出草稿，候选预览就靠这条 markdown 图给用户看。
 */
function assetUrl(src: string): string | null {
  const url = src.trim().replace(/^<|>$/g, "");
  if (!/^\/plays\/[\w-]+\/(?:assets|drafts)\/[\w./-]+$/.test(url)) return null;
  return url;
}

/**
 * 将 markdown 文本转换为 React 元素，
 * 图片组件会检查是否为本地素材图片：
 * - 是：渲染为可点击的按钮，点击打开灯箱
 * - 否：返回 null（不渲染）
 * 强调（**文本**）和行内代码（`代码`）使用原生 HTML 标签。
 */
export function WorkshopMarkdown({
  text,
  onOpen,
}: {
  text: string;
  onOpen: (images: LightboxImage[], index: number) => void;
}) {
  // 收集所有本地素材图片，用于在点击时传递正确的索引
  const imageRegex = /!\s*\[([^\]]*)\]\(([^)]+)\)/g;
  const gallery: LightboxImage[] = [];
  const seen = new Set<string>();
  let match: RegExpExecArray | null;
  while ((match = imageRegex.exec(text)) !== null) {
    // 这两个捕获组在正则命中时一定存在
    const m = match;
    const alt = m[1] ?? "";
    const src = m[2]!;
    const url = assetUrl(src);
    if (url && !seen.has(url)) {
      seen.add(url);
      gallery.push({ url, caption: alt || "剧目素材" });
    }
  }

  // 自定义组件：覆盖图片、强调、行内代码
  const overrides = {
    img: (props: { src?: string; alt?: string }) => {
      const { src: imgSrc = "", alt: imgAlt = "" } = props;
      const url = assetUrl(imgSrc);
      if (!url) return null; // 外部图片不渲染
      const index = gallery.findIndex((img) => img.url === url);
      if (index === -1) {
        return null;
      }
      return (
        <button
          key={`img-${index}`}
          className="md-image"
          onClick={() => onOpen(gallery, index)}
          title={imgAlt}
        >
          <img src={url} alt={imgAlt} loading="lazy" />
        </button>
      );
    },
    strong: (props: { children?: ReactNode }) => <strong>{props.children}</strong>,
    code: (props: { children?: ReactNode }) => <code>{props.children}</code>,
  };

  // 使用 markdown-to-jsx 的 compiler 渲染（v9 已移除 breaks 选项；.md-body p { white-space: pre-wrap } 已接管单换行）
  const element = compiler(text, {
    overrides,
  });

  return <div className="md-body">{element}</div>;
}