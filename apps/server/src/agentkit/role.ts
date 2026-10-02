/**
 * agent 角色：同一套工具实现，按角色决定「暴露什么、怎么等」。
 *
 * 工具实现不按角色切分（同一份 schema 与代码），但**装配按角色切**——每个角色只有
 * 一条路上的依赖面（剧作家要 PlaySaves 拿不到、工坊要 emitStop 用不上）。装不上的工具
 * 不进这个角色的目录，否则设置页会挂一个勾了也没用的开关。
 *
 * 换依赖面时改这里和 `kit.ts` 的 role 工厂两处，`agentkit.test.ts` 里有一条用例
 * 拿工厂的真实产物比这份表，漏改会红。
 */

export const AGENT_ROLES = ["playwriter", "workshop"] as const;
export type AgentRole = (typeof AGENT_ROLES)[number];

/** 每个角色装得上的工具（未列出＝装不上）。`web_search` 与资源库两个工具按配置再收。 */
export const ROLE_INSTALLABLE: Record<AgentRole, readonly string[]> = {
  playwriter: [
    "beat_done",
    "update_state",
    "write_memory",
    "read_memory_detail",
    "search_archive",
    "generate_image",
    "list_library",
    "import_asset",
    "web_search",
  ],
  workshop: [
    "list_files",
    "read_file",
    "edit_file",
    "write_file",
    "delete_file",
    "get_readiness",
    "inspect_asset",
    "generate_image",
    "read_skill",
    "list_saves",
    "read_lineage",
    "list_library",
    "import_asset",
    "web_search",
    "list_voices",
  ],
};

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
