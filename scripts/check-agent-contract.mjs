#!/usr/bin/env node
/**
 * prompt / tool 契约漂移守卫（独立版）。
 *
 * 提示词、工具描述、能力位三者互相引用，但各有各的载体（persona 在 prompt.ts、机制在工具
 * 的 DESCRIPTION、装配在 agentkit）。改了一边忘了另一边**不会报错**——只会在某个实例上
 * 悄悄教模型去调一个不存在的工具，或者让一条契约同时存在两种说法。
 *
 * 这个脚本只查**能确定对错**的那几类关系，不检查文风、不猜语义：
 *
 * 1. 提示词里点名的工具，装配面上必须真的有（能力位关着时不能教它调）。
 * 2. 工具契约不能同时写在 persona 与 DESCRIPTION 两处（机制只有一个家）。
 * 3. 素材生命周期只用共享契约里的状态词（不许各写一套「否决/废弃」）。
 * 4. 能力矩阵与能力目录不许各写一份能力清单。
 *
 * 用法：
 *   node scripts/check-agent-contract.mjs           # 跑全部检查
 *   node scripts/check-agent-contract.mjs --list    # 只列检查项
 *
 * 退出码：0 全过，1 有漂移。
 */
import { readFileSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";

const ROOT = resolve(import.meta.dirname, "..");
const AGENTKIT = join(ROOT, "apps/server/src/agentkit");

/**
 * 提示词里出现工具名是**允许且必要**的（persona 要讲「何时用」），但出现的名字必须在
 * 装配面上真的存在。这里扫的是提示词与工坊提示词两处正文。
 */
const PROMPT_FILES = ["apps/server/src/prompt.ts", "apps/server/src/workshop.ts", "apps/server/src/craftParams.ts"];

/** persona 里只许讲「何时用」，参数细节归 DESCRIPTION——这些是参数词汇，不该出现在提示词正文。 */
const PARAM_VOCAB = [
  "additionalProperties",
  "minLength",
  "maxLength",
  "draftId",
  "spriteId",
  "overwrite=",
  "Type.Object",
];

/** 共享契约里的素材状态词。各宿主实现可以有自己的内部名字，但对外说法必须出自这一套。 */
const LIFECYCLE_STATES = ["pending", "draft", "adopted", "expired", "failed"];

/** 不许再出现的旧词：它们曾经各自被当成状态，实际不是（见 core 的 assetLifecycle）。 */
const FORBIDDEN_LIFECYCLE_WORDS = ["rejected", "已否决", "被拒绝的候选"];

function read(rel) {
  return readFileSync(join(ROOT, rel), "utf8");
}

/** 装配面上真实存在的工具名：从 kit.ts 的工具目录 + 各工厂的 name 字段收。 */
function installedToolNames() {
  const names = new Set();
  for (const file of readdirSync(AGENTKIT)) {
    if (!file.endsWith(".ts")) continue;
    const source = readFileSync(join(AGENTKIT, file), "utf8");
    for (const match of source.matchAll(/name:\s*"([a-z_]+)"/g)) names.add(match[1]);
    // 工具目录里登记但工厂在别的文件里的（pi 的内建 read/write/edit/bash）
    for (const match of source.matchAll(/^\s{2}([a-z_]+):\s*\{\s*label:/gm)) names.add(match[1]);
  }
  for (const builtin of ["read", "write", "edit", "bash"]) names.add(builtin);
  return names;
}

/** 提示词正文里被反引号括起来的形如工具名的词。 */
function toolNamesMentionedIn(rel) {
  const source = read(rel);
  const found = new Set();
  for (const match of source.matchAll(/`([a-z][a-z_]{2,})`/g)) {
    const name = match[1];
    // 只认「看起来像工具名」的：带下划线，或命中已知工具词根
    if (name.includes("_")) found.add(name);
  }
  return found;
}

/** 去掉 TS 注释：注释是给开发者的，不进提示词，不该被这条检查误伤。 */
function stripComments(source) {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/[^\n]*/g, "$1");
}

/**
 * 提示词正文里出现的**参数名**：带词边界，别把 `spriteIdOf` 这样的标识符认成参数。
 *
 * **示例调用整行放行**：`generate_image(kind="sprite", spriteId="xiaoyu", …)` 教的是调用约定，
 * 一行例子比十句散文有用，这类示范一直是本项目的教学手段（既有测试也钉着它）。
 * 这条检查拦的是另一种：**用散文解释参数**（默认值、取值范围、给不给会怎样）——
 * 那是 DESCRIPTION 的家，写两处就会各自漂移。
 */
function paramTokensIn(rel) {
  const source = stripComments(read(rel))
    .split("\n")
    // 具名参数调用行（行首是标识符、括号里带 `名=`）：整行跳过
    .filter((line) => !/^\s*[a-z_][\w.]*\s*\([^)]*\w+\s*=/.test(line))
    .join("\n");
  const found = new Set();
  for (const token of PARAM_VOCAB) {
    if (new RegExp(`\\b${token}\\b`).test(source)) found.add(token);
  }
  return found;
}

const checks = [];
function check(name, run) {
  checks.push({ name, run });
}

check("提示词点名的工具都在装配面上", () => {
  const installed = installedToolNames();
  const problems = [];
  for (const rel of PROMPT_FILES) {
    for (const name of toolNamesMentionedIn(rel)) {
      if (installed.has(name)) continue;
      // 排除明显不是工具名的（文件路径、字段名等带下划线的普通词）
      if (!/^(generate|commit|import|list|read|search|set|get|view|recut|enter|exit|update|beat|web)_/.test(name)) {
        continue;
      }
      problems.push(`${rel} 提到 \`${name}\`，但装配面上没有这个工具`);
    }
  }
  return problems;
});

check("提示词不承载工具参数细节", () => {
  const problems = [];
  for (const rel of PROMPT_FILES) {
    for (const token of paramTokensIn(rel)) {
      problems.push(`${rel} 出现参数名「${token}」——机制应归工具 DESCRIPTION，提示词只说「何时用」`);
    }
  }
  return problems;
});

check("素材状态词只用共享契约那一套", () => {
  const problems = [];
  const files = [
    ...PROMPT_FILES,
    "apps/server/src/playAssets.ts",
    "apps/server/src/agentkit/commitTool.ts",
    "apps/server/src/agentkit/imageTool.ts",
  ];
  for (const rel of files) {
    const source = read(rel);
    for (const word of FORBIDDEN_LIFECYCLE_WORDS) {
      if (source.includes(word)) problems.push(`${rel} 用了契约里不存在的状态词「${word}」`);
    }
  }
  return problems;
});

check("生命周期常量由共享契约推导", () => {
  const source = read("apps/server/src/playAssets.ts");
  if (!source.includes("ASSET_DRAFT_RETENTION_DAYS")) {
    return ["playAssets.ts 的保留期不再来自 @aivn/core 的 ASSET_DRAFT_RETENTION_DAYS"];
  }
  if (/DRAFT_TTL_MS\s*=\s*\d/.test(source)) {
    return ["playAssets.ts 把手写天数又写回来了——两边对同一条承诺会各说各的"];
  }
  return [];
});

check("能力矩阵与能力目录一一对应", () => {
  const kit = read("apps/server/src/agentkit/kit.ts");
  const contract = read("apps/server/src/agentkit/contract.ts");
  const catalogIds = [...kit.matchAll(/^\s{4}id:\s*"([a-z]+)",\s*$/gm)].map((m) => m[1]);
  const matrixIds = [...contract.matchAll(/^\s{4}id:\s*"([a-z]+)",\s*$/gm)].map((m) => m[1]);
  const problems = [];
  for (const id of catalogIds) {
    if (!matrixIds.includes(id)) problems.push(`能力「${id}」在 CAPABILITY_CATALOG 里，却不在 CAPABILITY_MATRIX 里`);
  }
  for (const id of matrixIds) {
    if (!catalogIds.includes(id)) problems.push(`能力「${id}」在 CAPABILITY_MATRIX 里，却不在 CAPABILITY_CATALOG 里`);
  }
  return problems;
});

if (process.argv.includes("--list")) {
  for (const { name } of checks) console.log(`- ${name}`);
  process.exit(0);
}

let failed = 0;
for (const { name, run } of checks) {
  let problems;
  try {
    problems = run();
  } catch (error) {
    problems = [`检查本身出错：${error.message}`];
  }
  if (problems.length === 0) {
    console.log(`✓ ${name}`);
  } else {
    failed += 1;
    console.log(`✗ ${name}`);
    for (const problem of problems) console.log(`    ${problem}`);
  }
}

if (failed > 0) {
  console.log(`\n${failed} 项检查未通过。`);
  process.exit(1);
}
console.log(`\n全部 ${checks.length} 项检查通过。`);
