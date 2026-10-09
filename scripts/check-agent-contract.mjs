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

/**
 * 共享契约里的素材状态词——**从 core 源码现读**，不在这里再抄一份。
 * 抄一份就等于「两边各写一套状态名」在守卫自己身上重演。
 */
function lifecycleStates() {
  const source = read("packages/core/src/play/assetLifecycle.ts");
  const match = source.match(/ASSET_LIFECYCLE_STATES\s*=\s*\[([^\]]+)\]/);
  if (!match) throw new Error("读不出 ASSET_LIFECYCLE_STATES——契约文件改结构了？");
  return new Set([...match[1].matchAll(/"([a-z]+)"/g)].map((m) => m[1]));
}

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
    // 工具目录里登记的（含 pi 的内建 read/write/edit/bash，它们没有 name: "..." 字面量）
    for (const match of source.matchAll(/^\s{2}([a-z_]+):\s*\{\s*label:/gm)) names.add(match[1]);
  }
  return names;
}

/**
 * 提示词正文里被反引号括起来、看起来像工具名的词。
 *
 * **两类都收**：带下划线的（`generate_image`）与短名（`read` / `write` / `edit` / `bash`）。
 * 早先只收前者，于是「内建工具也在检查范围内」是句空话——`read` 这类永远不会进入比对。
 */
function toolNamesMentionedIn(rel) {
  const source = read(rel);
  const found = new Set();
  for (const match of source.matchAll(/`([a-z][a-z_]{0,30})`/g)) found.add(match[1]);
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

/**
 * 无下划线的短名工具词：靠词根前缀判不出来，只能列出来。
 * 这两个词（read / write…）本身也是普通英文与文件动词，所以**只按精确相等**认，
 * 且必须整词被反引号括着才算（见 `toolNamesMentionedIn`）。
 */
const SHORT_TOOL_WORDS = new Set(["read", "write", "edit", "bash", "grep", "glob"]);

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
      // 反引号里什么都可能是（英文单词、文件名、字段名），只有**像个工具名**的才比。
      // 判据：带下划线且命中工具词根，或本身就是个短名工具词（read/write/edit/bash）。
      const looksLikeTool =
        (/^(generate|commit|import|list|read|search|set|get|view|recut|enter|exit|update|beat|web)_/.test(name) &&
          name.includes("_")) ||
        SHORT_TOOL_WORDS.has(name);
      if (!looksLikeTool) continue;
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
  const states = lifecycleStates();
  // 防呆：契约文件要是被读空了，白名单校验会「全部通过」——那不叫通过，叫失效。
  if (states.size < 5) problems.push(`从 core 只读到 ${states.size} 个状态词，契约文件可能改结构了`);
  const files = [
    ...PROMPT_FILES,
    "apps/server/src/playAssets.ts",
    "apps/server/src/agentkit/commitTool.ts",
    "apps/server/src/agentkit/imageTool.ts",
  ];
  // 认的是**生命周期动作的状态式形态**（裸词也认，不要求带引号；实测带引号的写法拦不住
  // 实际代码与文案里的裸词，那等于没生效）。
  //
  // 能力边界（别把这条读成「拦一切拼写错误」）：正则靠词根匹配，`adpoted` 这种**拼错**的词
  // 匹配不到，拦不住。它拦的是「用了一个契约外的、拼写正常的状态词」（如 `rejected`）——
  // 那才是真正会发生的漂移（另一个宿主自己发明了状态名）。
  // 两个收窄是被误报逼出来的：不认 `committed`（内部实现词），排除 CamelCase 里的片段
  // （`markCommitted` 不该因为含 Committed 中枪）。
  const stateLike = /\b(?<![A-Za-z])(adopt\w*|reject\w*|expir\w+|pend\w*|fail\w*)\b/gi;
  for (const rel of files) {
    const source = stripComments(read(rel));
    for (const word of FORBIDDEN_LIFECYCLE_WORDS) {
      if (source.includes(word)) problems.push(`${rel} 用了契约里不存在的状态词「${word}」`);
    }
    for (const match of source.matchAll(stateLike)) {
      const word = match[1].toLowerCase();
      if (states.has(word)) continue;
      // 只认状态式的形态：全小写、以 -ed 收尾（adopted / rejected / expired）。
      // 放过动词与动名词（adopt / adopting），否则每处正常英文都会中枪。
      if (!/^[a-z]+(?:ed|ted)$/.test(word)) continue;
      problems.push(`${rel} 出现状态式词「${word}」，不在共享契约的 ${[...states].join("/")} 里`);
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

check("恒列 skill 的 description 保持能力中立", () => {
  // skill 的 name + description 是**恒列**进提示词的（模型靠它决定要不要读全文），
  // 而 skill 本身没有能力位门控。所以 description 里不能点名那些「没配后端就不注册」的工具——
  // 否则没配音乐后端的实例也会从清单里读到「用 generate_bgm 出曲」，然后去找一个不存在的工具。
  // 正文里点名可以，但必须条件化（先说清楚本剧目配没配）。
  const GATED_TOOLS = ["generate_bgm", "generate_image", "generate_asset", "list_voices", "web_search"];
  const problems = [];
  const skillRoot = join(ROOT, "apps/server/skills");
  for (const name of readdirSync(skillRoot)) {
    const file = join(skillRoot, name, "SKILL.md");
    let source;
    try {
      source = readFileSync(file, "utf8");
    } catch {
      continue;
    }
    const fm = source.match(/^---\n([\s\S]*?)\n---/);
    if (!fm) {
      problems.push(`${name}/SKILL.md 没有 frontmatter`);
      continue;
    }
    const descLine = fm[1].split("\n").find((l) => l.startsWith("description:"));
    if (!descLine) {
      problems.push(`${name}/SKILL.md 的 frontmatter 没有 description`);
      continue;
    }
    for (const tool of GATED_TOOLS) {
      if (descLine.includes(tool)) {
        problems.push(`${name} 的 description 点名了门控工具「${tool}」——它会在没配后端的实例上恒列`);
      }
    }
  }
  return problems;
});

check("技能库只有 apps/server/skills 这一处", () => {
  // 曾有过一份受跟踪的仓库根 `skills/galgame-audio/`：内容与运行期那份不同、
  // 没有任何代码引用它（打包脚本带的是 apps/server/skills）。改那份不生效，
  // 而它看起来完全像"就是这里"——这类「改了不生效的副本」正是守卫该拦的。
  const problems = [];
  const rootSkills = join(ROOT, "skills");
  try {
    const entries = readdirSync(rootSkills);
    if (entries.length > 0) {
      problems.push(`仓库根有 skills/（${entries.join(" / ")}）——它不会被加载，改了不生效；技能库只看 apps/server/skills/`);
    }
  } catch {
    // 不存在即正确
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
