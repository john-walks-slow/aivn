import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { fetch as undiciFetch, ProxyAgent } from "undici";
import type { VoiceCatalog, VoiceEntry } from "@stage-ai/core";
import type { ServerConfig } from "./config.js";
import { readTtsKeys } from "./tts.js";

/**
 * Fish Audio 公共音色库客户端。
 *
 * 公共库免费档只开放热度前 1000 条（`accessible_upper_bound`），分页 100/页共 10 页。
 * 策略是**全量抓一次落盘**再在内存里搜索/筛选——每次筛选都打 Fish 既慢又烧请求。
 * 抓取失败但盘上有快照时沿用快照（标 `stale`），没有则把错误如实抛给调用方。
 */

const PAGE_SIZE = 100;
/** 免费档可达窗口 1000；再多翻页返回空数组，只是多打 10 次无效请求。 */
const MAX_PAGES = 10;
const CACHE_TTL_MS = 12 * 60 * 60 * 1000;
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
}

interface FishModelPage {
  total?: unknown;
  items?: FishModelEntity[];
}

function str(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function toEntry(raw: FishModelEntity): VoiceEntry | null {
  const id = str(raw._id);
  // 未训练完的模型进不了 TTS，进目录只会让用户选到合成失败的音色
  if (!/^[0-9a-f]{32}$/.test(id) || raw.state !== "trained") return null;
  return {
    id,
    title: str(raw.title) || id.slice(0, 8),
    description: str(raw.description),
    languages: Array.isArray(raw.languages) ? raw.languages.filter((c): c is string => typeof c === "string") : [],
    tags: Array.isArray(raw.tags) ? raw.tags.filter((t): t is string => typeof t === "string") : [],
    likes: typeof raw.like_count === "number" ? raw.like_count : 0,
    cover: str(raw.cover_image),
  };
}

/** 发一个 GET JSON 请求（测试注入假实现，绕开网络与 key）。 */
export type VoiceFetcher = <T>(path: string) => Promise<T>;

export class VoiceCatalogService {
  private readonly dispatcher: ProxyAgent | undefined;
  private readonly cacheFile: string;
  private readonly fetchJson: VoiceFetcher;
  /** 抓取中的共享 Promise——并发请求只打一轮 Fish。 */
  private inflight: Promise<VoiceCatalog> | null = null;

  constructor(
    private readonly config: ServerConfig,
    cacheFile: string,
    fetchJson?: VoiceFetcher,
  ) {
    if (config.tts.proxy) this.dispatcher = new ProxyAgent(config.tts.proxy);
    this.cacheFile = cacheFile;
    this.fetchJson = fetchJson ?? this.createFetcher();
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
    }
    return this.refreshOrStale(null);
  }

  /** 按 id 解析单条音色——用于"已填 voiceId 但不在热门目录内"的展示与试听。 */
  async resolve(id: string): Promise<VoiceEntry> {
    const entry = toEntry(await this.fetchJson<FishModelEntity>(`/model/${id}`));
    if (!entry) throw new Error(`音色 ${id} 不存在或未训练完成`);
    return entry;
  }

  private refreshOrStale(fallback: VoiceCatalog | null): Promise<VoiceCatalog> {
    this.inflight ??= this.refresh().finally(() => {
      this.inflight = null;
    });
    return this.inflight.catch((error: unknown) => {
      if (!fallback) throw error;
      const message = error instanceof Error ? error.message : String(error);
      console.warn(`[stage-ai] 音色库抓取失败（沿用磁盘快照）: ${message}`);
      return { ...fallback, stale: true };
    });
  }

  private async refresh(): Promise<VoiceCatalog> {
    const byId = new Map<string, VoiceEntry>();
    let total = 0;
    for (let page = 1; page <= MAX_PAGES; page += 1) {
      const body = await this.fetchJson<FishModelPage>(
        `/model?page_size=${PAGE_SIZE}&page_number=${page}&self=false&sort_by=score`,
      );
      if (page === 1) total = typeof body.total === "number" ? body.total : 0;
      const items = body.items ?? [];
      if (items.length === 0) break;
      for (const raw of items) {
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
    console.log(`[stage-ai] 音色库已更新: ${catalog.entries.length} 条 / 全库 ${total}`);
    return catalog;
  }

  /** 多 key 轮询：GET 与合成共用 key 池，401/402/429 时换下一把。 */
  private createFetcher(): VoiceFetcher {
    return async <T>(path: string): Promise<T> => {
      const keys = readTtsKeys(this.config);
      if (keys.length === 0) throw new Error("未配置 fish key，无法获取音色库");
      let lastError: unknown = null;
      for (const key of keys) {
        try {
          const res = await undiciFetch(`${this.config.tts.baseUrl}${path}`, {
            headers: { authorization: `Bearer ${key}` },
            dispatcher: this.dispatcher,
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
      console.warn(`[stage-ai] 音色库快照落盘失败（不影响本次使用）: ${String(error)}`);
    }
  }
}
