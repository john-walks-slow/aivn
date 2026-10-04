import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { fetch as undiciFetch, ProxyAgent } from "undici";
import type { VoiceCatalog, VoiceEntry } from "@aivn/core";
import type { ServerConfig } from "./config.js";
import type { SettingsSource } from "./settingsStore.js";

/**
 * Fish Audio 公共音色库客户端。
 *
 * 免费档对**每个查询**各开放一个 1000 条窗口（`accessible_upper_bound`）：全局热门前
 * 1000、`language=ja` 的日语 1000、`tag=anime` 的 1000……窗口彼此不同（全局热门窗口里
 * 日语只有 52 条）。所以带条件的筛选不能在本地目录里做，`list()` 把条件发给 Fish 抓
 * 对应窗口；无条件的基础目录仍是一次全量抓取落盘（12h 快照），它是语言下拉与 voiceId
 * 名字解析的底座。
 *
 * 抓取失败但盘上有基础目录快照时沿用快照（标 `stale`），没有则把错误如实抛给调用方。
 * 失败后静默几分钟，不让每次调用都重付一遍抓取的代价。窗口只进内存缓存（同样 12h，
 * 外加并发去重与条数上限），不落盘——重启重抓一次几秒钟，目录文件不跟着膨胀。
 */

const PAGE_SIZE = 100;
/** 免费档可达窗口 1000；再多翻页返回空数组，只是多打 10 次无效请求。 */
const MAX_PAGES = 10;
const CACHE_TTL_MS = 12 * 60 * 60 * 1000;
/** 查询窗口的内存缓存上限：每窗最多 1000 条，16 窗也就几 MB。 */
const WINDOW_CACHE_LIMIT = 16;
/**
 * 刷新失败后的静默期。
 *
 * 抓不到时 `fetchedAt` 不推进（推进了就等于把旧快照谎称成新的），于是每次调用都会重新
 * 发起一次完整刷新——代理不通时每次调用都白等三十多秒。失败一次就静默几分钟，
 * 让「上游坏了」不至于变成「每次查询都卡」。
 */
const FAILURE_BACKOFF_MS = 5 * 60 * 1000;
const TIMEOUT_MS = 30_000;

interface FishModelEntity {
  _id?: unknown;
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

/** Fish 的示例样本：作者给这个音色录的预渲染音频与它念的文本。 */
interface FishModelSample {
  audio?: unknown;
  text?: unknown;
}

interface FishModelPage {
  total?: unknown;
  items?: FishModelEntity[];
}

function str(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function strList(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

function firstSample(raw: FishModelEntity): FishModelSample | undefined {
  return Array.isArray(raw.samples) ? (raw.samples[0] as FishModelSample | undefined) : undefined;
}

function toEntry(raw: FishModelEntity): VoiceEntry | null {
  const id = str(raw._id);
  // 未训练完的模型进不了 TTS，进目录只会让用户选到合成失败的音色
  if (!/^[0-9a-f]{32}$/.test(id) || raw.state !== "trained") return null;
  return {
    id,
    title: str(raw.title) || id.slice(0, 8),
    description: str(raw.description),
    languages: strList(raw.languages),
    tags: strList(raw.tags),
    likes: typeof raw.like_count === "number" ? raw.like_count : 0,
    cover: str(raw.cover_image),
  };
}

/** 发一个 GET JSON 请求（测试注入假实现，绕开网络与 key）。 */
export type VoiceFetcher = <T>(path: string) => Promise<T>;

/** 一个音色的试听素材——官方的示例音频与示例文本，都在音色自己的语言里。 */
export interface VoiceSample {
  /** 作者预渲染的示例音频 URL（签名地址，一小时过期，必须落盘后再回放）；空串 = 没传样本。 */
  audio: string;
  /** 官方示例文本（音色母语）；作者一样没写时为空，由调用方按语言兜底。 */
  text: string;
  /** 音色语言标签，兜底文案据此选语言。 */
  languages: string[];
}

/**
 * 一次音色查询。条件之间是 AND（日语 且 带 anime 标签 且 名字含雷姆）；
 * `tags` 内部是 OR——Fish 的多 tag 参数就是并集。
 */
export interface VoiceQuery {
  /** ISO 639-1 小写两位码（Fish 大小写敏感：`JA` 直接 0 条，这里统一转小写）。 */
  language?: string;
  /** Fish 标签**原样**（同样大小写敏感：`anime` 100 条、`ANIME` 只有 3 条）；≤4 个。 */
  tags?: string[];
  /** 全库标题搜索（子串、不分大小写）——热门窗口之外的音色也只有这条路够得到。 */
  title?: string;
}

interface NormalizedVoiceQuery {
  language: string;
  tags: string[];
  title: string;
}

function normalizeVoiceQuery(query: VoiceQuery): NormalizedVoiceQuery {
  return {
    language: (query.language ?? "").trim().toLowerCase(),
    tags: [...new Set((query.tags ?? []).map((tag) => tag.trim()).filter(Boolean))].sort(),
    title: (query.title ?? "").trim().toLowerCase(),
  };
}

/** 查询的缓存键；空串 = 无条件（基础目录）。 */
function voiceQueryKey(query: VoiceQuery): string {
  const q = normalizeVoiceQuery(query);
  const parts: string[] = [];
  if (q.language) parts.push(`language=${q.language}`);
  for (const tag of q.tags) parts.push(`tag=${tag}`);
  if (q.title) parts.push(`title=${q.title}`);
  return parts.join("&");
}

/** 拼到 `/model?…&sort_by=score` 后面的过滤参数（值全部 encodeURIComponent）。 */
function voiceQuerySuffix(query: VoiceQuery): string {
  const q = normalizeVoiceQuery(query);
  const parts: string[] = [];
  if (q.language) parts.push(`language=${encodeURIComponent(q.language)}`);
  for (const tag of q.tags) parts.push(`tag=${encodeURIComponent(tag)}`);
  if (q.title) parts.push(`title=${encodeURIComponent(q.title)}`);
  return parts.length > 0 ? `&${parts.join("&")}` : "";
}

export class VoiceCatalogService {
  /** 出口代理：按当前设置里的地址惰性建，地址改了下次请求就用新的。 */
  private dispatcher: { proxy: string; agent: ProxyAgent } | null = null;
  private readonly cacheFile: string;
  private readonly fetchJson: VoiceFetcher;
  /** 抓取中的共享 Promise——并发请求只打一轮 Fish。 */
  private inflight: Promise<VoiceCatalog> | null = null;
  /** 查询窗口的内存缓存（键见 voiceQueryKey）。 */
  private readonly windows = new Map<string, VoiceCatalog>();
  /** 抓取中的查询窗口——同一条件的并发请求只打一轮 Fish。 */
  private readonly windowInflight = new Map<string, Promise<VoiceCatalog>>();
  /** 最近一次刷新失败的时刻，用于静默期（见 FAILURE_BACKOFF_MS）。 */
  private lastFailureAt = 0;

  constructor(
    private readonly settings: SettingsSource,
    cacheFile: string,
    fetchJson?: VoiceFetcher,
  ) {
    this.cacheFile = cacheFile;
    this.fetchJson = fetchJson ?? this.createFetcher();
  }

  /** 当前设置，每次现取：面板改完地址/密钥，这里立刻跟上（不再需要重启）。 */
  private get config(): ServerConfig {
    return this.settings.get();
  }

  private proxyAgent(proxy: string): ProxyAgent | undefined {
    if (proxy === "") return undefined;
    if (this.dispatcher?.proxy !== proxy) this.dispatcher = { proxy, agent: new ProxyAgent(proxy) };
    return this.dispatcher.agent;
  }

  /**
   * 取音色目录。`refresh` 强制重抓；否则命中 TTL 内的磁盘快照直接返回。
   * 抓取失败时：盘上有旧快照就用（`stale: true`），否则抛出——不做静默降级。
   */
  async get(refresh = false): Promise<VoiceCatalog> {
    if (!refresh) {
      const cached = await this.readCache();
      if (cached && Date.now() - cached.fetchedAt < CACHE_TTL_MS) return { ...cached, stale: false };
      if (cached) return this.refreshOrStale(cached);
    } else {
      // 用户显式点刷新（音色库面板那个按钮）不在静默期内，免得按了没反应
      this.lastFailureAt = 0;
    }
    return this.refreshOrStale(null);
  }

  /**
   * 按条件查询一个窗口（UI 语言/标签筛选、标题搜索、工坊 `list_voices` 共用）。
   *
   * 无条件 = 基础目录（`get()`，磁盘快照那条路）。窗口查询允许空结果——标题搜不到是
   * 正常答案，不像基础目录把空目录当错误。失败如实抛出，不做静默降级。
   */
  async list(query: VoiceQuery, refresh = false): Promise<VoiceCatalog> {
    const key = voiceQueryKey(query);
    if (key === "") return this.get(refresh);
    if (!refresh) {
      const hit = this.windows.get(key);
      if (hit && Date.now() - hit.fetchedAt < CACHE_TTL_MS) return hit;
    }
    // refresh=true 也复用在途请求：它本来就在抓这份新数据
    let pending = this.windowInflight.get(key);
    if (!pending) {
      pending = this.fetchQueryWindow(key, query).finally(() => {
        this.windowInflight.delete(key);
      });
      this.windowInflight.set(key, pending);
    }
    return pending;
  }

  private async fetchQueryWindow(key: string, query: VoiceQuery): Promise<VoiceCatalog> {
    // 标题搜索通常是窄查询，先探一页；语言/标签窗口通常拉满 1000 条，直接并发打完
    const probeFirst = (query.title ?? "").trim() !== "";
    const { entries } = await this.fetchEntries(voiceQuerySuffix(query), probeFirst);
    const catalog: VoiceCatalog = {
      entries,
      fetchedAt: Date.now(),
      totalAvailable: entries.length,
      stale: false,
    };
    this.windows.set(key, catalog);
    // FIFO 收口：最旧的窗口先让位（12h TTL 下进出频率很低，不值得正经 LRU）
    while (this.windows.size > WINDOW_CACHE_LIMIT) {
      let oldest: string | null = null;
      let oldestAt = Infinity;
      for (const [k, c] of this.windows) {
        if (c.fetchedAt < oldestAt) {
          oldest = k;
          oldestAt = c.fetchedAt;
        }
      }
      if (oldest === null) break;
      this.windows.delete(oldest);
    }
    console.log(`[aivn] 音色窗口已抓取: ${key || "基础目录"} ${entries.length} 条`);
    return catalog;
  }

  /** 按 id 解析单条音色——用于"已填 voiceId 但不在热门目录内"的展示与试听。 */
  async resolve(id: string): Promise<VoiceEntry> {
    return this.entryOf(id, await this.fetchModel(id));
  }

  /**
   * 取试听素材（素材管理页「试听」）。
   *
   * 现取、不进 12 小时目录快照：官方样本音频是签名 URL，一小时就过期，存进快照只会是死链。
   * 样本音频由作者预渲染——音色母语、零配额、点了就响；没传样本的音色（目录里约 2%）
   * 才退回拿官方示例文本自己合成。
   */
  async sample(id: string): Promise<VoiceSample> {
    const raw = await this.fetchModel(id);
    // 未训练/不存在的音色连合成都进不去，先在这里如实报错，别把死链或空文本带下去
    this.entryOf(id, raw);
    const sample = firstSample(raw);
    return {
      audio: str(sample?.audio),
      text: str(raw.default_text).trim() || str(sample?.text).trim(),
      languages: strList(raw.languages),
    };
  }

  private fetchModel(id: string): Promise<FishModelEntity> {
    return this.fetchJson<FishModelEntity>(`/model/${id}`);
  }

  private entryOf(id: string, raw: FishModelEntity): VoiceEntry {
    const entry = toEntry(raw);
    if (!entry) throw new Error(`音色 ${id} 不存在或未训练完成`);
    return entry;
  }

  private refreshOrStale(fallback: VoiceCatalog | null): Promise<VoiceCatalog> {
    if (Date.now() - this.lastFailureAt >= FAILURE_BACKOFF_MS) {
      this.inflight ??= this.refresh()
        .catch((error: unknown) => {
          this.lastFailureAt = Date.now();
          throw error;
        })
        .finally(() => {
          this.inflight = null;
        });
    }
    // 静默期内不再打上游：有快照就用旧数据并标 stale，没有就如实报错（不编一个假错误）
    if (!this.inflight) {
      if (fallback) return Promise.resolve({ ...fallback, stale: true });
      return Promise.reject(new Error("音色库暂时拉不到，本机也没有快照"));
    }
    return this.inflight.catch((error: unknown) => {
      if (!fallback) throw error;
      const message = error instanceof Error ? error.message : String(error);
      console.warn(`[aivn] 音色库抓取失败（沿用磁盘快照）: ${message}`);
      return { ...fallback, stale: true };
    });
  }

  /**
   * 抓一个窗口的全部条目。
   *
   * `probeFirst` 是给标题搜索用的：它通常只有一两页，先探第 1 页、满页才补剩下的
   * （搜「雷姆」1.2s 就回来）；语言/标签窗口通常拉满 1000 条，10 页直接并发打完
   * 只用一轮往返（本机实测 ~6s，探路再补要多花一轮）。
   */
  private async fetchEntries(
    suffix: string,
    probeFirst: boolean,
  ): Promise<{ entries: VoiceEntry[]; total: number }> {
    const page = (n: number): Promise<FishModelPage> =>
      this.fetchJson<FishModelPage>(
        `/model?page_size=${PAGE_SIZE}&page_number=${n}&self=false&sort_by=score${suffix}`,
      );
    const raws: FishModelEntity[] = [];
    let total = 0;
    if (probeFirst) {
      const first = await page(1);
      total = typeof first.total === "number" ? first.total : 0;
      raws.push(...(first.items ?? []));
      if (raws.length >= PAGE_SIZE) {
        const rest = await Promise.all(
          Array.from({ length: MAX_PAGES - 1 }, (_, i) => page(i + 2)),
        );
        for (const body of rest) raws.push(...(body.items ?? []));
      }
    } else {
      const pages = await Promise.all(Array.from({ length: MAX_PAGES }, (_, i) => page(i + 1)));
      total = typeof pages[0]?.total === "number" ? (pages[0]!.total as number) : 0;
      for (const body of pages) raws.push(...(body.items ?? []));
    }
    const byId = new Map<string, VoiceEntry>();
    for (const raw of raws) {
      const entry = toEntry(raw);
      if (entry) byId.set(entry.id, entry);
    }
    return {
      entries: [...byId.values()].sort((a, b) => b.likes - a.likes),
      total: total || raws.length,
    };
  }

  private async refresh(): Promise<VoiceCatalog> {
    const { entries, total } = await this.fetchEntries("", false);
    if (entries.length === 0) throw new Error("音色库返回空目录");
    const catalog: VoiceCatalog = {
      entries,
      fetchedAt: Date.now(),
      totalAvailable: total,
      stale: false,
    };
    await this.writeCache(catalog);
    console.log(`[aivn] 音色库已更新: ${catalog.entries.length} 条 / 全库 ${total}`);
    return catalog;
  }

  /** 多 key 轮询：GET 与合成共用 key 池，401/402/429 时换下一把。 */
  private createFetcher(): VoiceFetcher {
    return async <T>(path: string): Promise<T> => {
      const keys = this.config.tts.keys;
      if (keys.length === 0) throw new Error("未配置 STAGE_TTS_KEYS，无法获取音色库");
      let lastError: unknown = null;
      for (const key of keys) {
        try {
          const res = await undiciFetch(`${this.config.tts.baseUrl}${path}`, {
            headers: { authorization: `Bearer ${key}` },
            dispatcher: this.proxyAgent(this.config.tts.proxy),
            signal: AbortSignal.timeout(TIMEOUT_MS),
          });
          if (!res.ok) {
            const body = await res.text().catch(() => "");
            const message = `fish-tts HTTP ${res.status}: ${body.slice(0, 200)}`;
            // 4xx 多为 key 自身问题，换下一把；5xx 是服务端故障，换 key 也无解
            if (res.status >= 500) throw new Error(message);
            lastError = new Error(message);
            continue;
          }
          return (await res.json()) as T;
        } catch (error) {
          lastError = error;
        }
      }
      throw new Error(
        `音色库请求全部 key 失败: ${lastError instanceof Error ? lastError.message : String(lastError)}`,
      );
    };
  }

  private async readCache(): Promise<VoiceCatalog | null> {
    if (!existsSync(this.cacheFile)) return null;
    try {
      const parsed = JSON.parse(await readFile(this.cacheFile, "utf8")) as VoiceCatalog;
      return Array.isArray(parsed.entries) && parsed.entries.length > 0 ? parsed : null;
    } catch {
      return null;
    }
  }

  /** tmp + rename 原子写：并发刷新不会写出半截 JSON。 */
  private async writeCache(catalog: VoiceCatalog): Promise<void> {
    const tmp = `${this.cacheFile}.${randomUUID().slice(0, 8)}.tmp`;
    try {
      await mkdir(dirname(this.cacheFile), { recursive: true });
      await writeFile(tmp, JSON.stringify(catalog));
      await rename(tmp, this.cacheFile);
    } catch (error) {
      console.warn(`[aivn] 音色库快照落盘失败（不影响本次使用）: ${String(error)}`);
    }
  }
}
