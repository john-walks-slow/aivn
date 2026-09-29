import { describe, expect, it } from "vitest";
import { Flow2ApiImageGen } from "../src/flowImage.js";
import type { FlowImageOptions } from "../src/flowImage.js";

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

const opts: FlowImageOptions = {
  baseUrl: "http://127.0.0.1:38000",
  apiKey: "test-key",
  model: "gemini-3.1-flash-image",
  size: "2k",
  timeoutMs: 1000,
};

describe("Flow2ApiImageGen：flow2api 出图客户端", () => {
  it("只接受别名模型名（完整模型名会静默丢掉画幅，宁可构造期报错）", () => {
    expect(() => new Flow2ApiImageGen({ ...opts, model: "gemini-3.1-flash-image-preview-09-2025" })).toThrow(
      /不是受支持的别名模型名/,
    );
    expect(() => new Flow2ApiImageGen({ ...opts, model: "imagen-4.0-generate-preview" })).not.toThrow();
  });

  it("非法画幅尺寸构造期就拦下", () => {
    expect(() => new Flow2ApiImageGen({ ...opts, size: "8k" as never })).toThrow(/STAGE_FLOW_SIZE/);
  });

  it("请求形状：别名进 URL、x-goog-api-key 进头、画幅与尺寸进 imageConfig", async () => {
    const { fetchImpl, calls } = fakeFetch(() => inlineResponse());
    const gen = new Flow2ApiImageGen(opts, fetchImpl as never);
    await gen.generate({ prompt: "黄昏教室", aspectRatio: "3:4" });

    const call = calls[0]!;
    expect(call.url).toBe("http://127.0.0.1:38000/v1beta/models/gemini-3.1-flash-image:generateContent");
    expect(call.headers["x-goog-api-key"]).toBe("test-key");
    const config = (call.body.generationConfig as { responseModalities: string[]; imageConfig: Record<string, string> });
    expect(config.responseModalities).toEqual(["IMAGE"]);
    expect(config.imageConfig).toEqual({ aspectRatio: "3:4", imageSize: "2k" });
  });

  it("垫图走 inlineData，且排在提示词之后", async () => {
    const { fetchImpl, calls } = fakeFetch(() => inlineResponse());
    const gen = new Flow2ApiImageGen(opts, fetchImpl as never);
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
    const gen = new Flow2ApiImageGen(opts, fetchImpl as never);
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
    await expect(new Flow2ApiImageGen(opts, fetchImpl as never).generate({ prompt: "x" })).rejects.toThrow(
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
    await expect(new Flow2ApiImageGen(opts, fetchImpl as never).generate({ prompt: "x" })).rejects.toThrow(
      /未出图：这张图被安全策略拦截了/,
    );
  });

  it("HTTP 报错带出状态与响应片段", async () => {
    const { fetchImpl } = fakeFetch(() => new Response("auth_unavailable", { status: 503 }));
    await expect(new Flow2ApiImageGen(opts, fetchImpl as never).generate({ prompt: "x" })).rejects.toThrow(
      /HTTP 503.*auth_unavailable/,
    );
  });

  it("非法画幅在发请求前就报错（flow2api 拿到坏画幅不报错，只会降级出方图）", async () => {
    const { fetchImpl, calls } = fakeFetch(() => inlineResponse());
    await expect(
      new Flow2ApiImageGen(opts, fetchImpl as never).generate({ prompt: "x", aspectRatio: "21:9" as never }),
    ).rejects.toThrow(/画幅/);
    expect(calls).toHaveLength(0);
  });
});
