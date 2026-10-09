import type { AgentRole } from "./role.js";

/** Cross-host capability profile recorded by stage-ai. */
export type CapabilityProfile = "shared" | "preset-specific";
export type CapabilityEquivalence = "required" | "semantic-only" | "intentional-difference";

export interface CapabilityHostContract {
  /** The independent stage-ai implementation. */
  stageAi: string;
  /** The dsh-aivn host implementation or an intentional omission. */
  dshAivn: string;
  /** Configuration or service required before the capability can be used. */
  backendDependency: string;
  /** Why the two hosts are allowed to differ. */
  intentionalDifference: string;
}

export interface CrossHostCapabilityContract {
  id: string;
  profile: CapabilityProfile;
  domainSemantic: string;
  roles: readonly AgentRole[];
  equivalence: CapabilityEquivalence;
  hosts: CapabilityHostContract;
}

/**
 * The single cross-host capability record.
 *
 * This is a domain/host boundary contract, not a second tool registry. The
 * stage-ai catalog remains responsible for UI labels and concrete tool ids;
 * this record explains what both hosts promise and where they intentionally
 * diverge.
 */
export const CAPABILITY_MATRIX: readonly CrossHostCapabilityContract[] = [
  {
    id: "stage",
    profile: "shared",
    domainSemantic: "收束一轮并交出停止点；必要时提议本轮状态更新。",
    roles: ["playwriter"],
    equivalence: "semantic-only",
    hosts: {
      stageAi: "AgentKit 的 beat_done / update_state 与独立版编排器。",
      dshAivn: "剧本 <stop> 标签与 DSH 会话投影；状态由文件工具维护。",
      backendDependency: "无额外后端依赖。",
      intentionalDifference: "停止点来源不同，但两边都归一到同一 Stage IR。",
    },
  },
  {
    id: "nsfw",
    profile: "preset-specific",
    domainSemantic: "在全年龄与限制级剧情通道之间切换。",
    roles: ["playwriter"],
    equivalence: "intentional-difference",
    hosts: {
      stageAi: "独立版编排器维护 nsfw 通道、摘要和谱系标记。",
      dshAivn: "不暴露该能力；由 DSH 宿主策略决定会话安全边界。",
      backendDependency: "独立版需配置限制级模型/提示词链路。",
      intentionalDifference: "DSH 当前不模拟独立版的双模型与谱系状态机。",
    },
  },
  {
    id: "characters",
    profile: "shared",
    domainSemantic: "维护角色卡与角色身份事实。",
    roles: ["playwriter"],
    equivalence: "semantic-only",
    hosts: {
      stageAi: "AgentKit 文件工具写入 characters/，由 PlayFiles 校验。",
      dshAivn: "DSH 文件工具写入同一剧目工作区。",
      backendDependency: "无额外后端依赖。",
      intentionalDifference: "文件入口不同，但角色卡格式由 @aivn/core 约束。",
    },
  },
  {
    id: "voice",
    profile: "shared",
    domainSemantic: "查询音色并为角色选择可用 voiceId。",
    roles: ["workshop"],
    equivalence: "required",
    hosts: {
      stageAi: "AgentKit list_voices 查询 VoiceCatalogService。",
      dshAivn: "DSH list_voices 查询插件 VoiceCatalog。",
      backendDependency: "Fish Audio key 与可用音色目录。",
      intentionalDifference: "独立版设置由 settings.json 管理，DSH 由插件配置管理。",
    },
  },
  {
    id: "memory",
    profile: "shared",
    domainSemantic: "维护剧目设定、状态与可检索的剧情记忆。",
    roles: ["playwriter"],
    equivalence: "semantic-only",
    hosts: {
      stageAi: "记忆卡经 PlayFiles 写入，状态经谱系快照回滚。",
      dshAivn: "通过 DSH 文件工具维护工作区文件，历史由宿主会话提供。",
      backendDependency: "无额外后端依赖。",
      intentionalDifference: "独立版有分支过滤和 archive 工具；DSH 使用原生历史/文件视图。",
    },
  },
  {
    id: "files",
    profile: "shared",
    domainSemantic: "在允许的剧目文件面内读取、修改和校验文件。",
    roles: ["workshop"],
    equivalence: "semantic-only",
    hosts: {
      stageAi: "pi read/write/edit 经 PlayEnv 白名单与结构校验。",
      dshAivn: "DSH 原生 fs 工具在会话 workspace 内读写。",
      backendDependency: "无额外后端依赖。",
      intentionalDifference: "独立版有角色/能力级写面；DSH 由宿主 workspace 权限控制。",
    },
  },
  {
    id: "image",
    profile: "shared",
    domainSemantic: "生成、审阅、采用或修整剧目图像资产。",
    roles: ["playwriter", "workshop"],
    equivalence: "semantic-only",
    hosts: {
      stageAi: "独立版支持 queued generate_image、workshop draft/commit_asset 与 recut_sprite。",
      dshAivn: "DSH 使用 generate_image 候选、generate_asset 一键入库和 cut。",
      backendDependency: "生图后端；独立版另需本地抠底能力。",
      intentionalDifference: "独立版把候选与采用拆成显式生命周期；DSH 可按工具选择同步或一键流程。",
    },
  },
  {
    id: "music",
    profile: "preset-specific",
    domainSemantic: "生成并登记一首可供剧本引用的 BGM。",
    roles: ["workshop"],
    equivalence: "semantic-only",
    hosts: {
      stageAi: "独立版 pending job 后台排产并通过 asset_ready 到货。",
      dshAivn: "DSH generate_bgm 使用宿主/插件媒体任务管线。",
      backendDependency: "音乐生成后端。",
      intentionalDifference: "两边任务生命周期由各自宿主管理，不互相模拟队列。",
    },
  },
  {
    id: "library",
    profile: "preset-specific",
    domainSemantic: "查找可复用素材并导入当前剧目。",
    roles: ["playwriter", "workshop"],
    equivalence: "intentional-difference",
    hosts: {
      stageAi: "应用级 library/ 资源库与引用即导入；工坊可显式 import_asset。",
      dshAivn: "不假定独立版跨剧目 library；DSH 仅处理当前 workspace 的素材工具。",
      backendDependency: "独立版需本地 library 目录；DSH 无此依赖。",
      intentionalDifference: "资源库是独立版产品能力，不能把其目录状态复制进 DSH。",
    },
  },
  {
    id: "search",
    profile: "shared",
    domainSemantic: "向外部检索服务请求现实资料。",
    roles: ["playwriter", "workshop"],
    equivalence: "required",
    hosts: {
      stageAi: "AgentKit web_search 使用 Exa 依赖。",
      dshAivn: "DSH web_search 使用插件 Exa 客户端。",
      backendDependency: "Exa key / 可用联网出口。",
      intentionalDifference: "配置入口不同，结果语义都是外部检索回执。",
    },
  },
  {
    id: "lineage",
    profile: "preset-specific",
    domainSemantic: "读取演出周目、故事树与当前分支记录。",
    roles: ["workshop"],
    equivalence: "intentional-difference",
    hosts: {
      stageAi: "独立版 saves、session 和 LineageTree 的只读 AgentKit 工具。",
      dshAivn: "不复制 LineageTree；使用 DSH 原生会话历史与 fork。",
      backendDependency: "独立版需剧目 saves 数据。",
      intentionalDifference: "DSH 是线性会话优先，路线树/周目不是插件责任。",
    },
  },
  {
    id: "skill",
    profile: "shared",
    domainSemantic: "按需读取跨剧目的制作技能。",
    roles: ["workshop"],
    equivalence: "semantic-only",
    hosts: {
      stageAi: "read_skill 只读 apps/server/skills。",
      dshAivn: "DSH skill-filesystem/tool-skill 暴露插件 skills。",
      backendDependency: "随包技能文件。",
      intentionalDifference: "技能加载时机和宿主工具不同，技能内容需保持领域语义一致。",
    },
  },
  {
    id: "view",
    profile: "preset-specific",
    domainSemantic: "把剧目内或外部图片读给 Agent 判断。",
    roles: ["workshop"],
    equivalence: "semantic-only",
    hosts: {
      stageAi: "view_image 读本地素材或安全下载的网页图片。",
      dshAivn: "由 DSH 客户端/文件工具提供图片查看，不复制独立版下载缓存。",
      backendDependency: "外部网址来源需要联网出口。",
      intentionalDifference: "独立版需要服务端图片附件适配；DSH 使用宿主 view 能力。",
    },
  },
  {
    id: "readiness",
    profile: "shared",
    domainSemantic: "检查剧目是否满足开演或备料条件。",
    roles: ["workshop"],
    equivalence: "semantic-only",
    hosts: {
      stageAi: "get_readiness 复用独立版 readiness 报告。",
      dshAivn: "validate_play 检查 workspace 剧目文件和素材一致性。",
      backendDependency: "无额外后端依赖。",
      intentionalDifference: "独立版检查运行时就绪门，DSH 检查插件可理解的 workspace 契约。",
    },
  },
  {
    id: "shell",
    profile: "preset-specific",
    domainSemantic: "以宿主服务进程权限执行命令。",
    roles: ["workshop"],
    equivalence: "intentional-difference",
    hosts: {
      stageAi: "工坊 pi bash，默认关闭并受 PlayEnv 外的宿主权限约束。",
      dshAivn: "DSH preset tool-bash 行，默认关闭并由 DSH 配置控制。",
      backendDependency: "宿主操作系统权限与 shell。",
      intentionalDifference: "两边都明确是高权限能力，但 cwd、超时和审计归各自宿主。",
    },
  },
] as const;

export type CapabilityMatrixId = (typeof CAPABILITY_MATRIX)[number]["id"];

export const CAPABILITY_MATRIX_BY_ID: Readonly<Record<CapabilityMatrixId, CrossHostCapabilityContract>> =
  Object.fromEntries(CAPABILITY_MATRIX.map((entry) => [entry.id, entry])) as Readonly<
    Record<CapabilityMatrixId, CrossHostCapabilityContract>
  >;

export interface ToolSideEffectMetadata {
  read_only: boolean;
  workspace_write: boolean;
  external_request: boolean;
  asset_create: boolean;
  asset_adopt: boolean;
  background_job: boolean;
  requires_confirmation: boolean;
  reversible: boolean;
  idempotent: boolean;
}

export type AgentToolWithContract<T = unknown> = T & {
  sideEffects: ToolSideEffectMetadata;
};

const READ_ONLY: ToolSideEffectMetadata = {
  read_only: true,
  workspace_write: false,
  external_request: false,
  asset_create: false,
  asset_adopt: false,
  background_job: false,
  requires_confirmation: false,
  reversible: true,
  idempotent: true,
};

/** Declarative side-effect/lifecycle metadata for every AgentKit tool id. */
export const TOOL_SIDE_EFFECT_CATALOG: Readonly<Record<string, ToolSideEffectMetadata>> = {
  beat_done: { ...READ_ONLY, read_only: false, reversible: false, idempotent: false },
  enter_nsfw: { ...READ_ONLY, read_only: false, reversible: true },
  exit_nsfw: { ...READ_ONLY, read_only: false, reversible: true },
  update_state: { ...READ_ONLY, read_only: false, reversible: true, idempotent: false },
  read_memory_detail: READ_ONLY,
  search_archive: READ_ONLY,
  // 两个角色都**产出**新图（所以 asset_create 恒真）；差别在下游：
  // 剧作家一次调用就把图落进 assets/（draft + commit 一起做完）；工坊只落草稿，采用是另一步。
  generate_image: { ...READ_ONLY, read_only: false, external_request: true, asset_create: true, idempotent: false },
  commit_asset: {
    ...READ_ONLY,
    read_only: false,
    workspace_write: true,
    asset_adopt: true,
    requires_confirmation: true,
    reversible: false,
    idempotent: true,
  },
  generate_bgm: {
    ...READ_ONLY,
    read_only: false,
    // 生成即入库：曲子直接落 assets/bgm/ 并补素材表，没有草稿那一步（见 playMusic.ts）。
    workspace_write: true,
    external_request: true,
    asset_create: true,
    background_job: true,
    reversible: false,
    idempotent: false,
  },
  recut_sprite: { ...READ_ONLY, read_only: false, workspace_write: true, reversible: false },
  read_skill: READ_ONLY,
  set_craft: { ...READ_ONLY, read_only: false, workspace_write: true, reversible: true },
  list_voices: { ...READ_ONLY, external_request: true },
  web_search: { ...READ_ONLY, external_request: true },
  read: READ_ONLY,
  write: { ...READ_ONLY, read_only: false, workspace_write: true, reversible: false, idempotent: false },
  edit: { ...READ_ONLY, read_only: false, workspace_write: true, reversible: false, idempotent: false },
  bash: { ...READ_ONLY, read_only: false, workspace_write: true, external_request: true, reversible: false, idempotent: false },
  get_readiness: READ_ONLY,
  view_image: { ...READ_ONLY, read_only: false, external_request: true },
  list_library: READ_ONLY,
  import_asset: { ...READ_ONLY, read_only: false, workspace_write: true, asset_adopt: true, reversible: false, idempotent: false },
  list_saves: READ_ONLY,
  read_lineage: READ_ONLY,
};

export function sideEffectsForTool(name: string, role?: AgentRole): ToolSideEffectMetadata {
  const metadata = TOOL_SIDE_EFFECT_CATALOG[name];
  if (!metadata) throw new Error(`Missing AgentKit side-effect metadata for tool: ${name}`);
  // 剧作家走 queued：发起即返回、图到货时才落 assets/（见 imageTool.runQueued 与 playhouse）。
  // 工坊走 sync：只产草稿，采用是另一步 commit_asset。
  if (name === "generate_image" && role === "playwriter") {
    return { ...metadata, workspace_write: true, background_job: true, asset_adopt: true };
  }
  return metadata;
}

export function attachToolContract<T extends { name: string }>(tool: T, role?: AgentRole): AgentToolWithContract<T> {
  return { ...tool, sideEffects: sideEffectsForTool(tool.name, role) };
}

export function assertToolContracts(tools: readonly { name: string; sideEffects?: ToolSideEffectMetadata }[]): void {
  for (const tool of tools) {
    const metadata = tool.sideEffects;
    if (!metadata) throw new Error(`AgentKit tool ${tool.name} has no side-effect contract`);
    for (const field of [
      "read_only",
      "workspace_write",
      "external_request",
      "asset_create",
      "asset_adopt",
      "background_job",
      "requires_confirmation",
      "reversible",
      "idempotent",
    ] as const) {
      if (typeof metadata[field] !== "boolean") {
        throw new Error(`AgentKit tool ${tool.name} has invalid side-effect field ${field}`);
      }
    }
  }
}
