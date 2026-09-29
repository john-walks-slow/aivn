import { fetch as undiciFetch } from "undici";
import type { GeneratedImage, ImageBackend, ImageRequest } from "./imageBackend.js";
import type { ServerConfig } from "./config.js";
import { Flow2ApiImageGen } from "./flowImage.js";

/** undici 的 Response 与全局同名类型不兼容（FormData/File 分叉）：直接用取回的返回类型。 */
type UpstreamResponse = Awaited<ReturnType<typeof undiciFetch>>;

/**
 * cpa 网关出图客户端（`ImageBackend` 的文生图实现）。两种模型两种协议：
 * - `seedream-5.0-lite` → `POST /images/generations`，返回 `data[0].b64_json` 或远端 `url`；
 * - `gemini-3.1-flash-image` → `POST /chat/completions` **流式**，图片在 `delta.images[].image_url.url`
 *   的 `data:image/jpeg;base64,` 里（网关不实现 images/generations）。
 *
 * cpa 没有垫图通道，`references` 一律忽略——角色一致性只有 flow2api 那条路走得通。
 * 单图 15–30s；超时/报错一律抛出，由调用方降级。
 */

export interface CpaImageOptions {
  baseUrl: string;
  apiKey: string;
  model: string;
  size: string;
  timeoutMs: number;
}

export class CpaImageGen implements ImageBackend {
  /** fetch 注入点：默认 undici，测试可替身。 */
  constructor(
    private readonly opts: CpaImageOptions,
    private readonly fetchImpl: typeof undiciFetch = undiciFetch,
  ) {}

  generate(req: ImageRequest): Promise<GeneratedImage> {
    return this.opts.model.includes("gemini")
      ? this.viaChat(req.prompt)
      : this.viaImages(req.prompt);
  }

  /** seedream 系：一次性响应，图片是 base64 或远端 URL。 */
  private async viaImages(prompt: string): Promise<GeneratedImage> {
    const res = await this.post("/images/generations", {
      model: this.opts.model,
      prompt,
      size: this.opts.size,
      n: 1,
    });
    const body = (await res.json().catch(() => null)) as {
      data?: { b64_json?: string; url?: string }[];
    } | null;
    const first = body?.data?.[0];
    if (first?.b64_json) {
      return { data: Buffer.from(first.b64_json, "base64"), mimeType: "image/jpeg" };
    }
    if (first?.url) {
      const img = await this.fetchImpl(first.url, {
        signal: AbortSignal.timeout(this.opts.timeoutMs),
      });
      if (!img.ok) throw new Error(`生图下载失败 HTTP ${img.status}`);
      return { data: Buffer.from(await img.arrayBuffer()), mimeType: "image/jpeg" };
    }
    throw new Error("生图响应无图片数据");
  }

  /** gemini 系：SSE 流，图片以 data URL 增量到达。 */
  private async viaChat(prompt: string): Promise<GeneratedImage> {
    const res = await this.post("/chat/completions", {
      model: this.opts.model,
      messages: [{ role: "user", content: prompt }],
      stream: true,
      max_tokens: 300,
    });
    let b64: string | null = null;
    for await (const line of sseLines(res)) {
      const payload = parseSse(line);
      const images = payload?.choices?.[0]?.delta?.images;
      if (!Array.isArray(images)) continue;
      for (const image of images) {
        const url: string | undefined = image?.image_url?.url;
        if (typeof url !== "string") continue;
        const comma = url.indexOf(",");
        if (!url.startsWith("data:image/") || comma === -1) continue;
        b64 = url.slice(comma + 1);
      }
    }
    if (!b64) throw new Error("生图流无图片数据");
    return { data: Buffer.from(b64, "base64"), mimeType: "image/jpeg" };
  }

  private async post(path: string, body: unknown): Promise<UpstreamResponse> {
    const res = await this.fetchImpl(`${this.opts.baseUrl}${path}`, {
      method: "POST",
      headers: { authorization: `Bearer ${this.opts.apiKey}`, "content-type": "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(this.opts.timeoutMs),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new Error(`生图 HTTP ${res.status}: ${text.slice(0, 200)}`);
    }
    return res;
  }
}

/** SSE 行迭代（yield 已去掉 "data:" 前缀的负载与空行）。 */
async function* sseLines(res: UpstreamResponse): AsyncGenerator<string> {
  const body = res.body;
  if (!body) return;
  const decoder = new TextDecoder();
  let buffer = "";
  for await (const chunk of body as unknown as AsyncIterable<Uint8Array>) {
    buffer += decoder.decode(chunk, { stream: true });
    let nl: number;
    while ((nl = buffer.indexOf("\n")) !== -1) {
      const line = buffer.slice(0, nl).trim();
      buffer = buffer.slice(nl + 1);
      if (line.startsWith("data:")) {
        const data = line.slice(5).trim();
        if (data && data !== "[DONE]") yield data;
      }
    }
  }
}

function parseSse(line: string): {
  choices?: { delta?: { images?: { image_url?: { url?: string } }[] } }[];
} | null {
  try {
    return JSON.parse(line);
  } catch {
    return null;
  }
}

/**
 * 从配置装配生图后端；`STAGE_IMAGE_ENABLED=false` 返回 null（预发射只记谱系不发起）。
 * 默认走 cpa——它是本项目自己配置的依赖；flow2api 是本机第三方进程，由部署方显式切过去。
 */
export function createImageBackend(config: ServerConfig): ImageBackend | null {
  if (!config.image.enabled) return null;
  if (config.image.backend === "flow2api") {
    return new Flow2ApiImageGen({
      baseUrl: config.flow.baseUrl,
      apiKey: config.flow.apiKey,
      model: config.flow.model,
      size: config.flow.size,
      timeoutMs: config.flow.timeoutMs,
    });
  }
  return new CpaImageGen({
    baseUrl: config.baseUrl,
    apiKey: config.apiKey,
    model: config.image.model,
    size: config.image.size,
    timeoutMs: config.image.timeoutMs,
  });
}
