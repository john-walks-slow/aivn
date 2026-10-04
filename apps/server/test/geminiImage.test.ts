import { describe, expect, it } from "vitest";
import { GeminiImageGen } from "../src/geminiImage.js";
import type { GeminiImageOptions } from "../src/geminiImage.js";

/** 抓下请求并回放脚本化的响应；不打真网关。 */
function fakeFetch(
  responder: (url: string, init: { headers: Record<string, string>; body: string }) => Response,
): { fetchImpl: typeof fetch; calls: { url: string; headers: Record<string, string>; body: Record<string, unknown> }[] } {
  const calls: { url: string; headers: Record<string, string>; body: Record<string, unknown> }[] = [];
  const fetchImpl = (async (url: string, init: { headers: Record<string, string>; body: string }) => {
    calls.push({ url, headers: init.headers, body: JSON.parse(init.body) });
    return responder(url, init);
  }) as unknown as typeof fetch;
  return { fetchImpl, calls };
}

const PNG_B64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";

const inlineResponse = (b64 = PNG_B64, mime = "image/png"): Response =>
  new Response(
    JSON.stringify({
      candidates: [{ content: { parts: [{ text: "ok" }, { inlineData: { mimeType: mime, data: b64 } }] } }],
    }),
    { status: 200, headers: { "content-type": "application/json" } },
  );

const opts: GeminiImageOptions = {
  baseUrl: "http://127.0.0.1:38000",
  apiKey: "test-key",
  model: "gemini-3.1-flash-image",
  size: "2K",
  timeoutMs: 1000,
};

describe("GeminiImageGen：Gemini 原生生图", () => {
  it("非法画幅尺寸构造期就拦下；字面像素尺寸本接口没有这个入参", () => {
    expect(() => new GeminiImageGen({ ...opts, size: "8K" as never })).toThrow(/生图尺寸「8K」非法/);
    expect(() => new GeminiImageGen({ ...opts, size: "1536x1024" })).toThrow(/Gemini 格式的档位只认/);
  });

  it("请求形状：模型名进 URL、x-goog-api-key 进头、画幅与尺寸进 imageConfig", async () => {
    const { fetchImpl, calls } = fakeFetch(() => inlineResponse());
    const gen = new GeminiImageGen(opts, fetchImpl as never);
    await gen.generate({ prompt: "黄昏教室", aspectRatio: "3:4" });

    const call = calls[0]!;
    expect(call.url).toBe("http://127.0.0.1:38000/v1beta/models/gemini-3.1-flash-image:generateContent");
    expect(call.headers["x-goog-api-key"]).toBe("test-key");
    const config = (call.body.generationConfig as { responseModalities: string[]; imageConfig: Record<string, string> });
    expect(config.responseModalities).toEqual(["IMAGE"]);
    expect(config.imageConfig).toEqual({ aspectRatio: "3:4", imageSize: "2K" });
  });

  it("配置里写小写 2k 也按官方的大写发出去", async () => {
    const { fetchImpl, calls } = fakeFetch(() => inlineResponse());
    await new GeminiImageGen({ ...opts, size: "2k" }, fetchImpl as never).generate({ prompt: "x" });
    const config = (calls[0]!.body.generationConfig as { imageConfig: Record<string, string> }).imageConfig;
    expect(config.imageSize).toBe("2K");
  });

  it("请求声明的档位下限会抬高档位，但不会把配置降下来", async () => {
    const at = async (cfg: string, minTier?: "2K" | "4K") => {
      const { fetchImpl, calls } = fakeFetch(() => inlineResponse());
      await new GeminiImageGen({ ...opts, size: cfg }, fetchImpl as never).generate({ prompt: "x", minTier });
      return (calls[0]!.body.generationConfig as { imageConfig: Record<string, string> }).imageConfig.imageSize;
    };
    expect(await at("1K", "2K")).toBe("2K"); // 立绘抠底：1K 抬到 2K
    expect(await at("4K", "2K")).toBe("4K"); // 配置更高时不动
    expect(await at("1K")).toBe("1K"); // 背景与 CG 不声明，跟着配置
  });

  it("逐剧目覆盖：请求里带了 model / size 就压过构造期那份配置", async () => {
    // 设置页改的是 play.json 的 image 段，构造期的 opts 来自 .env，优先级看的是请求。
    const { fetchImpl, calls } = fakeFetch(() => inlineResponse());
    const gen = new GeminiImageGen(opts, fetchImpl as never);
    await gen.generate({ prompt: "x", model: "gemini-3-pro-image", size: "4K", aspectRatio: "3:4" });

    expect(calls[0]!.url).toContain("/models/gemini-3-pro-image:generateContent");
    const config = (calls[0]!.body.generationConfig as { imageConfig: Record<string, string> }).imageConfig;
    expect(config.imageSize).toBe("4K");
  });

  it("逐剧目覆盖也走同一套校验：字面像素尺寸在请求级照样报错", async () => {
    const { fetchImpl } = fakeFetch(() => inlineResponse());
    await expect(
      new GeminiImageGen(opts, fetchImpl as never).generate({ prompt: "x", size: "1536x1024" }),
    ).rejects.toThrow(/Gemini 格式的档位只认/);
  });

  it("垫图走 inlineData，且排在提示词之后", async () => {
    const { fetchImpl, calls } = fakeFetch(() => inlineResponse());
    const gen = new GeminiImageGen(opts, fetchImpl as never);
    await gen.generate({
      prompt: "同一个角色，笑着",
      references: [{ mimeType: "image/png", data: Buffer.from("ref-bytes") }],
    });

    const parts = (calls[0]!.body.contents as { parts: { text?: string; inlineData?: { data: string } }[] }[])[0]!
      .parts;
    expect(parts[0]!.text).toBe("同一个角色，笑着");
    expect(parts[1]!.inlineData?.data).toBe(Buffer.from("ref-bytes").toString("base64"));
  });

  it("base64 图像字节原样解出并带上 mimeType", async () => {
    const { fetchImpl } = fakeFetch(() => inlineResponse(PNG_B64, "image/webp"));
    const gen = new GeminiImageGen(opts, fetchImpl as never);
    const img = await gen.generate({ prompt: "x" });
    expect(img.mimeType).toBe("image/webp");
    expect(img.data.equals(Buffer.from(PNG_B64, "base64"))).toBe(true);
  });

  it("只回 fileData（网关取图没跑通）要单独报错，不能混成「没有图像」", async () => {
    const { fetchImpl } = fakeFetch(
      () =>
        new Response(
          JSON.stringify({ candidates: [{ content: { parts: [{ fileData: { fileUri: "https://x/y.png" } }] } }] }),
          { status: 200 },
        ),
    );
    await expect(new GeminiImageGen(opts, fetchImpl as never).generate({ prompt: "x" })).rejects.toThrow(
      /只回了文件地址/,
    );
  });

  it("只回文字（被内容策略拒绝之类）把原文带出来", async () => {
    const { fetchImpl } = fakeFetch(
      () =>
        new Response(
          JSON.stringify({ candidates: [{ content: { parts: [{ text: "这张图被安全策略拦截了" }] } }] }),
          { status: 200 },
        ),
    );
    await expect(new GeminiImageGen(opts, fetchImpl as never).generate({ prompt: "x" })).rejects.toThrow(
      /未出图：这张图被安全策略拦截了/,
    );
  });

  it("parts 空但带 finishMessage / blockReason 时要把原因带出来（cpa 实测只给这个）", async () => {
    const { fetchImpl } = fakeFetch(
      () =>
        new Response(
          JSON.stringify({
            candidates: [{ content: { parts: [] }, finishMessage: "Unable to show the generated image." }],
          }),
          { status: 200 },
        ),
    );
    await expect(new GeminiImageGen(opts, fetchImpl as never).generate({ prompt: "x" })).rejects.toThrow(
      /没有图像内容：Unable to show the generated image/,
    );

    const { fetchImpl: blocked } = fakeFetch(
      () =>
        new Response(
          JSON.stringify({
            candidates: [{ content: { parts: [] } }],
            promptFeedback: { blockReason: "SAFETY" },
          }),
          { status: 200 },
        ),
    );
    await expect(new GeminiImageGen(opts, blocked as never).generate({ prompt: "x" })).rejects.toThrow(
      /没有图像内容：SAFETY/,
    );
  });

  it("HTTP 报错带出状态与响应片段", async () => {
    const { fetchImpl } = fakeFetch(() => new Response("auth_unavailable", { status: 503 }));
    await expect(new GeminiImageGen(opts, fetchImpl as never).generate({ prompt: "x" })).rejects.toThrow(
      /HTTP 503.*auth_unavailable/,
    );
  });

  it("非法画幅在发请求前就报错（上游拿到坏画幅不报错，只会降级出方图）", async () => {
    const { fetchImpl, calls } = fakeFetch(() => inlineResponse());
    await expect(
      new GeminiImageGen(opts, fetchImpl as never).generate({ prompt: "x", aspectRatio: "5:3" as never }),
    ).rejects.toThrow(/画幅/);
    expect(calls).toHaveLength(0);
  });
});
