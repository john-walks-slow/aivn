/**
 * Fish Audio 公共音色库客户端（`list_voices` 与音色库面板的后端），两个宿主共用一份。
 *
 * 免费档对**每个查询**各开放一个 1000 条窗口（`accessible_upper_bound`）：全局热门前 1000、
 * `language=ja` 的 1000、`tag=anime` 的 1000……窗口彼此不同（全局热门窗口里日语只有 52 条）。
 * 所以带条件的筛选不能在本地目录里做——`list()` 把条件发给 Fish 抓对应窗口，
 * 窗口进内存缓存（12h、上限 16 窗、同窗并发只打一轮）。
 *
 * **出网方式归宿主**：key 轮询、代理、超时都封在传进来的 `fetchJson` 里
 * （服务端按设置现取地址与代理，插件用全局 fetch + 共用 key 池）。这里只管分页、解析与缓存。
 * 磁盘快照与试听样本是**服务端独有**的两层（插件没有数据目录，样本是素材管理页的事），
 * 它们挂在 `VoiceCatalogService` 上，不进这个包。
 */
import type { VoiceEntry } from "@aivn/core";

/** 上游一页抓多少条（与工具面「一页列几条」无关）。 */
export const PAGE_SIZE = 100;
/** 免费档可达窗口 1000 条；再多翻页返回空数组，只是多打几次无效请求。 */
export const MAX_PAGES = 10;
/** 快照与窗口的保鲜期：12 小时。 */
export const VOICE_CACHE_TTL_MS = 12 * 60 * 60 * 1000;
/** 窗口缓存上限：每窗最多 1000 条，16 窗也就几 MB。 */
export const WINDOW_CACHE_LIMIT = 16;

/**
 * 一次音色查询。条件之间是 AND（日语 且 带 anime 标签 且 名字含雷姆）；`tags` 内部是 OR
 * ——Fish 的多 tag 参数就是并集。
 */
export interface VoiceQuery {
  /** ISO 639-1 小写两位码（Fish 大小写敏感：`JA` 直接 0 条，这里统一转小写）。 */
  language?: string;
  /** Fish 标签**原样**（同样大小写敏感：`anime` 100 条、`ANIME` 只有 3 条）。 */
  tags?: string[];
  /** 全库标题搜索（子串、不分大小写）——热门窗口之外的音色也只有这条路够得到。 */
  title?: string;
}

/** 一个条件窗口。 */
export interface VoiceWindow {
  entries: VoiceEntry[];
  /** 上游报的匹配总数（可能大于实际抓回的条数）。 */
  total: number;
}

/** 取上游 JSON 的口子（key 轮询、代理、超时都在宿主的实现里）。 */
export type VoiceJsonFetcher = <T>(path: string) => Promise<T>;

/** Fish 的示例样本：作者给这个音色录的预渲染音频与它念的文本。 */
export interface VoiceSample {
  /** 作者预渲染的示例音频 URL（签名地址，一小时过期，必须落盘后再回放）；空串 = 没传样本。 */
  audio: string;
  /** 示例文本：官方给的优先，其次作者录样本时写的；都没有就是空串（由调用方按语言兜底）。 */
  text: string;
  /** 音色语言标签（试听文案据此选语言）。 */
  languages: string[];
}

interface RawVoice {
  _id?: unknown;
  id?: unknown;
  title?: unknown;
  description?: unknown;
  languages?: unknown;
  tags?: unknown;
  like_count?: unknown;
  cover_image?: unknown;
  state?: unknown;
  default_text?: unknown;
  samples?: unknown;
}

interface RawPage {
  total?: unknown;
  items?: unknown[];
}

function str(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function strList(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

/** 作者给这个音色录的第一条示例（没有则 undefined）。 */
export function firstVoiceSample(raw: unknown): { audio: string; text: string } | undefined {
  const samples = (raw as RawVoice)?.samples;
  if (!Array.isArray(samples) || samples.length === 0) return undefined;
  const sample = samples[0] as { audio?: unknown; text?: unknown } | undefined;
  return { audio: str(sample?.audio), text: str(sample?.text) };
}

/**
 * 试听素材：官方示例文本优先，其次作者录样本时写的那句，再没有就空串。
 *
 * 示例音频是**签名地址、一小时过期**，所以它只能现取现用（不进任何快照）。
 */
export function readVoiceSample(raw: unknown): VoiceSample {
  const item = (raw ?? {}) as RawVoice;
  const sample = firstVoiceSample(item);
  return {
    audio: sample?.audio ?? "",
    text: str(item.default_text).trim() || (sample?.text ?? "").trim(),
    languages: strList(item.languages),
  };
}

/**
 * 响应体是外部数据：逐字段认，认不出的丢掉。
 *
 * 两道闸都不能省：**未训练完的模型进不了 TTS**（进目录只会让用户选到合成失败的音色），
 * id 必须是 32 位 hex 的 reference_id（别的形状合成都进不去）。
 */
export function toVoiceEntry(raw: unknown): VoiceEntry | null {
  const item = (raw ?? {}) as RawVoice;
  const id = str(item._id) || str(item.id);
  if (!/^[0-9a-f]{32}$/.test(id) || item.state !== "trained") return null;
  return {
    id,
    title: str(item.title) || id.slice(0, 8),
    description: str(item.description),
    languages: strList(item.languages),
    tags: strList(item.tags),
    likes: typeof item.like_count === "number" ? item.like_count : 0,
    cover: str(item.cover_image),
  };
}

interface NormalizedQuery {
  language: string;
  tags: string[];
  title: string;
}

function normalize(query: VoiceQuery): NormalizedQuery {
  return {
    language: (query.language ?? "").trim().toLowerCase(),
    tags: [...new Set((query.tags ?? []).map((tag) => tag.trim()).filter(Boolean))].sort(),
    title: (query.title ?? "").trim().toLowerCase(),
  };
}

/** 窗口的缓存键；空串 = 无条件（基础目录）。 */
export function voiceQueryKey(query: VoiceQuery): string {
  const q = normalize(query);
  const parts: string[] = [];
  if (q.language) parts.push(`language=${q.language}`);
  for (const tag of q.tags) parts.push(`tag=${tag}`);
  if (q.title) parts.push(`title=${q.title}`);
  return parts.join("&");
}

/** 拼到 `/model?…&sort_by=score` 后面的过滤参数（值全部 encodeURIComponent）。 */
export function voiceQuerySuffix(query: VoiceQuery): string {
  const q = normalize(query);
  const parts: string[] = [];
  if (q.language) parts.push(`language=${encodeURIComponent(q.language)}`);
  for (const tag of q.tags) parts.push(`tag=${encodeURIComponent(tag)}`);
  if (q.title) parts.push(`title=${encodeURIComponent(q.title)}`);
  return parts.length > 0 ? `&${parts.join("&")}` : "";
}

/**
 * 抓一个窗口的全部条目。
 *
 * `probeFirst` 是给标题搜索用的：它通常只有一两页，先探第 1 页、满页才补剩下的
 * （搜「雷姆」1.2s 就回来）；语言/标签窗口通常拉满 1000 条，10 页直接并发打完只用一轮往返
 * （实测 ~6s，探路再补要多花一轮）。
 */
export async function fetchVoiceWindow(
  fetchJson: VoiceJsonFetcher,
  suffix: string,
  probeFirst: boolean,
): Promise<VoiceWindow> {
  const page = (n: number): Promise<RawPage> =>
    fetchJson<RawPage>(`/model?page_size=${PAGE_SIZE}&page_number=${n}&self=false&sort_by=score${suffix}`);
  const raws: RawVoice[] = [];
  let total = 0;
  if (probeFirst) {
    const first = await page(1);
    total = typeof first.total === "number" ? first.total : 0;
    raws.push(...((first.items ?? []) as RawVoice[]));
    if (raws.length >= PAGE_SIZE) {
      const rest = await Promise.all(Array.from({ length: MAX_PAGES - 1 }, (_, i) => page(i + 2)));
      for (const body of rest) raws.push(...((body.items ?? []) as RawVoice[]));
    }
  } else {
    const pages = await Promise.all(Array.from({ length: MAX_PAGES }, (_, i) => page(i + 1)));
    total = typeof pages[0]?.total === "number" ? (pages[0]!.total as number) : 0;
    for (const body of pages) raws.push(...((body.items ?? []) as RawVoice[]));
  }
  const byId = new Map<string, VoiceEntry>();
  for (const raw of raws) {
    const entry = toVoiceEntry(raw);
    if (entry) byId.set(entry.id, entry);
  }
  const entries = [...byId.values()].sort((a, b) => b.likes - a.likes);
  return { entries, total: total || raws.length };
}

/** 带窗口缓存与并发去重的音色库客户端。 */
export class VoiceClient {
  private readonly windows = new Map<string, { at: number; window: VoiceWindow }>();
  private readonly inflight = new Map<string, Promise<VoiceWindow>>();

  constructor(private readonly fetchJson: VoiceJsonFetcher) {}

  /**
   * 取一个条件窗口；同窗并发只打一轮上游。
   *
   * `refresh` 跳过缓存读（用户显式点刷新时用），但在途请求照样复用——它本来就在抓新数据。
   */
  list(query: VoiceQuery, refresh = false): Promise<VoiceWindow> {
    const key = voiceQueryKey(query);
    if (!refresh) {
      const hit = this.windows.get(key);
      if (hit && Date.now() - hit.at < VOICE_CACHE_TTL_MS) return Promise.resolve(hit.window);
    }
    const running = this.inflight.get(key);
    if (running) return running;
    const job = fetchVoiceWindow(this.fetchJson, voiceQuerySuffix(query), (query.title ?? "").trim() !== "")
      .then((window) => {
        this.remember(key, window);
        return window;
      })
      .finally(() => this.inflight.delete(key));
    this.inflight.set(key, job);
    return job;
  }

  private remember(key: string, window: VoiceWindow): void {
    this.windows.set(key, { at: Date.now(), window });
    while (this.windows.size > WINDOW_CACHE_LIMIT) {
      const oldest = this.windows.keys().next().value;
      if (oldest === undefined) break;
      this.windows.delete(oldest);
    }
  }
}
