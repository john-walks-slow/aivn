import type { AgentTool } from "@earendil-works/pi-agent-core";
import type { ThinkingLevel } from "@aivn/core";
import type { WriteScope } from "../playFiles.js";
import { createNsfwTools } from "./nsfwTool.js";
import { AGENT_ROLES, type AgentRole } from "./role.js";
import type { AgentKitDeps, PlaywriterKitDeps, WorkshopKitDeps } from "./deps.js";
import { createPiBashTool, createPiFileTools } from "./piTools.js";
import { PlayEnv } from "./playEnv.js";
import { createValidatePlayTool } from "./validatePlayTool.js";
import { createGenerateImageTool } from "./imageTool.js";
import { createAnnotateTool } from "./annotateTool.js";
import { createGenerateAssetTool } from "./assetTool.js";
import { createLibraryTools } from "./libraryTool.js";
import { createGenerateMusicTool } from "./musicTool.js";
import { createArchiveTool } from "./archiveTool.js";
import { createImportAssetTool } from "./registerTool.js";
import { createCutTool } from "./cutTool.js";
import { createVoiceTool } from "./voiceTool.js";
import { createWebSearchTool } from "./searchTool.js";
import { createReadSkillTool } from "./skillTool.js";
import { assertToolContracts, attachToolContract, type AgentToolWithContract } from "./contract.js";

/**
 * 统一 agent 基座的装配入口：`createAgentKit(deps)` 一个函数出两套 agent。
 *
 * 用户语汇是**能力**（capability），不是工具：`CAPABILITY_CATALOG` 是唯一真相源，
 * 一行写清「这个名字、这个后果、开出来授权哪些工具、给哪个角色、给哪几个文件面」。
 * play.json 的 `agents.<role>.capabilities` 存的是启用集（白名单），缺省 = 该角色默认集。
 *
 * 两条推导，装配与设置页共用：
 * - **装上的工具 = 基座工具 ∪ 开着的能力授权的工具**（∩ 依赖面真装得出来的那些）；
 * - **`can` 位 = 这个能力开着，且它授权的工具都装上了**——能力声明了一个装不出来的工具
 *   （没配 Exa、没配 TTS），这一位就是假，提示词不会教模型去调它没有的东西。
 *
 * 工具目录（`TOOL_CATALOG`）留着当**工具层的真相源**：谁在哪个角色上装得上写在这里，
 * 能力只引用工具 id，不再各自维护一份角色清单。
 */

/** 能力分组（Agent 页按组渲染）。分组顺序即界面顺序。 */
export const CAPABILITY_GROUPS = {
  show: "演出",
  cast: "角色",
  writing: "写作",
  assets: "素材",
  research: "查资料",
  stagecraft: "搭台辅助",
  advanced: "进阶",
} as const;

export type CapabilityGroup = keyof typeof CAPABILITY_GROUPS;

/** 服务端配置面：能力依赖的这些服务端东西没配好时，开关勾了也暂不生效。 */
export interface CapabilityEnv {
  /** 联网检索（Exa / 内置搜索）。 */
  search: boolean;
  /** TTS 音色库。 */
  voice: boolean;
  /** 生图后端。 */
  image: boolean;
  /** 音乐生成后端。 */
  music: boolean;
}

interface CapabilityEntry {
  id: string;
  label: string;
  /** 一句后果（界面副标题）。不写工具名——用户语汇里没有工具。 */
  desc: string;
  group: CapabilityGroup;
  /** 给哪些角色。工具授权还会按 `TOOL_CATALOG` 的角色再收一道。 */
  roles: readonly [AgentRole, ...AgentRole[]];
  /** 授权哪些工具（`TOOL_CATALOG` 的 id）。 */
  tools: readonly string[];
  /** 这个能力开出来，agent 的手能改哪几类文件。 */
  writeScopes?: readonly WriteScope[];
  /** 默认关（用户要自己去勾）。 */
  defaultOff?: boolean;
  /** 依赖的服务端配置项；缺了这一项界面会补 `unavailableNote`。 */
  needs?: keyof CapabilityEnv;
  unavailableNote?: string;
}

/**
 * 能力目录的**唯一真相源**。
 *
 * 拆分的尺度是「两件事是不是一回事」：写作参数就写在 play.json 里，所以跟着「改剧目文件」；
 * 而「读技能库」「看图」「检查开演条件」互不相干，各占一行——合成一个开关只是把三种诉求
 * 混在一起，用户想关掉其中一个就得连另外两个一起关。
 */
const CATALOG_ROWS = [
  {
    id: "nsfw",
    label: "限制级通道",
    desc: "自己开启 / 关闭限制级剧情：开启后改用你指定的限制级模型，并注入你在 Agent 页写的那组上下文。",
    group: "show",
    roles: ["playwriter"],
    tools: ["enter_nsfw", "exit_nsfw"],
  },
  {
    id: "characters",
    label: "管理角色",
    desc: "自己写、改角色卡（人设、立绘取景）；关着时新角色走临时角色通道，完整卡去工坊补。",
    group: "cast",
    roles: ["playwriter"],
    tools: ["write", "edit"],
    writeScopes: ["characters"],
    defaultOff: true,
  },
  {
    id: "voice",
    label: "音色库",
    desc: "挑 TTS 音色，配给角色卡。",
    group: "cast",
    roles: ["workshop"],
    tools: ["list_voices"],
    needs: "voice",
    unavailableNote: "服务端没配语音（TTS），暂不生效",
  },
  {
    id: "memory",
    label: "记忆",
    desc: "自己把世界设定记成卡，并能翻找往事。",
    group: "writing",
    roles: ["playwriter"],
    tools: ["write", "edit", "search_archive"],
    writeScopes: ["memory"],
  },
  {
    id: "files",
    label: "改剧目文件",
    desc: "直接读写角色卡、记忆卡、play.json 与写作参数。",
    group: "writing",
    roles: ["workshop"],
    tools: ["write", "edit"],
    writeScopes: ["characters", "memory", "config"],
  },
  {
    id: "image",
    label: "生图",
    desc: "缺背景 / 立绘时自己画，后台出图不阻塞台词。",
    group: "assets",
    roles: ["playwriter", "workshop"],
    tools: ["generate_image", "generate_asset", "cut", "import_asset"],
    needs: "image",
    unavailableNote: "服务端没配生图后端，暂不生效",
  },
  {
    id: "annotate",
    label: "标注素材",
    desc: "给已入库的素材补 / 改标题、描述、情绪、场景——生成工具不承载元数据，BGM 全靠这一步。",
    group: "assets",
    roles: ["playwriter", "workshop"],
    tools: ["annotate_asset"],
  },
  {
    id: "music",
    label: "生成 BGM",
    desc: "库里没有合适的曲子时自己写一首，垫到剧目里。",
    group: "assets",
    roles: ["workshop"],
    tools: ["generate_bgm"],
    needs: "music",
    unavailableNote: "服务端没配音乐生成后端，暂不生效",
  },
  {
    id: "library",
    label: "素材资源库",
    desc: "查库里有哪些素材，也能把现成的搬进本剧目。",
    group: "assets",
    roles: ["playwriter", "workshop"],
    tools: ["list_library"],
  },
  {
    id: "search",
    label: "联网检索",
    desc: "缺现实资料时上网查。",
    group: "research",
    roles: ["playwriter", "workshop"],
    tools: ["web_search"],
    needs: "search",
    unavailableNote: "服务端没配联网检索，暂不生效",
  },
  {
    id: "skill",
    label: "技能库",
    desc: "查跨剧目的通用做法。",
    group: "stagecraft",
    roles: ["playwriter", "workshop"],
    tools: ["read_skill"],
  },
  {
    id: "readiness",
    label: "检查开演条件",
    desc: "开演前查还缺什么。",
    group: "stagecraft",
    roles: ["workshop"],
    tools: ["validate_play"],
  },
  {
    id: "shell",
    label: "命令行",
    desc: "以服务进程权限跑命令，能绕开文件面（默认关）。",
    group: "advanced",
    roles: ["workshop"],
    tools: ["bash"],
    defaultOff: true,
  },
] as const satisfies readonly CapabilityEntry[];

/** 目录的宽类型视图（迭代用）；字面量留在 `CATALOG_ROWS` 里给 id 联合。 */
export const CAPABILITY_CATALOG: readonly CapabilityEntry[] = CATALOG_ROWS;

export type CapabilityId = (typeof CATALOG_ROWS)[number]["id"];

/** 目录项 → 界面那一行（新 API `/api/agents/capabilities` 的数据源）。 */
export interface AgentCapabilityEntry {
  id: string;
  label: string;
  desc: string;
  group: CapabilityGroup;
  /** 分组的中文名（分组键是英文，界面上不能直接摆出来）。 */
  groupLabel: string;
  /** 服务端现在配得出它的工具吗；false 时开关照旧能勾，配好后生效。 */
  available: boolean;
  /** `available: false` 时界面的那句说明。 */
  unavailableNote?: string;
}

/** 某个角色的能力目录（按分组顺序）。 */
export function capabilityCatalog(role: AgentRole, env: CapabilityEnv): AgentCapabilityEntry[] {
  return CAPABILITY_CATALOG.filter((cap) => cap.roles.includes(role)).map((cap) => {
    const available = !cap.needs || env[cap.needs];
    return {
      id: cap.id,
      label: cap.label,
      desc: cap.desc,
      group: cap.group,
      groupLabel: CAPABILITY_GROUPS[cap.group],
      available,
      ...(available || !cap.unavailableNote ? {} : { unavailableNote: cap.unavailableNote }),
    };
  });
}

/**
 * 工具目录的**工具层真相源**：哪个角色装得上这个工具（`read` / `write` / `edit` / `bash`
 * 是 pi 的内建工具，路径白名单在 `PlayEnv` 里收口）。
 *
 * 能力目录引用这里的 id；装一个没登记的 id 会当着测试红——所以装配不再需要第二份角色清单。
 */
const TOOL_CATALOG: Record<string, { label: string; roles: readonly [AgentRole, ...AgentRole[]] }> = {
  enter_nsfw: { label: "进入限制级剧情", roles: ["playwriter"] },
  exit_nsfw: { label: "退出限制级剧情", roles: ["playwriter"] },
  search_archive: { label: "检索历史往事", roles: ["playwriter"] },
  generate_image: { label: "出候选图", roles: ["playwriter", "workshop"] },
  // 只装工坊：剧作家一次调用就声明了最终 id，宿主把出图与入库一次做完（见 imageTool）。
  generate_asset: { label: "生成剧目素材", roles: ["playwriter", "workshop"] },
  // 只装工坊：一首 ~175s 的曲子要 84s，剧作家的一轮等不起；音乐又是制作资产。
  generate_bgm: { label: "生成 BGM", roles: ["workshop"] },
  annotate_asset: { label: "标注素材", roles: ["playwriter", "workshop"] },
  cut: { label: "抠底", roles: ["workshop"] },
  // 只装工坊：剧作家那条路是「引用即导入」（剧本里写个 id，宿主去库里取），不自己登记。
  import_asset: { label: "登记素材", roles: ["workshop"] },
  // 两个角色都装：写这一拍时手边可查的通用手艺（2026-10-10 起对剧作家开放）。
  read_skill: { label: "读技能库", roles: ["playwriter", "workshop"] },
  list_voices: { label: "查音色库", roles: ["workshop"] },
  web_search: { label: "联网检索", roles: ["playwriter", "workshop"] },
  read: { label: "读文件", roles: ["playwriter", "workshop"] },
  write: { label: "写文件", roles: ["playwriter", "workshop"] },
  edit: { label: "编辑文件", roles: ["playwriter", "workshop"] },
  bash: { label: "命令行", roles: ["workshop"] },
  validate_play: { label: "检查开演条件", roles: ["workshop"] },
  list_library: { label: "浏览素材资源库", roles: ["playwriter", "workshop"] },
};

/**
 * 基座工具：两个角色恒装，不进任何能力。
 *
 * `read` 必须在基座上：角色表 ≥5 人时 A 区只给不在场的角色一行摘要，模型得能自己
 * `read characters/<id>.md` 把完整人设翻出来；把它挂进「管理角色」，默认关的那一刻
 * 连读角色卡都没了。
 */
export const BASE_TOOLS = ["read"] as const;

/** 某个角色装得上的工具 id（依赖面允许的那些；`web_search` / 音色 / 库还要按配置再收）。 */
export function installableTools(role: AgentRole): string[] {
  return Object.entries(TOOL_CATALOG)
    .filter(([, meta]) => meta.roles.includes(role))
    .map(([id]) => id)
    .sort();
}

/** 这个能力在这个角色上授权哪些工具（目录里标了别的角色的不算它头上）。 */
export function capabilityTools(cap: CapabilityEntry, role: AgentRole): string[] {
  return cap.tools.filter((id) => TOOL_CATALOG[id]?.roles.includes(role));
}

/**
 * 各角色的默认启用集：能力目录里这个角色的那些，减掉默认关的。
 *
 * 剧作家默认**关**「管理角色」：角色卡是制作资产（音色、立绘、取景都在卡上，工坊的地盘），
 * 而记忆卡是剧情事实（演出中自然长出来的）。代价写进 README 与 validation：关着时戏里
 * 临时给新角色编的人设只活在当轮上下文与占位最小卡里。
 *
 * 工坊沿用「装得上的全部减 `bash`」：命令行以服务进程权限跑，按剧目手动勾。写成
 * 「目录里工坊的那些减 shell」而不是列一串 id，新增能力不会静默漏装。
 */
export function defaultCapabilitiesFor(role: AgentRole): string[] {
  return CAPABILITY_CATALOG.filter(
    (cap) => cap.roles.includes(role) && !cap.defaultOff,
  ).map((cap) => cap.id);
}

/** 用户配置解析后的最终启用集：play.json 给了就按它（未知 id 丢弃），没给走默认。 */
export function enabledCapabilitiesFor(
  role: AgentRole,
  configured?: readonly string[],
): ReadonlySet<string> {
  if (!configured) return new Set(defaultCapabilitiesFor(role));
  const known = new Set(
    CAPABILITY_CATALOG.filter((cap) => cap.roles.includes(role)).map((cap) => cap.id),
  );
  return new Set(configured.filter((id) => known.has(id)));
}

/** 装上的工具 = 基座 ∪ 开着的能力授权的工具。 */
export function enabledToolsFor(role: AgentRole, capabilities: ReadonlySet<string>): Set<string> {
  const out = new Set<string>(BASE_TOOLS);
  for (const cap of CAPABILITY_CATALOG) {
    if (!cap.roles.includes(role) || !capabilities.has(cap.id)) continue;
    for (const tool of capabilityTools(cap, role)) out.add(tool);
  }
  return out;
}

/** 这个角色的手能改哪几类文件（开着的能力的写面并集）。 */
export function writeScopesFor(role: AgentRole, capabilities: ReadonlySet<string>): WriteScope[] {
  const out: WriteScope[] = [];
  for (const cap of CAPABILITY_CATALOG) {
    if (!cap.roles.includes(role) || !capabilities.has(cap.id)) continue;
    for (const scope of cap.writeScopes ?? []) {
      if (!out.includes(scope)) out.push(scope);
    }
  }
  return out;
}

/** 当前真正可用的能力位（`kit.can`）：提示词按它决定注不注某一章。 */
export type AgentCapabilities = Record<CapabilityId, boolean>;

/** 从实际装上的工具算能力位——判定只有这一份，装配与两个角色的提示词不会各算各的。 */
export function capabilitiesOf(
  role: AgentRole,
  capabilities: ReadonlySet<string>,
  tools: readonly { name: string }[],
): AgentCapabilities {
  const installed = new Set(tools.map((tool) => tool.name));
  return Object.fromEntries(
    CAPABILITY_CATALOG.map((cap) => {
      const on = cap.roles.includes(role) && capabilities.has(cap.id);
      return [cap.id, on && capabilityTools(cap, role).every((id) => installed.has(id))];
    }),
  ) as AgentCapabilities;
}

export interface AgentKit {
  role: AgentRole;
  /** 装好的工具（已按能力启用集过滤）；每一项都带 `sideEffects` 契约。 */
  tools: AgentToolWithContract<AgentTool<any>>[];
  can: AgentCapabilities;
  /** 思考档位（宿主解析后透出，提示词与 UI 用）。 */
  thinking: ThinkingLevel;
}

/**
 * 这个角色在给定依赖面上真装得出来的工具（**还没有过能力那道过滤**）。
 *
 * `agentkit.test.ts` 拿这里的原样产物对账 `TOOL_CATALOG` 的角色标记：比过滤后的结果
 * 等于拿启用集和自己比，工厂多装一个没登记的工具照样能过。
 */
export function roleTools(deps: AgentKitDeps): AgentTool<any>[] {
  return deps.role === "playwriter" ? playwriterTools(deps) : workshopTools(deps);
}

export function createAgentKit(deps: AgentKitDeps & { thinking?: ThinkingLevel }): AgentKit {
  const installable = roleTools(deps);
  const wanted = enabledToolsFor(deps.role, deps.capabilities);
  const tools = installable.filter((tool) => wanted.has(tool.name));
  const contractedTools: AgentToolWithContract<AgentTool<any>>[] = tools.map((tool) =>
    attachToolContract(tool, deps.role),
  );
  assertToolContracts(contractedTools);
  return {
    role: deps.role,
    tools: contractedTools,
    can: capabilitiesOf(deps.role, deps.capabilities, tools),
    thinking: deps.thinking ?? "default",
  };
}

/** 这个角色的 `PlayEnv` 政策：能写哪几类文件、通用读口认不认引擎产物。 */
function envOf(role: AgentRole, files: AgentKitDeps["files"], capabilities: ReadonlySet<string>, onWrite: AgentKitDeps["onWrite"]): PlayEnv {
  return new PlayEnv(
    files,
    {
      writeScopes: writeScopesFor(role, capabilities),
      // 工坊要能读用户手上的剧目全貌；剧作家的通用读口不认引擎产物（别的世界线的纪元摘要），
      // 往事走 search_archive 这个带分支过滤的工具。记忆卡本身是普通剧目文件，read 拿得到。
      readGenerated: role === "workshop",
    },
    onWrite,
  );
}

/**
 * 剧作家的工具：轮收束 + 状态/记忆 + 剧目文件 + 生图（后台排产）+ 资源库检索 + 联网。
 *
 * 文件工具与工坊**同一套**（pi 的 read / write / edit，走同一个 `PlayEnv` 白名单）：
 * 角色卡、记忆卡本来就是普通剧目文件，专用工具只是给同一件事多加一条 schema 与一层守卫。
 * 少了 bash 与 lineage：命令行按剧目手动勾，故事树是工坊的活。
 */
function playwriterTools(deps: PlaywriterKitDeps): AgentTool<any>[] {
  const env = envOf(deps.role, deps.files, deps.capabilities, deps.onWrite);
  return [
    createArchiveTool(deps),
    ...createNsfwTools(deps),
    ...createPiFileTools(env),
    createGenerateImageTool({
      playAssets: deps.playAssets,
      imageConcurrency: deps.imageConcurrency,
      onAsset: () => {},
    }),
    // 剧作家的排产路径就叫 generate_asset：同一个能力，投递方式不同（发起即返回、到货淡入）
    createGenerateAssetTool({
      mode: "queued",
      playAssets: deps.playAssets,
      emitPreload: deps.emitPreload,
      kick: deps.kick,
      kickSprite: deps.kickSprite,
      existingAssetUrl: deps.existingAssetUrl,
    }),
    createAnnotateTool({ playAssets: deps.playAssets, playMusic: deps.playMusic }),
    // 剧作家的默认导入路径是**引用即导入**（剧本里写个 id，宿主去库里搬），所以库这一面只有浏览；
    // 从库往剧目里搬东西走 import_asset 的 `library:` 来源，它按角色装（剧作家不装）。
    ...createLibraryTools({ library: deps.assetLibrary }),
    ...(deps.exa ? [createWebSearchTool(deps.exa)] : []),
    // 技能库：写这一拍时手边可查的通用手艺（与工坊读的是同一批文件、同一个工具）
    createReadSkillTool(),
  ];
}

/**
 * 工坊的工具：pi 的文件与命令行工具 + 生图（同步）+ 素材库检索 + 故事树 + 技能库 + 联网。
 *
 * read / write / edit / bash 全部来自 pi，我们只提供 `PlayEnv` 这一个 `ExecutionEnv`：
 * 白名单与 play.json 校验都在它里面（见 `playEnv.ts`）。
 */
function workshopTools(deps: WorkshopKitDeps): AgentTool<any>[] {
  const env = envOf(deps.role, deps.files, deps.capabilities, deps.onWrite);
  return [
    ...createPiFileTools(env),
    createPiBashTool(env),
    createValidatePlayTool(deps),
    // 候选图：只产草稿（不抠底、不入库），采用走 import_asset
    createGenerateImageTool({
      playAssets: deps.playAssets,
      imageConcurrency: deps.imageConcurrency,
      // 草稿也推气泡：候选图要摆在对话里让用户直接看见、点开对比
      onAsset: (path, url, kind, replaced, toolCallId) =>
        deps.onAsset({ kind, path, url }, replaced, toolCallId),
    }),
    // 一步落成（出图 + 立绘抠底 + 登记）：工坊这一面是同步等待
    createGenerateAssetTool({
      mode: "sync",
      playAssets: deps.playAssets,
      onAsset: (path, url, kind, replaced, toolCallId) =>
        deps.onAsset({ kind, path, url }, replaced, toolCallId),
    }),
    createCutTool({
      playAssets: deps.playAssets,
      onAsset: (path, url, kind, replaced, toolCallId) =>
        deps.onAsset({ kind, path, url }, replaced, toolCallId),
    }),
    createImportAssetTool({
      playAssets: deps.playAssets,
      playId: deps.playId,
      store: deps.store,
      library: deps.assetLibrary,
      onWrite: deps.onWrite,
      onAsset: (path, url, kind, replaced, toolCallId) =>
        deps.onAsset({ kind, path, url }, replaced, toolCallId),
    }),
    // 没配音乐后端就不注册：必然失败的工具只会诱使模型空转
    ...createGenerateMusicTool({
      music: deps.playMusic,
      // 后台发起：工具不等曲子，宿主那边记账并到货广播
      kick: (req) => deps.queueMusic?.(req) ?? "音乐生成未启用。",
    }),
    createAnnotateTool({ playAssets: deps.playAssets, playMusic: deps.playMusic }),
    createReadSkillTool(),
    // 没配 TTS 就不注册：查不出来的工具只会诱使模型空转
    ...createVoiceTool(deps.voices),
    ...createLibraryTools({ library: deps.assetLibrary }),
    ...(deps.exa ? [createWebSearchTool(deps.exa)] : []),
  ];
}

/** 角色全集（设置页渲染两张卡用）。 */
export const ROLES = AGENT_ROLES;
