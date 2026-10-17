import { open, readFile, stat } from "node:fs/promises";
import { existsSync } from "node:fs";
import { basename, extname } from "node:path";
import type { ImageContent } from "@earendil-works/pi-ai";
import type { WorkshopAttachment } from "@aivn/core";
import type { PlayStore } from "./store.js";
import { MAX_WEB_IMAGE_BYTES, sniffImageMime } from "@aivn/agent";

/**
 * 用户投进剧目的原始资料（`resources/`）。
 *
 * 与 `assets/` 的区别是方向：那里是**剧目素材**（喂给舞台的），这里是**人给的原作**
 * （喂给 agent 的）。落进剧目目录是有意的——agent 的 read / bash / view_image 全部以剧目
 * 目录为根，放别处它够不着；代价是导出剧目包会把原件一起带走（改编资料是这部剧的一部分）。
 */

export const RESOURCE_DIR = "resources";
/** 剧目内相对路径前缀（协议里的 path 一律长这样）。 */
export const RESOURCE_PREFIX = `${RESOURCE_DIR}/`;

/** 文件名上限：留出扩展名与去重后缀的余量，别把 Windows 的长路径顶爆。 */
const MAX_NAME_CHARS = 96;

/**
 * 文件名消毒：只留纯文件名一段，去掉路径、控制字符与 Windows 上的非法字符。
 *
 * 不用白名单字符集：原作名里有中文、空格、括号都很正常，全挡掉等于逼用户改名。
 */
export function safeResourceName(raw: string): string {
  const base = basename(raw.trim().split("\\").pop() ?? "");
  const cleaned = base
    .replace(/[\u0000-\u001f\u007f]/g, "")
    .replace(/[:*?"<>|]/g, "")
    .trim()
    // 前导点：`.env` 这类隐藏文件与 `..` 都从这儿挡掉
    .replace(/^\.+/, "");
  if (cleaned === "" || cleaned === "." || cleaned === "..") {
    throw new Error(`文件名不合法: ${raw}`);
  }
  if (cleaned.length <= MAX_NAME_CHARS) return cleaned;
  const ext = extname(cleaned);
  const stem = cleaned.slice(0, cleaned.length - ext.length).slice(0, MAX_NAME_CHARS - ext.length);
  return `${stem}${ext}`;
}

/** 重名不覆盖：`原作.epub` 已存在就落 `原作-2.epub`。 */
export function uniqueResourceName(name: string, taken: (candidate: string) => boolean): string {
  if (!taken(name)) return name;
  const ext = extname(name);
  const stem = name.slice(0, name.length - ext.length);
  for (let i = 2; i < 1000; i += 1) {
    const candidate = `${stem}-${i}${ext}`;
    if (!taken(candidate)) return candidate;
  }
  throw new Error(`同名文件太多: ${name}`);
}

/**
 * 单个文件名是否合法（静态服务与路径校验共用）。
 *
 * 刻意不用 http 层那个 `safeSeg`：它的 `\w` 只认 ASCII，而原作名里中文、空格、括号都很正常——
 * 用它挡一次，中文名的附件在列表里看得见、点开却是 404。这里只挡真正的路径风险。
 */
export function isResourceName(name: string): boolean {
  return name !== "" && !name.includes("/") && !name.includes("\\") && !name.startsWith(".");
}

/** 相对路径 → 文件名：必须是 `resources/<一段>`，否则拒绝。 */
export function resourceNameOf(rel: string): string {
  if (!rel.startsWith(RESOURCE_PREFIX)) throw new Error(`不是资源路径: ${rel}`);
  const name = rel.slice(RESOURCE_PREFIX.length);
  if (!isResourceName(name)) throw new Error(`不是资源路径: ${rel}`);
  return name;
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)}KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)}MB`;
}

/**
 * 按盘上那份现读一个附件视图。
 *
 * 尺寸与 kind 都从字节来（不看扩展名）：`.png` 后缀的文本、改了名的图，都会按真实内容定性。
 */
export async function readResource(store: PlayStore, rel: string, playId: string): Promise<WorkshopAttachment> {
  const name = resourceNameOf(rel);
  const abs = store.resourcePath(name);
  if (!existsSync(abs)) throw new Error(`附件不存在: ${rel}`);
  const info = await stat(abs);
  return {
    path: rel,
    name,
    size: info.size,
    kind: (await sniffHead(abs)) ? "image" : "file",
    url: `/plays/${playId}/resources/${encodeURIComponent(name)}`,
  };
}

/** 只读前 32 字节定性质：一份 60MB 的电子书不该为了认格式整个读进来。 */
async function sniffHead(abs: string): Promise<string | null> {
  const handle = await open(abs, "r");
  try {
    const buf = Buffer.alloc(32);
    const { bytesRead } = await handle.read(buf, 0, buf.length, 0);
    return sniffImageMime(buf.subarray(0, bytesRead));
  } finally {
    await handle.close();
  }
}

/**
 * 图片附件 → 随消息送进模型的 image 块。
 *
 * 上限沿用 `view_image` 那一档（20MB）：一张 50MB 的图塞进对话是几万 token 的沉默爆炸。
 * 超限或嗅不出图片格式的不内联——注脚里那个路径仍然有效，模型可以自己去 `view_image` 看。
 */
export async function inlineImages(
  store: PlayStore,
  attachments: readonly WorkshopAttachment[],
): Promise<ImageContent[]> {
  const out: ImageContent[] = [];
  for (const attachment of attachments) {
    if (attachment.kind !== "image" || attachment.size > MAX_WEB_IMAGE_BYTES) continue;
    const data = await readFile(store.resourcePath(attachment.name));
    const mimeType = sniffImageMime(data);
    if (!mimeType) continue;
    out.push({ type: "image", data: data.toString("base64"), mimeType });
  }
  return out;
}

/** 把附件列成给模型看的一行行注脚：它是「这条消息带了什么」的唯一书面凭证。 */
export function attachmentNote(attachment: WorkshopAttachment): string {
  const ext = extname(attachment.name).replace(/^\./, "").toLowerCase() || "未知格式";
  const label = attachment.kind === "image" ? "图片" : ext;
  return `[附件] ${attachment.name}（${formatSize(attachment.size)}，${label}）→ ${attachment.path}`;
}

/**
 * 正文 + 附件注脚。当前轮与历史回灌**共用同一份**——两处各写一遍，模型翻旧账时看到的
 * 附件清单就会与当初那轮不一样。
 */
export function withAttachmentNotes(
  text: string,
  attachments: readonly WorkshopAttachment[] | undefined,
): string {
  if (!attachments || attachments.length === 0) return text;
  const notes = attachments.map(attachmentNote).join("\n");
  return text.trim() === "" ? notes : `${text}\n\n${notes}`;
}
