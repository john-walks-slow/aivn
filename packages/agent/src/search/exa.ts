/**
 * Exa 检索客户端（`web.search` 能力的后端）。
 *
 * 一次 `/search` 用 `contents.text` 把正文一并取回——「搜索」与「读页面」在这里是同一个动作，
 * 所以联网只多一个工具，不是搜索 + 抓取两个。
 *
 * 从 AIVN `apps/server/src/exa.ts` 与 DSH 插件的 `src/exa.ts` 合成一份（两边各有一份**同一套
 * 规矩**的实现，只有代理接线方式不同）：
 *
 * - **多 Key 轮询**：401 / 402 / 429 换下一把（Exa 的免费额度按 key 给），其余状态与网络错误
 *   当场失败——查询本身非法时换 key 也一样失败，只白烧一次往返；
 * - **正文预算**：总 15000 字按条数摊分（检索是配角，不能把上下文预算挤掉）；
 * - **代理不自己配**：包只认一个注入的 `fetch`。服务端的代理（undici ProxyAgent）与插件的
 *   环境变量代理都在各自的接线处烘进 `fetchImpl`——包不认识 undici（规约 R5）。
 */
import { defaultFetch, type FetchLike } from "../http.js";

export interface SearchResult {
  title: string;
  url: string;
  /** 页面发布日期（ISO 串，可能缺）。 */
  publishedDate?: string;
  text: string;
}

export interface ExaOptions {
  /** 至少一把；空数组是调用方的错，不是这里的运行状态。 */
  readonly keys: readonly string[];
  readonly baseUrl: string;
  readonly timeoutMs?: number;
  /** 缺省用全局 fetch；服务端在这里烘进代理。 */
  readonly fetchImpl?: FetchLike;
}

const RETRYABLE_STATUS = new Set([401, 402, 429]);
/** 正文总预算（字符）。 */
const TEXT_BUDGET = 15_000;
const DEFAULT_TIMEOUT_MS = 30_000;

/** 非轮换错误：查询本身非法、端点写错这类持久错误，换 key 也一样失败。 */
class NonRetryableExaError extends Error {}

export class Exa {
  private readonly fetchImpl: FetchLike;
  /** 下一把要用的 key（成功后往前推，真轮询分摊额度）。 */
  private keyCursor = 0;

  constructor(private readonly opts: ExaOptions) {
    this.fetchImpl = opts.fetchImpl ?? defaultFetch;
  }

  /** 语义检索：query 写成一句自然语言描述，不是关键词堆砌。 */
  async search(query: string, numResults: number): Promise<SearchResult[]> {
    const { keys, baseUrl } = this.opts;
    const perResult = Math.min(6000, Math.max(800, Math.floor(TEXT_BUDGET / numResults)));
    const body = JSON.stringify({ query, numResults, contents: { text: { maxCharacters: perResult } } });
    const timeoutMs = this.opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    let lastError: unknown = null;
    for (let attempt = 0; attempt < keys.length; attempt += 1) {
      const index = (this.keyCursor + attempt) % keys.length;
      try {
        const res = await this.fetchImpl(`${baseUrl}/search`, {
          method: "POST",
          headers: { "x-api-key": keys[index]!, "content-type": "application/json" },
          body,
          signal: AbortSignal.timeout(timeoutMs),
        });
        if (!res.ok) {
          const detail = await res.text().catch(() => "");
          if (!RETRYABLE_STATUS.has(res.status)) {
            throw new NonRetryableExaError(`exa HTTP ${res.status}: ${detail.slice(0, 200)}`);
          }
          lastError = new Error(`exa key#${index} HTTP ${res.status}: ${detail.slice(0, 200)}`);
          continue;
        }
        this.keyCursor = (index + 1) % keys.length;
        return parseResults(await res.json());
      } catch (error) {
        if (error instanceof NonRetryableExaError) throw error;
        lastError = error;
      }
    }
    throw new Error(`exa 全部 key 失败: ${lastError instanceof Error ? lastError.message : String(lastError)}`);
  }
}

/** 响应体是外部数据：逐字段认，认不出的丢掉，绝不假定形状。 */
function parseResults(raw: unknown): SearchResult[] {
  const results = (raw as { results?: unknown })?.results;
  if (!Array.isArray(results)) return [];
  const out: SearchResult[] = [];
  for (const item of results) {
    const r = item as { title?: unknown; url?: unknown; publishedDate?: unknown; text?: unknown };
    if (typeof r.url !== "string") continue;
    out.push({
      title: typeof r.title === "string" && r.title.trim() !== "" ? r.title.trim() : r.url,
      url: r.url,
      ...(typeof r.publishedDate === "string" ? { publishedDate: r.publishedDate } : {}),
      text: typeof r.text === "string" ? r.text : "",
    });
  }
  return out;
}
