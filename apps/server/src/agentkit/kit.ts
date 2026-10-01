import type { AgentTool } from "@earendil-works/pi-agent-core";
import type { ThinkingLevel } from "@stage-ai/core";
import { createBeatDoneTool } from "./beatTool.js";
import type { AgentKitDeps, PlaywriterKitDeps, WorkshopKitDeps } from "./deps.js";
import { createFilesTools } from "./filesTool.js";
import { createGenerateImageTool } from "./imageTool.js";
import { createLibraryTools } from "./libraryTool.js";
import { createLineageTools } from "./lineageTool.js";
import { createMemoryTools } from "./memoryTool.js";
import { AGENT_ROLES, type AgentRole } from "./role.js";
import { createWebSearchTool } from "./searchTool.js";
import { createReadSkillTool } from "./skillTool.js";

/**
 * 统一 agent 基座的装配入口：`createAgentKit(deps)` 一个函数出两套 agent。
 *
 * 「仅仅暴露内容不同」落在这里：**工具实现与 schema 同一份**，分叉的只有
 * - 装不装（角色没有的能力不装，装一个必然失败/不该调的工具只会诱使模型空转）；
 * - 同一工具传不同的依赖（`generate_image` 的 sync/queued 两种等待策略）；
 * - 提示词按 `can` 决定注不注某一章。
 *
 * 工具开关（play.json 的 agents.disabledTools）在最后一道统一过滤：
 * 装出来再摘掉，模型这一轮就彻底看不见它，提示词里对应的章节也由宿主按 `can` 收掉。
 */

/** 工具分组（设置页按组渲染开关）。 */
export const TOOL_GROUPS = {
  beat: "轮与停止点",
  memory: "记忆与状态",
  image: "生图",
  skill: "技能库",
  files: "剧目文件",
  library: "素材资源库",
  lineage: "故事树",
  web: "联网检索",
} as const;

export type ToolGroup = keyof typeof TOOL_GROUPS;

/** 工具目录的一行（`GET /api/agents/tools` 的数据源）。 */
export interface AgentToolEntry {
  id: string;
  label: string;
  group: ToolGroup;
  /** 分组的中文名（设置页的表头）：分组键是英文，界面上不能直接摆出来。 */
  groupLabel: string;
  roles: AgentRole[];
}

/** 每个工具属于哪些角色：装配与设置页共用的唯一真相源。 */
const TOOL_ROLES: Record<string, { label: string; group: ToolGroup; roles: AgentRole[] }> = {
  beat_done: { label: "结束本轮", group: "beat", roles: ["playwriter"] },
  update_state: { label: "提议状态更新", group: "memory", roles: ["playwriter"] },
  write_memory: { label: "写记忆文件", group: "memory", roles: ["playwriter"] },
  read_memory_detail: { label: "读记忆卡详情", group: "memory", roles: ["playwriter"] },
  search_archive: { label: "检索历史往事", group: "memory", roles: ["playwriter"] },
  generate_image: { label: "生成剧目素材", group: "image", roles: ["playwriter", "workshop"] },
  read_skill: { label: "读技能库", group: "skill", roles: ["workshop"] },
  web_search: { label: "联网检索", group: "web", roles: ["playwriter", "workshop"] },
  list_files: { label: "列出剧目文件", group: "files", roles: ["workshop"] },
  read_file: { label: "读剧目文件", group: "files", roles: ["workshop"] },
  edit_file: { label: "编辑剧目文件", group: "files", roles: ["workshop"] },
  write_file: { label: "写剧目文件", group: "files", roles: ["workshop"] },
  delete_file: { label: "删除剧目文件", group: "files", roles: ["workshop"] },
  get_readiness: { label: "检查开演条件", group: "files", roles: ["workshop"] },
  inspect_asset: { label: "看剧目图片", group: "files", roles: ["workshop"] },
  list_library: { label: "浏览素材资源库", group: "library", roles: ["workshop"] },
  import_asset: { label: "从资源库导入素材", group: "library", roles: ["workshop"] },
  list_saves: { label: "列出周目", group: "lineage", roles: ["workshop"] },
  read_lineage: { label: "读故事树", group: "lineage", roles: ["workshop"] },
};

/** 全部工具目录（两个角色合起来），按分组排序——设置页直接渲染它。 */
export function agentToolCatalog(): AgentToolEntry[] {
  return Object.entries(TOOL_ROLES)
    .map(([id, meta]) => ({
      id,
      label: meta.label,
      group: meta.group,
      groupLabel: TOOL_GROUPS[meta.group],
      roles: meta.roles,
    }))
    .sort((a, b) => a.group.localeCompare(b.group) || a.id.localeCompare(b.id));
}

/** 某个角色能有的工具目录（不依赖运行时配置，设置页据此渲染开关）。 */
export function catalogFor(role: AgentRole): AgentToolEntry[] {
  return agentToolCatalog().filter((entry) => entry.roles.includes(role));
}

/** 能力位：提示词按它决定注不注某一章（装一个必然失败的能力只会教模型反复空转）。 */
export interface AgentCapabilities {
  /** 生图可用。 */
  image: boolean;
  /** 联网检索可用（配了 Exa key）。 */
  search: boolean;
  /** 素材资源库可用（配置了库目录）。 */
  library: boolean;
}

export interface AgentKit {
  role: AgentRole;
  /** 装好的工具（已按 disabledTools 过滤）。 */
  tools: AgentTool<any>[];
  can: AgentCapabilities;
  /** 本次实际装上的工具目录。 */
  catalog: AgentToolEntry[];
  /** 思考档位（宿主解析后透出，提示词与 UI 用）。 */
  thinking: ThinkingLevel;
}

export function createAgentKit(deps: AgentKitDeps & { thinking?: ThinkingLevel }): AgentKit {
  const tools = deps.role === "playwriter" ? playwriterTools(deps) : workshopTools(deps);
  const enabled = tools.filter((tool) => !deps.disabled.has(tool.name));
  const has = (name: string): boolean => enabled.some((tool) => tool.name === name);
  return {
    role: deps.role,
    tools: enabled,
    can: {
      image: has("generate_image"),
      search: has("web_search"),
      library: has("list_library"),
    },
    catalog: enabled.map((tool) => {
      const meta = TOOL_ROLES[tool.name]!;
      return {
        id: tool.name,
        label: meta.label,
        group: meta.group,
        groupLabel: TOOL_GROUPS[meta.group],
        roles: meta.roles,
      };
    }),
    thinking: deps.thinking ?? "off",
  };
}

/** 剧作家的工具：轮收束 + 记忆 + 生图（后台排产）+ 联网。 */
function playwriterTools(deps: PlaywriterKitDeps): AgentTool<any>[] {
  return [
    createBeatDoneTool(deps),
    ...createMemoryTools(deps),
    createGenerateImageTool({
      mode: "queued",
      playAssets: deps.playAssets,
      emitPreload: deps.emitPreload,
      kick: deps.kick,
      kickSprite: deps.kickSprite,
      statusOf: deps.statusOf,
      hasStaticAsset: deps.hasStaticAsset,
    }),
    ...(deps.exa ? [createWebSearchTool(deps.exa)] : []),
  ];
}

/** 工坊的工具：剧目文件 + 生图（同步）+ 素材库 + 故事树 + 技能库 + 联网。 */
function workshopTools(deps: WorkshopKitDeps): AgentTool<any>[] {
  return [
    ...createFilesTools(deps),
    createGenerateImageTool({
      mode: "sync",
      playAssets: deps.playAssets,
      onAsset: (path, url, kind, replaced) => deps.onAsset({ kind, path, url }, replaced),
    }),
    createReadSkillTool(),
    ...createLineageTools(deps),
    ...createLibraryTools(deps),
    ...(deps.exa ? [createWebSearchTool(deps.exa)] : []),
  ];
}

/** 角色全集（设置页渲染两张卡用）。 */
export const ROLES = AGENT_ROLES;
