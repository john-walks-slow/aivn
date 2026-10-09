/**
 * 包只认一个 fetch 抽象：**不绑定任何一种 fetch 实现**（规约 R5——包不认识 undici，也不认识
 * 宿主的代理接线）。
 *
 * 需要代理的宿主把代理烘在自己的那一层，交给包的是一个已经能用的 `FetchLike`：
 * 服务端 `undiciFetch + ProxyAgent`、插件直接给带环境代理的全局 fetch。
 */
export interface FetchInitLike {
  readonly method?: string;
  readonly headers?: Record<string, string>;
  readonly body?: string;
  readonly signal?: AbortSignal;
  /** 跳转自己管（每一跳都要重判地址）。 */
  readonly redirect?: "follow" | "manual" | "error";
}

/** 判据、取字节、认 content-type 都用得上，所以这几样都在契约里。 */
export interface FetchResponseLike {
  readonly ok: boolean;
  readonly status: number;
  readonly headers: { get(name: string): string | null };
  /** 流式读体：大小上限要边收边判（`content-length` 只是声明）。 */
  readonly body: ReadableStream<Uint8Array> | null;
  text(): Promise<string>;
  json(): Promise<unknown>;
  arrayBuffer(): Promise<ArrayBuffer>;
}

export type FetchLike = (url: string, init: FetchInitLike) => Promise<FetchResponseLike>;

/** 缺省实现：全局 fetch（Node 22 起自带）。 */
export const defaultFetch: FetchLike = (url, init) => globalThis.fetch(url, init);
