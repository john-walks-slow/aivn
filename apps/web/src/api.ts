import type {
  CharacterDocument,
  AssetMeta,
  CgEntry,
  LibraryEntry,
  LineageView,
  PlayConfig,
  PlayCover,
  VoiceCatalog,
  VoiceEntry,
} from "@aivn/core";

/** 资源库导入回执（服务端 assetImport 的结果原样）。 */
export interface ImportResult {
  kind: string;
  id: string;
  /** 立绘类目落成的立绘 id（= `assets/sprites/<spriteId>/` 的目录名；主角固定 `protagonist`）。 */
  spriteId: string;
  files: string[];
  characters: string[];
  /** 这次写的是主角卡（角色列表为空）。 */
  protagonist: boolean;
  manifestKeys: string[];
  /** 剧目配置/素材表的改动（进工坊撤销条；REST 直连时前端不用它）。 */
  writes: { path: string; before: string | null; after: string }[];
}

/** 开演前置检查：引擎手上还没有的东西（只作提示，不挡开演）。 */
export interface Readiness {
  premise: boolean;
  sprites: boolean;
  background: boolean;
  /** 本剧目已有的周目数（0 = 还没开演）。 */
  saves: number;
}

/**
 * 还没有的故事设定。世界观前提不写也能开演——剧作家会自由发挥，
 * 想要一个确定的世界才去写。立绘与背景同理（没图就落氛围底色，没有立绘的角色不上台）。
 *
 * 文案直说引擎缺什么，不跟玩家讲「就绪门」那套内部说法。
 */
export const readinessMissing = (r: Readiness): string[] =>
  r.premise ? [] : ["故事前提"];

export const readinessAdvice = (r: Readiness): string[] => [
  ...(r.sprites ? [] : ["立绘"]),
  ...(r.background ? [] : ["背景图"]),
];

export interface PlaySummary {
  id: string;
  title: string;
  premise: string;
  readiness: Readiness;
}

/** 剧目文件（工坊文件浏览器 / 工坊 agent 白名单面）。 */
export interface PlayFile {
  path: string;
  dir: string[];
  size: number;
  writable: boolean;
  /** 预览方式：text 进编辑器，image/audio 走静态 URL，其余为 binary。 */
  kind: "text" | "image" | "audio" | "binary";
}

/** 存档（周目）：一剧目并存 N 棵独立的谱系树。 */
export interface SaveInfo {
  id: string;
  name: string;
  createdAt: number;
  updatedAt: number;
  beats: number;
  preview: string;
  current: boolean;
}

export interface PlayDetail {
  play: PlayConfig;
  /** 世界观前提全文（memory/always/premise.md）——A 区注入的同一份，标题页显示与设置页编辑都走它。 */
  premise: string;
  readiness: Readiness;
  /**
   * 角色表（`characters/*.md` 的解析结果，含 id 固定为 protagonist 的主角卡）——角色的真相源。
   * play.json 的 `characters` 是纯元数据，任何界面都不该从那里取角色。
   */
  cast: CharacterDocument[];
  /**
   * 素材声明（`assets/manifest.json`）：立绘的取景/体量/名牌都在这张表上，
   * 舞台按它算立绘摆位——角色卡里没有这些字段。
   */
  manifest: Record<string, AssetMeta>;
}

/** 网关模型清单的一行（Agent 设置页的模型下拉）。 */
export interface GatewayModel {
  id: string;
  name: string;
}

/** 能力目录的一行（Agent 设置页的能力开关，按 group 分组）。 */
export interface AgentCapabilityEntry {
  id: string;
  label: string;
  /** 一句后果（副标题）。界面上不出现工具名。 */
  desc: string;
  group: string;
  /** 分组的中文名（服务端 CAPABILITY_GROUPS 的另一半），设置页表头直接用它。 */
  groupLabel: string;
  /** 常开：渲染成灰字，不给开关。 */
  locked: boolean;
  /** 服务端现在配得出它吗；false 时开关照旧能勾，配好后生效。 */
  available: boolean;
  unavailableNote?: string;
}

/**
 * 剧作家 session 历史快照（只读）：「模型到底吐了什么」——注入的原文、思考、
 * 未经解析的原始 DSL、工具调用。与谱系的分工见 `apps/server/src/history.ts`。
 * 形状与服务端一一对应（web 不得 import server 包，这里是契约的手写副本）。
 */
export interface HistoryEntry {
  /** 轮号（与服务端 `runtime.beatNo` 同尺）。 */
  beat: number;
  /** 轮内自增序号（从 1 起）。 */
  seq: number;
  role: "user" | "thinking" | "assistant" | "toolCall";
  /** role ≠ toolCall 时有：原文，不解析不裁剪。 */
  text?: string;
  /** role = toolCall 时有：工具名。 */
  name?: string;
  /** role = toolCall 时有：参数原样。 */
  args?: Record<string, unknown>;
}

export interface HistoryBeat {
  turn: number;
  entries: HistoryEntry[];
}

/** 设置面板数据（P6）：敏感值只回掩码，原样回传视为「不改」。 */
export interface Settings {
  /**
   * 只读的启动参数：端口 / 监听地址 / 数据目录（改它们要写 exe 同级的 .env 再重启）。
   * `host` 是**当前实际**监听的地址（已算进「允许局域网访问」）；`lanUrls` 是手机该连的地址，
   * 只听本机时为空。
   */
  bootstrap: { port: number; host: string; dataRoot: string; lanUrls: string[] };
  model: {
    modelId: string;
    modelBase: string;
    /** 支持模型清单原文（`STAGE_MODELS`，逗号分隔）；空 = 网关有什么给什么。 */
    models: string;
    baseUrl: string;
    apiKey: string;
    apiKeySet: boolean;
    maxTokens: number;
    contextWindow: number;
    compactRatio: number;
    keepRecentTokens: number;
    nsfwModelId: string;
    nsfwPrompt: string;
  };
  /** 工坊线程的压缩参数（工坊模型可与剧作家不同，阈值因此另有一套）。 */
  workshopContext: { contextWindow: number; compactRatio: number; keepRecentTokens: number };
  /** 单轮超时（毫秒）。 */
  beatTimeoutMs: number;
  /** 公网入口密码：保持掩码 = 不改，清空 = 关闭设防。 */
  password: string;
  passwordSet: boolean;
  /** 允许局域网访问：开着监听 0.0.0.0，关着只听 127.0.0.1。显式 --host / STAGE_HOST 优先于它。 */
  lanAccess: boolean;
  image: {
    enabled: boolean;
    /** 接口格式，不是产品名：gemini 支持垫图，modelslab 只吃一张，openai 完全不支持。 */
    format: "gemini" | "openai" | "modelslab";
    baseUrl: string;
    apiKey: string;
    apiKeySet: boolean;
    model: string;
    /** 出图档位 `1K` / `2K` / `4K`（= 总像素量级），或字面像素 `1536x1024`（openai 格式用）。 */
    size: string;
    concurrency: number;
    timeoutMs: number;
    reference: "none" | "neutral";
  };
  tts: KeyListSettings & { enabled: boolean; proxy: string; baseUrl: string; concurrency: number };
  exa: KeyListSettings & { enabled: boolean; baseUrl: string; proxy: string; timeoutMs: number };
}

/** 多 key 凭据字段：明文不回传，输入框留空即「不改」。 */
export interface KeyListSettings {
  /** 逗号分隔的明文；服务端读侧恒回空串。 */
  keys: string;
  /** 已存 key 的掩码（仅显示）。 */
  masked: string[];
  keyCount: number;
}

/** 创作口径正文（memory/always/craft.md）。新剧目为空——内置准则在剧作家的系统提示里。 */
export interface Craft {
  content: string;
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, init);
  const body = (await res.json().catch(() => null)) as (T & { error?: string }) | null;
  if (!res.ok) throw new Error(body?.error ?? `请求失败: ${res.status}`);
  return body as T;
}

export const api = {
  listPlays: () => request<PlaySummary[]>("/api/plays"),

  playDetail: (id: string) => request<PlayDetail>(`/api/plays/${id}`),

  /** 世界观前提（memory/always/premise.md）：单独读写，不走 play.json。 */
  savePremise: (id: string, content: string) =>
    request<{ ok: true }>(`/api/plays/${id}/premise`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ content }),
    }),

  /** 路线树（P6）：全量节点含废弃分支；打开路线视图时取，操作后刷新。 */
  lineage: (id: string) => request<LineageView>(`/api/plays/${id}/lineage`),

  /**
   * 剧作家原始历史：活动周目最近若干轮的 session 快照（注入原文 / 思考 / 原始 DSL / 工具调用）。
   * 只读——不建 runtime、不改任何状态，所以它是「回看这场戏怎么写出来的」的唯一入口。
   * 读盘落后一轮（轮收束时才落盘），拿不到就回空表，不报错。
   */
  history: (id: string) => request<{ beats: HistoryBeat[] }>(`/api/plays/${id}/history`),

  /** 存档（周目）列表：按最近更新倒序，current 标记当前活动档。 */
  listSaves: (id: string) => request<SaveInfo[]>(`/api/plays/${id}/saves`),

  /** 开始新周目：建一棵空树并切过去，旧档原封不动。 */
  createSave: (id: string, name?: string) =>
    request<SaveInfo>(`/api/plays/${id}/saves`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name }),
    }),

  /** 改名：只改档名标签，不动树。 */
  renameSave: (id: string, saveId: string, name: string) =>
    request<SaveInfo>(`/api/plays/${id}/saves/${saveId}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name }),
    }),

  deleteSave: (id: string, saveId: string) =>
    request<{ ok: boolean }>(`/api/plays/${id}/saves/${saveId}`, { method: "DELETE" }),

  /** 切档：改活动档指针并重建 runtime；演出进行中等当前一轮演完。 */
  activateSave: (id: string, saveId: string) =>
    request<{ ok: boolean }>(`/api/plays/${id}/active`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ saveId }),
    }),

  createPlay: (id: string, title: string) =>
    request<{ id: string }>("/api/plays/create", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ id, title }),
    }),

  importPlay: (zip: File) =>
    request<{ id: string }>("/api/plays/import", { method: "POST", body: zip }),

  deletePlay: (id: string) => request<{ ok: boolean }>(`/api/plays/${id}`, { method: "DELETE" }),

  savePlay: (play: PlayConfig) =>
    request<{ ok: boolean }>(`/api/plays/${play.id}/play`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(play),
    }),

  /**
   * Agent 设置页的模型下拉数据源（服务端转问网关 `/v1/models`）。
   * 网关读不到时这个请求会失败——**不静默退回默认模型**：看到的模型和实际计费的对不上比报错糟。
   */
  agentModels: (refresh = false) =>
    request<{ models: GatewayModel[]; defaultModel: string }>(
      `/api/agents/models${refresh ? "?refresh=1" : ""}`,
    ),

  /**
   * Agent 设置页的能力目录（两个角色共用的那一份真相源）。
   * 按角色返回——「结束本轮」只装给剧作家，给搭台那张卡列出来就是骗人。
   */
  agentCapabilities: () => request<{
    capabilities: Record<"playwriter" | "workshop", AgentCapabilityEntry[]>;
    defaults: Record<string, string[]>;
  }>("/api/agents/capabilities"),

  /** 手动生图（工坊）：POST /api/plays/:id/images 发起异步生成 */
  generateImage: (
    id: string,
    req: {
      kind: "sprite" | "background" | "cg";
      name?: string;
      /** 立绘：哪张立绘（= 目录名）、哪个差分、这三分轴。 */
      spriteId?: string;
      variant?: string;
      framing?: string;
      stature?: string;
      title?: string;
      referenceCharacters?: string[];
      instruction?: string;
    },
  ) =>
    request<{ target: string; path: string; prompt: string }>(`/api/plays/${id}/images`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(req),
    }),

  listAssets: (id: string) => request<Record<string, string[]>>(`/api/plays/${id}/assets`),

  /** 素材元数据表：stem → 描述/标签/情绪（素材页副标题与剧作家提示词同一份）。 */
  assetMeta: (id: string) => request<Record<string, AssetMeta>>(`/api/plays/${id}/assets/meta`),

  /**
   * 写立绘的呈现声明（素材页「立绘」类别的四个下拉）：立绘级（不给 variant）或差分级覆盖。
   * 传 null 就是摘掉那一格、回到缺省。
   */
  declareSprite: (
    id: string,
    req: {
      spriteId: string;
      variant?: string | null;
      framing?: string | null;
      stature?: string | null;
      anchor?: string | null;
      title?: string | null;
    },
  ) =>
    request<{ ok: boolean }>(`/api/plays/${id}/assets/sprite`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(req),
    }),

  uploadAsset: (id: string, kind: string, name: string, data: Blob) =>
    request<{ ok: boolean }>(`/api/plays/${id}/assets?kind=${encodeURIComponent(kind)}&name=${encodeURIComponent(name)}`, {
      method: "POST",
      body: data,
    }),

  deleteAsset: (id: string, kind: string, name: string) =>
    request<{ ok: boolean }>(`/api/plays/${id}/assets?kind=${encodeURIComponent(kind)}&name=${encodeURIComponent(name)}`, {
      method: "DELETE",
    }),

  /** 资源库清单：可按类别过滤 + 关键词搜索（id/标题/描述/标签都参与匹配）。counts 是全量分类计数。 */
  listLibrary: (kind?: string, q?: string) =>
    request<{ entries: LibraryEntry[]; total: number; counts: Record<string, number> }>(
      `/api/library?kind=${encodeURIComponent(kind ?? "")}&q=${encodeURIComponent(q ?? "")}`,
    ),

  /** 从资源库导入到本剧目（复制文件 + 写素材表/角色卡），保存即生效。target=protagonist 落主角卡（连立绘）。 */
  importLibraryAsset: (
    id: string,
    req: { kind: string; entryId: string; variants?: string[]; target?: "protagonist" },
  ) =>
    request<ImportResult>(`/api/plays/${id}/assets/import`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(req),
    }),

  /** 音色查询：条件发给服务端现拉 Fish 对应窗口（空条件 = 基础热门目录）。 */
  voiceCatalog: (query: { language?: string; tags?: string[]; title?: string; refresh?: boolean } = {}) => {
    const params = new URLSearchParams();
    if (query.language) params.set("language", query.language);
    for (const tag of query.tags ?? []) params.append("tag", tag);
    if (query.title) params.set("q", query.title);
    if (query.refresh) params.set("refresh", "1");
    const qs = params.toString();
    return request<VoiceCatalog>(`/api/voices${qs ? `?${qs}` : ""}`);
  },

  /** 单条音色解析：用于"已填 voiceId 但不在热门目录内"的展示与试听。 */
  voice: (voiceId: string) => request<VoiceEntry>(`/api/voices/${voiceId}`),

  /** 音色试听：服务端合成固定样本，返回 media-cache URL。 */
  ttsPreview: (id: string, voiceId: string) =>
    request<{ url: string }>(`/api/plays/${id}/tts-preview`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ voiceId }),
    }),

  /**
   * CG 页的台账：静态素材（assets/cg，带素材表描述）与站内生成的图（带生图 prompt）
   * 合成一张清单，同一 id 只出现一次。只读盘上已有的东西，不触发生图。
   */
  cgCatalog: (id: string) => request<{ entries: CgEntry[] }>(`/api/plays/${id}/cg`),

  listFiles: (id: string) => request<PlayFile[]>(`/api/plays/${id}/files`),

  readFile: (id: string, path: string) =>
    request<{ path: string; content: string }>(`/api/plays/${id}/files?path=${encodeURIComponent(path)}`),

  saveFile: (id: string, path: string, content: string) =>
    request<{ ok: boolean }>(`/api/plays/${id}/files`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ path, content }),
    }),

  deleteFile: (id: string, path: string) =>
    request<{ ok: boolean }>(`/api/plays/${id}/files?path=${encodeURIComponent(path)}`, { method: "DELETE" }),

  /** 创作口径：剧作家每一轮怎么写都听这一份。缺文件时服务端回退默认正文。 */
  craft: (id: string) => request<Craft>(`/api/plays/${id}/craft`),

  saveCraft: (id: string, content: string) =>
    request<{ ok: boolean }>(`/api/plays/${id}/craft`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ content }),
    }),

  /** 玩家输入润色：LLM 按主角角色卡口吻改写（服务端），返回润色后文本。 */
  polish: (id: string, text: string) =>
    request<{ text: string }>(`/api/plays/${id}/polish`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ text }),
    }),

  settings: () => request<Settings>("/api/config"),

  /** 保存设置：服务端就地生效，并回传新的读视图（凭据只回掩码，改完要拿新的掩码）。 */
  saveSettings: (patch: unknown) =>
    request<{ changed: string[]; settings: Settings }>("/api/config", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(patch),
    }),

  /**
   * 一键放行 Windows 防火墙（服务端用自己的 exe 路径写一条入站规则，需要 UAC）。
   * 服务端只认本机请求：局域网上的别人调它会被 403；开发态 / 非 Windows 回 501。
   */
  openFirewall: () =>
    request<{ ok: boolean; message: string }>("/api/lan/open-firewall", { method: "POST" }),
};

/** 素材 URL（静态服务）。name 为文件名或 stem（无扩展名时按目录清单补全）。 */
export function assetUrl(playId: string, dir: string, name: string): string {
  return `/plays/${playId}/assets/${dir}/${name}`;
}

/** 剧目文件预览 URL：PlayFile.path 已含 assets/ 前缀，与静态服务路径一致。 */
export function fileUrl(playId: string, path: string): string {
  return `/plays/${playId}/${path}`;
}

/** 资源库条目内文件的预览 URL（库在服务端只读直出，不经剧目目录）。 */
export function libraryFileUrl(kind: string, id: string, file: string): string {
  return `/library/${kind}/${id}/${encodeURIComponent(file)}`;
}

/**
 * 剧目封面 URL：play.json 里指定的那张，没有就取剧目里第一张背景、其次第一张插图。
 *
 * 剧目库封面与标题画面共用这一处——两处各写一遍「先背景后插图」时，改一处就有一处
 * 显示的是另一张图。指向的图被删了同样回落，不留一个永远裂开的封面。
 */
export function coverUrl(
  playId: string,
  cover: PlayCover | undefined,
  assets: Record<string, string[]> | undefined,
): string | null {
  if (cover) {
    const file = (assets?.[cover.kind] ?? []).includes(cover.id) ? cover.id : undefined;
    if (file) return assetUrl(playId, cover.kind, file);
  }
  const bg = assets?.backgrounds?.[0];
  if (bg) return assetUrl(playId, "backgrounds", bg);
  const cg = assets?.cg?.[0];
  return cg ? assetUrl(playId, "cg", cg) : null;
}
