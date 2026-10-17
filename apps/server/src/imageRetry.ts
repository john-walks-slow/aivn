import type { FetchInitLike, FetchLike, FetchResponseLike } from "@aivn/agent";

/**
 * 生图层通用的失败重试（`image.retryIntervalMs` / `image.retryWindowMs`）。
 *
 * 包在**宿主那份 fetch 外面**，所以五款接口格式（gemini / modelslab / openai / comfyui / novelai）
 * 一次装上，协议实现里一行都不用改；一次出图内部的多个请求（ComfyUI 的提交+轮询+取图、
 * modelslab 的换链接+出图）也各自享有同一条策略。
 *
 * 判据是 HTTP 语义、不是某家的规矩：**上游一时之忙**（`408` / `423` / `429` / `5xx`）与网络中断
 * 值得再敲；其余 4xx（Key 不对、模型名不认、画布不合法）敲一百遍也是同一个答案。
 *
 * **窗口只管「还敲不敲」**：调用方自己带的超时（各家 `generate()` 里那个 `AbortSignal.timeout`）
 * 不跟着缩，也不去重试一个已经 abort 的请求——拿重试窗口去砍一发正跑着的生成，
 * 2K/4K 那类本来就慢的出图会被自己掐死。
 *
 * NovelAI 撞的是「同一账号同一时刻只收一发」（另一发回 423/429），这是这条策略最常见的用武之地；
 * 其余格式撞的是网关限流与 5xx。
 */
export interface ImageRetryPolicy {
  /** 两次尝试之间隔多久（毫秒）。 */
  intervalMs: number;
  /** 从第一次失败起算，敲满这么久还没成功就放弃（毫秒）。 */
  windowMs: number;
}

/** 值不值得再敲一发。 */
export function retryableStatus(status: number): boolean {
  return status === 408 || status === 423 || status === 429 || status >= 500;
}

/** 窗口或间隔 ≤ 0 = 关：原样返回宿主那份 fetch，不给调用链白加一层。 */
export function retryingFetch(fetchImpl: FetchLike, policy: ImageRetryPolicy): FetchLike {
  if (policy.intervalMs < 1 || policy.windowMs < 1) return fetchImpl;
  return async (url: string, init: FetchInitLike): Promise<FetchResponseLike> => {
    const deadline = Date.now() + policy.windowMs;
    for (;;) {
      let res: FetchResponseLike | null = null;
      let failure: unknown = null;
      try {
        res = await fetchImpl(url, init);
      } catch (error) {
        failure = error;
      }
      if (res !== null && res.ok) return res;
      // 到点 abort 的那一发不重试：再敲一次也是当场 abort（信号是调用方的，已经废了）。
      if (init.signal?.aborted === true) {
        if (res !== null) return res;
        throw failure;
      }
      const worthRetry = res === null || retryableStatus(res.status);
      // 不可重试、或窗口已经用完 —— 把最后一发原样交回协议层，错误话术仍由它自己说。
      if (!worthRetry || Date.now() + policy.intervalMs >= deadline) {
        if (res !== null) return res;
        throw failure;
      }
      await new Promise((resolve) => setTimeout(resolve, policy.intervalMs));
    }
  };
}
