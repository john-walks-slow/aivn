import { describe, expect, it } from "vitest";
import { ModelsLabImageGen, canvasFor } from "../src/modelslabImage.js";
import type { ModelsLabImageOptions } from "../src/modelslabImage.js";

const HOSTED = "https://cdn.modelslab.com/tmp/init.png";
const IMG = "https://cdn.modelslab.com/out/result.png";

const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64",
);

/** 垫图上传与出图两次 POST 都要走同一个替身，按路径分派。 */
function fakeFetch(calls: { path: string; body: Record<string, unknown> }[]) {
  const impl = (async (url: string, init: { body: string }) => {
    const path = String(url);
    if (!path.startsWith("http://api.test")) return imageResponse();
    const body = JSON.parse(init.body);
    calls.push({ path, body });
    const json = path.endsWith("/base64_to_url")
      ? { status: "success", output: [HOSTED] }
      : { status: "success", output: [IMG], generationTime: 4.2 };
    return new Response(JSON.stringify(json), { status: 200 });
  }) as unknown as typeof fetch;
  return impl;
}

const imageResponse = (): Response =>
  new Response(PNG, { status: 200, headers: { "content-type": "image/png" } });

const opts: ModelsLabImageOptions = {
  baseUrl: "http://api.test/api/v6",
  apiKey: "test-key",
  model: "anillustrious",
  size: "1K",
  timeoutMs: 1000,
};

const reference = { mimeType: "image/png", data: PNG };

describe("ModelsLabImageGen", () => {
  it("画布：长边顶到单边上限 1024，短边按比例对齐 8（w<h 的画幅竖着给）", () => {
    expect(canvasFor("16:9")).toBe("1024x576");
    expect(canvasFor("9:16")).toBe("576x1024");
    expect(canvasFor("4:3")).toBe("1024x768");
    expect(canvasFor("3:4")).toBe("768x1024");
    expect(canvasFor("1:1")).toBe("1024x1024");
  });

  it("无垫图走 text2img：key 进请求体，画幅换算成 width/height", async () => {
    const calls: { path: string; body: Record<string, unknown> }[] = [];
    const gen = new ModelsLabImageGen(opts, fakeFetch(calls));
    const image = await gen.generate({ prompt: "黄昏教室", aspectRatio: "16:9" });

    expect(image.mimeType).toBe("image/png");
    expect(calls).toHaveLength(1);
    expect(calls[0]!.path).toBe("http://api.test/api/v6/images/text2img");
    expect(calls[0]!.body).toMatchObject({ key: "test-key", model_id: "anillustrious", width: 1024, height: 576 });
    // 提示词是 tag 结构，增强与 NSFW 检查都要显式关掉
    expect(calls[0]!.body).toMatchObject({ enhance_prompt: false, safety_checker: false });
  });

  it("带垫图走两步：先 base64 换托管链接，再 img2img，且不发 width/height（画幅随垫图走）", async () => {
    const calls: { path: string; body: Record<string, unknown> }[] = [];
    const gen = new ModelsLabImageGen(opts, fakeFetch(calls));
    await gen.generate({ prompt: "同一张脸", references: [reference] });

    expect(calls.map((c) => c.path)).toEqual([
      "http://api.test/api/v6/image_editing/base64_to_url",
      "http://api.test/api/v6/images/img2img",
    ]);
    expect(String(calls[0]!.body.init_image)).toMatch(/^data:image\/png;base64,/);
    expect(calls[1]!.body).toMatchObject({ init_image: HOSTED });
    expect(calls[1]!.body).not.toHaveProperty("width");
  });

  it("超过一张垫图直接报错，不静默取第一张", async () => {
    const gen = new ModelsLabImageGen(opts, fakeFetch([]));
    await expect(gen.generate({ prompt: "两个人", references: [reference, reference] })).rejects.toThrow(
      /只吃一张垫图/,
    );
  });

  it("字面像素越单边上限即报错；剧目覆盖的尺寸同样过这条", async () => {
    const gen = new ModelsLabImageGen({ ...opts, size: "2048x1024" }, fakeFetch([]));
    await expect(gen.generate({ prompt: "x", aspectRatio: "16:9" })).rejects.toThrow(/单边上限/);

    const ok = new ModelsLabImageGen(opts, fakeFetch([]));
    await expect(ok.generate({ prompt: "x", size: "2048x1024" })).rejects.toThrow(/单边上限/);
  });

  it("异步队列与错误响应各报各的，别混成「没有图片」", async () => {
    const respond = (payload: unknown) =>
      (async () =>
        new Response(JSON.stringify(payload), { status: 200 })) as unknown as typeof fetch;
    const gen = new ModelsLabImageGen(opts, respond({ status: "processing", id: 7 }));
    await expect(gen.generate({ prompt: "x" })).rejects.toThrow(/异步队列/);

    const failed = new ModelsLabImageGen(opts, respond({ status: "error", message: "模型不存在" }));
    await expect(failed.generate({ prompt: "x" })).rejects.toThrow(/模型不存在/);
  });

  it("非法画幅构造后就在请求前拦下", async () => {
    const gen = new ModelsLabImageGen(opts, fakeFetch([]));
    await expect(gen.generate({ prompt: "x", aspectRatio: "7:5" as never })).rejects.toThrow(/画幅/);
  });

  it("HTTP 失败带上状态码与上游原因，别报成「没有图片地址」", async () => {
    const impl = (async () =>
      new Response(JSON.stringify({ message: "insufficient credits" }), { status: 402 })) as unknown as typeof fetch;
    const gen = new ModelsLabImageGen(opts, impl);
    await expect(gen.generate({ prompt: "x" })).rejects.toThrow(/HTTP 402：insufficient credits/);
  });
});