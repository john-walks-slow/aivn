/**
 * agent 角色：谁是角色、叫什么名字。
 *
 * 工具实现不按角色切分（同一份 schema 与代码），但**装配按角色切**——每个角色只有
 * 一条路上的依赖面（剧作家要 PlaySaves 拿不到、工坊要 emitStop 用不上）。一个角色装不装得上
 * 某个工具，写在 `kit.ts` 的 `TOOL_CATALOG` 里（角色可见性是工具自身的属性，与它的
 * label/group 同一行）；这里不再另列一份 id 清单。
 */

export const AGENT_ROLES = ["playwriter", "workshop"] as const;
export type AgentRole = (typeof AGENT_ROLES)[number];

/** 角色元数据：UI 文案与设置页的两张卡都从这里取。 */
export const ROLE_META: Record<AgentRole, { label: string; blurb: string }> = {
  playwriter: {
    label: "剧作家",
    blurb: "实时写剧本。每一轮都要交出停止点（选项/自由输入），决定这一轮怎么收。",
  },
  workshop: {
    label: "搭台助手",
    blurb: "搭剧目：写设定、角色卡、记忆卡，出素材，读故事树。不参与演出。",
  },
};

export function isAgentRole(value: string): value is AgentRole {
  return (AGENT_ROLES as readonly string[]).includes(value);
}
