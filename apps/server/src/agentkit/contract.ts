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
      intentionalDifference:
        "停止点的**载体必须不同**：服务端要工具 terminate 来收束轮边界（编排器按它判 beatClosed），" +
        "插件必须是剧本末行标签——DSH 的「在新对话中分支」与舞台重建只认助手消息轮尾；两边归一到同一 Stage IR。" +
        "状态那一格同样是载体差异：服务端 update_state 进引擎真值（随谱系快照回滚），插件写 memory/always/state/ 三份文件。",
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
      intentionalDifference:
        "限制级通道是**运行时换模型**（服务端双模型 + SFW 摘要 + 谱系标记），文件里写个 flag 换不动它；" +
        "插件没有这条通道——会话安全边界归 DSH 宿主。",
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
      intentionalDifference:
        "往事检索的**载体必须不同**：服务端的 search_archive 带分支过滤（pathSet）+ NSFW 过滤 + 相关性排序，" +
        "而它读的 memory/archive/ 是引擎产物；插件没有 archive 数据（往事 = 宿主会话历史），文件化拿不到同样的语义。" +
        "记忆卡本身是普通剧目文件，两边都 read（服务端原先的 read_memory_detail 已于 2026-10-10 删除）。",
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
        "pi read/write/edit 经 PlayEnv 白名单与结构校验；play.json 的 craft 段也用 edit 改。",
      dshAivn: "DSH 原生 fs 工具在会话 workspace 内读写（两个预设都有，含工坊的 characters 写面）。",
      backendDependency: "无额外后端依赖。",
      intentionalDifference:
        "独立版按角色收写面（characters / memory / config）；DSH 由宿主 workspace 权限控制。" +
        "写作参数两边都用通用文件工具改（2026-10-10 起，服务端删掉了 set_craft）。",
    },
  },
  {
    id: "image",
    profile: "shared",
    capabilities: ["image.generate", "image.cutout", "asset.register", "asset.generate"],
    domainSemantic: "生成、审阅、采用或修整剧目图像资产。",
    roles: ["playwriter", "workshop"],
    equivalence: "semantic-only",
    hosts: {
      stageAi:
        "出图分两件：generate_image 只产候选（草稿区），generate_asset 一步落成——工坊同步等图、剧作家后台排产；" +
        "外来图 / 候选图登记走 import_asset（source 给 draft:<草稿id> / 路径 / 网址）、重抠走 cut（source 给 sprite:<主体id>）。",
      dshAivn:
        "插件的 generate_image 与服务端同名同义（只产候选，给了 kind 就走剧目感知落位），外来图登记走 import_asset，" +
        "一键入库走 generate_asset（出图 + 抠底 + 登记），文件级重抠走 cut。" +
        "两边同一个 cut（引用寻址）、同一个 generate_image / generate_asset；差别只在采用候选这一步：插件的候选区可读（给路径即可），服务端的采用要经 import_asset 的 draft: 句柄。",
      backendDependency: "生图后端；抠底在两边都是包里的同一份实现。",
      intentionalDifference:
        "参数面、写 prompt 的硬约束、垫图规则与请求归一化同源（image.generate / image.cutout）；" +
        "差别在生命周期：服务端把「候选 → 采用」拆成两个显式工具、并按角色分同步/排产，插件把候选与一键入库分成两个工具、一律同步等待。",
    },
  },
  {
    id: "annotate",
    profile: "shared",
    capabilities: ["asset.annotate"],
    domainSemantic: "给已入库的素材补 / 改元数据（标题、描述、标签、情绪、场景、循环、音量）。",
    roles: ["playwriter", "workshop"],
    equivalence: "semantic-only",
    hosts: {
      stageAi:
        "annotate_asset 走 PlayAssets.annotate（三类图）与 PlayMusic.annotate（配乐），素材必须真的在；" +
        "图片类的元数据也可以在 import_asset / generate_asset 落成那一步一次给全。",
      dshAivn:
        "annotate_asset 走包里的 asset.annotate + declareMeta，落成步（register / generate_asset）同样能带 title / description / tags。",
      backendDependency: "无额外后端依赖（只写 assets/manifest.json）。",
      intentionalDifference: "同一份字段与描摹、同一份写口（declareMeta）；宿主只差各自的文件锁。",
    },
  },
  {
    id: "music",
    profile: "preset-specific",
    capabilities: ["music.generate"],
    domainSemantic: "生成并登记一首可供剧本引用的 BGM（元数据另走 asset.annotate）。",
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
        "资源库是独立版产品能力（跨剧目 library/ 目录），不能把它的目录状态复制进 DSH：插件不假定有库，" +
        "list_library / library_import 在插件侧也没有对应物。两边的 import_asset 曾长期同名不同义，" +
        "2026-10-09 把服务端那个改名 library_import（P4 清理清单第 1 条），插件那份保留原名——" +
        "两者仍不同义（前者按库 kind/entryId 复制，后者是路径/URL/草稿的登记），合并只省服务端代码，不算统一。",
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
      intentionalDifference:
        "周目与故事树是独立版产品概念（saves/ + LineageTree）：list_saves / read_lineage 回的是按存档、路径过滤、" +
        "分页与 kind 渲染过的树，不是一次文件读取。插件是线性会话优先（宿主 fork 就是它的分支），不复制这条数据。",
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
        "**通道归宿主、正文同源**：服务端走 read_skill（只读 apps/server/skills/ + 守卫），插件走 realm 隔离的" +
        "预设行与宿主 available_skills——把技能变成文件读取只会搅乱「哪份技能在哪个通道可见」这条宿主规则。" +
        "正文层已收敛：音频技能一份在包里（packages/agent/skills/aivn-audio.md），两份 SKILL.md 由 sync-skills.mjs" +
        "生成、各仓守卫盯着；play-setup / visual-craft 仍是同题重写的两份。",
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
    id: "readiness",
    profile: "shared",
    capabilities: ["play.readiness"],
    domainSemantic: "检查剧目是否读得出来、还缺什么（agent 面自查）。",
    roles: ["workshop"],
    equivalence: "semantic-only",
    hosts: {
      stageAi: "validate_play（原 get_readiness）：判据、报告文本与插件同一份（包里的 play.readiness）。",
      dshAivn: "validate_play：同一份能力、同一份报告（play.json 能否解析、craft 取值、世界状态、premise、角色数、立绘、背景、素材清单、台账对账）。",
      backendDependency: "无额外后端依赖。",
      intentionalDifference:
        "零差异：判定（readPlayReadiness）与渲染（renderReadiness）都在包里。" +
        "工坊面板 / 剧目卡那份四行底数仍留在服务端——读者是用户，不走 agent 面。",
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
  search_archive: READ_ONLY,
  // 只产候选：烧一次配额、落草稿区，**不写 assets/**（采用是 import_asset 的事）。
  generate_image: { ...READ_ONLY, read_only: false, external_request: true, asset_create: true, idempotent: false },
  // 一步落成：出图 +（立绘）抠底 + 写 assets/ + 补素材表 + 记台账。
  generate_asset: { ...READ_ONLY, read_only: false, workspace_write: true, external_request: true, asset_create: true, idempotent: false },
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
  // 标注只动素材表 `assets/manifest.json` 里那几格：写工作区、可逆、幂等（同一份补丁写两遍一个样）
  annotate_asset: {
    ...READ_ONLY,
    read_only: false,
    workspace_write: true,
    reversible: true,
    idempotent: true,
  },
  cut: { ...READ_ONLY, read_only: false, workspace_write: true, reversible: false },
  // 把一张外来的图落成素材：写 assets/ + 补素材表 + 记台账（来源可以是网图，所以也有对外请求）。
  import_asset: {
    ...READ_ONLY,
    read_only: false,
    workspace_write: true,
    external_request: true,
    asset_create: true,
    requires_confirmation: true,
    reversible: false,
    idempotent: true,
  },
  read_skill: READ_ONLY,
  list_voices: { ...READ_ONLY, external_request: true },
  web_search: { ...READ_ONLY, external_request: true },
  read: READ_ONLY,
  write: { ...READ_ONLY, read_only: false, workspace_write: true, reversible: false, idempotent: false },
  edit: { ...READ_ONLY, read_only: false, workspace_write: true, reversible: false, idempotent: false },
  bash: { ...READ_ONLY, read_only: false, workspace_write: true, external_request: true, reversible: false, idempotent: false },
  validate_play: READ_ONLY,
  list_library: READ_ONLY,
  library_import: { ...READ_ONLY, read_only: false, workspace_write: true, asset_adopt: true, reversible: false, idempotent: false },
  list_saves: READ_ONLY,
  read_lineage: READ_ONLY,
};

export function sideEffectsForTool(name: string, role?: AgentRole): ToolSideEffectMetadata {
  const metadata = TOOL_SIDE_EFFECT_CATALOG[name];
  if (!metadata) throw new Error(`Missing AgentKit side-effect metadata for tool: ${name}`);
  // 剧作家走 queued：发起即返回、图到货时才落 assets/（见 assetTool.runQueued 与 playhouse）。
  // 工坊走 sync：等图出完并入库，同一轮就能引用。
  if (name === "generate_asset" && role === "playwriter") {
    return { ...metadata, background_job: true, asset_adopt: true, requires_confirmation: false };
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
