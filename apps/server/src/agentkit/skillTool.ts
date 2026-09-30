import type { AgentTool } from "@earendil-works/pi-agent-core";
import { type Static, Type } from "@earendil-works/pi-ai";
import { readSkill } from "../skills.js";
import { reason, textResult } from "./result.js";

/**
 * 技能库读取（只给搭台助手）。
 *
 * 技能是**跨剧目的通用做法速查**（agentskills.io 约定：`skills/<name>/SKILL.md` + frontmatter），
 * 比如「免费 BGM/SFX 素材源在哪、能不能商用」——这类答案与具体剧目无关，查一次对所有剧目都成立。
 * system prompt 只列 name/description，模型觉得对上了才读全文：渐进披露比把长文全量塞进 A 区便宜。
 *
 * 为什么不也给剧作家：本剧的画风、构图偏好、提示词口径都属于**这个剧目的记忆**（`memory/always/craft.md`
 * 与设定卡），每轮本来就注入。放进技能库要人去猜该读哪一份，而记忆是它本来就看得见的。
 */
const readSkillParams = Type.Object({ name: Type.String({ maxLength: 64 }) }, { additionalProperties: false });

export function createReadSkillTool(): AgentTool<typeof readSkillParams> {
  return {
    name: "read_skill",
    label: "读技能库",
    description:
      "读一份技能库全文（system prompt 里 <available_skills> 列出的那些）。" +
      "技能是跨剧目通用的做法速查：去哪里找可用素材、授权能不能商用、这类活儿的标准流程是什么。" +
      "这部剧自己的画风与创作口径在 memory 里，不要来这里找。",
    parameters: readSkillParams,
    execute: async (_toolCallId, params: Static<typeof readSkillParams>) => {
      try {
        const skill = await readSkill(params.name);
        return textResult(skill.content);
      } catch (error) {
        return textResult(`读取失败：${reason(error)}`);
      }
    },
  };
}
