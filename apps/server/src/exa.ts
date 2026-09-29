import { fetch as undiciFetch, ProxyAgent } from "undici";
import { readKeysFile, type ServerConfig } from "./config.js";

/**
 * Exa 检索客户端（工坊 agent 唯一的联网口子）。
 *
 * 一次 `/search` 通过 `contents.text` 把正文一并取回——「搜索」与「获取信息」在这里是同一个动作，
 * 所以工坊只多一个工具，不是搜索 + 抓取两个。
 *
 * - 多 Key 轮询：401/402/429 换下一把（对齐 `tts.ts`；Exa 的免费额度是按 key 给的）；
 * - 代理：本机代理（api.exa.ai 墙外）。
 */

export interface ExaResult {
  title: string;
  url: string;
  /** 页面发布日期（ISO 串，可能缺）。 */
  publishedDate?: string;
  text: string;
}

const RETRYABLE_STATUS = new Set([401, 402, 429]);
/** 正文总预算（字符）：检索是配角，不能把 A 区的预算挤掉，按条数摊分。 */
const TEXT_BUDGET = 15_000;

/** 非轮换错误哨兵：查询本身非法、端点写错这类持久错误，换 key 也一样失败，只白烧一次往返。 */
class NonRetryableExaError extends Error {}

export class Exa {
  private readonly dispatcher: ProxyAgent | undefined;
  /** 下一把要用的 key（成功后往前推，真轮询分摊额度）。 */
  private keyCursor = 0;

  constructor(
    private readonly opts: { keys: string[]; baseUrl: string; proxy?: string; timeoutMs: number },
    /** fetch 注入点：默认 undici，测试可替身。 */
    private readonly fetchImpl: typeof undiciFetch = undiciFetch,
  ) {
    if (opts.proxy) this.dispatcher = new ProxyAgent(opts.proxy);
  }

  /** 语义检索：query 写成一句自然语言描述，不是关键词堆砌。 */
  async search(query: string, numResults: number): Promise<ExaResult[]> {
    const { keys } = this.opts;
    const perResult = Math.min(6000, Math.max(800, Math.floor(TEXT_BUDGET / numResults)));
    const body = JSON.stringify({
      query,
      numResults,
      contents: { text: { maxCharacters: perResult } },
    });
    let lastError: unknown = null;
    for (let attempt = 0; attempt < keys.length; attempt += 1) {
      const index = (this.keyCursor + attempt) % keys.length;
      try {
        const res = await this.fetchImpl(`${this.opts.baseUrl}/search`, {
          method: "POST",
          headers: { "x-api-key": keys[index]!, "content-type": "application/json" },
          body,
          dispatcher: this.dispatcher,
          signal: AbortSignal.timeout(this.opts.timeoutMs),
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
function parseResults(raw: unknown): ExaResult[] {
  const results = (raw as { results?: unknown })?.results;
  if (!Array.isArray(results)) return [];
  const out: ExaResult[] = [];
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

/** 从配置装配 Exa 客户端；未启用或无可用 key 返回 null（工具不注册，prompt 里也不提联网）。 */
export function createExa(config: ServerConfig): Exa | null {
  if (!config.exa.enabled) return null;
  const keys = readKeysFile(config.exa.keysPath);
  if (keys.length === 0) {
    console.warn(`[stage-ai] Exa key 文件缺失或为空（工坊联网停用）: ${config.exa.keysPath}`);
    return null;
  }
  return new Exa({
    keys,
    baseUrl: config.exa.baseUrl,
    proxy: config.exa.proxy || undefined,
    timeoutMs: config.exa.timeoutMs,
  });
}
