import { describe, expect, it } from "vitest";
import { OpenAiImageGen, openAiCanvasFor as canvasFor } from "../src/index.js";

const OPENAI_OPTS = {
  baseUrl: "http://gateway",
  apiKey: "test-key",
  model: "gpt-image-2",
  size: "1K",
  timeoutMs: 1000,
};

describe("OpenAiImageGen：OpenAI 格式生图", () => {
  it("按画幅把档位换算成 WxH（总像素量级，两边对齐 16 的倍数）", () => {
    expect(canvasFor("16:9", "1K")).toBe("1360x768");
    expect(canvasFor("9:16", "1K")).toBe("768x1360");
    expect(canvasFor("1:1", "1K")).toBe("1024x1024");
    expect(canvasFor("16:9", "2K")).toBe("2736x1536");
  });

  it("字面尺寸原样发出（老模型只认它自己那几个尺寸）", async () => {
    const sent: Record<string, unknown>[] = [];
    const gen = new OpenAiImageGen({ ...OPENAI_OPTS, size: "1536x1024" }, (async (_input: string, init: { body: string }) => {
      sent.push(JSON.parse(init.body));
      return new Response(JSON.stringify({ data: [{ b64_json: "cGl4" }] }), { status: 200 });
    }) as never);
    await gen.generate({ prompt: "a", aspectRatio: "9:16" });
    expect(sent[0]).toMatchObject({ size: "1536x1024" });
  });

  it("档位算出来的尺寸越过 gpt-image-2 的官方上限就报出来，不发出去", async () => {
    const gen = new OpenAiImageGen({ ...OPENAI_OPTS, size: "4K" }, (async () => {
      throw new Error("不该被调用");
    }) as never);
    await expect(gen.generate({ prompt: "a", aspectRatio: "16:9" })).rejects.toThrow(/3840x2160/);
  });

  it("images/generations：base64 直接落，url 走二次下载", async () => {
    const sent: Record<string, unknown>[] = [];
    const gen = new OpenAiImageGen(OPENAI_OPTS, (async (input: string, init: { body: string }) => {
      if (String(input).endsWith("/v1/images/generations")) {
        sent.push(JSON.parse(init.body));
        return new Response(
          JSON.stringify({ data: [{ b64_json: Buffer.from("pix").toString("base64") }] }),
          { status: 200 },
        );
      }
      return new Response("remote-bytes", { status: 200 });
    }) as never);
    expect((await gen.generate({ prompt: "a", aspectRatio: "9:16" })).data.toString()).toBe("pix");
    expect(sent[0]).toMatchObject({ model: "gpt-image-2", prompt: "a", size: "768x1360", n: 1 });

    const urlGen = new OpenAiImageGen(OPENAI_OPTS, (async (input: string) => {
      if (String(input).endsWith("/v1/images/generations")) {
        return new Response(JSON.stringify({ data: [{ url: "http://cdn/x.jpg" }] }), { status: 200 });
      }
      return new Response("remote-bytes", { status: 200 });
    }) as never);
    expect((await urlGen.generate({ prompt: "b" })).data.toString()).toBe("remote-bytes");
  });

  it("垫图发不出去：有这个接口没有的入参就直接拒，不静默丢弃", async () => {
    const gen = new OpenAiImageGen(OPENAI_OPTS, (async () => new Response("{}")) as never);
    await expect(
      gen.generate({ prompt: "a", references: [{ mimeType: "image/png", data: Buffer.from("x") }] }),
    ).rejects.toThrow(/没有参考图入参/);
  });

  it("网关报错带出状态与响应体片段", async () => {
    const gen = new OpenAiImageGen(OPENAI_OPTS, (async () => new Response("auth_unavailable", { status: 503 })) as never);
    await expect(gen.generate({ prompt: "a" })).rejects.toThrow("OpenAI 格式出图失败 HTTP 503：auth_unavailable");
  });
});

