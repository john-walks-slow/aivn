import { copyFile, mkdir, readdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { dirname, extname, join } from "node:path";
import {
  characterCardPath,
  parseCharacterCard,
  serializeCharacterCard,
  PROTAGONIST_ID,
  type AssetCharacter,
  type AssetKind,
  type AssetMeta,
  type CharacterDocument,
  type LibraryEntry,
  type LibraryFile,
} from "@aivn/core";
import type { AssetLibrary } from "./library.js";
import { PlayFiles } from "./playFiles.js";
import { withPlayConfigLock, type PlayStore } from "./store.js";
import type { PlayFileWrite } from "./workshop.js";

/**
 * 资源库 → 剧目的导入。
 *
 * **复制而不是引用**：剧目包要能导出、素材静态服务零改动、用户把资源库目录删了老剧照样开演。
 * 代价是同一个背景在几部剧里存几份（见计划文档的取舍），换来的是剧目自包含。
 *
 * **条目声明什么就搬什么**，不做「立绘包 vs 单文件」的分档：一个条目可以只有角色卡、
 * 只有立绘、两者都有、或只有描述。角色卡字段走同一条合并规则（库里有值才覆盖剧目的），
 * 所以剧目侧手写的补充说明不会被一份缺字段的库 meta 冲掉。
 *
 * 立绘落在 `assets/sprites/<id>/`，呈现声明（取景/体量/对齐）与说明写进剧目的
 * `assets/manifest.json`——两个键：`<id>` 是立绘级，`<id>/<variant>` 是差分级覆盖。
 * **卡是可选的**：条目带 `meta.character` 才写 `characters/<id>.md`，只声明了图不再建空壳卡。
 */

export interface ImportRequest {
  kind: AssetKind;
  entryId: string;
  /** 立绘类目（characters / sprites）只导这几条差分（缺省全导）。 */
  variants?: string[];
  /** 落点为固定 id 的主角（立绘与卡都落 `protagonist`）而不是以条目 id 命名。 */
  target?: "protagonist";
}

export interface ImportResult {
  kind: AssetKind;
  id: string;
  /** 立绘类目落成的立绘 id（= `assets/sprites/<spriteId>/` 的目录名；主角固定 `protagonist`）。 */
  spriteId: string;
  /** 落到剧目的相对路径（assets/…），给前端与工坊回执看。 */
  files: string[];
  /** 写进/更新了哪些角色卡 id（立绘类目没有 `meta.character` 时为空）。 */
  characters: string[];
  /** 这次写的是那张固定的主角卡（而不是新建一张以条目 id 命名的卡）。 */
  protagonist: boolean;
  /** 剧目素材表新增/更新的键。 */
  manifestKeys: string[];
  /** 剧目配置/素材表被改动的文本（进工坊撤销条；REST 直连时为空）。 */
  writes: PlayFileWrite[];
}

/** 剧目素材目录里同名的其它扩展名文件要清掉：`stemMap` 只认一个 stem，留着会挑到旧的那张。 */
const ALL_EXT = new Set([".png", ".jpg", ".jpeg", ".webp", ".gif", ".mp3", ".ogg", ".m4a", ".wav", ".flac", ".aac"]);

function stemOf(name: string): string {
  const idx = name.lastIndexOf(".");
  return idx === -1 ? name : name.slice(0, idx);
}

/** 只搬资源库里真有值的字段：剧目侧手写的东西不该被一份缺字段的库 meta 冲掉。 */
function mergeMeta(existing: AssetMeta | undefined, incoming: AssetMeta): AssetMeta {
  const merged: AssetMeta = { ...existing };
  for (const [key, value] of Object.entries(incoming) as [string, unknown][]) {
    if (value !== undefined) (merged as Record<string, unknown>)[key] = value;
  }
  return merged;
}

/** 丢掉 undefined 的字段，免得往 manifest 里写一堆空值。 */
function compact(meta: AssetMeta): AssetMeta {
  return Object.fromEntries(Object.entries(meta).filter(([, v]) => v !== undefined)) as AssetMeta;
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

/** 立绘类目要导哪些差分：指定的那几条 > meta 声明的 > 目录里全部文件（手工丢个文件夹进来也能用）。 */
function pickedVariants(entry: LibraryEntry, requested: string[] | undefined): string[] {
  if (requested && requested.length > 0) return requested;
  const declared = Object.keys(entry.meta.variants ?? {});
  if (declared.length > 0) return declared;
  return entry.files.map((f) => stemOf(f.name));
}

/** 一条差分落在条目录里的哪个文件：variants 表优先，其次按差分名当文件名找。 */
function fileForVariant(entry: LibraryEntry, variant: string): LibraryFile | undefined {
  const declared = entry.meta.variants?.[variant]?.file;
  if (declared) {
    const byName = entry.files.find((f) => f.name === declared);
    if (byName) return byName;
  }
  return entry.files.find((f) => stemOf(f.name) === variant);
}

/** 立绘级声明：呈现三轴 + 标题（无卡主体的名牌）。 */
function spriteMeta(entry: LibraryEntry): AssetMeta {
  return compact({
    title: entry.meta.title,
    description: entry.meta.description,
    framing: entry.meta.framing,
    stature: entry.meta.stature,
    anchor: entry.meta.anchor,
  });
}

/** 差分级声明：只放这条差分自己声明的取景与说明，没声明就留空让立绘级兜。 */
function variantMeta(entry: LibraryEntry, variant: string): AssetMeta {
  const declared = entry.meta.variants?.[variant];
  return compact({ description: declared?.description, framing: declared?.framing });
}

export async function importFromLibrary(
  library: AssetLibrary,
  store: PlayStore,
  req: ImportRequest,
): Promise<ImportResult> {
  const entry = await library.entry(req.kind, req.entryId);
  if (!entry) throw new Error(`资源库里没有 ${req.kind}/${req.entryId}`);
  const files = new PlayFiles(store);
  const isSpritePack = entry.kind === "characters" || entry.kind === "sprites";
  // 立绘类目的 id 决定立绘放哪个目录；主角固定 id（其余用条目 id）
  const spriteId = req.target === "protagonist" ? PROTAGONIST_ID : entry.id;
  const result: ImportResult = {
    kind: entry.kind,
    id: entry.id,
    spriteId,
    files: [],
    characters: [],
    protagonist: req.target === "protagonist",
    manifestKeys: [],
    writes: [],
  };

  // ── 文件复制在锁外：整包图片几十兆，进锁会把整条剧目配置队列堵住 ──
  const manifest: [string, AssetMeta][] = [];
  if (isSpritePack) {
    const variants = pickedVariants(entry, req.variants);
    // 纯立绘条目没有图就是空条目（导进来什么都不发生）；角色包可以零媒体——
    // 先定人设、图后面再画是一条正当路径。
    if (variants.length === 0 && entry.kind === "sprites") {
      throw new Error(`资源库条目 ${entry.id} 里没有立绘文件`);
    }
    const kindPath = `sprites/${spriteId}`;
    for (const variant of variants) {
      const source = fileForVariant(entry, variant);
      if (!source) throw new Error(`差分 ${variant} 在资源库条目里没有对应文件`);
      const ext = extname(source.name).toLowerCase();
      await removeStaleSiblings(store, kindPath, variant, `${variant}${ext}`);
      await copyInto(await library.filePath(entry.kind, entry.id, source.name), store.assetPath(`${kindPath}/${variant}${ext}`));
      result.files.push(`assets/${kindPath}/${variant}${ext}`);
      // 差分级键带主体前缀：多主体剧目里光写 smile 会被另一个立绘的同名差分覆盖。
      // 条目对这条差分一个字都没声明时不写空对象——manifest 是给人读的。
      const own = variantMeta(entry, variant);
      if (Object.keys(own).length > 0) manifest.push([`${spriteId}/${variant}`, own]);
    }
    // 立绘级声明只在真有图时写：一张图都没有的主体没有摆位可声明
    const base = spriteMeta(entry);
    if (variants.length > 0 && Object.keys(base).length > 0) manifest.push([spriteId, base]);
  } else {
    // 单文件类别：背景 / CG / BGM / 音效
    const source = entry.files[0];
    if (source) {
      const ext = extname(source.name).toLowerCase();
      await removeStaleSiblings(store, entry.kind, entry.id, `${entry.id}${ext}`);
      await copyInto(await library.filePath(entry.kind, entry.id, source.name), store.assetPath(`${entry.kind}/${entry.id}${ext}`));
      result.files.push(`assets/${entry.kind}/${entry.id}${ext}`);
      manifest.push([entry.id, entry.meta]);
    }
  }

  // ── 配置读改写在锁内：角色卡与素材表都是「读全量 → 改 → 写回」，裸做就是互相覆盖 ──
  await withPlayConfigLock(store.dir, async () => {
    // before 与 after 都在锁内现取：撤销条要能精确回滚，锁外读到的可能已被别人改过
    const manifestBefore = await files.read("assets/manifest.json").catch(() => null);
    if (manifest.length > 0) {
      const current = await readManifest(files);
      for (const [key, meta] of manifest) {
        current[key] = mergeMeta(current[key], meta);
        result.manifestKeys.push(key);
      }
      const manifestText = `${JSON.stringify(current, null, 2)}\n`;
      await files.write("assets/manifest.json", manifestText);
      if (manifestBefore !== manifestText) {
        result.writes.push({ path: "assets/manifest.json", before: manifestBefore, after: manifestText });
      }
    }

    // 卡只写条目真给了角色原料的那些：立绘独立成素材之后，「只声明了图」不再需要一张空壳卡挂差分。
    const card = entry.meta.character;
    if (!isSpritePack || !card) return;
    const write = await applyCharacterCard(files, spriteId, card);
    result.characters.push(spriteId);
    if (write) result.writes.push(write);
  });
  return result;
}

/**
 * 把角色卡原料落进 `characters/<id>.md`：库里没写的字段一律不动，
 * 剧目侧手改过的补充说明要留住。没变化就不写盘，也不记撤销条（空操作会误导用户）。
 *
 * 立绘字段（framing / sprites / spriteFraming）不在这里——它们归素材表，
 * 顺带也让存量卡下次被写到时就瘦下来（`serializeCharacterCard` 只写四个机器字段）。
 */
async function applyCharacterCard(
  files: PlayFiles,
  id: string,
  card: AssetCharacter,
): Promise<PlayFileWrite | null> {
  const path = characterCardPath(id);
  const before = await files.read(path).catch(() => null);
  // 卡不存在就是空卡：条目 id 就是角色 id，目录名与文件名主体一致
  const existing: CharacterDocument = before ? parseCharacterCard(before) : { body: "" };
  const next: CharacterDocument = { ...existing, id };
  // 与素材表同一条判据：空串不算「库里写了」，否则会把已有内容抹成空白
  for (const key of ["name", "voice", "voiceId"] as const) {
    if (card[key]) next[key] = card[key];
  }
  // 人设就是卡片的正文（旧资源库的 persona 字段）
  if (card.persona) next.body = card.persona;
  const after = serializeCharacterCard(next);
  if (after === before) return null;
  await files.write(path, after);
  return { path, before, after };
}
