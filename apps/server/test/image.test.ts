import { describe, expect, it } from "vitest";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PlayStore } from "../src/store.js";
import { createGenerateAssetTool } from "../src/agentkit/assetTool.js";
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
