import { useCallback, useEffect, useRef, useState } from "react";
import type { VoiceCatalog, VoiceEntry } from "@aivn/core";
import { api } from "../api.js";

/** 一次音色筛选（三者 AND，tags 内部 OR）；全空 = 基础热门目录。 */
export interface VoiceFilter {
  language: string;
  tags: string[];
  title: string;
}

export const EMPTY_VOICE_FILTER: VoiceFilter = { language: "", tags: [], title: "" };

function hasCondition(filter: VoiceFilter): boolean {
  return filter.language !== "" || filter.tags.length > 0 || filter.title !== "";
}

/** 音色目录状态：基础目录 + 查询窗口，角色卡（解析当前音色名）与音色库面板共用。 */
export interface VoiceCatalogState {
  /** 基础热门目录：语言下拉的语种来源 + voiceId 名字解析的底座。 */
  catalog: VoiceCatalog | null;
  error: string | null;
  loading: boolean;
  /** 当前筛选（上次 search 的参数）。 */
  filter: VoiceFilter;
  /** 筛选命中 Fish 对应窗口的目录；无筛选时为 null（网格回落到基础目录）。 */
  result: VoiceCatalog | null;
  searching: boolean;
  searchError: string | null;
  /** 换筛选条件：语言/标签/关键词变化时调用（关键词的防抖由调用方做）。 */
  search: (filter: VoiceFilter) => void;
  /** 强制重抓：有筛选重抓当前窗口，没筛选重抓基础目录。 */
  refresh: () => void;
  /**
   * 音色显示名。窗口外的 voiceId（合法的私有/小众音色，如 demo 剧目用的
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

  const [filter, setFilter] = useState<VoiceFilter>(EMPTY_VOICE_FILTER);
  const [result, setResult] = useState<VoiceCatalog | null>(null);
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);
  /** 查询序号：慢响应晚到时不覆盖新查询的结果。 */
  const searchSeq = useRef(0);

  const load = useCallback((refresh: boolean): void => {
    setLoading(true);
    api
      .voiceCatalog({ refresh })
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

  const runSearch = useCallback((next: VoiceFilter, refresh: boolean): void => {
    setFilter(next);
    if (!hasCondition(next)) {
      // 筛选清空 = 基础目录；序号推进，让在途的窗口响应作废
      searchSeq.current += 1;
      setResult(null);
      setSearchError(null);
      setSearching(false);
      return;
    }
    const seq = ++searchSeq.current;
    setSearching(true);
    // 重试一开始就把上一次的错误清掉：留着它会压着网格，看起来像这次也失败了
    setSearchError(null);
    api
      .voiceCatalog({
        language: next.language || undefined,
        tags: next.tags,
        title: next.title || undefined,
        refresh,
      })
      .then((r) => {
        if (seq !== searchSeq.current) return;
        setResult(r);
        setSearchError(null);
      })
      .catch((e: Error) => {
        if (seq !== searchSeq.current) return;
        setSearchError(e.message);
      })
      .finally(() => {
        if (seq === searchSeq.current) setSearching(false);
      });
  }, []);

  const search = useCallback((next: VoiceFilter): void => runSearch(next, false), [runSearch]);

  const refresh = useCallback((): void => {
    if (hasCondition(filter)) runSearch(filter, true);
    else load(true);
  }, [filter, load, runSearch]);

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
    filter,
    result,
    searching,
    searchError,
    search,
    refresh,
    resolve,
    nameOf: (id) => {
      if (!id) return "未设置";
      const entry = catalog?.entries.find((e) => e.id === id) ?? resolved[id];
      return entry ? entry.title : `${id.slice(0, 8)}…`;
    },
  };
}
