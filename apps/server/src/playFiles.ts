import { mkdir, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { dirname, join, resolve, sep } from "node:path";
import type { PlayStore } from "./store.js";

/**
 * 剧目文件层（工坊 agent 与文件浏览器共用）：剧目目录里**面向用户的可编辑面**。
 *
 * 白名单而非黑名单——会话日志（session.json/lineage.jsonl）、TTS 缓存、二进制素材都不在此层，
 * 工坊 agent 与浏览器拿不到它们；越界路径一律拒绝，不做「尽力而为」的裁剪。
 */

/** 可编辑文本文件（工坊 agent 能改的面）。 */
const EDITABLE_EXT = new Set([".md", ".json", ".txt"]);
/** 只读可见目录（浏览器能看，工坊 agent 不写）。 */
const READONLY_PREFIXES = ["assets/"];
/** 素材描述表（stem → 画面说明，注入剧作家提示词）——assets/ 里唯一可写的文本文件。 */
const ASSET_MANIFEST = "assets/manifest.json";
/** 允许下钻的顶层目录（其余目录整棵跳过，不进 readdir）。 */
const DIR_ROOTS = ["memory", "assets"];

/** 预览方式：binary 文件不进编辑器，前端按 kind 决定渲染预览还是播放。 */
export type PlayFileKind = "text" | "image" | "audio" | "binary";

const IMAGE_EXT = new Set([".png", ".jpg", ".jpeg", ".webp", ".gif"]);
const AUDIO_EXT = new Set([".mp3", ".ogg", ".wav", ".m4a", ".flac", ".aac"]);

function kindOf(rel: string): PlayFileKind {
  const ext = extOf(rel);
  if (EDITABLE_EXT.has(ext) || ext === ".css") return "text";
  if (IMAGE_EXT.has(ext)) return "image";
  if (AUDIO_EXT.has(ext)) return "audio";
  return "binary";
}

export interface PlayFile {
  path: string;
  /** 目录层级（浏览器建树用）：`play.json` 为 []。 */
  dir: string[];
  size: number;
  /** 工坊 agent 可写（false = 只读展示）。 */
  writable: boolean;
  /** 预览方式：text 进编辑器，其余走静态 URL 预览/播放。 */
  kind: PlayFileKind;
}

/** 相对路径校验：禁止绝对路径、`..`、空段与反斜杠。 */
function normalizePath(rel: string): string | null {
  const cleaned = rel.trim().replace(/^\.\//, "");
  if (cleaned === "" || cleaned.startsWith("/") || cleaned.includes("\\")) return null;
  const segments = cleaned.split("/");
  if (segments.some((s) => s === "" || s === "." || s === "..")) return null;
  return segments.join("/");
}

/** 可写面：根层 play.json + theme.css + 素材描述表 + memory/** 文本文件。 */
function isEditable(rel: string): boolean {
  if (rel === "play.json" || rel === "theme.css" || rel === ASSET_MANIFEST) return true;
  if (!rel.startsWith("memory/")) return false;
  return EDITABLE_EXT.has(extOf(rel));
}

function isVisible(rel: string): boolean {
  if (isEditable(rel)) return true;
  return READONLY_PREFIXES.some((prefix) => rel.startsWith(prefix));
}

/** 目录可下钻：白名单根的祖先链（`memory`/`assets`）本身不可见，但必须能走进去。 */
function isTraversableDir(rel: string): boolean {
  return DIR_ROOTS.some((root) => rel === root || rel.startsWith(`${root}/`));
}

function extOf(rel: string): string {
  const idx = rel.lastIndexOf(".");
  return idx === -1 ? "" : rel.slice(idx).toLowerCase();
}

/** 剧目文件层：路径解析到剧目目录内，越界即抛错。 */
export class PlayFiles {
  private readonly root: string;

  constructor(store: PlayStore) {
    this.root = resolve(store.dir);
  }

  /** 解析绝对路径（越界/非法一律抛错）。mode 决定是否要求可写。 */
  pathOf(rel: string, mode: "read" | "write"): string {
    const clean = normalizePath(rel);
    if (!clean) throw new Error(`非法路径: ${rel}`);
    const allowed = mode === "write" ? isEditable(clean) : isVisible(clean);
    if (!allowed) throw new Error(`路径不在工坊可${mode === "write" ? "写" : "读"}范围: ${clean}`);
    const abs = resolve(this.root, clean);
    if (abs !== this.root && !abs.startsWith(this.root + sep)) throw new Error(`路径越界: ${rel}`);
    return abs;
  }

  /** 文件清单（浏览器建树 + 工坊 agent 的目录视图）。 */
  async list(): Promise<PlayFile[]> {
    const out: PlayFile[] = [];
    const walk = async (rel: string): Promise<void> => {
      const abs = rel === "" ? this.root : join(this.root, rel);
      if (!existsSync(abs)) return;
      let entries;
      try {
        entries = await readdir(abs, { withFileTypes: true });
      } catch {
        return;
      }
      for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
        const child = rel === "" ? entry.name : `${rel}/${entry.name}`;
        if (entry.isDirectory()) {
          if (isTraversableDir(child)) await walk(child);
          continue;
        }
        if (!isVisible(child)) continue;
        const info = await stat(join(this.root, child));
        out.push({
          path: child,
          dir: child.split("/").slice(0, -1),
          size: info.size,
          writable: isEditable(child),
          kind: kindOf(child),
        });
      }
    };
    await walk("");
    return out;
  }

  async read(rel: string): Promise<string> {
    const abs = this.pathOf(rel, "read");
    if (!existsSync(abs)) throw new Error(`文件不存在: ${rel}`);
    // 二进制按 utf8 读只会灌一屏乱码进编辑器——明确拒绝，前端改走静态 URL 预览
    if (kindOf(rel) !== "text") throw new Error(`不是文本文件，用预览查看: ${rel}`);
    return readFile(abs, "utf8");
  }

  /** 写盘（工坊 agent 与浏览器共用）；返回规范化后的相对路径。 */
  async write(rel: string, content: string): Promise<string> {
    const abs = this.pathOf(rel, "write");
    await mkdir(dirname(abs), { recursive: true });
    await writeFile(abs, content, "utf8");
    return normalizePath(rel)!;
  }

  /** 删除（仅 memory/** 与 theme.css；play.json 是剧目定义，删掉=剧目损坏，任何入口都不许删）。 */
  async remove(rel: string): Promise<void> {
    const abs = this.pathOf(rel, "write");
    if (abs === join(this.root, "play.json")) throw new Error("play.json 不可删除");
    await rm(abs, { force: true });
  }
}