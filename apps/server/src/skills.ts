import { BACKGROUND_CONTEXT, formatSkillsForSystemPrompt, loadSkills, type Skill } from "@earendil-works/pi-agent-core";
import { NodeExecutionEnv } from "@earendil-works/pi-agent-core/node";
import { workshopSkillsDirOf } from "./paths.js";

/**
 * 工坊的出图知识以 skill 形式挂给 agent（agentskills.io 约定：`skills/<name>/SKILL.md` + frontmatter）。
 *
 * 为什么是 skill 而不是往 system prompt 里塞长文：
 * - **渐进披露**：system prompt 里只列 name/description/路径，模型觉得对上了才 read_skill 读全文。
 *   一堆画风/构图/表情面板的细节全量塞进去，每一轮对话都在为用不到的内容付 token；
 * - **可维护**：画风锚点这种会迭代的东西，独立成文件，改一行不用重排整个提示词；
 * - **不是我的发明**：pi-agent-core 原生支持这套约定，别自己造 prompt 模板机制。
 *
 * 边界：skills/ 是服务端自己的目录，模型只能经 `read_skill` 读——不放开剧目文件白名单
 * （PlayFiles 只管剧目目录，工坊的文本工具看不到仓库里任何东西）。
 */

const SKILLS_DIR = workshopSkillsDirOf(import.meta.url);

/** 技能是仓库里的静态文件：进程内只加载一次，system prompt 每轮重建也不用重读盘。 */
let cache: Map<string, Skill> | null = null;

async function load(): Promise<Map<string, Skill>> {
  if (cache) return cache;
  const env = new NodeExecutionEnv({ cwd: SKILLS_DIR });
  const { skills, diagnostics } = await loadSkills(env, SKILLS_DIR, BACKGROUND_CONTEXT);
  for (const d of diagnostics) {
    console.warn(`[aivn] 工坊 skill 加载告警 ${d.code}：${d.path} — ${d.message}`);
  }
  cache = new Map(skills.map((s) => [s.name, s]));
  return cache;
}

/** 注入 system prompt 的技能清单块（只有 name/description/路径，模型按需再读全文）。 */
export async function skillsPrompt(): Promise<string> {
  const skills = [...(await load()).values()];
  return skills.length > 0 ? formatSkillsForSystemPrompt(skills) : "";
}

/** 技能全文；名字不在清单里就报错（把「有哪些」摆给模型自己挑）。 */
export async function readSkill(name: string): Promise<{ name: string; content: string }> {
  const skills = await load();
  const skill = skills.get(name.trim());
  if (!skill) {
    throw new Error(`没有名为「${name}」的 skill。可选：${[...skills.keys()].join(" / ") || "（无）"}`);
  }
  return { name: skill.name, content: skill.content };
}
