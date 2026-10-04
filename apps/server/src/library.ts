import { existsSync } from "node:fs";
import { readFile, readdir, stat } from "node:fs/promises";
import { extname, join, resolve, sep } from "node:path";
import {
  ASSET_KINDS,
  isAssetKind,
  parseAssetMeta,
  type AssetKind,
  type LibraryEntry,
  type LibraryFile,
} from "@aivn/core";

/**
 * 应用级素材资源库（`STAGE_LIBRARY_ROOT`，默认仓库根 `library/`）。
 *
 * **只读**：条目由用户在本地目录里增删改（`library/<kind>/<id>/` + 可选 `meta.json`），
 * 这里只负责扫描、搜索、把路径安全地交给静态服务。没有写接口是产品决定，不是没做——
 * 让用户去浏览器里维护一堆 JSON 元数据，比直接丢文件夹难用得多。
 *
 * 一个条目 = 一个目录，目录名即素材 id。id 会原样成为剧目里的文件名主体，
 * 也就是剧本 `<scene bg="…">` 引用的那个名字，所以跨剧目导入后引用方式不变。
 *
 * `characters` 是唯一可以零媒体的类别：一个只有 `meta.character` 的目录就是一张角色卡，
 * 立绘差分是它的可选附件——角色先定下来、图后面再画是常见的搭台顺序。
 * `sprites` 是纯立绘（机甲、道具、猫），一目录一主体多差分，没有卡也不欠谁一张卡。
 */

/** 各 kind 收哪些扩展名：放错地方的视频/压缩包不进清单，免得列表被垃圾塞满。 */
const KIND_EXT: Record<AssetKind, ReadonlySet<string>> = {
  backgrounds: new Set([".png", ".jpg", ".jpeg", ".webp"]),
  cg: new Set([".png", ".jpg", ".jpeg", ".webp"]),
  sprites: new Set([".png", ".webp"]),
  characters: new Set([".png", ".webp"]),
  bgm: new Set([".mp3", ".ogg", ".m4a", ".wav", ".flac"]),
  sfx: new Set([".mp3", ".ogg", ".m4a", ".wav", ".flac"]),
};

const META_FILE = "meta.json";

/** 素材 id（= 目录名 = 剧本引用名）的合法形状：与剧目素材文件名同一套规则。 */
const ENTRY_ID = /^[\w][\w.-]{0,63}$/;

export function assertEntryId(id: string): string {
  if (!ENTRY_ID.test(id) || id.includes("..")) throw new Error(`非法素材 id: ${id}`);
  return id;
}

export class AssetLibrary {
  constructor(readonly root: string) {}

  private kindDir(kind: AssetKind): string {
    return join(this.root, kind);
  }

  /** 某条目目录下的素材文件（按文件名排序，已过滤扩展名）。 */
  private async mediaFiles(kind: AssetKind, id: string): Promise<LibraryFile[]> {
    const dir = join(this.kindDir(kind), id);
    if (!existsSync(dir)) return [];
    const allowed = KIND_EXT[kind];
    const out: LibraryFile[] = [];
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      if (!entry.isFile() || entry.name === META_FILE) continue;
      if (!allowed.has(extname(entry.name).toLowerCase())) continue;
      out.push({ name: entry.name, size: (await stat(join(dir, entry.name))).size });
    }
    return out.sort((a, b) => a.name.localeCompare(b.name));
  }

  /** 读一个条目的 meta.json（缺文件/坏 JSON 都退回空元数据 + 一条 warning，不拖垮整库）。 */
  private async readMeta(kind: AssetKind, id: string, warnings: string[]): Promise<Record<string, unknown>> {
    const path = join(this.kindDir(kind), id, META_FILE);
    if (!existsSync(path)) return {};
    try {
      const parsed: unknown = JSON.parse(await readFile(path, "utf8"));
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
        warnings.push(`${META_FILE} 不是对象，已忽略`);
        return {};
      }
      return parsed as Record<string, unknown>;
    } catch (error) {
      warnings.push(`${META_FILE} 解析失败：${error instanceof Error ? error.message : String(error)}`);
      return {};
    }
  }

  /** 扫描单个条目。空目录不算条目——但 characters 有一张角色卡就成立，立绘是可选附件。 */
  async entry(kind: AssetKind, id: string): Promise<LibraryEntry | null> {
    if (!ENTRY_ID.test(id) || id.includes("..")) return null;
    const warnings: string[] = [];
    const all = await this.mediaFiles(kind, id);
    const meta = parseAssetMeta(await this.readMeta(kind, id, warnings));
    if (all.length === 0 && !meta.character) return null;
    // 立绘类目（纯立绘与角色包）一个目录里放的就是一套差分，全是素材；别的类别只认第一个
    const multi = kind === "characters" || kind === "sprites";
    const files = multi ? all : all.slice(0, 1);
    if (!multi && all.length > 1) {
      warnings.push(`一个条目只取一个文件，已取 ${files[0]!.name}；其余 ${all.length - 1} 个未使用`);
    }
    // 差分表里的文件名对不上目录实际内容时提前说：等到导入那一刻才发现就晚了
    if (multi && meta.variants) {
      for (const [name, expr] of Object.entries(meta.variants)) {
        if (!files.some((f) => f.name === expr.file)) {
          warnings.push(`差分 ${name} 指向的 ${expr.file} 不在目录里`);
        }
      }
    }
    return {
      kind,
      id,
      title: meta.title ?? id,
      description: meta.description ?? "",
      meta,
      files,
      size: files.reduce((sum, f) => sum + f.size, 0),
      ...(warnings.length > 0 ? { warnings } : {}),
    };
  }

  /** 全量扫描（按 kind 声明顺序、id 排序）。目录不存在 = 空库，不报错。 */
  async list(): Promise<LibraryEntry[]> {
    if (!existsSync(this.root)) return [];
    const out: LibraryEntry[] = [];
    for (const kind of ASSET_KINDS) {
      const dir = this.kindDir(kind);
      if (!existsSync(dir)) continue;
      for (const entry of (await readdir(dir, { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name))) {
        if (!entry.isDirectory() || entry.name.startsWith(".")) continue;
        const item = await this.entry(kind, entry.name);
        if (item) out.push(item);
      }
    }
    return out;
  }

  /** 按类别取（UI 的分类 tab 与工具调用都走它）。 */
  async entriesOf(kind: AssetKind): Promise<LibraryEntry[]> {
    return (await this.list()).filter((e) => e.kind === kind);
  }

  /** 条目内文件的绝对路径（静态服务用）。只放行清单里真实存在的文件，杜绝穿越。 */
  async filePath(kind: string, id: string, file: string): Promise<string> {
    if (!isAssetKind(kind)) throw new Error(`未知素材类别: ${kind}`);
    assertEntryId(id);
    const entry = await this.entry(kind, id);
    if (!entry) throw new Error(`素材不存在: ${kind}/${id}`);
    if (!entry.files.some((f) => f.name === file)) throw new Error(`素材里没有这个文件: ${file}`);
    const abs = resolve(this.kindDir(kind), id, file);
    const base = resolve(this.kindDir(kind), id) + sep;
    if (!abs.startsWith(base)) throw new Error(`路径越界: ${file}`);
    return abs;
  }
}
