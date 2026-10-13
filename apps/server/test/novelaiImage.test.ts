import { zipSync } from "fflate";
import sharp from "sharp";
import { describe, expect, it } from "vitest";
import { sniffImageMime } from "../src/imageBackend.js";
import { NovelAiImageGen, canvasFor } from "../src/novelaiImage.js";
import type { NovelAiImageOptions } from "../src/novelaiImage.js";

const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64",
);

const zipOf = (...names: string[]): Uint8Array =>
  zipSync(Object.fromEntries(names.map((name) => [name, new Uint8Array(PNG)])));

interface Call {
  url: string;
  headers: Record<string, string>;
  body: Record<string, unknown>;
}

/** 官方成功响应是一个 ZIP（内含 image_0.png），不是图片字节。 */
function fakeFetch(calls: Call[], zip: Uint8Array = zipOf("image_0.png", "image_1.png")) {
  return (async (url: string, init: { headers: Record<string, string>; body: string }) => {
    calls.push({ url, headers: init.headers, body: JSON.parse(init.body) });
    return new Response(zip, { status: 200, headers: { "content-type": "binary/octet-stream" } });
  }) as unknown as typeof fetch;
}

const opts: NovelAiImageOptions = {
  baseUrl: "https://image.novelai.net/",
  apiKey: "pst-test-token",
  model: "nai-diffusion-4-5-full",
  size: "1K",
  timeoutMs: 1000,
};

const parametersOf = (call: Call): Record<string, unknown> => call.body.parameters as Record<string, unknown>;

const reference = { mimeType: "image/png", data: PNG };

describe("NovelAiImageGen", () => {
  it("画布：档位当目标面积按画幅展开，两边都是 64 的倍数且不越单图预算", () => {
    expect(canvasFor("16:9", 1024 ** 2)).toEqual({ width: 1344, height: 768 });
    expect(canvasFor("9:16", 1024 ** 2)).toEqual({ width: 768, height: 1344 });
    expect(canvasFor("1:1", 1024 ** 2)).toEqual({ width: 1024, height: 1024 });
    // 2K 的目标面积本来就超单图上限，朝预算收缩（1:1 就是 1728x1792）
    expect(canvasFor("1:1", 2048 ** 2)).toEqual({ width: 1728, height: 1792 });
  });

  it("画布：档位面积超上限时收缩，两边仍对齐 64", () => {
    for (const aspect of ["16:9", "9:16", "3:4", "1:1", "21:9"] as const) {
      const { width, height } = canvasFor(aspect, 4096 ** 2);
      expect(width % 64).toBe(0);
      expect(height % 64).toBe(0);
      expect(width * height).toBeLessThanOrEqual(3_145_728);
      expect(width).toBeLessThanOrEqual(2048);
      expect(height).toBeLessThanOrEqual(2048);
    }
  });

  it("V4/V4.5：走 v4_prompt 与 v4_negative_prompt，Key 走 Bearer 头", async () => {
    const calls: Call[] = [];
    const gen = new NovelAiImageGen(opts, fakeFetch(calls));
    const image = await gen.generate({ prompt: "黄昏教室", aspectRatio: "16:9", size: "2K" });

    expect(image.mimeType).toBe("image/png");
    expect(calls[0]!.url).toBe("https://image.novelai.net/ai/generate-image");
    expect(calls[0]!.headers.authorization).toBe("Bearer pst-test-token");
    expect(calls[0]!.body).toMatchObject({ input: "黄昏教室", model: "nai-diffusion-4-5-full", action: "generate" });

    const parameters = parametersOf(calls[0]!);
    expect(parameters).toMatchObject({ width: 2048, height: 1152, n_samples: 1, sampler: "k_euler_ancestral" });
    // 两个 v4 结构必须同时在场：缺一个上游回 500 而不是 400
    expect(parameters.v4_prompt).toMatchObject({ caption: { base_caption: "黄昏教室" } });
    expect(parameters.v4_negative_prompt).toMatchObject({ caption: { base_caption: expect.any(String) } });
    expect(parameters).not.toHaveProperty("uc");
  });

  it("V5 发 params_version 4、V4/V3 发 3（值被上游忽略，照官方填）", async () => {
    const calls: Call[] = [];
    const gen = new NovelAiImageGen(opts, fakeFetch(calls));
    await gen.generate({ prompt: "x", model: "nai-diffusion-5-full" });
    expect(parametersOf(calls[0]!).params_version).toBe(4);

    const legacy: Call[] = [];
    const v3 = new NovelAiImageGen({ ...opts, model: "nai-diffusion-3" }, fakeFetch(legacy));
    await v3.generate({ prompt: "x" });
    expect(parametersOf(legacy[0]!).params_version).toBe(3);
  });

  it("V3 及更早走 prompt + uc，不发 v4 结构", async () => {
    const calls: Call[] = [];
    const gen = new NovelAiImageGen({ ...opts, model: "nai-diffusion-3" }, fakeFetch(calls));
    await gen.generate({ prompt: "1girl, solo" });

    const parameters = parametersOf(calls[0]!);
    expect(parameters).toMatchObject({ prompt: "1girl, solo" });
    expect(String(parameters.uc)).toMatch(/lowres/);
    expect(parameters).not.toHaveProperty("v4_prompt");
    expect(parameters).not.toHaveProperty("v4_negative_prompt");
  });

  it("同画幅单张垫图走 img2img：源图先落到目标画布并编成 PNG", async () => {
    const calls: Call[] = [];
    const gen = new NovelAiImageGen(opts, fakeFetch(calls));
    // 1x1 参考图与 1:1 画幅匹配 → 走 img2img（立绘 neutral → 表情差分就是同画幅）
    await gen.generate({ prompt: "同一张脸", aspectRatio: "1:1", references: [reference] });

    expect(calls[0]!.body.action).toBe("img2img");
    const parameters = parametersOf(calls[0]!);
    expect(parameters).toMatchObject({ strength: 0.7, noise: 0 });

    const raw = String(parameters.image);
    expect(raw).not.toMatch(/^data:/);
    const fitted = Buffer.from(raw, "base64");
    expect(sniffImageMime(fitted)).toBe("image/png");
    expect(await sharp(fitted).metadata()).toMatchObject({ width: 1024, height: 1024 });
  });

  it("V4.5 跨画幅单张垫图或多张参考图走 director_reference_images，并剥掉多模态尾注", async () => {
    const calls: Call[] = [];
    const gen = new NovelAiImageGen(opts, fakeFetch(calls));
    // 1x1 参考图垫进 16:9 CG（跨画幅）或多张参考图 → 走 director_reference_images
    await gen.generate({
      prompt:
        "2girls, tea party. The attached reference images are, in this exact order: 1) Alice, 2) Bob. Keep each of them recognisably that same person.",
      aspectRatio: "16:9",
      references: [reference, reference],
    });

    expect(calls[0]!.body.action).toBe("generate");
    expect(calls[0]!.body.input).toBe("2girls, tea party");
    const parameters = parametersOf(calls[0]!);
    expect(parameters).not.toHaveProperty("image");
    const dirImgs = parameters.director_reference_images as string[];
    expect(dirImgs).toHaveLength(2);
    const decoded = Buffer.from(dirImgs[0]!, "base64");
    expect(sniffImageMime(decoded)).toBe("image/png");
    expect(await sharp(decoded).metadata()).toMatchObject({ width: 1024, height: 1536 });
    expect(parameters.director_reference_strength_values).toEqual([1, 1]);

    // 非 V4.5 模型不支持多张参考图
    const v3 = new NovelAiImageGen({ ...opts, model: "nai-diffusion-3" }, fakeFetch([]));
    await expect(v3.generate({ prompt: "两个人", references: [reference, reference] })).rejects.toThrow(/只吃一张/);
  });

  it("垫图是 JPEG（立绘留底原片就是 JPEG）也照收：转成 PNG 再发", async () => {
    const jpeg = await sharp(PNG).jpeg().toBuffer();
    const calls: Call[] = [];
    const gen = new NovelAiImageGen(opts, fakeFetch(calls));
    await gen.generate({ prompt: "x", aspectRatio: "1:1", references: [{ mimeType: "image/jpeg", data: jpeg }] });

    const fitted = Buffer.from(String(parametersOf(calls[0]!).image), "base64");
    expect(sniffImageMime(fitted)).toBe("image/png");
  });

  it("响应是 ZIP：解出里面的图片；不是 ZIP 就退回「整段是图」；两者都不是才报错", async () => {
    const gen = new NovelAiImageGen(opts, fakeFetch([], zipOf("image_0.png")));
    expect((await gen.generate({ prompt: "x" })).data.equals(PNG)).toBe(true);

    // 上游换端点时可能直接给图片字节，字节头认得出就收下
    const raw = (async () =>
      new Response(PNG, { status: 200, headers: { "content-type": "image/png" } })) as unknown as typeof fetch;
    expect(await new NovelAiImageGen(opts, raw).generate({ prompt: "x" })).toMatchObject({
      mimeType: "image/png",
    });

    const noImage = new NovelAiImageGen(opts, fakeFetch([], zipOf("readme.txt")));
    await expect(noImage.generate({ prompt: "x" })).rejects.toThrow(/ZIP 里没有图片条目/);

    const garbage = (async () => new Response("not an image", { status: 200 })) as unknown as typeof fetch;
    await expect(new NovelAiImageGen(opts, garbage).generate({ prompt: "x" })).rejects.toThrow(
      /既不是图片也不是 ZIP/,
    );
  });

  it("字面像素：不是 64 的倍数、或越界，都在发请求前报错", async () => {
    const gen = new NovelAiImageGen(opts, fakeFetch([]));
    await expect(gen.generate({ prompt: "x", size: "1000x1000" })).rejects.toThrow(/64 的倍数/);
    await expect(gen.generate({ prompt: "x", size: "4096x4096" })).rejects.toThrow(/单图上限/);
    await expect(gen.generate({ prompt: "x", size: "1024x1024" })).resolves.toBeTruthy();
  });

  it("非法画幅在请求前拦下", async () => {
    const gen = new NovelAiImageGen(opts, fakeFetch([]));
    await expect(gen.generate({ prompt: "x", aspectRatio: "7:5" as never })).rejects.toThrow(/画幅/);
  });

  it("HTTP 失败带上状态码与上游 message（401 是 token 的问题，不是模型的问题）", async () => {
    const impl = (async () =>
      new Response(JSON.stringify({ statusCode: 401, message: "Access Token is incorrect." }), {
        status: 401,
      })) as unknown as typeof fetch;
    const gen = new NovelAiImageGen(opts, impl);
    await expect(gen.generate({ prompt: "x" })).rejects.toThrow(/HTTP 401：Access Token is incorrect\./);
  });
});
