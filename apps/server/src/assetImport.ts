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
  type SpriteFraming,
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
 * 导入同时把元数据搬进剧目的 `assets/manifest.json`（立绘另加角色卡
 * `characters/<id>.md`）——这才是「剧作家能按情绪选曲、认出这是谁的哪个表情」的落点。
 */

export interface ImportRequest {
  kind: AssetKind;
  entryId: string;
  /** characters 条目只导这几条差分（缺省全导）。 */
  expressions?: string[];
  /** 落点为固定 id 的主角卡（`characters/protagonist.md`）而不是以条目 id 命名的新卡。 */
  target?: "protagonist";
}

export interface ImportResult {
  kind: AssetKind;
  id: string;
  /** 落到剧目的相对路径（assets/…），给前端与工坊回执看。 */
  files: string[];
  /** 写进/更新了哪些角色卡 id。 */
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

/** characters 条目要导哪些差分：指定的那几条 > meta 声明的 > 目录里全部文件（手工丢个文件夹进来也能用）。 */
function pickedExpressions(entry: LibraryEntry, requested: string[] | undefined): string[] {
  const declared = Object.keys(entry.meta.expressions ?? {});
  if (requested && requested.length > 0) return requested;
  if (declared.length > 0) return declared;
  return entry.files.map((f) => stemOf(f.name));
}

/** 一条差分落在条目录里的哪个文件：expressions 表优先，其次按差分名当文件名/主体名找。 */
function fileForExpression(entry: LibraryEntry, expression: string): LibraryFile | undefined {
  const declared = entry.meta.expressions?.[expression]?.file;
  if (declared) {
    const byName = entry.files.find((f) => f.name === declared);
    if (byName) return byName;
  }
  return entry.files.find((f) => stemOf(f.name) === expression);
}

export async function importFromLibrary(
  library: AssetLibrary,
  store: PlayStore,
  req: ImportRequest,
): Promise<ImportResult> {
  const entry = await library.entry(req.kind, req.entryId);
  if (!entry) throw new Error(`资源库里没有 ${req.kind}/${req.entryId}`);
  const files = new PlayFiles(store);
  const isCharacter = entry.kind === "characters";
  // 角色 id 决定卡落在哪、立绘放哪个目录——主角固定 id，其余用条目 id
  const characterId = req.target === "protagonist" ? PROTAGONIST_ID : entry.id;
  const result: ImportResult = {
    kind: entry.kind,
    id: entry.id,
    files: [],
    characters: [],
    protagonist: false,
    manifestKeys: [],
    writes: [],
  };

  // ── 文件复制在锁外：整包图片几十兆，进锁会把整条剧目配置队列堵住 ──
  const manifest: [string, AssetMeta][] = [];
  const spriteMap: Record<string, string> = {};
  // 差分级取景：只有条目差分显式声明才搬，角色级 framing 留给 applyCharacter 写单值
  const spriteFraming: Record<string, SpriteFraming> = {};
  // 主角和别的角色一样可以上台：立绘照导，落在 assets/sprites/protagonist/。
  // 要不要用它、用不用它的立绘是创作口径（craft.md）的事，导入这一层不替剧目做决定。
  const copyMedia = isCharacter;
  if (copyMedia) {
    for (const expression of pickedExpressions(entry, req.expressions)) {
      const source = fileForExpression(entry, expression);
      if (!source) throw new Error(`差分 ${expression} 在资源库条目里没有对应文件`);
      const ext = extname(source.name).toLowerCase();
      const kindPath = `sprites/${characterId}`;
      await removeStaleSiblings(store, kindPath, expression, `${expression}${ext}`);
      await copyInto(await library.filePath(entry.kind, entry.id, source.name), store.assetPath(`${kindPath}/${expression}${ext}`));
      result.files.push(`assets/${kindPath}/${expression}${ext}`);
      // 键带角色前缀：多角色剧目里光写 smile 会被另一个角色的同名差分覆盖
      manifest.push([
        `${characterId}/${expression}`,
        mergeMeta(undefined, entry.meta, {
          description: entry.meta.expressions?.[expression]?.description ?? entry.meta.description,
        }),
      ]);
      spriteMap[expression] = `${expression}${ext}`;
      const expressionFraming = entry.meta.expressions?.[expression]?.framing;
      if (expressionFraming) spriteFraming[expression] = expressionFraming;
    }
  } else if (!isCharacter) {
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

    const card = entry.meta.character;
    result.protagonist = req.target === "protagonist";
    // 立绘必须有角色可挂：只声明了图就按目录名建一张空壳卡，否则差分映射无处安放
    if (!card && Object.keys(spriteMap).length === 0) return;
    const write = await applyCharacterCard(files, characterId, {
      card: card ?? {},
      sprites: spriteMap,
      spriteFraming,
      framing: entry.meta.framing,
    });
    result.characters.push(characterId);
    if (write) result.writes.push(write);
  });
  return result;
}

/**
 * 把角色卡原料落进 `characters/<id>.md`：库里没写的字段一律不动，
 * 剧目侧手改过的补充说明要留住。没变化就不写盘，也不记撤销条（空操作会误导用户）。
 */
async function applyCharacterCard(
  files: PlayFiles,
  id: string,
  incoming: {
    card: AssetCharacter;
    sprites: Record<string, string>;
    spriteFraming: Record<string, SpriteFraming>;
    framing?: SpriteFraming;
  },
): Promise<PlayFileWrite | null> {
  const path = characterCardPath(id);
  const before = await files.read(path).catch(() => null);
  // 卡不存在就是空卡：条目 id 就是角色 id，目录名与文件名主体一致
  const existing: CharacterDocument = before ? parseCharacterCard(before) : { body: "" };
  const next: CharacterDocument = { ...existing, id };
  // 与素材表同一条判据：空串不算「库里写了」，否则会把已有内容抹成空白
  for (const key of ["name", "voice", "voiceId"] as const) {
    if (incoming.card[key]) next[key] = incoming.card[key];
  }
  // 人设就是卡片的正文（旧资源库的 persona 字段）
  if (incoming.card.persona) next.body = incoming.card.persona;
  if (Object.keys(incoming.sprites).length > 0) {
    next.sprites = { ...(existing.sprites ?? {}), ...incoming.sprites };
  }
  // 取景同上：库里没写就不动剧目侧的值。差分级覆盖是合并而非替换——
  // 只导一条 smile 不该把同角色其它差分（可能带 closeup 取景）的声明抹掉。
  if (incoming.framing) next.framing = incoming.framing;
  if (Object.keys(incoming.spriteFraming).length > 0) {
    next.spriteFraming = { ...(existing.spriteFraming ?? {}), ...incoming.spriteFraming };
  }
  const after = serializeCharacterCard(next);
  if (after === before) return null;
  await files.write(path, after);
  return { path, before, after };
}
