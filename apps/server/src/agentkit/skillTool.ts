import type { AgentTool } from "@earendil-works/pi-agent-core";
import { type Static, Type } from "@earendil-works/pi-ai";
import { readSkill } from "../skills.js";
import { reason, textResult } from "./result.js";

/**
 * 出图技能读取（两个角色共用）。
 *
 * 技能是仓库里的静态文件：system prompt 只列 name/description，模型觉得对上了才读全文。
 * 渐进披露比把画风/构图/表情面板全量塞进 A 区便宜——一整部剧目几十轮都在为用不到的内容付 token。
 */
const readSkillParams = Type.Object({ name: Type.String({ maxLength: 64 }) }, { additionalProperties: false });

export function createReadSkillTool(): AgentTool<typeof readSkillParams> {
  return {
    name: "read_skill",
    label: "读出图技能",
    description:
      "读一份出图技能全文（system prompt 里 <available_skills> 列出的那些）。" +
      "画风怎么定、场景怎么构图、立绘出整套还是单张——对上了就调它。",
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
