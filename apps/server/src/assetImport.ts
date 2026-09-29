import { copyFile, mkdir, readdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { dirname, extname, join } from "node:path";
import { parsePlayConfig, type AssetKind, type AssetMeta, type CharacterCard, type LibraryEntry } from "@stage-ai/core";
import type { AssetLibrary } from "./library.js";
import { PlayFiles } from "./playFiles.js";
import { withPlayConfigLock, type PlayStore } from "./store.js";
import type { WorkshopWrite } from "./workshop.js";

/**
 * 资源库 → 剧目的导入。
 *
 * **复制而不是引用**：剧目包要能导出、素材静态服务零改动、用户把资源库目录删了老剧照样开演。
 * 代价是同一个背景在几部剧里存几份（见计划文档的取舍），换来的是剧目自包含。
 *
 * 导入同时把资源库的元数据搬进剧目的 `assets/manifest.json`——这才是「剧作家能按情绪选曲」
 * 的落点：资源库里的描述不进剧目，提示词里就还是一串光秃秃的文件名。
 */

export interface ImportRequest {
  kind: AssetKind;
  entryId: string;
  /** 立绘包只导这几条差分（缺省全导）。 */
  expressions?: string[];
}

export interface ImportResult {
  kind: AssetKind;
  id: string;
  /** 落到剧目的相对路径（assets/…），给前端与工坊回执看。 */
  files: string[];
  /** 立绘导入时写进 play.json 的角色 id。 */
  characters: string[];
  /** 剧目素材表新增/更新的键。 */
  manifestKeys: string[];
  /** 剧目配置/素材表被改动的文本（进工坊撤销条；REST 直连时为空）。 */
  writes: WorkshopWrite[];
}

/** 剧目素材目录里同名的其它扩展名文件要清掉：`stemMap` 只认一个 stem，留着会挑到旧的那张。 */
const ALL_EXT = new Set([".png", ".jpg", ".jpeg", ".webp", ".gif", ".mp3", ".ogg", ".m4a", ".wav", ".flac", ".aac"]);

function stemOf(name: string): string {
  const idx = name.lastIndexOf(".");
  return idx === -1 ? name : name.slice(0, idx);
}

/** 只搬资源库里真有值的字段：剧目侧手写的补充说明不该被一份缺字段的 meta 冲掉。 */
function mergeMeta(existing: AssetMeta | undefined, incoming: AssetMeta, extra?: { description?: string }): AssetMeta {
  const merged: AssetMeta = { ...existing };
  for (const [key, value] of Object.entries(incoming) as [string, unknown][]) {
    if (value !== undefined) (merged as Record<string, unknown>)[key] = value;
  }
  if (extra?.description) merged.description = extra.description;
  return merged;
}

/** 复制进剧目：目标目录不存在就建（立绘是 sprites/<id>/ 两级，空剧目导入时都没有）。 */
async function copyInto(source: string, target: string): Promise<void> {
  await mkdir(dirname(target), { recursive: true });
  await copyFile(source, target);
}

async function removeStaleSiblings(store: PlayStore, kindPath: string, stem: string, keep: string): Promise<void> {
  const dir = join(store.dir, "assets", kindPath);
  if (!existsSync(dir)) return;
  for (const name of await readdir(dir)) {
    if (name === keep || stemOf(name) !== stem) continue;
    if (ALL_EXT.has(extname(name).toLowerCase())) await store.deleteAsset(kindPath, name);
  }
}

/** 剧目素材表：缺文件/坏 JSON 都要当成空表重来，不能让一份坏数据挡住导入。 */
async function readManifest(files: PlayFiles): Promise<Record<string, AssetMeta>> {
  const raw = await files.read("assets/manifest.json").catch(() => "");
  if (!raw.trim()) return {};
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    return parsed as Record<string, AssetMeta>;
  } catch {
    return {};
  }
}

export async function importFromLibrary(
  library: AssetLibrary,
  store: PlayStore,
  req: ImportRequest,
): Promise<ImportResult> {
  const entry = await library.entry(req.kind, req.entryId);
  if (!entry) throw new Error(`资源库里没有 ${req.kind}/${req.entryId}`);
  const files = new PlayFiles(store);
  const result: ImportResult = {
    kind: req.kind,
    id: entry.id,
    files: [],
    characters: [],
    manifestKeys: [],
    writes: [],
  };

  // 素材文件复制不进锁（大文件会占着锁不放），只把「读配置 → 改 → 写回」整段包进去。
  // play.json 与素材表都是「读全量 → 改一项 → 写回」，裸做就是后写的拿旧值覆盖先写的。
  const plan =
    req.kind === "sprites"
      ? await copySpritePack(library, store, entry, req.expressions, result)
      : await copySingleFile(library, store, entry, result);

  await withPlayConfigLock(store.dir, async () => {
    // before 与 after 都在锁内现取：撤销条要能精确回滚，锁外读到的可能已被别人改过
    const manifestBefore = await files.read("assets/manifest.json").catch(() => null);
    const manifest = await readManifest(files);
    for (const [key, meta] of plan.manifest) {
      manifest[key] = mergeMeta(manifest[key], meta);
      result.manifestKeys.push(key);
    }
    const content = `${JSON.stringify(manifest, null, 2)}\n`;
    await files.write("assets/manifest.json", content);
    if (manifestBefore !== content) {
      result.writes.push({ path: "assets/manifest.json", before: manifestBefore, after: content });
    }
    if (plan.sprites) {
      const before = await files.read("play.json").catch(() => null);
      const play = before ? parsePlayConfig(JSON.parse(before)) : null;
      if (!play) throw new Error("剧目 play.json 不可读，立绘包没能写进角色卡");
      let character = play.characters.find((c) => c.id === plan.sprites!.id);
      if (!character) {
        character = {
          id: plan.sprites.id,
          name: plan.sprites.name,
          persona: plan.sprites.persona,
          ...(plan.sprites.voice ? { voice: plan.sprites.voice } : {}),
          ...(plan.sprites.voiceId ? { voiceId: plan.sprites.voiceId } : {}),
          sprites: {},
        } satisfies CharacterCard;
        play.characters.push(character);
      }
      character.sprites = { ...(character.sprites ?? {}), ...plan.sprites.sprites };
      // 角色卡与立绘文件是一套东西：校验过才落盘，别写出半套
      // 不带尾换行：与 savePlay / mapSprite 的写法一致，别让撤销后的文本对不上
      const after = JSON.stringify(parsePlayConfig(play), null, 2);
      await files.write("play.json", after);
      if (before !== after) result.writes.push({ path: "play.json", before, after });
      result.characters.push(plan.sprites.id);
    }
  });
  return result;
}

/** 一次导入要落进剧目配置的东西：素材表条目，加上立绘包才有的角色卡差分映射。 */
interface ImportPlan {
  manifest: [string, AssetMeta][];
  sprites: {
    id: string;
    name: string;
    persona: string;
    voice?: string;
    voiceId?: string;
    sprites: Record<string, string>;
  } | null;
}

/** 背景 / CG / BGM / 音效：一个文件一个 id。 */
async function copySingleFile(
  library: AssetLibrary,
  store: PlayStore,
  entry: LibraryEntry,
  result: ImportResult,
): Promise<ImportPlan> {
  const source = entry.files[0]!;
  const ext = extname(source.name).toLowerCase();
  await removeStaleSiblings(store, entry.kind, entry.id, `${entry.id}${ext}`);
  await copyInto(await library.filePath(entry.kind, entry.id, source.name), store.assetPath(`${entry.kind}/${entry.id}${ext}`));
  result.files.push(`assets/${entry.kind}/${entry.id}${ext}`);
  return { manifest: [[entry.id, entry.meta]], sprites: null };
}

/** 立绘包：文件落 `sprites/<id>/`，差分映射留给配置阶段并进角色卡。 */
async function copySpritePack(
  library: AssetLibrary,
  store: PlayStore,
  entry: LibraryEntry,
  requested: string[] | undefined,
  result: ImportResult,
): Promise<ImportPlan> {
  const declared = Object.entries(entry.meta.expressions ?? {});
  // 没写差分表时按文件名当差分名：手工丢个文件夹进来也能用，不必先补 meta.json
  const picked = requested && requested.length > 0 ? requested : declared.length > 0 ? declared.map(([name]) => name) : entry.files.map((f) => stemOf(f.name));
  if (picked.length === 0) throw new Error("立绘包没有可用差分");
  const mapping = new Map<string, string>();
  for (const name of picked) {
    const file = entry.meta.expressions?.[name]?.file ?? name;
    const source = entry.files.find((f) => f.name === file) ?? entry.files.find((f) => stemOf(f.name) === name);
    if (!source) throw new Error(`差分 ${name} 在资源库条目里没有对应文件`);
    mapping.set(name, source.name);
  }

  const manifest: [string, AssetMeta][] = [];
  const sprites: Record<string, string> = {};
  for (const [expression, file] of mapping) {
    const ext = extname(file).toLowerCase();
    await removeStaleSiblings(store, `sprites/${entry.id}`, expression, `${expression}${ext}`);
    await copyInto(await library.filePath(entry.kind, entry.id, file), store.assetPath(`sprites/${entry.id}/${expression}${ext}`));
    result.files.push(`assets/sprites/${entry.id}/${expression}${ext}`);
    // 键带角色前缀：多角色剧目里光写 smile 会被另一个角色的同名差分覆盖
    manifest.push([
      `${entry.id}/${expression}`,
      mergeMeta(undefined, entry.meta, {
        description: entry.meta.expressions?.[expression]?.description ?? entry.meta.description,
      }),
    ]);
    sprites[expression] = `${expression}${ext}`;
  }

  return {
    manifest,
    sprites: {
      id: entry.id,
      name: entry.meta.character?.name ?? entry.id,
      persona: entry.meta.character?.persona ?? "",
      ...(entry.meta.character?.voice ? { voice: entry.meta.character.voice } : {}),
      ...(entry.meta.character?.voiceId ? { voiceId: entry.meta.character.voiceId } : {}),
      sprites,
    },
  };
}
