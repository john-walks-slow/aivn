import { lookup } from "node:dns/promises";
import { createHash } from "node:crypto";
import { isIP } from "node:net";
import { fetch as undiciFetch, ProxyAgent } from "undici";
import { sniffImageMime } from "./imageMime.js";

/**
 * 网络图片下载（工坊 `view_image` 的网络分支）。
 *
 * 这是**模型驱动的出网**：`web_search` 返回什么 URL 它就可能去取什么，所以内网地址必须在这里挡死
 * ——不然模型被页面里的一段文字指个 `http://127.0.0.1:8787/api/...` 就把本机的口开了。
 * 每次跳转都重新判：只查首跳地址的重定向是最常见的绕过。
 *
 * 出口代理读标准的 `HTTP_PROXY` / `HTTPS_PROXY` 环境变量，不另开一个配置项：代理本来就是环境的事，
 * 装服务的那台机器上设一次就有，没设就直连（内网部署本来也没有墙外的问题）。
 */

/** 图库原图几 MB 是常态；再大就不是「看一眼参考」，是在替用户下文件。 */
export const MAX_WEB_IMAGE_BYTES = 20 * 1024 * 1024;
/** 跳转上限：正常的图床 1~2 跳；来回弹跳的多半不是图。 */
const MAX_REDIRECTS = 3;
/** 一张图 20 秒还下不完就是卡住了，不是慢。 */
const TIMEOUT_MS = 20_000;

export interface WebImage {
  data: Buffer;
  mimeType: string;
}

export type WebImageFetcher = (url: string) => Promise<WebImage>;

export class WebImageFetcherImpl {
  private readonly dispatcher: ProxyAgent | undefined;

  constructor() {
    // 在构造时读一次：进程跑起来之后改环境变量对已经建好的连接池没有意义
    this.dispatcher = proxyFromEnv();
  }

  /** 工具依赖面要的是一个函数，不是这个类（`fetchImage`）。 */
  get fetchImage(): WebImageFetcher {
    return (url) => this.fetch(url);
  }

  private async fetch(rawUrl: string): Promise<WebImage> {
    let target = parseHttpUrl(rawUrl);
    for (let hop = 0; hop <= MAX_REDIRECTS; hop += 1) {
      await assertPublicHost(target.hostname);
      const res = await undiciFetch(target, {
        redirect: "manual",
        dispatcher: this.dispatcher,
        signal: AbortSignal.timeout(TIMEOUT_MS),
        headers: { accept: "image/*" },
      });
      if (res.status >= 300 && res.status < 400) {
        const location = res.headers.get("location");
        await res.body?.cancel();
        if (!location) throw new Error(`${target} 返回 ${res.status} 但没有 Location`);
        target = parseHttpUrl(new URL(location, target).toString());
        continue;
      }
      if (!res.ok) {
        await res.body?.cancel();
        throw new Error(`${target} 返回 HTTP ${res.status}`);
      }
      const data = await readCapped(res.body, target);
      const mimeType = sniffImageMime(data);
      if (!mimeType) throw new Error(`${target} 不是一张能看的图（要 png/jpeg/webp/gif，认不出字节头）`);
      return { data, mimeType };
    }
    throw new Error(`${rawUrl} 跳转超过 ${MAX_REDIRECTS} 次`);
  }
}

/**
 * 边收边判大小，超了立刻断流。
 *
 * `content-length` 只是一条**声明**：chunked 响应根本没有这个头，
 * 先 `arrayBuffer()` 收全再判大小等于把上限写在事后——一个几百 MB 的响应就能把进程打死。
 */
export async function readCapped(body: ReadableStream<Uint8Array> | null, url: URL): Promise<Buffer> {
  if (!body) throw new Error(`${url} 没有响应体`);
  const reader = body.getReader();
  const chunks: Buffer[] = [];
  let total = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > MAX_WEB_IMAGE_BYTES) {
        await reader.cancel();
        throw new Error(`${url} 的图超过 ${MAX_WEB_IMAGE_BYTES / 1048576}MB 上限`);
      }
      chunks.push(Buffer.from(value.buffer, value.byteOffset, value.byteLength));
    }
  } finally {
    reader.releaseLock();
  }
  return Buffer.concat(chunks);
}

/**
 * 出口代理：标准环境变量，HTTPS 优先（墙外站点多是 https）。
 *
 * 不读 `NO_PROXY`：它在这类部署里列的正是本工具已经拒掉的回环与内网，
 * 而完整实现一套域名后缀匹配不值当——唯一真正该直连的（本机）本来就下不了。
 */
function proxyFromEnv(): ProxyAgent | undefined {
  // 取第一个非空的：不少机器把 HTTPS_PROXY 留着但置空，只认非空才不会被它挡住后面已设的 HTTP_PROXY
  const url =
    [process.env.HTTPS_PROXY, process.env.https_proxy, process.env.HTTP_PROXY, process.env.http_proxy]
      .map((value) => value?.trim() ?? "")
      .find((value) => value !== "") ?? "";
  return url === "" ? undefined : new ProxyAgent(url);
}

/** 只认 http(s)：file:、data:、gopher: 这些协议给模型一条路就能读本机文件。 */
function parseHttpUrl(raw: string): URL {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Error(`不是合法的网址：${raw}`);
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") throw new Error(`只支持 http/https 网址，收到 ${url.protocol}`);
  return url;
}

/** 解析出的每个地址都得是公网：任何一个指向内网就整条拒掉（DNS 轮询到内网也算）。 */
async function assertPublicHost(rawHostname: string): Promise<void> {
  // URL 的 hostname 给 IPv6 带着方括号（[::1]），DNS 那边要的是裸地址
  const hostname = rawHostname.replace(/^\[/, "").replace(/\]$/, "");
  // 字面 IP（尤其是内网写法）不查 DNS：查了要么白等，要么被解析器按名字处理成另一种结果
  if (isIP(hostname) !== 0) {
    if (!isPublicAddress(hostname)) throw new Error(`不下载内网地址（${rawHostname}）`);
    return;
  }
  if (hostname === "localhost" || hostname.endsWith(".localhost") || hostname.endsWith(".local")) {
    throw new Error(`不下载内网地址（${hostname}）`);
  }
  const addresses = await lookup(hostname, { all: true }).catch((error: unknown) => {
    throw new Error(`${hostname} 解析不了：${error instanceof Error ? error.message : String(error)}`);
  });
  for (const { address } of addresses) {
    if (!isPublicAddress(address)) throw new Error(`不下载内网地址（${hostname} → ${address}）`);
  }
}

function isPublicAddress(address: string): boolean {
  const head = address.toLowerCase();
  // 高位全 0 的两种 v6 写法都落到 v4 上判：::ffff:7f00:1（映射）与 ::7f00:1 / ::127.0.0.1（v4 兼容，
  // ::/96，虽已废弃但网络栈照样认）。URL 规范化后给的都是十六进制形式，只认点分十进制会漏。
  const v4 = embeddedV4(head) ?? (head.includes(":") ? null : head);
  if (v4 !== null) {
    const [a = -1, b = -1] = v4.split(".").map(Number);
    if (a === 0 || a === 10 || a === 127) return false;
    if (a === 169 && b === 254) return false; // 链路本地（含云元数据 169.254.169.254）
    if (a === 172 && b >= 16 && b <= 31) return false;
    if (a === 192 && b === 168) return false;
    if (a === 100 && b >= 64 && b <= 127) return false; // 运营商级 NAT
    if (a >= 224) return false; // 组播与保留
    return true;
  }
  if (head === "::" || head === "::1") return false;
  // fc00::/7 唯一本地、fe80::/10 链路本地
  if (/^f[cd]/.test(head) || /^fe[89ab]/.test(head)) return false;
  return true;
}

/**
 * v6 地址尾部那 32 位是不是一个内网 v4：命中 `::ffff:<v4>` / `::<v4>` 就还原成点分十进制。
 * 只认写满 32 位的形式（点分四段或两组十六进制）——`::1` 这种是纯 v6，走下面的判决。
 */
function embeddedV4(head: string): string | null {
  const rest = head.startsWith("::ffff:") ? head.slice(7) : head.startsWith("::") ? head.slice(2) : null;
  if (rest === null || rest === "") return null;
  if (!rest.includes(":")) return /^(\d{1,3}\.){3}\d{1,3}$/.test(rest) ? rest : null;
  const [hi, lo] = rest.split(":");
  if (!hi || !lo || hi.length > 4 || lo.length > 4) return null;
  if (!/^[0-9a-f]{1,4}$/.test(hi) || !/^[0-9a-f]{1,4}$/.test(lo)) return null;
  return [parseInt(hi, 16) >> 8, parseInt(hi, 16) & 255, parseInt(lo, 16) >> 8, parseInt(lo, 16) & 255].join(".");
}

/** 下载结果的本地缓存名：按 URL 摘要，同一张网图一轮对话里看多次只下一次。 */
export function webImageBase(url: string): string {
  return createHash("sha256").update(url).digest("hex").slice(0, 32);
}