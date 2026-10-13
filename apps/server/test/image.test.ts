import { describe, expect, it } from "vitest";
import sharp from "sharp";
import { existsSync } from "node:fs";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PlayStore } from "../src/store.js";
import { PlayFiles } from "../src/playFiles.js";
import { PlayAssets } from "../src/playAssets.js";
import { Limiter } from "../src/limiter.js";
import type { ImageAspect } from "../src/imageBackend.js";
import { createGenerateAssetTool } from "../src/agentkit/assetTool.js";
import { createGenerateImageTool } from "../src/agentkit/imageTool.js";
import { PlaywrightOrchestrator } from "../src/orchestrator.js";
import { LineageTree } from "@aivn/core";
import { PlayMemory } from "../src/memory.js";
import { BEAT_2, createFakeStreamFn, NEUTRAL_REFERENCE, PLAY, sharedBackends } from "./helpers.js";

async function makeStore(): Promise<PlayStore> {
  const dir = await mkdtemp(join(tmpdir(), "stage-image-"));
  await writeFile(join(dir, "play.json"), JSON.stringify({ id: "img", ...PLAY }));
  await writeFile(join(dir, "lineage.jsonl"), "");
  return new PlayStore(dir);
}
describe("剧作家 generate_asset：后台排产（占住时间线位置，不等图）", () => {
  it("bg/cg 预发射 + 发起后台生成，静态素材已有的跳过，立绘走 kickSprite", async () => {
    const store = await makeStore();
    const preloaded: string[] = [];
    const kicked: string[] = [];
    const spriteKicks: Record<string, unknown>[] = [];
    const orchestrator = new PlaywrightOrchestrator({
      streamFn: createFakeStreamFn([
        {
          text: "",
          toolCalls: [
            { name: "generate_asset", args: { kind: "background", prompt: "rainy station", name: "bg_station" } },
            { name: "generate_asset", args: { kind: "cg", prompt: "confession", name: "cg_01" } },
            // 立绘：variant 缺省即 neutral（下面单测锁住 schema 统一）
            { name: "generate_asset", args: { kind: "sprite", prompt: "neutral portrait", spriteId: "mio" } },
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
      store,
      memory: await PlayMemory.load(store),
      tree: new LineageTree(),
      engine: { turn: 0, affinity: {}, flags: {} },
      scene: "走廊",
      persist: () => {},
      // 生图对剧作家默认关闭（Agent 页勾上才开），这里显式打开——默认集的另一条路另有用例锁
      agents: { tools: ["beat_done", "generate_asset"] },
      imageTools: {
        // 「剧目里有没有这张」一律问 PlayAssets（它查盘）：这条用例只关心排产决策，
        // 只有那张工坊导入过的背景答「有」
        playAssets: {
          exists: async () => false,
          existingUrl: async (t: { name?: string }) =>
            t.name === "bg_rooftop_sunset" ? "/plays/img/assets/backgrounds/bg_rooftop_sunset.jpg" : null,
        } as never,
        kick: (_type, _prompt, id) => kicked.push(id),
        kickSprite: (target) => spriteKicks.push(target as unknown as Record<string, unknown>),
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
    // 立绘的 kick 收的是整个目标（主体 id + 差分 + 呈现三轴），宿主据此拼出预载骨架的键
    expect(spriteKicks).toHaveLength(1);
    expect(spriteKicks[0]).toMatchObject({ spriteId: "mio", variant: "neutral" });
    orchestrator.dispose();
  });

  it("generate_asset 两个角色是同一份 schema（垫图与差分都拿得到），generate_image 只有 produce 面", () => {
    const queued = createGenerateAssetTool({
      mode: "queued",
      playAssets: undefined,
      emitPreload: () => {},
      kick: () => {},
      kickSprite: () => {},
      existingAssetUrl: async () => null,
    });
    const sync = createGenerateAssetTool({
      mode: "sync",
      playAssets: undefined,
      onAsset: () => {},
    });
    const props = (t: { parameters: { properties?: Record<string, unknown> } }) => Object.keys(t.parameters.properties ?? {});
    // aspectRatio 只在「不给 kind 的通用候选」那条路上有意义，服务端两个角色都给出剧目素材，所以不露它
    for (const key of ["variant", "spriteId", "references", "framing", "stature", "title", "style"]) {
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
    const tool = createGenerateAssetTool({
      mode: "queued",
      playAssets: { exists: async () => false, existingUrl: async () => null } as never,
      emitPreload: () => {},
      kick: (type, _prompt, id, refs) => kicked.push([type, id, refs]),
      kickSprite: () => {},
      existingAssetUrl: async () => null,
    });
    return tool
      .execute("t1", { kind: "cg", name: "cg_01", prompt: "p", references: ["mio", "rin"] } as never)
      .then(() => expect(kicked).toEqual([["cg", "cg_01", ["mio", "rin"]]]));
  });
});

async function realImage(aspect: ImageAspect, mimeType: string): Promise<Buffer> {
  const [ratioW, ratioH] = aspect.split(":").map(Number);
  const height = 1365;
  const width = Math.round((height * ratioW!) / ratioH!);
  const figure = await sharp({
    create: {
      width: Math.round(width * 0.5),
      height: Math.round(height * 0.7),
      channels: 3,
      background: "#3c4678",
    },
  })
    .png()
    .toBuffer();
  const composed = await sharp({
    create: { width, height, channels: 3, background: "#00ff00" },
  })
    .composite([{ input: figure, left: Math.round(width * 0.25), top: Math.round(height * 0.15) }])
    .png()
    .toBuffer();
  return mimeType === "image/png" ? composed : await sharp(composed).jpeg().toBuffer();
}

describe("工坊 generate_asset：同步出图 + 登记入库一条龙", () => {
  it("背景生成：草稿句柄正常入库，不报「路径不在剧目可读范围」，写素材表与台账", async () => {
    const store = await makeStore();
    const files = new PlayFiles(store);
    const bgImage = await realImage("16:9", "image/jpeg");
    const assets = new PlayAssets("img", {
      store,
      files,
      backends: sharedBackends({ generate: async () => ({ data: bgImage, mimeType: "image/jpeg" }) }),
      limiter: new Limiter(1),
      reference: NEUTRAL_REFERENCE,
      onWrite: () => {},
    });

    const onAssets: unknown[] = [];
    const tool = createGenerateAssetTool({
      mode: "sync",
      playAssets: assets,
      onAsset: (path, url, kind, replaced, toolCallId) => {
        onAssets.push({ path, url, kind, replaced, toolCallId });
      },
    });

    const res = await tool.execute("call_1", {
      kind: "background",
      name: "sunset_beach",
      prompt: "beautiful sunset beach",
      description: "夕阳下的海滩",
    } as never);

    const text = JSON.stringify(res);
    expect(text).toContain("背景已生成并入库");
    expect(text).toContain("assets/backgrounds/sunset_beach.jpg");
    expect(text).toContain("/plays/img/assets/backgrounds/sunset_beach.jpg");
    expect(existsSync(join(store.dir, "assets/backgrounds/sunset_beach.jpg"))).toBe(true);

    const manifest = JSON.parse(await files.read("assets/manifest.json")) as Record<string, { description?: string }>;
    expect(manifest.sunset_beach?.description).toBe("夕阳下的海滩");

    const ledger = JSON.parse(await files.read("assets/generated.json")) as Record<string, { prompt?: string }>;
    expect(ledger.sunset_beach?.prompt).toContain("beautiful sunset beach");

    expect(onAssets).toHaveLength(1);
    expect(onAssets[0]).toMatchObject({
      path: "assets/backgrounds/sunset_beach.jpg",
      kind: "background",
      replaced: false,
      toolCallId: "call_1",
    });
  });

  it("立绘生成：一步完成出图 + 自动去底归一化 + 留底原片 + 登记落盘", async () => {
    const store = await makeStore();
    const files = new PlayFiles(store);
    const spriteImage = await realImage("9:16", "image/png");
    const assets = new PlayAssets("img", {
      store,
      files,
      backends: sharedBackends({ generate: async () => ({ data: spriteImage, mimeType: "image/png" }) }),
      limiter: new Limiter(1),
      reference: NEUTRAL_REFERENCE,
      onWrite: () => {},
    });

    const onAssets: unknown[] = [];
    const tool = createGenerateAssetTool({
      mode: "sync",
      playAssets: assets,
      onAsset: (path, url, kind, replaced, toolCallId) => {
        onAssets.push({ path, url, kind, replaced, toolCallId });
      },
    });

    const res = await tool.execute("call_2", {
      kind: "sprite",
      spriteId: "mio",
      variant: "neutral",
      framing: "full",
      prompt: "girl standing in uniform",
      description: "制服站姿澪",
    } as never);

    const text = JSON.stringify(res);
    expect(text).toContain("立绘已生成并入库");
    expect(text).toContain("assets/sprites/mio/neutral.png");
    expect(existsSync(join(store.dir, "assets/sprites/mio/neutral.png"))).toBe(true);

    // 自动去底成透明 PNG，两格指标入表
    const manifest = JSON.parse(await files.read("assets/manifest.json")) as Record<string, { figureTop?: number; figureHeight?: number }>;
    expect(manifest.mio?.figureTop).toBeGreaterThan(0);
    expect(manifest.mio?.figureHeight).toBeGreaterThan(0);

    // 原片留底到 media-cache/sprite-sources/，支持日后原地重抠
    expect(existsSync(join(store.dir, "media-cache/sprite-sources/mio/neutral.png"))).toBe(true);

    expect(onAssets).toHaveLength(1);
    expect(onAssets[0]).toMatchObject({
      path: "assets/sprites/mio/neutral.png",
      kind: "sprite",
      replaced: false,
      toolCallId: "call_2",
    });
  });

  it("草稿相对路径可直接登记与作 references 垫图", async () => {
    const store = await makeStore();
    const files = new PlayFiles(store);
    const bgImage = await realImage("16:9", "image/jpeg");
    const assets = new PlayAssets("img", {
      store,
      files,
      backends: sharedBackends({ generate: async () => ({ data: bgImage, mimeType: "image/jpeg" }) }),
      limiter: new Limiter(1),
      reference: NEUTRAL_REFERENCE,
      onWrite: () => {},
    });

    const drafted = await assets.draft({ kind: "background", name: "park" }, "autumn park");

    const regRel = await assets.register(drafted.path, { kind: "background", name: "park_rel" });
    expect(regRel.path).toBe("assets/backgrounds/park_rel.jpg");

    const nextDraft = await assets.draft(
      { kind: "background", name: "park_night", references: [drafted.path] },
      "same park at night",
    );
    expect(nextDraft.draftId).toBeTruthy();
  });
});
