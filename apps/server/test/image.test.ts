import { describe, expect, it } from "vitest";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { OpenAiImageGen, canvasFor } from "../src/openaiImage.js";
import type { ImageBackend } from "../src/imageBackend.js";
import { PlayStore } from "../src/store.js";
import { createGenerateImageTool } from "../src/agentkit/imageTool.js";
import { PlaywrightOrchestrator } from "../src/orchestrator.js";
import { LineageTree } from "@aivn/core";
import { PlayMemory } from "../src/memory.js";
import { BEAT_2, createFakeStreamFn, PLAY } from "./helpers.js";

async function makeStore(): Promise<PlayStore> {
  const dir = await mkdtemp(join(tmpdir(), "stage-image-"));
  await writeFile(join(dir, "play.json"), JSON.stringify({ id: "img", ...PLAY }));
  await writeFile(join(dir, "lineage.jsonl"), "");
  return new PlayStore(dir);
}

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
            // 立绘：expression 缺省即 neutral（下面单测锁住 schema 统一）
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
      // 生图对剧作家默认关闭（Agent 页勾上才开），这里显式打开——默认集的另一条路另有用例锁
      agents: { tools: ["beat_done", "generate_image"] },
      imageTools: {
        // 「剧目里有没有这张」一律问 PlayAssets（它查盘）：这条用例只关心排产决策，
        // 只有那张工坊导入过的背景答「有」
        playAssets: {
          exists: async () => false,
          existingUrl: async (t: { name?: string }) =>
            t.name === "bg_rooftop_sunset" ? "/plays/img/assets/backgrounds/bg_rooftop_sunset.jpg" : null,
        } as never,
        kick: (_type, _prompt, id) => kicked.push(id),
        kickSprite: (charId) => spriteKicks.push(charId),
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

  it("两个角色的 generate_image 是同一份 schema（垫图与差分都拿得到）", () => {
    const queued = createGenerateImageTool({
      mode: "queued",
      playAssets: undefined,
      emitPreload: () => {},
      kick: () => {},
      kickSprite: () => {},
      existingAssetUrl: async () => null,
    });
    const sync = createGenerateImageTool({ mode: "sync", playAssets: undefined, onAsset: () => {} });
    const props = (t: { parameters: { properties?: Record<string, unknown> } }) => Object.keys(t.parameters.properties ?? {});
    for (const key of ["expression", "referenceCharacters", "framing", "style"]) {
      expect(props(queued)).toContain(key);
      expect(props(sync)).toContain(key);
    }
    // 同步与排产只差 description 与等待策略，参数对象必须是同一份
    expect(queued.parameters).toBe(sync.parameters);
    // 抠底参数两个角色都不给：填它得先看过成图，而出图那一刻没人看过图
    expect(props(queued)).not.toContain("cutout");
    expect(props(sync)).not.toContain("cutout");
  });

  it("垫图参数透传到后台发起（剧作家出的 CG 也要锁得住角色）", () => {
    const kicked: Array<[string, string, string[] | undefined]> = [];
    const tool = createGenerateImageTool({
      mode: "queued",
      playAssets: { exists: async () => false, existingUrl: async () => null } as never,
      emitPreload: () => {},
      kick: (type, _prompt, id, refs) => kicked.push([type, id, refs]),
      kickSprite: () => {},
      existingAssetUrl: async () => null,
    });
    return tool
      .execute("t1", { kind: "cg", name: "cg_01", prompt: "p", referenceCharacters: ["mio", "rin"] } as never)
      .then(() => expect(kicked).toEqual([["cg", "cg_01", ["mio", "rin"]]]));
  });
});
