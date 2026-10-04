import { useCallback, useEffect, useRef, useState } from "react";
import type { VoiceCatalog, VoiceEntry } from "@aivn/core";
import { api } from "../api.js";

/** 音色目录状态：懒加载一次，角色卡（解析当前音色名）与音色库面板共用。 */
export interface VoiceCatalogState {
  catalog: VoiceCatalog | null;
  error: string | null;
  loading: boolean;
  /** 强制重抓 Fish 目录。 */
  refresh: () => void;
  /**
   * 音色显示名。目录外的 voiceId（合法的私有/小众音色，如 demo 剧目用的
   * 萝莉萌妹）回落到按 id 单条解析，取不到就显示短 id——不假装是"未设置"。
   */
  nameOf: (id: string | undefined) => string;
  /** 登记一个待解析的 voiceId（角色卡挂载时调用）。 */
  resolve: (id: string | undefined) => void;
}

export function useVoiceCatalog(): VoiceCatalogState {
  const [catalog, setCatalog] = useState<VoiceCatalog | null>(null);
  const [resolved, setResolved] = useState<Record<string, VoiceEntry>>({});
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  /** 已发起过解析的 id（含失败的）——否则解析不到的 id 会每次渲染重发一次请求。 */
  const attempted = useRef(new Set<string>());

  const load = useCallback((refresh: boolean): void => {
    setLoading(true);
    api
      .voiceCatalog(refresh)
      .then((next) => {
        setCatalog(next);
        setError(null);
      })
      .catch((e: Error) => setError(e.message))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    load(false);
  }, [load]);

  const resolve = useCallback(
    (id: string | undefined): void => {
      if (!id || !catalog || attempted.current.has(id)) return;
      if (catalog.entries.some((e) => e.id === id)) return;
      attempted.current.add(id);
      api
        .voice(id)
        .then((entry) => setResolved((prev) => ({ ...prev, [id]: entry })))
        // 解析不到不是错误——voiceId 仍可试听，只是面板里没有它的名字与封面
        .catch(() => {});
    },
    [catalog],
  );

  return {
    catalog,
    error,
    loading,
    refresh: () => load(true),
    resolve,
    nameOf: (id) => {
      if (!id) return "未设置";
      const entry = catalog?.entries.find((e) => e.id === id) ?? resolved[id];
      return entry ? entry.title : `${id.slice(0, 8)}…`;
    },
  };
}
