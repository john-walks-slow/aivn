#!/usr/bin/env node
/**
 * 一次性迁移（261004-workshop-layers）：角色卡上移到剧目顶层，主角落成一张卡。
 *
 * 1. `memory/always/characters/<id>.md` → `characters/<id>.md`（角色不再算记忆的一层）；
 * 2. `play.json` 的 `protagonist: {name, persona}` → `characters/protagonist.md`，并从 play.json 里删掉这个字段。
 *
 * 默认 dry-run，只打印将要做什么；`--apply` 才动盘（对齐仓库的「批处理先 dry run」规则）。
 *
 *   node scripts/migrate-play-layout.mjs                 # 看一遍 plays/* 会怎么迁
 *   node scripts/migrate-play-layout.mjs --apply         # 真迁
 *   node scripts/migrate-play-layout.mjs --root /path/to/plays --only demo --apply
 *
 * **软链接一律跳过**：worktree 里的 plays/<其他剧目> 常是指向主工作区的软链，
 * 顺着它写下去等于改了另一个工作区的数据。本脚本只动自己看得见的真目录。
 */
import { existsSync } from "node:fs";
import { mkdir, readdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";

const CHAR_DIR = "characters";
const LEGACY_CHAR_DIR = join("memory", "always", "characters");
const PROTAGONIST = "protagonist";

/** 迁移脚本自己拼路径：核心包是 TS，脚本不该为了两个字符串去 build 一次。 */
function parseProtagonist(play) {
  const raw = play?.protagonist;
  if (!raw || typeof raw !== "object") return null;
  const name = typeof raw.name === "string" ? raw.name.trim() : "";
  const persona = typeof raw.persona === "string" ? raw.persona.trim() : "";
  return name || persona ? { name, persona } : null;
}

function cardText({ name, persona }) {
  return `---\nname: ${name || "你"}\n---\n\n${persona ? `${persona}\n` : ""}`;
}

async function migratePlay(playDir, apply) {
  const changes = [];
  const playPath = join(playDir, "play.json");
  const legacyDir = join(playDir, LEGACY_CHAR_DIR);
  const charDir = join(playDir, CHAR_DIR);

  // ── 1. 角色卡换目录 ──
  if (existsSync(legacyDir)) {
    for (const entry of (await readdir(legacyDir)).sort()) {
      if (!entry.endsWith(".md")) continue;
      const target = join(charDir, entry);
      if (existsSync(target)) {
        changes.push(`跳过 ${LEGACY_CHAR_DIR}/${entry}：${CHAR_DIR}/${entry} 已存在，不覆盖`);
        continue;
      }
      changes.push(`移动 ${LEGACY_CHAR_DIR}/${entry} → ${CHAR_DIR}/${entry}`);
      if (apply) {
        await mkdir(charDir, { recursive: true });
        await rename(join(legacyDir, entry), target);
      }
    }
    // 空了就收掉：留着空目录会让「角色表 = characters/」这条不变式看起来还有例外
    if (apply && (await readdir(legacyDir)).length === 0) await rm(legacyDir, { recursive: true });
    else if (!apply) changes.push(`（迁移后 ${LEGACY_CHAR_DIR}/ 空了就删掉它）`);
  }

  // ── 2. 主角落卡 ──
  const raw = JSON.parse(await readFile(playPath, "utf8"));
  const protagonist = parseProtagonist(raw);
  if (protagonist) {
    const target = join(charDir, `${PROTAGONIST}.md`);
    if (existsSync(target)) {
      changes.push(`跳过主角卡：${CHAR_DIR}/${PROTAGONIST}.md 已存在（play.json 的 protagonist 字段删掉即可）`);
    } else {
      changes.push(`写 ${CHAR_DIR}/${PROTAGONIST}.md ← play.json 的 protagonist`);
      if (apply) {
        await mkdir(charDir, { recursive: true });
        await writeFile(target, cardText(protagonist), "utf8");
      }
    }
    changes.push("从 play.json 删掉 protagonist 字段");
    if (apply) {
      delete raw.protagonist;
      await writeFile(playPath, `${JSON.stringify(raw, null, 2)}\n`, "utf8");
    }
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
    const playDir = join(root, entry.name);
    if (!existsSync(join(playDir, "play.json"))) continue;
    const changes = await migratePlay(playDir, apply);
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
