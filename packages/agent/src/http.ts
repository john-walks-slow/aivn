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
  /**
   * `Uint8Array` 是给 multipart 上传留的口（ComfyUI 的 `/upload/image`）。
   *
   * **不塞 `FormData`**：它不是跨实现通用的传输类型——npm `undici` 的 fetch 只认它自己那套类
   * （`instanceof` 判定），别的 realm 的 FormData 会被当成普通对象、以 `text/plain` 发出去一个字面量
   * `"[object FormData]"`（undici 8.11 实测）。字节体谁都认。
   *
   * 收 `ArrayBuffer` 那份（不是 `ArrayBufferLike`）：全局 fetch 的 `BodyInit` 不收 SharedArrayBuffer 撑的视图。
   *
   * 写字节的调用方要**自己带上 `content-type`**，且 boundary 必须与实体出自同一处
   * （见 `media/comfyui.ts` 的 `multipartForm`：由 `Response(form)` 一次生成，不手写）。
   */
  readonly body?: string | Uint8Array<ArrayBuffer>;
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
