import { copyFile, mkdir, readdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { dirname, extname, join } from "node:path";
import {
  parsePlayConfig,
  type AssetCharacter,
  type AssetKind,
  type AssetMeta,
  type CharacterCard,
  type LibraryEntry,
  type LibraryFile,
  type SpriteFraming,
} from "@stage-ai/core";
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
 * **条目声明什么就搬什么**，不做「立绘包 vs 单文件」的分档：一个条目可以只有角色卡、
 * 只有立绘、两者都有、或只有描述。角色卡字段走同一条合并规则（库里有值才覆盖剧目的），
 * 所以剧目侧手写的补充说明不会被一份缺字段的库 meta 冲掉。
 *
 * 导入同时把元数据搬进剧目的 `assets/manifest.json`（立绘另加 `play.json` 角色卡）——
 * 这才是「剧作家能按情绪选曲、认出这是谁的哪个表情」的落点。
 */

export interface ImportRequest {
  kind: AssetKind;
  entryId: string;
  /** characters 条目只导这几条差分（缺省全导）。 */
  expressions?: string[];
  /** 落点为主角卡（覆盖 play.json 的 protagonist）而不是角色列表。 */
  target?: "protagonist";
}

export interface ImportResult {
  kind: AssetKind;
  id: string;
  /** 落到剧目的相对路径（assets/…），给前端与工坊回执看。 */
  files: string[];
  /** 写进/更新了哪些角色卡 id。 */
  characters: string[];
  /** 这次写的是主角卡（角色列表为空）。 */
  protagonist: boolean;
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
  // 主角卡没有立绘位（舞台只画 characters，protagonist 只供音色与润色），
  // 复制过去就是没人引用的孤儿文件——只导卡，不导图
  const copyMedia = isCharacter && req.target !== "protagonist";
  if (copyMedia) {
    for (const expression of pickedExpressions(entry, req.expressions)) {
      const source = fileForExpression(entry, expression);
      if (!source) throw new Error(`差分 ${expression} 在资源库条目里没有对应文件`);
      const ext = extname(source.name).toLowerCase();
      const kindPath = `sprites/${entry.id}`;
      await removeStaleSiblings(store, kindPath, expression, `${expression}${ext}`);
      await copyInto(await library.filePath(entry.kind, entry.id, source.name), store.assetPath(`${kindPath}/${expression}${ext}`));
      result.files.push(`assets/${kindPath}/${expression}${ext}`);
      // 键带角色前缀：多角色剧目里光写 smile 会被另一个角色的同名差分覆盖
      manifest.push([
        `${entry.id}/${expression}`,
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

  // ── 配置读改写在锁内：play.json 与素材表都是「读全量 → 改 → 写回」，裸做就是互相覆盖 ──
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
    // 立绘必须有角色可挂：只声明了图就按目录名建一张空壳卡，否则差分映射无处安放
    if (!card && Object.keys(spriteMap).length === 0) return;
    const before = await files.read("play.json").catch(() => null);
    const play = before ? parsePlayConfig(JSON.parse(before)) : null;
    if (!play) throw new Error("剧目 play.json 不可读，角色卡没能写进去");
    applyCharacter(play, entry.id, card ?? {}, spriteMap, spriteFraming, entry.meta.framing, req.target === "protagonist");
    result.protagonist = req.target === "protagonist";
    if (!result.protagonist) result.characters.push(entry.id);
    // 不带尾换行：与 savePlay / playAssets 的写法一致，别让撤销后的文本对不上
    const after = JSON.stringify(parsePlayConfig(play), null, 2);
    await files.write("play.json", after);
    if (before !== after) result.writes.push({ path: "play.json", before, after });
  });
  return result;
}

/**
 * 把角色卡原料落进 play.json：库里没写的字段一律不动，剧目侧手改过的补充说明要留住。
 * 落点由请求决定而不是条目标记——同一个条目既能从角色列表进、也能从主角卡进。
 */
function applyCharacter(
  play: ReturnType<typeof parsePlayConfig>,
  id: string,
  card: AssetCharacter,
  spriteMap: Record<string, string>,
  spriteFraming: Record<string, SpriteFraming>,
  framing: SpriteFraming | undefined,
  toProtagonist: boolean,
): void {
  if (toProtagonist) {
    // 主角卡只有 name/persona 两个字段：台词风格与音色是角色的事，主角用不到。
    // 与下面同一条判据——空串不算「库里写了」，否则会把已有名字抹成空白触发整张卡被丢弃
    play.protagonist = {
      name: card.name || play.protagonist?.name || id,
      persona: card.persona || play.protagonist?.persona || "",
    };
    return;
  }
  let character = play.characters.find((c) => c.id === id);
  if (!character) {
    character = { id, name: card.name || id, persona: card.persona || "", sprites: {} } satisfies CharacterCard;
    play.characters.push(character);
  }
  for (const key of ["name", "persona", "voice", "voiceId"] as const) {
    const value = card[key];
    if (value) character[key] = value;
  }
  if (Object.keys(spriteMap).length > 0) {
    character.sprites = { ...(character.sprites ?? {}), ...spriteMap };
  }
  // 取景同上：库里没写就不动剧目侧的值。差分级覆盖是合并而非替换——
  // 只导一条 smile 不该把同角色其它差分（可能带 closeup 取景）的声明抹掉。
  if (framing) character.framing = framing;
  if (Object.keys(spriteFraming).length > 0) {
    character.spriteFraming = { ...(character.spriteFraming ?? {}), ...spriteFraming };
  }
}
