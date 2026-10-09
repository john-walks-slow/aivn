import { fetch as undiciFetch, ProxyAgent } from "undici";
import { fetchWebImage, type FetchLike, type WebImageFetcher } from "@aivn/agent";

/**
 * 网络图下载 —— 判据与实现都在 `@aivn/agent`（`media/web-image.ts`），两个宿主共用一份。
 *
 * 这里只剩服务端的接线：**出口代理读标准环境变量**（`HTTPS_PROXY` / `HTTP_PROXY`，大小写都认）。
 * 这是「设一次就有」的那条保证：装服务的那台机器上代理设了，图就能下；一个专门的
 * `STAGE_*_PROXY` 还得用户记得去设置面板里填。
 */
export { MAX_WEB_IMAGE_BYTES, readCapped, webImageBase } from "@aivn/agent";
export type { WebImage, WebImageFetcher } from "@aivn/agent";

export function proxyFromEnv(): ProxyAgent | undefined {
  const url =
    [process.env.HTTPS_PROXY, process.env.https_proxy, process.env.HTTP_PROXY, process.env.http_proxy]
      .map((value) => value?.trim() ?? "")
      .find((value) => value !== "") ?? "";
  return url === "" ? undefined : new ProxyAgent(url);
}

/** 工具依赖面要的是一个函数。 */
export function createWebImageFetcher(): WebImageFetcher {
  const dispatcher = proxyFromEnv();
  const fetchImpl: FetchLike = (url, init) => undiciFetch(url, { ...init, dispatcher });
  return (url) => fetchWebImage(url, { fetchImpl });
}
