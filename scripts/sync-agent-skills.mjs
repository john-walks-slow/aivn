#!/usr/bin/env node
/**
 * 共享技能正文的生成与守卫。
 *
 * 技能是 markdown 文件，两个宿主各自从自己的目录读（服务端 `apps/server/skills/`、
 * 插件 `<repo>/skills/`），所以「一份正文」只能靠**生成**来维持：
 *
 *   packages/agent/skills/<id>.md          正文（可含 {{VAR}} 占位）
 *   packages/agent/skills/<id>.hosts.json  各宿主的 frontmatter 与占位取值
 *        ↓
 *   每个宿主目录下的 SKILL.md
 *
 * 用法：
 *   node scripts/sync-agent-skills.mjs [--check] [--plugin-dir <插件仓路径>]
 *
 * `--check` 不写盘，只比对各宿主文件与生成结果是否一致（守卫用；不一致就非零退出）。
 * 插件仓不在场（`--plugin-dir` 指过去不存在）时**如实报错**，不静默跳过。
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const skillsDir = join(root, "packages", "agent", "skills");

/** 渲染一份宿主技能文件：frontmatter（宿主自己的 name/description）+ 正文（占位替换）。 */
export function renderSkill(id, hostKey, pluginDir) {
  const body = readFileSync(join(skillsDir, `${id}.md`), "utf8");
  const spec = JSON.parse(readFileSync(join(skillsDir, `${id}.hosts.json`), "utf8"));
  const host = spec.hosts[hostKey];
  if (!host) throw new Error(`技能 ${id} 没有宿主 ${hostKey} 的声明`);

  let rendered = body;
  for (const [name, value] of Object.entries(host.vars ?? {})) {
    const token = `{{${name}}}`;
    if (!rendered.includes(token)) throw new Error(`技能 ${id} 的正文里没有占位 ${token}`);
    rendered = rendered.split(token).join(value);
  }
  const leftover = rendered.match(/\{\{[A-Z_]+\}\}/);
  if (leftover) throw new Error(`技能 ${id} 有没被替换的占位 ${leftover[0]}`);

  const fm = [`name: ${host.frontmatter.name}`, `description: ${spec.description}`];
  for (const [key, value] of Object.entries(host.frontmatter)) {
    if (key === "name") continue;
    fm.push(`${key}: ${value}`);
  }
  return { file: join(hostKey === "plugin" ? pluginDir : root, host.file), text: `---\n${fm.join("\n")}\n---\n\n${rendered}` };
}

function main(argv) {
  const check = argv.includes("--check");
  const at = argv.indexOf("--plugin-dir");
  const pluginDir = resolve(at >= 0 ? argv[at + 1] : process.env.DSH_AIVN_DIR ?? join(root, "..", "dsh-aivn-shared"));
  if (!existsSync(pluginDir)) throw new Error(`插件仓不在场：${pluginDir}（用 --plugin-dir 或 DSH_AIVN_DIR 指过去）`);

  const problems = [];
  for (const id of ["aivn-audio"]) {
    for (const hostKey of ["server", "plugin"]) {
      const { file, text } = renderSkill(id, hostKey, pluginDir);
      if (check) {
        const onDisk = existsSync(file) ? readFileSync(file, "utf8") : null;
        if (onDisk !== text) problems.push(`${file} 与 packages/agent/skills/${id}.md 不一致（跑一次 sync-agent-skills.mjs）`);
        continue;
      }
      writeFileSync(file, text);
      console.log(`写入 ${file}`);
    }
  }
  if (problems.length > 0) {
    console.error(problems.join("\n"));
    process.exit(1);
  }
  console.log(check ? "共享技能正文与两份副本一致。" : "共享技能正文已同步。");
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main(process.argv.slice(2));
