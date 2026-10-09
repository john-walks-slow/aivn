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
  /**
   * 这份能力由包里的哪个能力实现（`@aivn/agent` 的 `CAPABILITIES` 里的 id）。
   *
   * 有这一格的行，两边的参数面 / 描述 / 领域实现是**同一份源码**；没有的行说明共享面还没到
   * 那一层（或本来就只有一边有）。守卫盯着它：包里的每个能力都必须在某一行出现，
   * 每一格写的 id 也必须在包里存在。
   */
  capabilities?: readonly string[];
  /** 只有一边有的能力：这一格写哪一边，守卫据此跳过「服务端能力目录里也得有它」那条。 */
  hostOnly?: "dsh-aivn";
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
    capabilities: ["voice.list"],
    domainSemantic: "查询音色并为角色选择可用 voiceId。",
    roles: ["workshop"],
    equivalence: "required",
    hosts: {
      stageAi: "AgentKit list_voices 查 VoiceCatalogService（总数与「磁盘快照」标记由它给）。",
      dshAivn: "插件 list_voices 查插件的 VoiceCatalog（出网那一层：多 key 轮询与超时）。",
      backendDependency: "Fish Audio key 与可用音色目录。",
      intentionalDifference:
        "参数面、筛选、分页与渲染同源（voice.list）；服务端另加 pi 侧的长度收紧（query ≤60 / tags ≤4），" +
        "出网层各是各的（服务端本地目录服务 vs 插件多 key 轮询）。设置也各由各自宿主管理。",
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
      dshAivn: "通过 DSH 的文件工具维护工作区文件（两个预设都装），历史由宿主会话提供。",
      backendDependency: "无额外后端依赖。",
      intentionalDifference: "独立版有分支过滤和 archive 工具（read_memory_detail / search_archive）；DSH 用原生文件视图，memory 那一格的角色也只有服务端有。",
    },
  },
  {
    id: "files",
    profile: "shared",
    domainSemantic: "在允许的剧目文件面内读取、修改和校验文件。",
    roles: ["workshop"],
    equivalence: "semantic-only",
    hosts: {
      stageAi:
        "pi read/write/edit 经 PlayEnv 白名单与结构校验；另有一个 set_craft——它要拿 withPlayConfigLock " +
        "改 play.json 的 craft 段（整体性 + 串行写），所以不能走通用的 edit。",
      dshAivn: "DSH 原生 fs 工具在会话 workspace 内读写（两个预设都有，含工坊的 characters 写面）。",
      backendDependency: "无额外后端依赖。",
      intentionalDifference:
        "独立版按角色收写面（characters / memory / config）；DSH 由宿主 workspace 权限控制。" +
        "set_craft 是服务端独有的一条（play.json 整体写 + 串行队列），插件改 craft 走通用文件工具。",
    },
  },
  {
    id: "image",
    profile: "shared",
    capabilities: ["image.generate", "image.cutout"],
    domainSemantic: "生成、审阅、采用或修整剧目图像资产。",
    roles: ["playwriter", "workshop"],
    equivalence: "semantic-only",
    hosts: {
      stageAi:
        "一个 generate_image 扛两种投递：工坊同步出草稿（入库另走 commit_asset）、剧作家后台排产直落；" +
        "重抠走 recut_sprite（拿留底原片原地重跑抠底）。",
      dshAivn:
        "插件的 generate_image 是**无剧目目标**的候选图（与服务端同名不同义），一键入库走 generate_asset（出图 + 抠底 + 登记），" +
        "文件级重抠走 cut。**插件没有 commit_asset / recut_sprite 的等价物**：采用发生在 generate_asset 内部，重抠对着源图跑 cut。",
      backendDependency: "生图后端；抠底在两边都是包里的同一份实现。",
      intentionalDifference:
        "参数面、写 prompt 的硬约束、垫图规则与请求归一化同源（image.generate / image.cutout）；" +
        "差别在生命周期：服务端把「候选 → 采用」拆成两个显式工具、并按角色分同步/排产，插件把候选与一键入库分成两个工具、一律同步等待。",
    },
  },
  {
    id: "music",
    profile: "preset-specific",
    capabilities: ["music.generate"],
    domainSemantic: "生成并登记一首可供剧本引用的 BGM。",
    roles: ["workshop"],
    equivalence: "semantic-only",
    hosts: {
      stageAi: "generate_bgm = deps.kick → 后台排产 → pendingJobs 记账 + asset_ready 到货（发起即返回）。",
      dshAivn: "generate_bgm = **同步 await** PlayAssets.generateBgm——插件没有「回合之外」的注入通道，等就是等。**没有任务管线。**",
      backendDependency: "音乐生成后端（协议在包里的 media/music.ts）。",
      intentionalDifference:
        "投递方式不同（后台排产 vs 同步等待），参数真相源、查重口径与回执文案同源（music.generate）；" +
        "插件只露 name / prompt / model / overwrite 四格，元数据落表由宿主自己的素材路径写。",
    },
  },
  {
    id: "library",
    profile: "preset-specific",
    domainSemantic: "查找可复用素材并导入当前剧目。",
    roles: ["playwriter", "workshop"],
    equivalence: "intentional-difference",
    hosts: {
      stageAi: "应用级 library/ 资源库 + 引用即导入；工坊可显式 library_import（从库按 entryId 复制进剧目）。",
      dshAivn:
        "插件有一个**同名不同义**的 import_asset：把本地路径 / URL 登记成剧目素材（asset.register），不是从应用级库导入；" +
        "它没有 list_library（插件不假定跨剧目资源库）。",
      backendDependency: "独立版需本地 library 目录；DSH 无此依赖。",
      intentionalDifference:
        "资源库是独立版产品能力，不能把其目录状态复制进 DSH。两边的 import_asset 曾长期同名不同义，" +
        "2026-10-09 把服务端那个改名 library_import（P4 清理清单第 1 条），插件那份保留原名。",
    },
  },
  {
    id: "search",
    profile: "shared",
    capabilities: ["web.search"],
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
      dshAivn: "DSH 的技能行（skill-filesystem / tool-skill）暴露插件 skills 目录，两个预设都装。",
      backendDependency: "随包技能文件。",
      intentionalDifference:
        "技能加载时机和宿主工具不同。**音频技能已收敛**：正文一份在包里（packages/agent/skills/aivn-audio.md），" +
        "两份 SKILL.md 由包内 sync-skills.mjs 生成、各仓守卫盯着；play-setup / visual-craft 仍是同题重写的两份。",
    },
  },
  {
    id: "style",
    profile: "preset-specific",
    hostOnly: "dsh-aivn",
    domainSemantic: "改舞台皮肤（配色令牌与主题）。",
    roles: ["workshop"],
    equivalence: "intentional-difference",
    hosts: {
      stageAi: "**没有这个能力**：独立版的舞台外观由前端主题与剧目 theme.json 决定，没有给 agent 的改皮肤口。",
      dshAivn: "插件的 set_stage_style 按令牌白名单改 theme.json（style-tokens 校验，写坏了当场拒）。",
      backendDependency: "无额外后端依赖。",
      intentionalDifference: "插件独有的产品面（用户在对话里说「换个配色」就能改），服务端没有对应实现，也没有必要模拟。",
    },
  },
  {
    id: "view",
    profile: "preset-specific",
    domainSemantic: "把剧目内或外部图片读给 Agent 判断。",
    roles: ["workshop"],
    equivalence: "intentional-difference",
    hosts: {
      stageAi: "view_image 读本地素材，或安全下载网页图片（带 SSRF 防护）后读回。",
      dshAivn:
        "**目前是有意省略，不是等价实现**：插件 9 个工具里没有看图工具，插件仓内也查不到它依赖的「宿主 view 能力」。" +
        "需要看图时走宿主自身能力（2026-10-09 逐项实读代码的结论）。",
      backendDependency: "外部网址来源需要联网出口。",
      intentionalDifference: "独立版有本地与外链两个分支；DSH 侧未落地。",
    },
  },
  {
    id: "readiness",
    profile: "shared",
    domainSemantic: "检查剧目是否满足开演或备料条件。",
    roles: ["workshop"],
    equivalence: "semantic-only",
    hosts: {
      stageAi: "get_readiness 只报 premise / 立绘 / 背景三行（工坊面板那份口径）。",
      dshAivn:
        "validate_play 是**超集**：play.json 读不读得出来（坏在哪一行）、craft 取值、世界状态、" +
        "premise、角色数、立绘、背景、素材清单、生图台账对账。",
      backendDependency: "无额外后端依赖。",
      intentionalDifference:
        "判定同源（包里的 readPlayReadiness）；报告按读者分两份——工坊面板那份四行留在服务端，" +
        "agent 面的完整报告在包里（插件的 validate_play 用它）。服务端没有 craft / 台账对账那几项。",
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
  library_import: { ...READ_ONLY, read_only: false, workspace_write: true, asset_adopt: true, reversible: false, idempotent: false },
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
