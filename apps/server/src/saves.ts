import { existsSync } from "node:fs";
import { mkdir, readdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";

/**
 * 存档（周目）层：一个剧目下并存 N 棵独立的谱系树，开始新周目只新建不覆盖。
 *
 * 布局：`<playDir>/saves/<saveId>/{meta.json, session.json, lineage.jsonl}`，
 * `<playDir>/active.json` 记当前活动档（「继续」进哪棵）。
 * 素材、剧目级记忆（always/index）、media-cache、工坊线程仍归剧目共享——只有谱系与引擎状态按档隔离。
 */

/** 存档元信息（meta.json）：列列表与改名只读这份，不碰动辄数 MB 的 session.json。 */
export interface SaveMeta {
  id: string;
  /** 档名（玩家可改的标签，与 id 解耦——改名不动 id，active.json 不会失效）。 */
  name: string;
  createdAt: number;
  updatedAt: number;
  /** 已演出拍数（当前路径上的 beat_end 计数）。 */
  beats: number;
  /** 当前路径最后一句台词/旁白（截断），供列表卡显示。 */
  preview: string;
}

/** 列表示用（加「是否当前活动档」）。 */
export interface SaveInfo extends SaveMeta {
  current: boolean;
}

const ID_RE = /^[\w-]+$/;
/** 档 id 由服务端生成，但仍按白名单校验——它会拼进文件路径与 REST 路径。 */
export function assertSaveId(id: string): string {
  if (!ID_RE.test(id)) throw new Error(`非法存档 id: ${id}`);
  return id;
}

export function saveDirOf(playDir: string, saveId: string): string {
  return join(playDir, "saves", assertSaveId(saveId));
}

export function savesDirOf(playDir: string): string {
  return join(playDir, "saves");
}

export function activePathOf(playDir: string): string {
  return join(playDir, "active.json");
}

/** 读档元信息（缺/坏一律当 null：磁盘上的孤立目录不该拖垮列列表）。 */
export async function readSaveMeta(playDir: string, saveId: string): Promise<SaveMeta | null> {
  try {
    const raw = JSON.parse(await readFile(join(saveDirOf(playDir, saveId), "meta.json"), "utf8")) as SaveMeta;
    return typeof raw?.id === "string" ? raw : null;
  } catch {
    return null;
  }
}

/** 写档元信息（tmp + rename 原子写：崩在写一半上不会留半截 JSON）。 */
export async function writeSaveMeta(playDir: string, meta: SaveMeta): Promise<void> {
  const dir = saveDirOf(playDir, meta.id);
  await mkdir(dir, { recursive: true });
  const tmp = join(dir, "meta.json.tmp");
  await writeFile(tmp, JSON.stringify(meta));
  await rename(tmp, join(dir, "meta.json"));
}

/** 剧目是否存在任何存档（就绪门「开始新周目」的可用性与「继续」的显隐）。 */
export async function hasAnySave(playDir: string): Promise<boolean> {
  const root = savesDirOf(playDir);
  if (!existsSync(root)) return false;
  try {
    return (await readdir(root, { withFileTypes: true })).some((e) => e.isDirectory());
  } catch {
    return false;
  }
}

/** 剧目级活动档指针（「继续」进哪棵）。 */
export class PlaySaves {
  constructor(private readonly playDir: string) {}

  private async ids(): Promise<string[]> {
    const root = savesDirOf(this.playDir);
    if (!existsSync(root)) return [];
    try {
      return (await readdir(root, { withFileTypes: true }))
        .filter((e) => e.isDirectory() && ID_RE.test(e.name))
        .map((e) => e.name);
    } catch {
      return [];
    }
  }

  /** 档名（列表卡与 runtime 装配共用；元信息缺失回落成 id）。 */
  async nameOf(saveId: string): Promise<string> {
    return (await readSaveMeta(this.playDir, saveId))?.name ?? saveId;
  }

  /** 活动档 id（无指针 = 无档）。 */
  async readActive(): Promise<string | null> {
    try {
      const raw = JSON.parse(await readFile(activePathOf(this.playDir), "utf8")) as { saveId?: string };
      const id = raw?.saveId ?? null;
      return id && ID_RE.test(id) && existsSync(saveDirOf(this.playDir, id)) ? id : null;
    } catch {
      return null;
    }
  }

  /** 列档（按最近更新倒序；元信息缺失的目录回落成占位档名，不静默吞掉）。 */
  async list(): Promise<SaveInfo[]> {
    const ids = await this.ids();
    const active = await this.readActive();
    const out: SaveInfo[] = [];
    for (const id of ids) {
      const meta = await readSaveMeta(this.playDir, id);
      out.push(
        meta
          ? { ...meta, current: meta.id === active }
          : {
              id,
              name: id,
              createdAt: 0,
              updatedAt: 0,
              beats: 0,
              preview: "",
              current: id === active,
            },
      );
    }
    return out.sort((a, b) => b.updatedAt - a.updatedAt || b.createdAt - a.createdAt);
  }

  /** 新建空档（空谱系 + 默认档名），并设为活动档。 */
  async create(name?: string): Promise<SaveInfo> {
    const existing = await this.list();
    const id = await this.freshId();
    const trimmed = name?.trim();
    const taken = new Set(existing.map((s) => s.name));
    const base = trimmed || `第 ${existing.length + 1} 周目`;
    const now = Date.now();
    const meta: SaveMeta = { id, name: dedupeName(taken, base), createdAt: now, updatedAt: now, beats: 0, preview: "" };
    await writeSaveMeta(this.playDir, meta);
    await this.activate(id);
    return { ...meta, current: true };
  }

  /** 改名（就地改标签：不动 id、不动树）。 */
  async rename(id: string, name: string): Promise<SaveInfo> {
    const meta = await readSaveMeta(this.playDir, id);
    const clean = name.trim();
    if (!clean) throw new Error("档名不能为空");
    const next: SaveMeta = { ...(meta ?? blankMeta(id, clean)), name: clean };
    await writeSaveMeta(this.playDir, next);
    return { ...next, current: (await this.readActive()) === id };
  }

  /**
   * 删档（整目录）。删的是活动档时指针顺延到最老的一棵，全删光则清指针——
   * 指针不能悬在已被删掉的树上，否则「继续」会凭空多开一档。
   */
  async remove(id: string): Promise<void> {
    const wasActive = (await this.readActive()) === id;
    await rm(saveDirOf(this.playDir, id), { recursive: true, force: true });
    if (!wasActive) return;
    const rest = (await this.ids()).sort();
    if (rest[0]) await this.activate(rest[0]);
    else await rm(activePathOf(this.playDir), { force: true });
  }

  /** 切档（只改指针，不动任何树）。 */
  async activate(id: string): Promise<void> {
    if (!existsSync(saveDirOf(this.playDir, id))) throw new Error(`存档不存在: ${id}`);
    await writeFile(activePathOf(this.playDir), JSON.stringify({ saveId: id }));
  }

  /** 新档 id：base36 时间戳 + 计数器（同一毫秒连建两档也不撞）。 */
  private async freshId(): Promise<string> {
    for (let i = 0; ; i += 1) {
      const id = `s${Date.now().toString(36)}${i === 0 ? "" : `-${i}`}`;
      if (!existsSync(saveDirOf(this.playDir, id))) return id;
    }
  }
}

function blankMeta(id: string, name: string): SaveMeta {
  const now = Date.now();
  return { id, name, createdAt: now, updatedAt: now, beats: 0, preview: "" };
}

/** 档名去重（删档后重名会让「第 N 周目」撞车）。 */
function dedupeName(taken: Set<string>, base: string): string {
  if (!taken.has(base)) return base;
  for (let n = 2; ; n += 1) {
    const candidate = `${base} ${n}`;
    if (!taken.has(candidate)) return candidate;
  }
}
