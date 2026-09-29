import { describe, expect, it } from "vitest";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ImageGen } from "../src/imagegen.js";
import { ImageAssets } from "../src/imageAssets.js";
import { PlayStore } from "../src/store.js";
import { PlaywrightOrchestrator } from "../src/orchestrator.js";
import { LineageTree } from "@stage-ai/core";
import { PlayMemory } from "../src/memory.js";
import { createFakeStreamFn, PLAY } from "./helpers.js";

async function makeStore(): Promise<PlayStore> {
  const dir = await mkdtemp(join(tmpdir(), "stage-image-"));
  await writeFile(join(dir, "play.json"), JSON.stringify({ id: "img", ...PLAY }));
  await writeFile(join(dir, "lineage.jsonl"), "");
  return new PlayStore(dir);
}

/** 记录调用次数的假生图器：同 prompt 只应被生成一次。 */
function fakeGen(delayMs = 0): { gen: ImageGen; calls: string[] } {
  const calls: string[] = [];
  const gen = {
    generate: async (prompt: string) => {
      calls.push(prompt);
      if (delayMs > 0) await new Promise((resolve) => setTimeout(resolve, delayMs));
      return { data: Buffer.from(`img:${prompt}`), ext: "jpg" as const };
    },
  } as unknown as ImageGen;
  return { gen, calls };
}

describe("ImageAssets：内容寻址缓存与预发射", () => {
  it("命中缓存不重复生成，manifest 落盘后重启可复用", async () => {
    const store = await makeStore();
    const { gen, calls } = fakeGen();
    const assets = new ImageAssets("img", store, gen, 2);
    await assets.load();

    const first = await assets.preload("bg", "rooftop at sunset", "bg_rooftop");
    expect(calls).toHaveLength(1);
    expect(existsSync(store.imagePath(first.url.split("/").pop()!))).toBe(true);

    // 同 id 同描述：直接命中，不进生成器
    const again = await assets.preload("bg", "rooftop at sunset", "bg_rooftop");
    expect(again.url).toBe(first.url);
    expect(calls).toHaveLength(1);
    await new Promise((r) => setTimeout(r, 10));

    // 新实例 load：manifest 读回，缓存命中
    const revived = new ImageAssets("img", store, gen, 2);
    await revived.load();
    expect(revived.snapshot()).toEqual([first]);
    expect(await revived.preload("bg", "rooftop at sunset", "bg_rooftop")).toEqual(first);
    expect(calls).toHaveLength(1);
  });

  it("同描述不同 id 共用一张图（复用键 = type+prompt）", async () => {
    const store = await makeStore();
    const { gen, calls } = fakeGen();
    const assets = new ImageAssets("img", store, gen, 2);
    const a = await assets.preload("cg", "confession under stars", "cg_01");
    const b = await assets.preload("cg", "confession under stars", "cg_02");
    expect(b.url).toBe(a.url);
    expect(calls).toEqual(["confession under stars"]);
    expect(assets.snapshot().map((x) => x.id).sort()).toEqual(["cg_01", "cg_02"]);
  });

  it("在飞去重：同 id 并发两次只生成一张", async () => {
    const store = await makeStore();
    const { gen, calls } = fakeGen(20);
    const assets = new ImageAssets("img", store, gen, 2);
    const [a, b] = await Promise.all([
      assets.preload("bg", "rainy station", "bg_station"),
      assets.preload("bg", "rainy station", "bg_station"),
    ]);
    expect(a.url).toBe(b.url);
    expect(calls).toHaveLength(1);
  });

  it("不同 id 同描述并发：只出一次图（按内容指纹去重，不只按 id）", async () => {
    const store = await makeStore();
    const { gen, calls } = fakeGen(30);
    const assets = new ImageAssets("img", store, gen, 4);
    const [a, b] = await Promise.all([
      assets.preload("cg", "same prompt", "cg_a"),
      assets.preload("cg", "same prompt", "cg_b"),
    ]);
    expect(a.url).toBe(b.url);
    expect(calls).toEqual(["same prompt"]);
  });

  it("并发闸门不超发（并发上限 2 → 同一时刻最多 2 次生成）", async () => {
    const store = await makeStore();
    let live = 0;
    let peak = 0;
    const gen = {
      generate: async () => {
        live += 1;
        peak = Math.max(peak, live);
        await new Promise((r) => setTimeout(r, 20));
        live -= 1;
        return { data: Buffer.from("x"), ext: "jpg" as const };
      },
    } as unknown as ImageGen;
    const assets = new ImageAssets("img", store, gen, 2);
    await Promise.all(
      ["a", "b", "c", "d", "e"].map((id) => assets.preload("bg", `prompt ${id}`, id)),
    );
    expect(peak).toBe(2);
  });

  it("失败向上抛（由调用方降级），不留 manifest 记录", async () => {
    const store = await makeStore();
    const gen = {
      generate: async () => {
        throw new Error("网关 503");
      },
    } as unknown as ImageGen;
    const assets = new ImageAssets("img", store, gen, 2);
    await expect(assets.preload("bg", "x", "bg_x")).rejects.toThrow("网关 503");
    expect(assets.snapshot()).toEqual([]);
  });

  it("manifest 指向的文件被删后不认账（磁盘是权威）", async () => {
    const store = await makeStore();
    const { gen } = fakeGen();
    const assets = new ImageAssets("img", store, gen, 2);
    const asset = await assets.preload("bg", "shrine steps", "bg_shrine");
    await new Promise((r) => setTimeout(r, 10));
    const { rm } = await import("node:fs/promises");
    await rm(store.imagePath(asset.url.split("/").pop()!));

    const revived = new ImageAssets("img", store, gen, 2);
    await revived.load();
    expect(revived.snapshot()).toEqual([]);
  });
});

describe("ImageGen：cpa 两种出图协议", () => {
  it("images/generations：base64 直接落，url 走二次下载", async () => {
    const gen = new ImageGen(
      { baseUrl: "http://cpa/v1", apiKey: "test-key", model: "gpt-image-2", size: "1536x1024", timeoutMs: 1000 },
      (async (input: string) => {
        if (String(input).endsWith("/images/generations")) {
          return new Response(
            JSON.stringify({ data: [{ b64_json: Buffer.from("pix").toString("base64") }] }),
            { status: 200 },
          );
        }
        return new Response("remote-bytes", { status: 200 });
      }) as never,
    );
    expect((await gen.generate("a")).data.toString()).toBe("pix");

    const urlGen = new ImageGen(
      { baseUrl: "http://cpa/v1", apiKey: "test-key", model: "gpt-image-2", size: "1536x1024", timeoutMs: 1000 },
      (async (input: string) => {
        if (String(input).endsWith("/images/generations")) {
          return new Response(JSON.stringify({ data: [{ url: "http://cdn/x.jpg" }] }), { status: 200 });
        }
        return new Response("remote-bytes", { status: 200 });
      }) as never,
    );
    expect((await urlGen.generate("b")).data.toString()).toBe("remote-bytes");
  });

  it("gemini：SSE 流里抓 delta.images 的 data URL", async () => {
    const b64 = Buffer.from("streamed-pixels").toString("base64");
    const sse =
      `data: ${JSON.stringify({ choices: [{ delta: { content: "" } }] })}\n\n` +
      `data: ${JSON.stringify({ choices: [{ delta: { images: [{ image_url: { url: `data:image/jpeg;base64,${b64}` } }] } }] })}\n\n` +
      "data: [DONE]\n\n";
    const gen = new ImageGen(
      { baseUrl: "http://cpa/v1", apiKey: "test-key", model: "gemini-3.1-flash-image", size: "1536x1024", timeoutMs: 1000 },
      (async () => new Response(sse, { status: 200 })) as never,
    );
    expect((await gen.generate("a")).data.toString()).toBe("streamed-pixels");
  });

  it("网关报错带出状态与响应体片段", async () => {
    const gen = new ImageGen(
      { baseUrl: "http://cpa/v1", apiKey: "test-key", model: "gpt-image-2", size: "1536x1024", timeoutMs: 1000 },
      (async () => new Response("auth_unavailable", { status: 503 })) as never,
    );
    await expect(gen.generate("a")).rejects.toThrow("生图 HTTP 503: auth_unavailable");
  });
});

describe("编排器：preload_asset 预发射钩子", () => {
  it("bg/cg 触发预发射，sprite 不发，已有同名素材不烧配额", async () => {
    const store = await makeStore();
    const tree = new LineageTree();
    const calls: [string, string, string][] = [];
    const orchestrator = new PlaywrightOrchestrator({
      streamFn: createFakeStreamFn([
        {
          text:
            '<preload_asset type="bg" prompt="rainy station" id="bg_station"/>\n' +
            '<preload_asset type="cg" prompt="confession" id="cg_01"/>\n' +
            '<preload_asset type="sprite" prompt="smile" id="sp_smile"/>\n' +
            '<preload_asset type="bg" prompt="sunset corridor" id="bg_rooftop_sunset"/>\n' +
            '<stop type="free"></stop>',
        },
      ]),
      model: {} as never,
      getApiKey: () => "test-key",
      play: { ...PLAY, id: "img" },
      memory: await PlayMemory.load(store),
      tree,
      engine: { turn: 0, affinity: {}, flags: {} },
      scene: "走廊",
      persist: () => {},
      // 已有导入素材的 id：不该再发一次生图
      assets: { backgrounds: ["bg_rooftop_sunset.jpg"] },
      onPreloadAsset: (type, prompt, id) => {
        calls.push([type, prompt, id]);
      },
      onServerMessage: () => {},
    });
    await orchestrator.autostart();
    await orchestrator.whenIdle();
    // bg_rooftop_sunset 已在 assets/backgrounds 里 → 不发起
    expect(calls).toEqual([
      ["bg", "rainy station", "bg_station"],
      ["cg", "confession", "cg_01"],
    ]);
    orchestrator.dispose();
  });
});
