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
};

/** 素材 URL（静态服务）。name 为文件名或 stem（无扩展名时按目录清单补全）。 */
export function assetUrl(playId: string, dir: string, name: string): string {
  return `/plays/${playId}/assets/${dir}/${name}`;
}
