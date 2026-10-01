import { describe, expect, it } from "vitest";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CpaImageGen } from "../src/imagegen.js";
import { ImageAssets } from "../src/imageAssets.js";
import { Limiter } from "../src/limiter.js";
import type { ImageBackend } from "../src/imageBackend.js";
import { PlayStore } from "../src/store.js";
import { createGenerateImageTool } from "../src/agentkit/imageTool.js";
import { PlaywrightOrchestrator } from "../src/orchestrator.js";
import { LineageTree } from "@stage-ai/core";
import { PlayMemory } from "../src/memory.js";
import { BEAT_2, createFakeStreamFn, PLAY } from "./helpers.js";

async function makeStore(): Promise<PlayStore> {
  const dir = await mkdtemp(join(tmpdir(), "stage-image-"));
  await writeFile(join(dir, "play.json"), JSON.stringify({ id: "img", ...PLAY }));
  await writeFile(join(dir, "lineage.jsonl"), "");
  return new PlayStore(dir);
}

/** 记录调用次数的假生图后端：同 prompt 只应被生成一次。 */
function fakeGen(delayMs = 0): { gen: ImageBackend; calls: string[] } {
  const calls: string[] = [];
  const gen: ImageBackend = {
    generate: async ({ prompt }) => {
      calls.push(prompt);
      if (delayMs > 0) await new Promise((resolve) => setTimeout(resolve, delayMs));
      return { data: Buffer.from(`img:${prompt}`), mimeType: "image/jpeg" };
    },
  };
  return { gen, calls };
}

describe("ImageAssets：内容寻址缓存与预发射", () => {
  it("命中缓存不重复生成，manifest 落盘后重启可复用", async () => {
    const store = await makeStore();
    const { gen, calls } = fakeGen();
    const assets = new ImageAssets("img", store, gen, new Limiter(2));
    await assets.load();

    const first = await assets.preload("bg", "rooftop at sunset", "bg_rooftop");
    expect(calls).toHaveLength(1);
    expect(existsSync(store.imagePath(first.url.split("/").pop()!))).toBe(true);

    // 同 id 同描述：直接命中，不进生成器
    const again = await assets.preload("bg", "rooftop at sunset", "bg_rooftop");
    expect(again.url).toBe(first.url);
    expect(calls).toHaveLength(1);
    // manifest 是 fire-and-forget 落盘（preload 不能被磁盘写阻塞），断言复用前显式等它落完
    await assets.flush();

    // 新实例 load：manifest 读回，缓存命中
    const revived = new ImageAssets("img", store, gen, new Limiter(2));
    await revived.load();
    expect(revived.snapshot()).toEqual([first]);
    expect(await revived.preload("bg", "rooftop at sunset", "bg_rooftop")).toEqual(first);
    expect(calls).toHaveLength(1);
  });

  it("prompt 落 manifest：重启后仍报得出这张图画的是什么，且不外泄到 WS 快照", async () => {
    const store = await makeStore();
    const { gen } = fakeGen();
    const assets = new ImageAssets("img", store, gen, new Limiter(2));
    await assets.load();
    await assets.preload("bg", "rooftop at sunset", "bg_rooftop");
    await assets.flush();

    const revived = new ImageAssets("img", store, gen, new Limiter(2));
    await revived.load();
    expect(revived.notes()).toEqual([{ id: "bg_rooftop", type: "bg", prompt: "rooftop at sunset" }]);
    expect(revived.snapshot()[0]).not.toHaveProperty("prompt");
  });

  it("同描述不同 id 共用一张图（复用键 = type+prompt）", async () => {
    const store = await makeStore();
    const { gen, calls } = fakeGen();
    const assets = new ImageAssets("img", store, gen, new Limiter(2));
    const a = await assets.preload("cg", "confession under stars", "cg_01");
    const b = await assets.preload("cg", "confession under stars", "cg_02");
    expect(b.url).toBe(a.url);
    expect(calls).toEqual(["confession under stars"]);
    expect(assets.snapshot().map((x) => x.id).sort()).toEqual(["cg_01", "cg_02"]);
  });

  it("在飞去重：同 id 并发两次只生成一张", async () => {
    const store = await makeStore();
    const { gen, calls } = fakeGen(20);
    const assets = new ImageAssets("img", store, gen, new Limiter(2));
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
    const assets = new ImageAssets("img", store, gen, new Limiter(4));
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
    const gen: ImageBackend = {
      generate: async () => {
        live += 1;
        peak = Math.max(peak, live);
        await new Promise((r) => setTimeout(r, 20));
        live -= 1;
        return { data: Buffer.from("x"), mimeType: "image/jpeg" };
      },
    };
    const assets = new ImageAssets("img", store, gen, new Limiter(2));
    await Promise.all(
      ["a", "b", "c", "d", "e"].map((id) => assets.preload("bg", `prompt ${id}`, id)),
    );
    expect(peak).toBe(2);
  });

  it("失败向上抛（由调用方降级），不留 manifest 记录", async () => {
    const store = await makeStore();
    const gen: ImageBackend = {
      generate: async () => {
        throw new Error("网关 503");
      },
    };
    const assets = new ImageAssets("img", store, gen, new Limiter(2));
    await expect(assets.preload("bg", "x", "bg_x")).rejects.toThrow("网关 503");
    expect(assets.snapshot()).toEqual([]);
  });

  it("manifest 指向的文件被删后不认账（磁盘是权威）", async () => {
    const store = await makeStore();
    const { gen } = fakeGen();
    const assets = new ImageAssets("img", store, gen, new Limiter(2));
    const asset = await assets.preload("bg", "shrine steps", "bg_shrine");
    await assets.flush();
    const { rm } = await import("node:fs/promises");
    await rm(store.imagePath(asset.url.split("/").pop()!));

    const revived = new ImageAssets("img", store, gen, new Limiter(2));
    await revived.load();
    expect(revived.snapshot()).toEqual([]);
  });
});

describe("CpaImageGen：cpa 两种出图协议", () => {
  it("images/generations：base64 直接落，url 走二次下载", async () => {
    const gen = new CpaImageGen(
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
    expect((await gen.generate({ prompt: "a" })).data.toString()).toBe("pix");

    const urlGen = new CpaImageGen(
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
    const gen = new CpaImageGen(
      { baseUrl: "http://cpa/v1", apiKey: "test-key", model: "gemini-3.1-flash-image", size: "1536x1024", timeoutMs: 1000 },
      (async () => new Response(sse, { status: 200 })) as never,
    );
    expect((await gen.generate({ prompt: "a" })).data.toString()).toBe("streamed-pixels");
  });

  it("网关报错带出状态与响应体片段", async () => {
    const gen = new CpaImageGen(
      { baseUrl: "http://cpa/v1", apiKey: "test-key", model: "gpt-image-2", size: "1536x1024", timeoutMs: 1000 },
      (async () => new Response("auth_unavailable", { status: 503 })) as never,
    );
    await expect(gen.generate({ prompt: "a" })).rejects.toThrow("生图 HTTP 503: auth_unavailable");
  });
});

describe("剧作家 generate_image：后台排产（占住时间线位置，不等图）", () => {
  it("bg/cg 预发射 + 发起后台生成，静态素材已有的跳过，立绘走 kickSprite", async () => {
    const store = await makeStore();
    const preloaded: string[] = [];
    const kicked: string[] = [];
    const spriteKicks: string[] = [];
    const orchestrator = new PlaywrightOrchestrator({
      streamFn: createFakeStreamFn([
        {
          text: "",
          toolCalls: [
            { name: "generate_image", args: { kind: "background", prompt: "rainy station", name: "bg_station" } },
            { name: "generate_image", args: { kind: "cg", prompt: "confession", name: "cg_01" } },
            // 立绘只出 neutral：这个工具没有 expression 参数，带了会被 schema 挡下（下面单测锁住）
            { name: "generate_image", args: { kind: "sprite", prompt: "neutral portrait", characterId: "mio" } },
            // 工坊已经导入过这张：同一个 id 不该再烧一次配额
            {
              name: "generate_image",
              args: { kind: "background", prompt: "sunset corridor", name: "bg_rooftop_sunset" },
            },
          ],
        },
        { text: BEAT_2, beatDone: true },
      ]),
      model: {} as never,
      getApiKey: () => "test-key",
      play: { ...PLAY, id: "img" },
      memory: await PlayMemory.load(store),
      tree: new LineageTree(),
      engine: { turn: 0, affinity: {}, flags: {} },
      scene: "走廊",
      persist: () => {},
      imageTools: {
        // 立绘目标在不在盘上由 PlayAssets 自己判；这条用例只关心排产决策
        playAssets: { exists: async () => false } as never,
        kick: (_type, _prompt, id) => kicked.push(id),
        kickSprite: (charId) => spriteKicks.push(charId),
        hasStaticAsset: (_type, id) => id === "bg_rooftop_sunset",
      },
      onServerMessage: () => {},
    });
    await orchestrator.start();
    await orchestrator.whenIdle();

    // 只有**图真的要来**的调用才占时间线位置（骨架占位出现在演出顺序里的那一行）：
    // 静态素材里已有的那张既不发也不占位——占了等不到 asset_ready，只会白闪到超时。
    const preload = orchestrator.eventsAfter(0).filter((e) => e.event.kind === "preload_asset");
    // 同批工具是并行的，落线顺序看谁先走完（立绘要先查盘上有没有）——比集合不比顺序
    const ids = preload.map((e) => (e.event as { id: string }).id).sort();
    expect(ids).toEqual(["bg_station", "cg_01", "mio:neutral"]);
    expect(kicked).toEqual(["bg_station", "cg_01"]);
    expect(spriteKicks).toEqual(["mio"]);
    orchestrator.dispose();
  });

  it("剧作家的 generate_image 没有 expression 参数（差分只能工坊出），工坊的有", async () => {
    const queued = createGenerateImageTool({
      mode: "queued",
      playAssets: undefined,
      emitPreload: () => {},
      kick: () => {},
      kickSprite: () => {},
      statusOf: () => "none",
      hasStaticAsset: () => false,
    });
    const sync = createGenerateImageTool({ mode: "sync", playAssets: undefined, onAsset: () => {} });
    const props = (t: { parameters: { properties?: Record<string, unknown> } }) => Object.keys(t.parameters.properties ?? {});
    expect(props(queued)).not.toContain("expression");
    expect(props(sync)).toContain("expression");
  });
});
