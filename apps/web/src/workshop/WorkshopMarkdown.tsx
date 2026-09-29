import type { ReactNode } from "react";
import type { LightboxImage } from "../ui/ImageLightbox.js";

/**
 * 工坊对话的极简 markdown：只认图片、粗体、行内代码、换行。
 *
 * 不引 markdown 库——工坊的回复面就这几种东西，为了渲染一段文字塞一整个解析器不值当。
 * 图片是重点：工坊 agent 会把 `generate_asset` 的素材 URL 写成 `![](...)` 贴出来，
 * 用户点一下开灯箱，这是**验收路径**（只报一句「已生成」等于让人凭空点头）。
 */

/** 只认同源的剧目素材路径，外链与 javascript: 一律当普通文本，不给模型往页面里塞任意 src 的机会。 */
function assetUrl(src: string): string | null {
  const url = src.trim().replace(/^<|>$/g, "");
  if (!/^\/plays\/[\w-]+\/assets\/[\w./-]+$/.test(url)) return null;
  return url;
}

type Span = { kind: "text" | "bold" | "code"; value: string };

/** 行内记号：**粗体** 与 `代码`。图片单独走段落级。 */
function parseSpans(line: string): Span[] {
  const spans: Span[] = [];
  const pattern = /\*\*([^*]+)\*\*|`([^`]+)`/g;
  let last = 0;
  for (const m of line.matchAll(pattern)) {
    const at = m.index ?? 0;
    if (at > last) spans.push({ kind: "text", value: line.slice(last, at) });
    if (m[1] !== undefined) spans.push({ kind: "bold", value: m[1] });
    else if (m[2] !== undefined) spans.push({ kind: "code", value: m[2] });
    last = at + m[0].length;
  }
  if (last < line.length) spans.push({ kind: "text", value: line.slice(last) });
  return spans;
}

const IMAGE_LINE = /^\s*!\[([^\]]*)\]\(([^)]+)\)\s*$/;

export function WorkshopMarkdown({
  text,
  onOpen,
}: {
  text: string;
  onOpen: (images: LightboxImage[], index: number) => void;
}) {
  const lines = text.split("\n");
  const out: ReactNode[] = [];
  const gallery: LightboxImage[] = [];

  const pushImage = (alt: string, url: string) => {
    const index = gallery.length;
    gallery.push({ url, caption: alt });
    out.push(
      <button key={`img-${index}`} className="md-image" onClick={() => onOpen(gallery, index)} title={alt}>
        <img src={url} alt={alt} loading="lazy" />
      </button>,
    );
  };

  const buffer: Span[][] = [];
  const flush = () => {
    if (buffer.length === 0) return;
    out.push(
      <p key={`p-${out.length}`}>
        {buffer.map((spans, i) => (
          <span key={i}>
            {i > 0 && <br />}
            {spans.map((span, j) => renderSpan(span, `${i}-${j}`))}
          </span>
        ))}
      </p>,
    );
    buffer.length = 0;
  };

  for (const line of lines) {
    const image = IMAGE_LINE.exec(line);
    const url = image ? assetUrl(image[2] ?? "") : null;
    if (image && url) {
      flush();
      pushImage(image[1] || "剧目素材", url);
      continue;
    }
    if (line.trim() === "") {
      flush();
      continue;
    }
    buffer.push(parseSpans(line));
  }
  flush();

  return <div className="md-body">{out}</div>;
}

function renderSpan(span: Span, key: string) {
  if (span.kind === "bold") return <strong key={key}>{span.value}</strong>;
  if (span.kind === "code") return <code key={key}>{span.value}</code>;
  return <span key={key}>{span.value}</span>;
}
