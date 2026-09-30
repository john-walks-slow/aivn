import type { AssetMeta, LibraryEntry, LineageView, PlayConfig, VoiceCatalog, VoiceEntry } from "@stage-ai/core";

/** 资源库导入回执（服务端 assetImport 的结果原样）。 */
export interface ImportResult {
  kind: string;
  id: string;
  files: string[];
  characters: string[];
  manifestKeys: string[];
  /** 剧目配置/素材表的改动（进工坊撤销条；REST 直连时前端不用它）。 */
  writes: { path: string; before: string | null; after: string }[];
}

/** 开演前置检查：引擎手上缺的东西直接照出来。 */
export interface Readiness {
  ready: boolean;
  premise: boolean;
  characterSprites: boolean;
  background: boolean;
  hasSession: boolean;
}

/**
 * 缺项文案分两档，别混：
 * - 硬门槛只有 premise：没有它剧本无从写起，开不了演。
 * - 立绘与背景是建议项：没图照样开演（舞台落氛围底色，没有立绘的角色不上台）。
 *
 * 文案直说引擎缺什么，不跟玩家讲「就绪门」那套内部说法。
 */
export const readinessMissing = (r: Readiness): string[] =>
  r.premise ? [] : ["故事前提"];

export const readinessAdvice = (r: Readiness): string[] => [
  ...(r.characterSprites ? [] : ["角色立绘"]),
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
  port: number;
  playsRoot: string;
  model: {
    modelId: string;
    modelBase: string;
    baseUrl: string;
    apiKey: string;
    apiKeySet: boolean;
    maxTokens: number;
    contextWindow: number;
    compactRatio: number;
    keepRecentTokens: number;
  };
  image: {
    enabled: boolean;
    backend: "cpa" | "flow2api";
    model: string;
    size: string;
    concurrency: number;
    timeoutMs: number;
  };
  /** flow2api 后端配置（backend=flow2api 时才生效）：key 只回掩码。 */
  flow: { baseUrl: string; apiKey: string; apiKeySet: boolean; model: string; size: string; timeoutMs: number };
  tts: { enabled: boolean; keysPath: string; proxy: string; baseUrl: string; concurrency: number; keyCount: number };
}

export interface TtsKeys {
  count: number;
  keys: string[];
}

/** 创作口径正文（memory/always/craft.md）。isDefault = 磁盘上没有文件，当前看的是内置默认。 */
export interface Craft {
  content: string;
  isDefault: boolean;
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

  listAssets: (id: string) => request<Record<string, string[]>>(`/api/plays/${id}/assets`),

  /** 素材元数据表：stem → 描述/标签/情绪（素材页副标题与剧作家提示词同一份）。 */
  assetMeta: (id: string) => request<Record<string, AssetMeta>>(`/api/plays/${id}/assets/meta`),

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

  /** 从资源库导入到本剧目（复制文件 + 写素材表/角色卡），保存即生效。target=protagonist 落主角卡。 */
  importLibraryAsset: (
    id: string,
    req: { kind: string; entryId: string; expressions?: string[]; target?: "protagonist" },
  ) =>
    request<ImportResult>(`/api/plays/${id}/assets/import`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(req),
    }),

  /** Fish 公共音色库目录（服务端抓取并缓存）。`refresh` 强制重抓。 */
  voiceCatalog: (refresh = false) => request<VoiceCatalog>(`/api/voices${refresh ? "?refresh=1" : ""}`),

  /** 单条音色解析：用于"已填 voiceId 但不在热门目录内"的展示与试听。 */
  voice: (voiceId: string) => request<VoiceEntry>(`/api/voices/${voiceId}`),

  /** 音色试听：服务端合成固定样本，返回 media-cache URL。 */
  ttsPreview: (id: string, voiceId: string) =>
    request<{ url: string }>(`/api/plays/${id}/tts-preview`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ voiceId }),
    }),

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

  saveSettings: (patch: unknown) =>
    request<{ changed: string[] }>("/api/config", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(patch),
    }),

  ttsKeys: () => request<TtsKeys>("/api/config/tts-keys"),

  saveTtsKeys: (keys: string[]) =>
    request<{ count: number }>("/api/config/tts-keys", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ keys }),
    }),
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
