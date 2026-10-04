#!/usr/bin/env node
/**
 * 一次性迁移（261004-sprite-entity）：立绘声明从角色卡搬进素材表。
 *
 * 261004 之后，一个主体的呈现声明只有两个落点：`assets/manifest.json` 的 `<id>`（立绘级）
 * 与 `<id>/<variant>`（差分覆盖）。角色卡只管人设与音色。所以：
 *
 * 1. 卡上的 `framing` / `spriteFraming` 抄进素材表对应键，然后从卡上删掉；`sprites` 映射表
 *    整个删掉（差分名就是文件名，不再有映射这一层）。映射里文件名主体与差分名不一致的，
 *    把文件改名成 `<差分名><后缀>`，让「variant = 文件名」这条恒等式成立。
 * 2. 素材表里的 `expressions` 键改名 `variants`（库里导入过的立绘本来就用这个键）。
 * 3. 存档/谱系里的 actor 属性 `expression` / `state` 改写 `variant`；工坊历史里的
 *    `generate_image` 调用参数 `characterId` → `spriteId`、`expression` → `variant`。
 *
 * 默认 dry-run，只打印将要做什么；`--apply` 才动盘（对齐仓库的「批处理先 dry run」规则）。
 *
 *   node scripts/migrate-sprite-declarations.mjs               # 看一遍 plays/* 会怎么迁
 *   node scripts/migrate-sprite-declarations.mjs --apply       # 真迁
 *   node scripts/migrate-sprite-declarations.mjs --root /path/to/plays --only demo --apply
 *
 * **软链接一律跳过**：worktree 里的 plays/<其他剧目> 常是指向主工作区的软链，
 * 顺着它写下去等于改了另一个工作区的数据。本脚本只动自己看得见的真目录。
 */
import { existsSync } from "node:fs";
import { mkdir, readdir, readFile, rename, writeFile } from "node:fs/promises";
import { extname, join, resolve } from "node:path";

const FRAMINGS = new Set(["full", "half", "square"]);
/** 卡上这些键在 261004 之后归素材表或消失。 */
const LEGACY_CARD_KEYS = new Set(["framing", "spriteFraming", "sprites"]);
const MANIFEST = join("assets", "manifest.json");

/** `---` 之间的 frontmatter 切成 head（键值行）与 rest（正文），拿不到就返回 null。 */
function splitFrontmatter(text) {
  const lines = text.split("\n");
  if (lines[0]?.trim() !== "---") return null;
  const close = lines.findIndex((line, i) => i > 0 && line.trim() === "---");
  if (close < 0) return null;
  return { head: lines.slice(1, close), rest: lines.slice(close + 1) };
}

/** 缩进行归属上一条键：`framing: full` 是标量，`spriteFraming:` 底下是块。 */
function parseEntries(head) {
  const entries = [];
  for (const line of head) {
    if (/^\s/.test(line) && entries.length > 0) {
      entries.at(-1).lines.push(line);
      continue;
    }
    entries.push({ key: line.split(":")[0].trim(), lines: [line] });
  }
  return entries;
}

function scalarOf(entry) {
  const m = /^[^:]+:\s*(.*)$/.exec(entry.lines[0]);
  return m ? m[1].trim().replace(/^["']|["']$/g, "") : "";
}

function blockOf(entry) {
  const pairs = [];
  for (const line of entry.lines.slice(1)) {
    const m = /^\s+([^:]+):\s*(.*)$/.exec(line);
    if (m) pairs.push([m[1].trim().replace(/^["']|["']$/g, ""), m[2].trim().replace(/^["']|["']$/g, "")]);
  }
  return pairs;
}

/** 声明只写给还没声明过的键：素材表是新真相源，已有值不覆盖。 */
function declare(manifest, key, field, value, changes) {
  const current = manifest[key] ?? {};
  if (current[field] !== undefined) {
    if (current[field] !== value) {
      changes.push(`跳过 ${key} 的 ${field}：素材表已声明 ${current[field]}，不覆盖`);
    }
    return;
  }
  manifest[key] = { ...current, [field]: value };
  changes.push(`素材表 ${key}.${field} = ${value}`);
}

async function migrateCard(playDir, file, manifest, apply, changes) {
  const abs = join(playDir, "characters", file);
  const text = await readFile(abs, "utf8");
  const fm = splitFrontmatter(text);
  if (!fm) return false;
  const entries = parseEntries(fm.head);
  const legacy = entries.filter((entry) => LEGACY_CARD_KEYS.has(entry.key));
  if (legacy.length === 0) return false;

  const id = file.replace(/\.md$/, "");

  const framing = legacy.find((entry) => entry.key === "framing");
  if (framing) {
    const value = scalarOf(framing);
    if (FRAMINGS.has(value)) declare(manifest, id, "framing", value, changes);
    else changes.push(`跳过 ${id} 的 framing：卡上写着 ${JSON.stringify(value)}，不是取景`);
  }

  const perVariant = legacy.find((entry) => entry.key === "spriteFraming");
  for (const [variant, value] of perVariant ? blockOf(perVariant) : []) {
    if (!FRAMINGS.has(value)) {
      changes.push(`跳过 ${id}/${variant} 的取景：卡上写着 ${JSON.stringify(value)}，不是取景`);
      continue;
    }
    declare(manifest, `${id}/${variant}`, "framing", value, changes);
  }

  const mapping = legacy.find((entry) => entry.key === "sprites");
  for (const [variant, filename] of mapping ? blockOf(mapping) : []) {
    if (filename.includes("/")) {
      changes.push(`跳过 ${id}/${variant} 的映射：${filename} 带路径分隔符，手动处理`);
      continue;
    }
    const stem = filename.slice(0, filename.length - extname(filename).length);
    if (stem === variant) continue;
    const dir = join(playDir, "assets", "sprites", id);
    const from = join(dir, filename);
    const to = join(dir, `${variant}${extname(filename)}`);
    if (!existsSync(from)) {
      changes.push(`跳过改名 ${filename} → ${variant}${extname(filename)}：${from} 不存在（映射已按「差分名 = 文件名」处理）`);
      continue;
    }
    if (existsSync(to)) {
      changes.push(`跳过改名 ${filename} → ${variant}${extname(filename)}：目标已存在`);
      continue;
    }
    changes.push(`改名 assets/sprites/${id}/${filename} → ${variant}${extname(filename)}`);
    if (apply) await rename(from, to);
  }

  changes.push(`删掉 ${file} 上的 ${legacy.map((entry) => entry.key).join(" / ")}`);
  if (apply) {
    const kept = entries.filter((entry) => !LEGACY_CARD_KEYS.has(entry.key)).flatMap((entry) => entry.lines);
    // 卡上只剩被迁移的字段时不留一对空栅栏（`---\n---`）：解析器容得下，但那是没用的噪声
    const head = kept.length > 0 ? ["---", ...kept, "---"] : [];
    await writeFile(abs, [...head, ...fm.rest].join("\n"), "utf8");
  }
  return true;
}

/** `expressions` → `variants`：旧键读回落留着，但迁移后盘上只该剩新键。 */
function migrateManifestKeys(manifest, changes) {
  for (const [key, meta] of Object.entries(manifest)) {
    if (!meta || typeof meta !== "object" || meta.expressions === undefined) continue;
    if (meta.variants === undefined) {
      meta.variants = meta.expressions;
      changes.push(`素材表 ${key}.expressions → variants`);
    } else {
      changes.push(`素材表 ${key}：删掉多余的 expressions（variants 已存在）`);
    }
    delete meta.expressions;
  }
}

/** 存档里的 actor 属性：`expression` / `state` 是 261004 之前的两个名字。 */
function migrateAttrs(attrs, changes, where) {
  if (!attrs || typeof attrs !== "object") return;
  for (const legacy of ["expression", "state"]) {
    if (attrs[legacy] === undefined) continue;
    if (attrs.variant === undefined) {
      attrs.variant = attrs[legacy];
      changes.push(`${where}.${legacy} → variant`);
    } else {
      changes.push(`${where}：删掉多余的 ${legacy}（variant 已存在）`);
    }
    delete attrs[legacy];
  }
}

/** 工坊历史里 generate_image 的参数名跟着工具 schema 走，否则重放给模型的是不存在的键。 */
function migrateHistory(history, changes) {
  for (const [index, thread] of (history ?? []).entries()) {
    for (const entry of thread?.entries ?? []) {
      if (entry?.role !== "toolCall" || !entry.args || typeof entry.args !== "object") continue;
      const where = `history[${index}] ${entry.name}`;
      migrateAttrs(entry.args, changes, where);
      if (entry.args.characterId !== undefined) {
        if (entry.args.spriteId === undefined) entry.args.spriteId = entry.args.characterId;
        delete entry.args.characterId;
        changes.push(`${where}.characterId → spriteId`);
      }
    }
  }
}

async function migrateSession(file, apply, changes) {
  const before = changes.length;
  const text = await readFile(file, "utf8");
  const session = JSON.parse(text);
  const where = file.split("/").slice(-2).join("/");

  for (const event of session?.lineage?.events ?? []) {
    migrateAttrs(event?.payload?.attrs, changes, `lineage ${where} ${event.id ?? ""}`.trim());
  }
  for (const item of session?.runtime?.events ?? []) {
    if (item?.event?.kind === "actor") migrateAttrs(item.event, changes, `runtime ${where} seq ${item.seq}`);
  }
  migrateHistory(session?.history, changes);

  if (changes.length > before && apply) await writeFile(file, JSON.stringify(session), "utf8");
}

async function migrateLineage(file, apply, changes) {
  const lines = (await readFile(file, "utf8")).split("\n");
  const out = [];
  let touched = false;
  const where = file.split("/").slice(-2).join("/");
  for (const line of lines) {
    if (line.trim() === "") {
      out.push(line);
      continue;
    }
    const event = JSON.parse(line);
    const before = changes.length;
    migrateAttrs(event?.payload?.attrs, changes, `lineage ${where} ${event.id ?? ""}`.trim());
    if (changes.length > before) touched = true;
    out.push(touched ? JSON.stringify(event) : line);
  }
  if (touched && apply) await writeFile(file, out.join("\n"), "utf8");
}

async function migrateSaves(playDir, apply, changes) {
  const dir = join(playDir, "saves");
  if (!existsSync(dir)) return;
  for (const entry of (await readdir(dir, { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name))) {
    if (!entry.isDirectory()) continue;
    const saveDir = join(dir, entry.name);
    for (const name of await readdir(saveDir)) {
      const file = join(saveDir, name);
      if (name === "session.json") await migrateSession(file, apply, changes);
      else if (name === "lineage.jsonl") await migrateLineage(file, apply, changes);
    }
  }
}

async function migratePlay(playDir, apply) {
  const changes = [];
  const charDir = join(playDir, "characters");
  const manifestPath = join(playDir, MANIFEST);
  const manifest = existsSync(manifestPath) ? JSON.parse(await readFile(manifestPath, "utf8")) : {};

  if (existsSync(charDir)) {
    for (const file of (await readdir(charDir)).filter((name) => name.endsWith(".md")).sort()) {
      await migrateCard(playDir, file, manifest, apply, changes);
    }
  }
  migrateManifestKeys(manifest, changes);
  await migrateSaves(playDir, apply, changes);

  if (changes.length > 0 && apply && Object.keys(manifest).length > 0) {
    await mkdir(join(playDir, "assets"), { recursive: true });
    await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
  }
  return changes;
}

async function main() {
  const argv = process.argv.slice(2);
  const apply = argv.includes("--apply");
  const value = (flag) => {
    const i = argv.indexOf(flag);
    return i >= 0 ? argv[i + 1] : undefined;
  };
  const root = resolve(value("--root") ?? "plays");
  const only = value("--only");

  const entries = await readdir(root, { withFileTypes: true });
  let touched = 0;
  for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
    if (!entry.isDirectory()) {
      if (entry.isSymbolicLink()) console.log(`[跳过] ${entry.name}：软链接（别的 worktree 的剧目，本脚本不跨目录写盘）`);
      continue;
    }
    if (only && entry.name !== only) continue;
    const changes = await migratePlay(join(root, entry.name), apply);
    if (changes.length === 0) continue;
    touched++;
    console.log(`\n[${entry.name}]${apply ? "" : "（dry-run）"}`);
    for (const line of changes) console.log(`  - ${line}`);
  }

  console.log(
    touched === 0
      ? "\n没有需要迁移的剧目。"
      : `\n共 ${touched} 部剧目${apply ? "已迁移" : "待迁移（加 --apply 落盘）"}。`,
  );
}

await main();
