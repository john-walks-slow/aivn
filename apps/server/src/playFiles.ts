import { mkdir, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { dirname, join, resolve, sep } from "node:path";
import { parsePlayConfig, CHARACTER_DIR } from "@aivn/core";
import type { PlayStore } from "./store.js";

/**
 * 剧目文件层（两个 agent 与文件浏览器共用）：剧目目录里**面向用户的可编辑面**。
 *
 * 白名单而非黑名单——会话日志（session.json/lineage.jsonl）、TTS 缓存、二进制素材都不在此层，
 * agent 与浏览器拿不到它们；越界路径一律拒绝，不做「尽力而为」的裁剪。
 */

/** 可编辑文本文件（agent 能改的面）。 */
const EDITABLE_EXT = new Set([".md", ".json", ".txt"]);
/** 只读可见目录（浏览器能看，agent 不写）。 */
const READONLY_PREFIXES = ["assets/"];
/** 素材描述表（stem → 画面说明，注入剧作家提示词）——assets/ 里唯一可写的文本文件。 */
const ASSET_MANIFEST = "assets/manifest.json";
/** 允许下钻的顶层目录（其余目录整棵跳过，不进 readdir）。 */
const DIR_ROOTS = ["memory", "assets", CHARACTER_DIR];
/** 二进制可写面：仅图像素材（生图落盘）。 */
const BINARY_WRITE_PREFIXES = ["assets/backgrounds/", "assets/cg/", "assets/sprites/"];
/** 单图上限 16MB：2K 图 1–3MB，留足余量又挡得住写歪的产物。 */
const MAX_BINARY_BYTES = 16 * 1024 * 1024;

/** 预览方式：binary 文件不进编辑器，前端按 kind 决定渲染预览还是播放。 */
export type PlayFileKind = "text" | "image" | "audio" | "binary";

/** 图像扩展名：预览判定与二进制可写判定共用同一份。 */
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
  /** agent 可写（false = 只读展示）。 */
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

/** 剧目定义：唯一一份要过结构校验的文件。 */
const PLAY_CONFIG = "play.json";

/**
 * play.json 的结构校验：**所有文本写口的唯一收口**。
 *
 * 文件页手写、两个 agent 的 write / edit、引用即导入的主角卡，落盘都得从 `write` 过，
 * 谁也别想把一份解析不了的 play.json 留在盘上——留下了，下一次 runtime 重建就会炸在
 * `void` 的 promise 里，用户看到的是「面板不刷新了」而不是「哪里坏了」。
 * bash 是唯一绕得开的写口（它不走这一层），收束时补一次读盘检查来兜。
 */
function assertPlayConfig(rel: string, text: string): void {
  if (rel !== PLAY_CONFIG) return;
  try {
    parsePlayConfig(JSON.parse(text));
  } catch (error) {
    throw new Error(
      `play.json 结构校验不过，未落盘：${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

/**
 * 机器产物：逐轮切片（archive）由引擎写。
 *
 * 它跟分支走（按 pathSet 过滤），手改或手建就绕过了防剧透。
 * 所以**看得见、改不动**：文件页能查看，文本写口一律拒。
 */
const GENERATED_PREFIXES = ["memory/archive/"];

/** 可写面：根层 play.json + theme.css + 素材描述表 + memory/** 与 characters/** 文本文件。 */
function isEditable(rel: string): boolean {
  if (rel === PLAY_CONFIG || rel === "theme.css" || rel === ASSET_MANIFEST) return true;
  if (isGenerated(rel)) return false;
  if (!rel.startsWith("memory/") && !rel.startsWith(`${CHARACTER_DIR}/`)) return false;
  return EDITABLE_EXT.has(extOf(rel));
}

/** 只读可见面：素材目录（浏览器预览）与引擎产物（文件页看得到、存不了）。 */
function isVisible(rel: string): boolean {
  if (isEditable(rel) || isGenerated(rel)) return true;
  return READONLY_PREFIXES.some((prefix) => rel.startsWith(prefix));
}

/**
 * 可写文件的三个面。**穷尽可写面**：`isEditable` 放行的每一个路径都恰好落在其中之一，
 * 加一类可写文件而忘了加 scope，用例会红（见 playFiles.test.ts）。
 *
 * 名字是用户语汇，不出现具体路径；路径只在上表里出现一次。
 */
export type WriteScope = "characters" | "memory" | "config";

/** scope → 它放行的路径（目录带尾斜杠，其余是整文件匹配）。一律按小写比，见 `isGenerated`。 */
const SCOPE_PREFIXES: Record<WriteScope, readonly string[]> = {
  characters: [`${CHARACTER_DIR}/`],
  memory: ["memory/"],
  config: [PLAY_CONFIG, "theme.css", ASSET_MANIFEST],
};

/** scope 的用户语汇（错误消息用；界面上的名字在能力目录里）。 */
export const WRITE_SCOPE_LABELS: Record<WriteScope, string> = {
  characters: "角色卡",
  memory: "记忆卡",
  config: "剧目文件",
};

/** 这个路径属于哪个可写面；不可写（含引擎产物）返回 null。 */
export function writeScopeOf(rel: string): WriteScope | null {
  if (!isEditable(rel)) return null;
  const lower = rel.toLowerCase();
  for (const scope of Object.keys(SCOPE_PREFIXES) as WriteScope[]) {
    const hit = SCOPE_PREFIXES[scope].some((prefix) =>
      prefix.endsWith("/") ? lower.startsWith(prefix) : lower === prefix,
    );
    if (hit) return scope;
  }
  return null;
}

/** 这个路径是否落在给定的可写面之内。能力的写面判定收在这一处。 */
export function inWriteScopes(rel: string, scopes: readonly WriteScope[]): boolean {
  const scope = writeScopeOf(rel);
  return scope !== null && scopes.includes(scope);
}

/**
 * 是不是引擎产物。**按小写比**：Windows / macOS 的文件系统不区分大小写，
 * `MEMORY/ARCHIVE/x.md` 在那边就是 `memory/archive/x.md` 同一个文件——
 * 区分大小写的比较只在 Linux 上成立，桌面版会从这条路绕过去。
 */
export function isGenerated(rel: string): boolean {
  const lower = rel.toLowerCase();
  return GENERATED_PREFIXES.some((prefix) => lower.startsWith(prefix));
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
  /** 剧目目录绝对路径（bash 的 cwd，也是这一层所有白名单判定的根）。 */
  readonly root: string;

  constructor(store: PlayStore) {
    this.root = resolve(store.dir);
  }

  /** 解析绝对路径（越界/非法一律抛错）。mode 决定是否要求可写。 */
  pathOf(rel: string, mode: "read" | "write"): string {
    const clean = normalizePath(rel);
    if (!clean) throw new Error(`非法路径: ${rel}`);
    const allowed = mode === "write" ? isEditable(clean) : isVisible(clean);
    if (!allowed) throw new Error(`路径不在剧目可${mode === "write" ? "写" : "读"}范围: ${clean}`);
    const abs = resolve(this.root, clean);
    if (abs !== this.root && !abs.startsWith(this.root + sep)) throw new Error(`路径越界: ${rel}`);
    return abs;
  }

  /** 文件清单（浏览器建树 + agent 的目录视图）。 */
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

  /** 写盘（agent 与浏览器共用）；返回规范化后的相对路径。 */
  async write(rel: string, content: string): Promise<string> {
    const abs = this.pathOf(rel, "write");
    const clean = normalizePath(rel)!;
    assertPlayConfig(clean, content);
    await mkdir(dirname(abs), { recursive: true });
    await writeFile(abs, content, "utf8");
    return clean;
  }

  /**
   * 剧目图像素材的二进制写入通道（生图落盘）。
   *
   * 独立于 `write`：文本工具写图片路径没有意义，而素材层若绕过本类直接落盘，
   * 「agent 的读写都在 PlayFiles 白名单内」这条铁律就成了假话，人和 agent 的写权限面也分叉了。
   * 调用方（PlayAssets）只传服务端从枚举拼出的路径，本类仍做一遍全量校验。
   *
   * 不推刷新信号：二进制走素材到货那条通道（`workshop_asset`），写盘信号只带文本路径。
   * 图像的「反悔」手段是覆盖重画与素材页删除。
   */
  async writeBinary(rel: string, data: Buffer): Promise<string> {
    const clean = normalizePath(rel);
    if (!clean || !isBinaryWritable(clean)) {
      throw new Error(`路径不在剧目二进制可写范围: ${rel}`);
    }
    const abs = resolve(this.root, clean);
    if (abs !== this.root && !abs.startsWith(this.root + sep)) throw new Error(`路径越界: ${rel}`);
    if (data.length > MAX_BINARY_BYTES) {
      throw new Error(`素材过大（${data.length}B，上限 ${MAX_BINARY_BYTES}B）: ${rel}`);
    }
    await mkdir(dirname(abs), { recursive: true });
    await writeFile(abs, data);
    return clean;
  }

  /** 绝对路径（二进制通道的调用方需要读回自己刚写的图作垫图）。 */
  absoluteOf(rel: string): string {
    const clean = normalizePath(rel);
    if (!clean) throw new Error(`非法路径: ${rel}`);
    const abs = resolve(this.root, clean);
    if (abs !== this.root && !abs.startsWith(this.root + sep)) throw new Error(`路径越界: ${rel}`);
    return abs;
  }

  /** 删除（仅 memory/**、characters/** 与 theme.css；play.json 是剧目定义，删掉=剧目损坏，任何入口都不许删）。 */
  async remove(rel: string): Promise<void> {
    const abs = this.pathOf(rel, "write");
    if (abs === join(this.root, PLAY_CONFIG)) throw new Error("play.json 不可删除");
    await rm(abs, { force: true });
  }

  /** 删除图像素材（覆盖生图时清掉换扩展名的旧文件；一个 id 只留一张图）。 */
  async removeAsset(rel: string): Promise<void> {
    const clean = normalizePath(rel);
    if (!clean || !isBinaryWritable(clean)) throw new Error(`路径不在素材范围: ${rel}`);
    await rm(this.absoluteOf(clean), { force: true });
  }
}

/** 二进制可写判定：仅图像素材目录下的图像文件。 */
function isBinaryWritable(rel: string): boolean {
  if (!BINARY_WRITE_PREFIXES.some((prefix) => rel.startsWith(prefix))) return false;
  return IMAGE_EXT.has(extOf(rel));
}