import type { PlayConfig } from "@stage-ai/core";

/** 就绪门（D13）：开演前置检查。 */
export interface Readiness {
  ready: boolean;
  premise: boolean;
  characterSprites: boolean;
  background: boolean;
  hasSession: boolean;
}

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
}

export interface PlayDetail {
  play: PlayConfig;
  readiness: Readiness;
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

  uploadAsset: (id: string, kind: string, name: string, data: Blob) =>
    request<{ ok: boolean }>(`/api/plays/${id}/assets?kind=${encodeURIComponent(kind)}&name=${encodeURIComponent(name)}`, {
      method: "POST",
      body: data,
    }),

  deleteAsset: (id: string, kind: string, name: string) =>
    request<{ ok: boolean }>(`/api/plays/${id}/assets?kind=${encodeURIComponent(kind)}&name=${encodeURIComponent(name)}`, {
      method: "DELETE",
    }),

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

  /** 玩家输入润色：LLM 按主角角色卡口吻改写（服务端），返回润色后文本。 */
  polish: (id: string, text: string) =>
    request<{ text: string }>(`/api/plays/${id}/polish`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ text }),
    }),
};

/** 素材 URL（静态服务）。name 为文件名或 stem（无扩展名时按目录清单补全）。 */
export function assetUrl(playId: string, dir: string, name: string): string {
  return `/plays/${playId}/assets/${dir}/${name}`;
}
