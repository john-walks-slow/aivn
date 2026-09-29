#!/usr/bin/env node
/**
 * 编码守卫：提交前扫一遍待提交的文件，抓 UTF-8 替换字符 U+FFFD。
 *
 * 背景：长中文正文偶尔会在生成/搬运途中丢掉几个字节，落成 U+FFFD（Unicode 替换字符，
 * 显示成一个带问号的方块）。实测 bash 通道本身是干净的（2 倍体积往返字节级一致），
 * 所以这是**产出端**的字符损坏，不是工具问题——只能靠「提交前拦一道」兜住。
 *
 * 用法：
 *   node scripts/check-encoding.mjs            # 扫 git 待提交（staged）文件
 *   node scripts/check-encoding.mjs <路径>...   # 扫指定文件
 */
import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { resolve } from "node:path";

// 用码点构造而不是写字面量：否则这个文件会被自己判为损坏。
const REPLACEMENT = String.fromCodePoint(0xfffd);

function collectStaged() {
  const out = execFileSync("git", ["diff", "--cached", "--name-only", "--diff-filter=ACM"], {
    encoding: "utf8",
  });
  return out.split("\n").filter(Boolean);
}

function collectWorktree() {
  const out = execFileSync("git", ["ls-files", "--modified", "--others", "--exclude-standard"], {
    encoding: "utf8",
  });
  return out.split("\n").filter(Boolean);
}

const argv = process.argv.slice(2);
const mode = argv[0] === "--worktree" ? "worktree" : argv.length > 0 ? "paths" : "staged";
const files = mode === "staged" ? collectStaged() : mode === "worktree" ? collectWorktree() : argv;

const binary = /\.(png|jpe?g|gif|webp|ico|woff2?|zip|gz|mp3|mp4|sqlite3?|db)$/i;
const bad = [];

for (const file of files) {
  if (binary.test(file)) continue;
  let text;
  try {
    text = readFileSync(resolve(file), "utf8");
  } catch {
    continue;
  }
  const index = text.indexOf(REPLACEMENT);
  if (index < 0) continue;
  const line = text.slice(0, index).split("\n").length;
  const col = index - text.lastIndexOf("\n", index - 1);
  bad.push({ file, line, col, snippet: text.slice(index - 20, index + 20).replace(/\n/g, "⏎") });
}

if (bad.length === 0) {
  console.log(`✓ 编码检查通过（${files.length} 个文件）`);
  process.exit(0);
}

console.error(`✗ 发现 ${bad.length} 处编码损坏（U+FFFD），请修好再提交：\n`);
for (const { file, line, col, snippet } of bad) {
  console.error(`  ${file}:${line}:${col}  …${snippet}…`);
}
console.error("\n修法：把损坏处重新敲一遍（不要用 sed 猜着替换——那正是当初把它写坏的方式）。");
process.exit(1);
