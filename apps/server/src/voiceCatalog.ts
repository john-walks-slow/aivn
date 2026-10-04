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
 * 公共库免费档只开放热度前 1000 条（`accessible_upper_bound`），分页 100/页共 10 页。
 * 策略是**全量抓一次落盘**再在内存里搜索/筛选——每次筛选都打 Fish 既慢又烧请求。
 * 10 页并发抓取（一轮来回，不是十轮）；抓取失败但盘上有快照时沿用快照（标 `stale`），
 * 没有则把错误如实抛给调用方。失败后静默几分钟，不让每次调用都重付一遍抓取的代价。
 */

const PAGE_SIZE = 100;
/** 免费档可达窗口 1000；再多翻页返回空数组，只是多打 10 次无效请求。 */
const MAX_PAGES = 10;
const CACHE_TTL_MS = 12 * 60 * 60 * 1000;
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

export class VoiceCatalogService {
  /** 出口代理：按当前设置里的地址惰性建，地址改了下次请求就用新的。 */
  private dispatcher: { proxy: string; agent: ProxyAgent } | null = null;
  private readonly cacheFile: string;
  private readonly fetchJson: VoiceFetcher;
  /** 抓取中的共享 Promise——并发请求只打一轮 Fish。 */
  private inflight: Promise<VoiceCatalog> | null = null;
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

  private async refresh(): Promise<VoiceCatalog> {
    // 10 页一次并发打完，不逐页等：串行时每页一个来回，翻完要三十多秒（本机实测），
    // 而这些页彼此独立、谁也不依赖谁。超出窗口的页返回空数组，MAX_PAGES 收口。
    const pages = await Promise.all(
      Array.from({ length: MAX_PAGES }, (_, i) =>
        this.fetchJson<FishModelPage>(
          `/model?page_size=${PAGE_SIZE}&page_number=${i + 1}&self=false&sort_by=score`,
        ),
      ),
    );
    const byId = new Map<string, VoiceEntry>();
    let total = 0;
    for (const [index, body] of pages.entries()) {
      if (index === 0) total = typeof body.total === "number" ? body.total : 0;
      for (const raw of body.items ?? []) {
        const entry = toEntry(raw);
        if (entry) byId.set(entry.id, entry);
      }
    }
    if (byId.size === 0) throw new Error("音色库返回空目录");
    const catalog: VoiceCatalog = {
      entries: [...byId.values()].sort((a, b) => b.likes - a.likes),
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
