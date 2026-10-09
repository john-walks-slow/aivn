import { describe, expect, it } from "vitest";
import { musicGenerate, requestOf, skipReceipt } from "../src/capabilities/music/generate.js";
import { GeminiMusicGen, parseMusic, MUSIC_EXT_BY_MIME } from "../src/media/music.js";

describe("music.generate", () => {
  function deps(existing: string | null = null) {
    const started: unknown[] = [];
    return {
      started,
      existing: async () => existing,
      start: async (request: unknown) => {
        started.push(request);
        return "已发起";
      },
    };
  }

  it("请求先归一化：id 与 prompt 修边，空串与空白项剔掉（别把空标签写进素材表）", async () => {
    const fake = deps();
    await musicGenerate.execute({ name: "  bgm_a  ", prompt: "  solo piano ", overwrite: false }, fake);
    // 元数据（title / mood / tags / scene…）不在这条路上：出完用 annotate_asset 标
    expect(fake.started).toEqual([{ name: "bgm_a", prompt: "solo piano", overwrite: false }]);
  });

  it("剧目里已有同名曲子默认跳过（不烧那一分半），回执说清怎么重做", async () => {
    const fake = deps("assets/bgm/bgm_a.m4a");
    const text = await musicGenerate.execute({ name: "bgm_a", prompt: "p" }, fake);
    expect(fake.started).toHaveLength(0);
    expect(text).toContain("已经有同名曲子");
    expect(text).toContain("overwrite=true");
    expect(text).toContain('<scene bgm="bgm_a" />');
  });

  it("overwrite 放行；回执由宿主的 start 给（排产回「已发起」、同步回「已入库」，共享文案不分叉）", async () => {
    const fake = deps("assets/bgm/bgm_a.m4a");
    const text = await musicGenerate.execute({ name: "bgm_a", prompt: "p", overwrite: true }, fake);
    expect(fake.started).toHaveLength(1);
    expect(text).toBe("已发起");
  });

  it("发起失败也当一句正文回给模型，不炸整轮", async () => {
    const text = await musicGenerate.execute(
      { name: "bgm_a", prompt: "p" },
      { existing: async () => null, start: async () => { throw new Error("上游 502"); } },
    );
    expect(text).toBe("没能发起音乐生成：上游 502");
  });

  it("skipReceipt 与 requestOf 是能力自己的出口（宿主只提供 existing 与 start）", () => {
    expect(skipReceipt("bgm_a", "assets/bgm/bgm_a.m4a")).toContain("assets/bgm/bgm_a.m4a");
    expect(requestOf({ name: "n", prompt: "p", overwrite: false })).toEqual({ name: "n", prompt: "p", overwrite: false });
  });
});

describe("GeminiMusicGen（协议随包）", () => {
  const opts = { baseUrl: "https://gw.test/", apiKey: "k", model: "flow-music-lyria-3.5", timeoutMs: 1000 };

  it("模型可被单次请求覆盖，端点、鉴权头与请求体都是 Gemini 原生形状", async () => {
    let seen: { url: string; init: any } | null = null;
    const backend = new GeminiMusicGen(opts, async (url, init) => {
      seen = { url, init };
      return {
        ok: true,
        status: 200,
        async json() {
          return { candidates: [{ content: { parts: [{ inlineData: { mimeType: "audio/mp4", data: Buffer.from("hi").toString("base64") } }] } }] };
        },
      } as never;
    });
    const out = await backend.generate({ prompt: "quiet piano", model: "musicfx" });
    expect(seen!.url).toBe("https://gw.test/v1beta/models/musicfx:generateContent");
    expect(seen!.init.headers["x-goog-api-key"]).toBe("k");
    expect(JSON.parse(seen!.init.body).contents[0].parts[0].text).toBe("quiet piano");
    expect(out.ext).toBe(".m4a");
    expect(out.bytes.toString()).toBe("hi");
  });

  it("没有音频时报上游给的原因（安全拦截往往只有 finishReason 这一处线索）", () => {
    expect(() => parseMusic({ candidates: [{ finishReason: "SAFETY" }] }, "m1")).toThrow(/SAFETY/);
    expect(MUSIC_EXT_BY_MIME["audio/mpeg"]).toBe(".mp3");
  });

  it("不给 key 就不带鉴权头（本机网关不校验）", async () => {
    let headers: Record<string, string> = {};
    const backend = new GeminiMusicGen({ ...opts, apiKey: undefined }, async (_url, init) => {
      headers = (init?.headers ?? {}) as Record<string, string>;
      return {
        ok: false,
        status: 500,
        async text() {
          return "boom";
        },
      } as never;
    });
    await expect(backend.generate({ prompt: "p" })).rejects.toThrow(/HTTP 500/);
    expect(headers["x-goog-api-key"]).toBeUndefined();
  });
});
