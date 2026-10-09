/**
 * 包只认一个 fetch 抽象：**不绑定任何一种 fetch 实现**（规约 R5——包不认识 undici，也不认识
 * 宿主的代理接线）。
 *
 * 需要代理的宿主把代理烘在自己的那一层，交给包的是一个已经能用的 `FetchLike`：
 * 服务端 `undiciFetch + ProxyAgent`、插件直接给带环境代理的全局 fetch。
 */
export interface FetchInitLike {
  readonly method: string;
  readonly headers: Record<string, string>;
  readonly body: string;
  readonly signal: AbortSignal;
}

export interface FetchResponseLike {
  readonly ok: boolean;
  readonly status: number;
  text(): Promise<string>;
  json(): Promise<unknown>;
}

export type FetchLike = (url: string, init: FetchInitLike) => Promise<FetchResponseLike>;

/** 缺省实现：全局 fetch（Node 22 起自带）。 */
export const defaultFetch: FetchLike = (url, init) => globalThis.fetch(url, init);
