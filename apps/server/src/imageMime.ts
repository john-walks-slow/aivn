/** 图片候选扩展名：同一个 stem 下可能有哪几种文件（找缓存、查已有素材共用一份）。 */
export const IMAGE_EXTS = [".jpg", ".jpeg", ".png", ".webp", ".gif"] as const;

/** 图片字节头嗅探：扩展名与 content-type 都可能骗人，认头最实。 */
export function sniffImageMime(bytes: Buffer): string | null {
  if (bytes.length > 8 && bytes.subarray(1, 4).toString("latin1") === "PNG") return "image/png";
  if (bytes.length > 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "image/jpeg";
  if (bytes.length > 12 && bytes.subarray(8, 12).toString("latin1") === "WEBP") return "image/webp";
  if (bytes.length > 6 && bytes.subarray(0, 6).toString("latin1").startsWith("GIF8")) return "image/gif";
  return null;
}

/** 扩展名 → mime（网络图缓存按 URL 摘要落名，重看同一张时靠它还原类型）。 */
export function mimeForExt(ext: string): string | null {
  switch (ext.toLowerCase()) {
    case ".png":
      return "image/png";
    case ".jpg":
    case ".jpeg":
      return "image/jpeg";
    case ".webp":
      return "image/webp";
    case ".gif":
      return "image/gif";
    default:
      return null;
  }
}