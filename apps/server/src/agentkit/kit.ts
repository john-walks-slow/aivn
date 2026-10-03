import type { AgentTool } from "@earendil-works/pi-agent-core";
import type { ThinkingLevel } from "@stage-ai/core";
import { createBeatDoneTool } from "./beatTool.js";
import { createNsfwTools } from "./nsfwTool.js";
import { AGENT_ROLES, ROLE_INSTALLABLE, type AgentRole } from "./role.js";
import type { AgentKitDeps, PlaywriterKitDeps, WorkshopKitDeps } from "./deps.js";
import { createPiBashTool, createPiFileTools } from "./piTools.js";
import { PlayEnv } from "./playEnv.js";
import { createReadinessTool } from "./readinessTool.js";
import { createGenerateImageTool } from "./imageTool.js";
import { createLibraryTools } from "./libraryTool.js";
import { createLineageTools } from "./lineageTool.js";
import { createMemoryTools } from "./memoryTool.js";
import { createRecutSpriteTool } from "./recutTool.js";
import { createViewImageTool } from "./viewTool.js";
import { createVoiceTool } from "./voiceTool.js";
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
  shell: "命令行",
  library: "素材资源库",
  lineage: "故事树",
  web: "联网检索",
  voice: "音色库",
} as const;

export type ToolGroup = keyof typeof TOOL_GROUPS;

/** 工具目录的一行（`GET /api/agents/tools` 的数据源）。 */
export interface AgentToolEntry {
  id: string;
  label: string;
  group: ToolGroup;
  /** 分组的中文名（设置页的表头）：分组键是英文，界面上不能直接摆出来。 */
  groupLabel: string;
}

/**
 * 工具目录的**唯一真相源**：装不装、设置页列什么，都从这里出。
 *
 * 不再按角色切分——两个角色拿到同一份清单，能不能用只看用户勾没勾。
 * 差异留在两处，都不是「工具归属」：
 * - 装配时的依赖与等待策略（`generate_image` 的 sync / queued）；
 * - 默认勾选哪些（`DEFAULT_ENABLED`）。
 */
const TOOL_CATALOG: Record<string, { label: string; group: ToolGroup }> = {
  beat_done: { label: "结束本轮", group: "beat" },
  enter_nsfw: { label: "进入限制级剧情", group: "beat" },
  exit_nsfw: { label: "退出限制级剧情", group: "beat" },
  update_state: { label: "提议状态更新", group: "memory" },
  create_character: { label: "建角色卡", group: "memory" },
  read_memory_detail: { label: "读记忆卡详情", group: "memory" },
  search_archive: { label: "检索历史往事", group: "memory" },
  generate_image: { label: "生成剧目素材", group: "image" },
  recut_sprite: { label: "重抠立绘底", group: "image" },
  read_skill: { label: "读技能库", group: "skill" },
  list_voices: { label: "查音色库", group: "voice" },
  web_search: { label: "联网检索", group: "web" },
  // read / write / edit / bash 是 pi 的内建工具，不走 filesTool——路径白名单在 PlayEnv 里收口。
  read: { label: "读文件", group: "files" },
  write: { label: "写文件", group: "files" },
  edit: { label: "编辑文件", group: "files" },
  bash: { label: "命令行", group: "shell" },
  get_readiness: { label: "检查开演条件", group: "files" },
  view_image: { label: "看图", group: "files" },
  list_library: { label: "浏览素材资源库", group: "library" },
  import_asset: { label: "从资源库导入", group: "library" },
  list_saves: { label: "列出周目", group: "lineage" },
  read_lineage: { label: "读故事树", group: "lineage" },
};

/**
 * 各角色的默认启用集。play.json 的 `agents.<role>.tools` 给了就按它来。
 *
 * 剧作家默认开着生图与资源库查询：素材来路是**创作决策**（哪些自己画、哪些从库里找），
 * 由搭台助手与用户对齐后写进剧目的 craft.md（见 workshop.ts 的「素材来源」那条）。
 * 工具不给它，这条策略就是空话——它会照着策略说「背景该去库里找」，却连库有什么都看不见。
 * 不想让它烧配额，在 Agent 页把这两个关掉即可，策略随之失效。
 */
const DEFAULT_ENABLED: Record<AgentRole, string[]> = {
  playwriter: [
    "beat_done",
    "enter_nsfw",
    "exit_nsfw",
    "update_state",
    "create_character",
    "read_memory_detail",
    "search_archive",
    "generate_image",
    // 只读浏览：宿主的引用即导入只认同名 id，不知道库里有什么就等于瞎猜。
    // import_asset 不开——导入走 DSL 引用，模型自己动手抄一遍 id 没有额外收益。
    "list_library",
    "web_search",
  ],
  // 搭台的缺省是**全开，除了 bash**：命令行以服务进程的权限跑（这台机器上就是 root），
  // 不是随手该开的东西，按剧目在 Agent 页手动勾。其余工具开着一个也不会烧钱。
  workshop: ROLE_INSTALLABLE.workshop.filter((id) => id !== "bash"),
};


/** 工具目录，按分组排序。不给 role 是全集；给了就只出这个角色真装得上的。 */
export function agentToolCatalog(role?: AgentRole): AgentToolEntry[] {
  const installable = role ? new Set(ROLE_INSTALLABLE[role]) : null;
  const catalog = installable
    ? Object.fromEntries(Object.entries(TOOL_CATALOG).filter(([id]) => installable.has(id)))
    : TOOL_CATALOG;
  return Object.entries(catalog)
    .map(([id, meta]) => ({
      id,
      label: meta.label,
      group: meta.group,
      groupLabel: TOOL_GROUPS[meta.group],
    }))
    .sort((a, b) => a.group.localeCompare(b.group) || a.id.localeCompare(b.id));
}


/** 某个角色的默认启用集（设置页据此渲染开关的初始态，不依赖运行时配置）。 */
export function defaultToolsFor(role: AgentRole): ReadonlySet<string> {
  return new Set(DEFAULT_ENABLED[role]);
}

/** 用户配置解析后的最终启用集：play.json 给了就按它，没给走默认。 */
export function enabledToolsFor(role: AgentRole, configured?: readonly string[]): ReadonlySet<string> {
  return new Set(configured ?? DEFAULT_ENABLED[role]);
}

/** 能力位：提示词按它决定注不注某一章（装一个必然失败的能力只会教模型反复空转）。 */
export interface AgentCapabilities {
  /** 生图可用。 */
  image: boolean;
  /** 联网检索可用（配了 Exa key）。 */
  search: boolean;
  /** 素材资源库可用（配置了库目录）。 */
  library: boolean;
  /** 音色库可用（配了 TTS key）。没配时 list_voices 不注册，提示词也不提。 */
  voice: boolean;
  /** 命令行可用。默认关，用户在 Agent 页勾上才有；没勾时提示词不提工作区。 */
  shell: boolean;
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
  const enabled = tools.filter((tool) => deps.enabled.has(tool.name));
  const has = (name: string): boolean => enabled.some((tool) => tool.name === name);
  return {
    role: deps.role,
    tools: enabled,
    can: {
      image: has("generate_image"),
      search: has("web_search"),
      library: has("list_library"),
      voice: has("list_voices"),
      shell: has("bash"),
    },
    catalog: enabled.map((tool) => {
      const meta = TOOL_CATALOG[tool.name]!;
      return {
        id: tool.name,
        label: meta.label,
        group: meta.group,
        groupLabel: TOOL_GROUPS[meta.group],
      };
    }),
    thinking: deps.thinking ?? "off",
  };
}

/**
 * 剧作家的工具：轮收束 + 记忆 + 生图（后台排产）+ 资源库检索 + 联网。
 *
 * 少了 files 与 lineage：它们要 `PlayFiles` / `PlaySaves`，那是工坊那条线的依赖面。
 * 清单是统一的，装不上的那部分不装——不是被切出去，是这条路上没有。
 */
function playwriterTools(deps: PlaywriterKitDeps): AgentTool<any>[] {
  return [
    createBeatDoneTool(deps),
    ...createNsfwTools(deps),
    ...createMemoryTools(deps),
    createGenerateImageTool({
      mode: "queued",
      playAssets: deps.playAssets,
      emitPreload: deps.emitPreload,
      kick: deps.kick,
      kickSprite: deps.kickSprite,
      existingAssetUrl: deps.existingAssetUrl,
    }),
    // 剧作家这边没有对话流可挂，onWrite/onAsset 就不给：工具照常能用，只是没有撤销条
    ...createLibraryTools({ playId: deps.playId, store: deps.store, library: deps.assetLibrary }),
    ...(deps.exa ? [createWebSearchTool(deps.exa)] : []),
  ];
}

/**
 * 工坊的工具：pi 的文件与命令行工具 + 生图（同步）+ 素材库检索 + 故事树 + 技能库 + 联网。
 *
 * read / write / edit / bash 全部来自 pi，我们只提供 `PlayEnv` 这一个 `ExecutionEnv`：
 * 白名单、play.json 校验与撤销条都在它里面（见 `playEnv.ts`）。
 */
function workshopTools(deps: WorkshopKitDeps): AgentTool<any>[] {
  const env = new PlayEnv(deps.files, deps.onWrite);
  return [
    ...createPiFileTools(env),
    createPiBashTool(env),
    createReadinessTool(deps),
    // 看图始终装（本地素材不依赖网络）；网址分支没有下载器时工具自己回「未启用」
    createViewImageTool({
      pathOf: (path) => deps.files.pathOf(path, "read"),
      cacheDir: () => deps.store.webImageDir(),
      fetchImage: deps.webImage,
    }),
    createGenerateImageTool({
      mode: "sync",
      playAssets: deps.playAssets,
      onAsset: (path, url, kind, replaced) => deps.onAsset({ kind, path, url }, replaced),
    }),
    createRecutSpriteTool({
      playAssets: deps.playAssets,
      onAsset: (path, url, kind, replaced) => deps.onAsset({ kind, path, url }, replaced),
    }),
    createReadSkillTool(),
    ...createLineageTools(deps),
    // 没配 TTS 就不注册：查不出来的工具只会诱使模型空转
    ...createVoiceTool(deps.voices),
    ...createLibraryTools({
      playId: deps.playId,
      store: deps.store,
      library: deps.assetLibrary,
      onWrite: deps.onWrite,
      onAsset: deps.onAsset,
    }),
    ...(deps.exa ? [createWebSearchTool(deps.exa)] : []),
  ];
}

/** 角色全集（设置页渲染两张卡用）。 */
export const ROLES = AGENT_ROLES;
