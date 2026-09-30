/**
 * agent 角色：同一套工具实现，按角色决定「暴露什么、怎么等」。
 *
 * 只有一个刻意的例外：`beat_done`（轮收束 + 停止点载荷）只有剧作家有，工坊不在演出里，
 * 装一个必然不该调用的工具只会诱使模型空转（与「没配 key 就不装 web_search」同一条理由）。
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
