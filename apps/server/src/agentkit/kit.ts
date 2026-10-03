import type { AgentTool } from "@earendil-works/pi-agent-core";
import type { ThinkingLevel } from "@stage-ai/core";
import { createBeatDoneTool } from "./beatTool.js";
import { createNsfwTools } from "./nsfwTool.js";
import { AGENT_ROLES, type AgentRole } from "./role.js";
import type { AgentKitDeps, PlaywriterKitDeps, WorkshopKitDeps } from "./deps.js";
import { createPiBashTool, createPiFileTools } from "./piTools.js";
import { PlayEnv } from "./playEnv.js";
import { createReadinessTool } from "./readinessTool.js";
import { createSetCraftTool } from "./craftTool.js";
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
 * 谁装得上写在下面 `TOOL_CATALOG` 的 `roles` 里；用户开关（play.json 的
 * `agents.<role>.tools`，存的是启用集）在最后一道统一过滤：
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

/** 工具目录的一项：这个工具是什么（label/group）+ 谁装得上（roles）。 */
interface ToolCatalogEntry {
  label: string;
  group: ToolGroup;
  /** 装得上的角色（至少一个；实现是同一份，这里说的是这条依赖面上装不装得上）。 */
  roles: readonly [AgentRole, ...AgentRole[]];
}

/**
 * 工具目录的**唯一真相源**：工具 id、设置页列什么、哪个角色装得上，都从这里出。
 *
 * 不再按角色切分——两个角色拿到同一份清单，能不能用只看用户勾没勾。
 * 角色可见性作为工具自身的属性写在这一行里：早先另有 `role.ts` 的 `ROLE_INSTALLABLE`
 * 把每个角色装得上的 id 又列一遍，加一个工具要改两处、漏了只能等测试红灯。
 * 剩下的差异只有装配时的依赖与等待策略（`generate_image` 的 sync / queued）与默认勾选哪些。
 */
const TOOL_CATALOG: Record<string, ToolCatalogEntry> = {
  beat_done: { label: "结束本轮", group: "beat", roles: ["playwriter"] },
  enter_nsfw: { label: "进入限制级剧情", group: "beat", roles: ["playwriter"] },
  exit_nsfw: { label: "退出限制级剧情", group: "beat", roles: ["playwriter"] },
  update_state: { label: "提议状态更新", group: "memory", roles: ["playwriter"] },
  create_character: { label: "建角色卡", group: "memory", roles: ["playwriter"] },
  read_memory_detail: { label: "读记忆卡详情", group: "memory", roles: ["playwriter"] },
  search_archive: { label: "检索历史往事", group: "memory", roles: ["playwriter"] },
  generate_image: { label: "生成剧目素材", group: "image", roles: ["playwriter", "workshop"] },
  recut_sprite: { label: "重抠立绘底", group: "image", roles: ["workshop"] },
  read_skill: { label: "读技能库", group: "skill", roles: ["workshop"] },
  set_craft: { label: "设置写作参数", group: "files", roles: ["workshop"] },
  list_voices: { label: "查音色库", group: "voice", roles: ["workshop"] },
  web_search: { label: "联网检索", group: "web", roles: ["playwriter", "workshop"] },
  // read / write / edit / bash 是 pi 的内建工具，不走 filesTool——路径白名单在 PlayEnv 里收口。
  read: { label: "读文件", group: "files", roles: ["workshop"] },
  write: { label: "写文件", group: "files", roles: ["workshop"] },
  edit: { label: "编辑文件", group: "files", roles: ["workshop"] },
  bash: { label: "命令行", group: "shell", roles: ["workshop"] },
  get_readiness: { label: "检查开演条件", group: "files", roles: ["workshop"] },
  view_image: { label: "看图", group: "files", roles: ["workshop"] },
  list_library: { label: "浏览素材资源库", group: "library", roles: ["playwriter", "workshop"] },
  import_asset: { label: "从资源库导入", group: "library", roles: ["playwriter", "workshop"] },
  list_saves: { label: "列出周目", group: "lineage", roles: ["workshop"] },
  read_lineage: { label: "读故事树", group: "lineage", roles: ["workshop"] },
};

/**
 * 某个角色装得上的工具 id（依赖面允许的那些；`web_search` / 资源库 / 音色还要按配置再收）。
 * 排一次序：默认启用集的顺序不该跟着目录里的行序走（前端拿它只当开关的初始态，但顺序是白送的确定性）。
 */
function installableTools(role: AgentRole): string[] {
  return Object.entries(TOOL_CATALOG)
    .filter(([, meta]) => meta.roles.includes(role))
    .map(([id]) => id)
    .sort();
}

/**
 * 各角色的默认启用集。play.json 的 `agents.<role>.tools` 给了就按它来。
 *
 * 剧作家默认开着生图与资源库查询：素材来路是**创作决策**（哪些自己画、哪些从库里找），
 * 由搭台助手与用户对齐后写进 play.json 的 `craft.assets`（工坊的 `set_craft` 工具）。
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
  workshop: installableTools("workshop").filter((id) => id !== "bash"),
};

/**
 * 目录项 → 设置页/装配用的那一行。工具名不在目录里直接报错：目录是唯一真相源，
 * 装配出一个没登记的工具意味着这一行永远是 `undefined`——那不该悄悄过去。
 */
export function agentToolEntry(id: string): AgentToolEntry {
  const meta = TOOL_CATALOG[id];
  if (!meta) {
    throw new Error(`工具 ${id} 不在工具目录里（kit.ts 的 TOOL_CATALOG）：新增工具必须在那里登记角色。`);
  }
  return { id, label: meta.label, group: meta.group, groupLabel: TOOL_GROUPS[meta.group] };
}

/** 工具目录，按分组排序。不给 role 是全集；给了就只出这个角色真装得上的。 */
export function agentToolCatalog(role?: AgentRole): AgentToolEntry[] {
  const ids = role ? installableTools(role) : Object.keys(TOOL_CATALOG);
  return ids
    .map((id) => agentToolEntry(id))
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

/**
 * 能力位与授权它的工具：**一位一个工具**，模型调得动才有这一位。
 *
 * 表在这里而不散在各处：加一位只改这一行，`AgentCapabilities` 跟着长一位——
 * 两个角色的 system prompt 读的是同一个 `kit.can`，不存在「只改一边」的余地。
 */
export const CAPABILITY_TOOLS = {
  /** 生图可用。 */
  image: "generate_image",
  /** 联网检索可用（配了 Exa key）。 */
  search: "web_search",
  /** 素材资源库可用（配置了库目录）。 */
  library: "list_library",
  /** 音色库可用（配了 TTS key）。没配时 list_voices 不注册，提示词也不提。 */
  voice: "list_voices",
  /** 命令行可用。默认关，用户在 Agent 页勾上才有；没勾时提示词不提工作区。 */
  shell: "bash",
  /**
   * 限制级（NSFW）通道可用：这一位由 `enter_nsfw` 授权（进得去才有得聊），`exit_nsfw`
   * 与它默认同开同关。工具摘掉之后还教模型去调它，它只会反复空转——用户把这两项
   * 一起取消勾选，就是本剧目不要限制级通道。
   */
  nsfw: "enter_nsfw",
} as const;

export type CapabilityKey = keyof typeof CAPABILITY_TOOLS;

/** 当前真正可用的能力（`kit.can`）：提示词按它决定注不注某一章，装一个必然失败的能力只会教模型反复空转。 */
export type AgentCapabilities = Record<CapabilityKey, boolean>;

/** 从实际装上的工具算能力位——判定只有这一份，装配与两个角色的提示词不会各算各的。 */
export function capabilitiesOf(tools: readonly { name: string }[]): AgentCapabilities {
  const installed = new Set(tools.map((tool) => tool.name));
  return Object.fromEntries(
    Object.entries(CAPABILITY_TOOLS).map(([key, tool]) => [key, installed.has(tool)]),
  ) as AgentCapabilities;
}

export interface AgentKit {
  role: AgentRole;
  /** 装好的工具（已按用户启用集过滤）。 */
  tools: AgentTool<any>[];
  can: AgentCapabilities;
  /** 本次实际装上的工具目录。 */
  catalog: AgentToolEntry[];
  /** 思考档位（宿主解析后透出，提示词与 UI 用）。 */
  thinking: ThinkingLevel;
}

/**
 * 这个角色在给定依赖面上真装得出来的工具（**还没有过用户开关那道过滤**）。
 *
 * 目录里 `roles` 标注的就是它——`agentkit.test.ts` 拿这里的原样产物比目录，不是比过滤后的结果：
 * 比过滤后的就等于拿启用集和自己比，工厂多装一个没登记的工具照样能过。
 */
export function roleTools(deps: AgentKitDeps): AgentTool<any>[] {
  return deps.role === "playwriter" ? playwriterTools(deps) : workshopTools(deps);
}

export function createAgentKit(deps: AgentKitDeps & { thinking?: ThinkingLevel }): AgentKit {
  const tools = roleTools(deps);
  const enabled = tools.filter((tool) => deps.enabled.has(tool.name));
  return {
    role: deps.role,
    tools: enabled,
    can: capabilitiesOf(enabled),
    catalog: enabled.map((tool) => agentToolEntry(tool.name)),
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
    createSetCraftTool(deps),
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
