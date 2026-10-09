import { fetch as undiciFetch, ProxyAgent } from "undici";
import { Exa, type FetchLike } from "@aivn/agent";
import type { ServerConfig } from "./config.js";

export { Exa } from "@aivn/agent";
export type { SearchResult } from "@aivn/agent";

/**
 * 检索客户端（工坊 agent 唯一的联网口子）——实现在 `@aivn/agent`，两个宿主共用一份。
 *
 * 这里只剩**服务端自己的接线**：代理。包只认一个注入的 fetch（规约 R5：包不认识 undici），
 * 设置页「代理」项指定的 ProxyAgent 在这一层烘进去；留空则直连（api.exa.ai 墙外）。
 */
function proxiedFetch(proxy: string | undefined): FetchLike | undefined {
  if (!proxy) return undefined;
  const dispatcher = new ProxyAgent(proxy);
  return (url, init) => undiciFetch(url, { ...init, dispatcher });
}

/** 从配置装配 Exa 客户端；未启用或无可用 key 返回 null（工具不注册，prompt 里也不提联网）。 */
export function createExa(config: ServerConfig): Exa | null {
  if (!config.exa.enabled) return null;
  const keys = config.exa.keys;
  if (keys.length === 0) {
    console.warn("[aivn] STAGE_EXA_KEYS 为空（工坊联网停用）");
    return null;
  }
  return new Exa({
    keys,
    baseUrl: config.exa.baseUrl,
    timeoutMs: config.exa.timeoutMs,
    fetchImpl: proxiedFetch(config.exa.proxy || undefined),
  });
}
