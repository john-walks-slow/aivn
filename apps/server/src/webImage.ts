import { EnvHttpProxyAgent, fetch as undiciFetch, setGlobalDispatcher } from "undici";
import { fetchWebImage, type FetchLike, type WebImageFetcher } from "@aivn/agent";

/**
 * 网络图下载与通用出网 fetch —— 判据与实现都在 `@aivn/agent`（`media/web-image.ts`），两个宿主共用一份。
 *
 * 这里负责服务端的统一出网接线：**出口代理读标准环境变量**（`HTTPS_PROXY` / `HTTP_PROXY` / `NO_PROXY`，大小写都认）。
 * 用 `EnvHttpProxyAgent` 并把回环地址（`localhost,127.0.0.1,::1`）常驻进 `noProxy`：
 * - 本机网关（`127.0.0.1:38000` flow2api、本机 ComfyUI 等）即使没配 `NO_PROXY` 也一律直连；
 * - 墙外生图/网图地址（`image.novelai.net`、外部参考图 URL 等）自动走代理；
 * - 同时修复 userland `undici` 加载时把 `globalThis[Symbol(undici.globalDispatcher.1)]` 重置成裸 `Agent` 的副作用。
 */
export { MAX_WEB_IMAGE_BYTES, readCapped, webImageBase } from "@aivn/agent";
export type { WebImage, WebImageFetcher } from "@aivn/agent";

const LOOPBACK_NO_PROXY = "localhost,127.0.0.1,::1";

let cached: { key: string; agent: EnvHttpProxyAgent } | null = null;

function firstEnv(...values: (string | undefined)[]): string {
  return values.map((value) => value?.trim() ?? "").find((value) => value !== "") ?? "";
}

export function proxyFromEnv(): EnvHttpProxyAgent | undefined {
  const httpsProxy = firstEnv(process.env.HTTPS_PROXY, process.env.https_proxy);
  const httpProxy = firstEnv(process.env.HTTP_PROXY, process.env.http_proxy);
  if (httpsProxy === "" && httpProxy === "") return undefined;

  const noProxy = [LOOPBACK_NO_PROXY, process.env.NO_PROXY, process.env.no_proxy]
    .map((value) => value?.trim() ?? "")
    .filter((value) => value !== "")
    .join(",");
  const key = `${httpsProxy}|${httpProxy}|${noProxy}`;
  if (cached?.key !== key) {
    cached = {
      key,
      agent: new EnvHttpProxyAgent({
        httpProxy: httpProxy || httpsProxy,
        httpsProxy: httpsProxy || httpProxy,
        noProxy,
      }),
    };
  }
  return cached.agent;
}

/**
 * 把环境代理装回 undici 全局 dispatcher（恢复被 userland `import "undici"` 冲掉的 `NODE_USE_ENV_PROXY` 行为，
 * 并在 `.env` 加载后生效）。
 */
export function installEnvProxy(): void {
  const agent = proxyFromEnv();
  if (agent) setGlobalDispatcher(agent);
}

installEnvProxy();

/** 带环境代理（含回环直连绕过）的通用 fetch 实现，供生图、音乐与网图抓取共用。 */
export const envFetch: FetchLike = (url, init) =>
  undiciFetch(url, { ...init, dispatcher: proxyFromEnv() });

/** 工具依赖面要的是一个函数。 */
export function createWebImageFetcher(): WebImageFetcher {
  return (url) => fetchWebImage(url, { fetchImpl: envFetch });
}
