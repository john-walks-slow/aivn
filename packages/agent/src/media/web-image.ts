/**
 * 网络图片下载：`references` 里的 http(s) 项（用户在网上看到一张想要的参考图，直接喂进来）。
 *
 * 这是**模型驱动的出网**：检索返回什么网址它就可能拿去垫图，所以内网地址必须在这里挡死——
 * 不然页面里一段文字指个 `http://127.0.0.1:...` 就把本机的口开了。**每次跳转都重新判**：
 * 只查首跳地址的重定向是最常见的绕过。
 *
 * 这个模块只做「下一张图」这件事：出口代理、下载缓存、拿到之后写到哪里都是宿主的事
 * （包只认一个注入的 `fetch`；缓存名可以用 `webImageBase(url)` 算）。
 * 不走这个包的宿主自己也要记得判内网——判据只写在这一份里。
 */

import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';
import { createHash } from "node:crypto";
import { defaultFetch, type FetchLike } from "../http.js";
import { sniffImageMime } from "./image.js";

/** 图库原图几 MB 是常态；再大就不是「垫一张参考图」，是在替用户下文件。 */
export const MAX_WEB_IMAGE_BYTES = 20 * 1024 * 1024;
/** 跳转上限：正常的图床 1~2 跳；来回弹跳的多半不是图。 */
const MAX_REDIRECTS = 3;
/** 一张图 20 秒还下不完就是卡住了，不是慢。 */
const TIMEOUT_MS = 20_000;

export interface WebImage {
	data: Buffer;
	mimeType: string;
}

/** 出网面：宿主把代理烘好的 fetch 交给它，缺省用全局 fetch。 */
export interface WebImageOptions {
  readonly fetchImpl?: FetchLike;
}

/** 工具依赖面要的是一个函数，不是这个类。 */
export type WebImageFetcher = (url: string) => Promise<WebImage>;

/** 下载一张网络图（只认 http/https，每个跳转都重判公网地址）。 */
export async function fetchWebImage(rawUrl: string, options: WebImageOptions = {}): Promise<WebImage> {
  const fetchImpl = options.fetchImpl ?? defaultFetch;
	let target = parseHttpUrl(rawUrl);
	for (let hop = 0; hop <= MAX_REDIRECTS; hop += 1) {
		await assertPublicHost(target.hostname);
		const res = await fetchImpl(target.href, {
			redirect: 'manual',
			signal: AbortSignal.timeout(TIMEOUT_MS),
			headers: { accept: 'image/*' },
		});
		if (res.status >= 300 && res.status < 400) {
			const location = res.headers.get('location');
			await res.body?.cancel();
			if (!location) throw new Error(`${target} 返回 ${res.status} 但没有 Location`);
			target = parseHttpUrl(new URL(location, target).toString());
			continue;
		}
		if (!res.ok) {
			await res.body?.cancel();
			throw new Error(`垫图下载失败：${target} 返回 HTTP ${res.status}`);
		}
		const data = await readCapped(res.body, target);
		const mimeType = sniffImageMime(data);
		if (!mimeType) throw new Error(`垫图下载失败：${target} 不是一张能看的图（要 png/jpeg/webp/gif，认不出字节头）`);
		return { data, mimeType };
	}
	throw new Error(`垫图下载失败：${rawUrl} 跳转超过 ${MAX_REDIRECTS} 次`);
}

/**
 * 边收边判大小，超了立刻断流。
 *
 * `content-length` 只是一条**声明**：chunked 响应根本没有这个头，先收全再判大小等于把上限
 * 写在事后——一个几百 MB 的响应就能把进程打死。
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
				throw new Error(`垫图下载失败：${url} 的图超过 ${MAX_WEB_IMAGE_BYTES / 1048576}MB 上限`);
			}
			chunks.push(Buffer.from(value.buffer, value.byteOffset, value.byteLength));
		}
	} finally {
		reader.releaseLock();
	}
	return Buffer.concat(chunks);
}

/** 只认 http(s)：`file:`、`data:`、`gopher:` 这些协议给模型一条路就能读本机文件。 */
function parseHttpUrl(raw: string): URL {
	let url: URL;
	try {
		url = new URL(raw);
	} catch {
		throw new Error(`不是合法的网址：${raw}`);
	}
	if (url.protocol !== 'http:' && url.protocol !== 'https:') {
		throw new Error(`垫图只支持 http/https 网址，收到 ${url.protocol}`);
	}
	return url;
}

/** 解析出的每个地址都得是公网：任何一个指向内网就整条拒掉（DNS 轮询到内网也算）。 */
async function assertPublicHost(rawHostname: string): Promise<void> {
	// URL 的 hostname 给 IPv6 带着方括号（[::1]），DNS 那边要的是裸地址
	const hostname = rawHostname.replace(/^\[/, '').replace(/\]$/, '');
	// 字面 IP（尤其是内网写法）不查 DNS：查了要么白等，要么被解析器按名字处理成另一种结果
	if (isIP(hostname) !== 0) {
		if (!isPublicAddress(hostname)) throw new Error(`不下载内网地址（${rawHostname}）`);
		return;
	}
	if (hostname === 'localhost' || hostname.endsWith('.localhost') || hostname.endsWith('.local')) {
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
	const v4 = embeddedV4(head) ?? (head.includes(':') ? null : head);
	if (v4 !== null) {
		const [a = -1, b = -1] = v4.split('.').map(Number);
		if (a === 0 || a === 10 || a === 127) return false;
		if (a === 169 && b === 254) return false; // 链路本地（含云元数据 169.254.169.254）
		if (a === 172 && b >= 16 && b <= 31) return false;
		if (a === 192 && b === 168) return false;
		if (a === 100 && b >= 64 && b <= 127) return false; // 运营商级 NAT
		if (a >= 224) return false; // 组播与保留
		return true;
	}
	if (head === '::' || head === '::1') return false;
	// fc00::/7 唯一本地、fe80::/10 链路本地
	if (/^f[cd]/.test(head) || /^fe[89ab]/.test(head)) return false;
	return true;
}

/**
 * v6 地址尾部那 32 位是不是一个内网 v4：命中 `::ffff:<v4>` / `::<v4>` 就还原成点分十进制。
 * 只认写满 32 位的形式（点分四段或两组十六进制）——`::1` 这种是纯 v6，走上面的判决。
 */
function embeddedV4(head: string): string | null {
	const rest = head.startsWith('::ffff:') ? head.slice(7) : head.startsWith('::') ? head.slice(2) : null;
	if (rest === null || rest === '') return null;
	if (!rest.includes(':')) return /^(\d{1,3}\.){3}\d{1,3}$/.test(rest) ? rest : null;
	const [hi, lo] = rest.split(':');
	if (!hi || !lo || hi.length > 4 || lo.length > 4) return null;
	if (!/^[0-9a-f]{1,4}$/.test(hi) || !/^[0-9a-f]{1,4}$/.test(lo)) return null;
	return [parseInt(hi, 16) >> 8, parseInt(hi, 16) & 255, parseInt(lo, 16) >> 8, parseInt(lo, 16) & 255].join('.');
}

/** 下载结果的本地缓存名：按 URL 摘要，同一张网图一轮对话里看多次只下一次。 */
export function webImageBase(url: string): string {
  return createHash("sha256").update(url).digest("hex").slice(0, 32);
}
