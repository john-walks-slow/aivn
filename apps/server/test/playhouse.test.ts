import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { LineageTree } from "@stage-ai/core";
import { PlayHouse, helloPayload } from "../src/playhouse.js";
import { PlayLibrary } from "../src/store.js";
import { AssetLibrary } from "../src/library.js";
import { loadConfig } from "../src/config.js";

const PLAY_JSON = JSON.stringify({
  id: "p1",
  title: "T",
  premise: "x",
  characters: [],
  opening: "（开始）",
  initialScene: "s",
});

const engine = { flags: {}, sceneDetails: {}, activeThreads: [] };

describe("PlayHouse 周目作用域：逛不建、连舞台也不建，开演才建", () => {
  let root: string;
  let library: PlayLibrary;
  let house: PlayHouse;
  let config: ReturnType<typeof loadConfig>;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), "stageai-playhouse-"));
    const playDir = join(root, "p1");
    await mkdir(playDir, { recursive: true });
    await writeFile(join(playDir, "play.json"), PLAY_JSON);
    library = new PlayLibrary(root);
    // 生图关掉：runtime 只碰磁盘，不发任何网络请求
    config = loadConfig({ STAGE_IMAGE_ENABLED: "false" }, root);
    house = new PlayHouse(library, config, new AssetLibrary(join(root, "library")));
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  const saveIds = (): Promise<string[]> => library.saves("p1").list().then((s) => s.map((x) => x.id));

  it("hello 带上骨架兜底上界：客户端不知道生图要多久，这个数只能服务端给", async () => {
    const runtime = await house.get("p1");
    expect(helloPayload("p1", runtime).type).toBe("hello");
    const hello = helloPayload("p1", runtime) as { assetsTtlMs?: number };
    expect(hello.assetsTtlMs).toBe(540_000);
  });

  it("get() 不建周目：runtime 落在无会话作用域上", async () => {
    const runtime = await house.get("p1");
    expect(runtime.save.id).toBe("");
    expect(runtime.store.saveId).toBeNull();
    expect(await saveIds()).toEqual([]);
    await expect(runtime.store.saveSession(new LineageTree(), engine, "s")).rejects.toThrow();
  });

  it("begin() 才建周目，并发的两个「开演」共用同一个 runtime", async () => {
    const [a, b] = await Promise.all([house.begin("p1"), house.begin("p1")]);
    expect(a.save.id).not.toBe("");
    expect(a).toBe(b);
    expect(a.store.saveId).toBe(b.store.saveId);
    expect(await saveIds()).toEqual([a.save.id]);
  });

  it("逛过工坊再开演：无会话那份被换掉，工坊现场留着", async () => {
    const browsing = await house.get("p1");
    const staged = await house.begin("p1");
    expect(browsing).not.toBe(staged);
    expect(browsing.store).not.toBe(staged.store);
    expect(staged.workshop).toBe(browsing.workshop); // 工坊对话现场不能被打断
    expect(staged.save.id).not.toBe("");
    expect(await saveIds()).toEqual([staged.save.id]);
  });

  it("删掉最后一棵周目后回到无会话作用域，下次开演再新建一棵", async () => {
    const staged = await house.begin("p1");
    await house.deleteSave("p1", staged.save.id);
    expect(await saveIds()).toEqual([]);

    const again = await house.begin("p1");
    expect(again.save.id).not.toBe("");
    expect(await saveIds()).toEqual([again.save.id]);
  });

  it("已有活动周目时 begin() 挂上去，不另建", async () => {
    const created = await library.saves("p1").create();
    const staged = await house.begin("p1");
    expect(staged.save.id).toBe(created.id);
    expect(staged.save.name).toBe(created.name);
    expect(await saveIds()).toEqual([created.id]);
  });

  it("并发 get() 共享同一次装配，不各装一份 runtime", async () => {
    const [a, b] = await Promise.all([house.get("p1"), house.get("p1")]);
    expect(a).toBe(b);
  });

  it("装配完成后不再留住在飞记录：runtime 被换掉后装得出新的那一份", async () => {
    const browsing = await house.get("p1");
    const staged = await house.begin("p1");
    await house.deleteSave("p1", staged.save.id);
    // 在飞表里若还留着 browsing 这条已兑现的 promise，这里拿回的就是它——
    // 那份 runtime 早已被 begin() 换掉、orchestrator 已 dispose，拿到就是死的
    expect(await house.get("p1")).not.toBe(browsing);
  });

  it("开演前插的提示跟着换树交接过去，不跟着旧实例蒸发", async () => {
    const browsing = await house.get("p1");
    await browsing.orchestrator.playerAction({ kind: "prompt", text: "让她先别说话" });
    const staged = await house.begin("p1");
    const queued = (staged.orchestrator as unknown as { pending: { text: string }[] }).pending;
    expect(queued.map((item) => item.text)).toEqual(["让她先别说话"]);
  });

  it("模型下拉 = 网关清单 ∩ 支持清单：只给点名的几个，顺序照配置", async () => {
    const original = globalThis.fetch;
    globalThis.fetch = (async () =>
      new Response(JSON.stringify({ data: [{ id: "low" }, { id: "high" }, { id: "vision" }] }), {
        status: 200,
      })) as typeof fetch;
    try {
      const config = loadConfig({ STAGE_IMAGE_ENABLED: "false", STAGE_MODELS: "high,low" }, root);
      const narrowed = new PlayHouse(library, config, new AssetLibrary(join(root, "library")));
      const listed = await narrowed.gatewayModels();
      expect(listed.models.map((m) => m.id)).toEqual(["high", "low"]);
      expect(listed.defaultModel).toBe(config.modelId);
    } finally {
      globalThis.fetch = original;
    }
  });
});

describe("导演生图：前置守卫（都不该碰生图后端）", () => {
  let root: string;
  let library: PlayLibrary;
  let house: PlayHouse;

  /** 生图开着的 PlayHouse：填一个永远不会被打到的网关地址，出题之前不发任何请求。 */
  async function houseWithImages(enabled: boolean): Promise<PlayHouse> {
    const config = loadConfig(
      enabled
        ? {
            STAGE_IMAGE_ENABLED: "true",
            STAGE_IMAGE_FORMAT: "gemini",
            STAGE_IMAGE_BASE_URL: "http://127.0.0.1:1",
            STAGE_IMAGE_API_KEY: "test-key",
            STAGE_IMAGE_MODEL: "no-such-model",
          }
        : { STAGE_IMAGE_ENABLED: "false" },
      root,
    );
    return new PlayHouse(library, config, new AssetLibrary(join(root, "library")));
  }

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), "stageai-cg-"));
    const playDir = join(root, "p1");
    await mkdir(playDir, { recursive: true });
    await writeFile(join(playDir, "play.json"), PLAY_JSON);
    library = new PlayLibrary(root);
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it("生图没开：直接说没开，不静默", async () => {
    house = await houseWithImages(false);
    await expect(house.requestCg("p1")).rejects.toThrow(/生图未启用/);
  });

  it("空树又没有指令：无可画，也明说", async () => {
    house = await houseWithImages(true);
    await expect(house.requestCg("p1")).rejects.toThrow(/还没有剧情可画/);
  });

  it("模型只吐半句：当作没写成，不拿它去烧一张图", async () => {
    house = await houseWithImages(true);
    // 网关把流掐在半路、仍报 stop 时，提示词会停在 "…wearing" 这种半句上。
    const half = house as unknown as { composeCgPrompt: () => Promise<string> };
    half.composeCgPrompt = async () => "17-year-old girl with long straight pink hair, wearing";
    await expect(house.requestCg("p1", "黄昏窗边")).rejects.toThrow(/半句/);
  });
});
