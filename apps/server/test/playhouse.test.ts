import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { LineageTree } from "@aivn/core";
import { PlayHouse, helloPayload } from "../src/playhouse.js";
import { PlayLibrary } from "../src/store.js";
import { AssetLibrary } from "../src/library.js";
import { settingsFromEnv } from "../src/config.js";
import { settingsStoreFor, createFakeStreamFn, BEAT_1, BEAT_1_STOP } from "./helpers.js";

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
  let config: ReturnType<typeof settingsFromEnv>;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), "aivn-playhouse-"));
    const playDir = join(root, "p1");
    await mkdir(playDir, { recursive: true });
    await writeFile(join(playDir, "play.json"), PLAY_JSON);
    library = new PlayLibrary(root);
    // 生图关掉：runtime 只碰磁盘，不发任何网络请求
    config = settingsFromEnv({ STAGE_IMAGE_ENABLED: "false" });
    house = new PlayHouse(library, settingsStoreFor(config), new AssetLibrary(join(root, "library")));
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
      const config = settingsFromEnv({ STAGE_IMAGE_ENABLED: "false", STAGE_MODELS: "high,low" });
      const narrowed = new PlayHouse(library, settingsStoreFor(config), new AssetLibrary(join(root, "library")));
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
    const config = settingsFromEnv(
      enabled
        ? {
            STAGE_IMAGE_ENABLED: "true",
            STAGE_IMAGE_FORMAT: "gemini",
            STAGE_IMAGE_BASE_URL: "http://127.0.0.1:1",
            STAGE_IMAGE_API_KEY: "test-key",
            STAGE_IMAGE_MODEL: "no-such-model",
          }
        : { STAGE_IMAGE_ENABLED: "false" },
    );
    return new PlayHouse(library, settingsStoreFor(config), new AssetLibrary(join(root, "library")));
  }

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), "aivn-cg-"));
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
    (house as any).streamFn = async () => ({
      async *[Symbol.asyncIterator]() {
        yield { type: "text_delta", delta: "17-year-old girl with long straight pink hair, wearing" };
        yield { type: "done", reason: "stop" };
      },
    });
    await expect(house.requestCg("p1", "黄昏窗边")).rejects.toThrow(/半句/);
  });

  it("参考角色无立绘时前置校验报错，不执行出图", async () => {
    house = await houseWithImages(true);
    await expect(
      house.requestCg("p1", "雨中漫步", {
        referenceCharacters: ["non_existent_char"],
      }),
    ).rejects.toThrow(/角色卡/);
  });

  it("未勾选基于历史且无指令时拒绝出图", async () => {
    house = await houseWithImages(true);
    await expect(
      house.requestCg("p1", undefined, { useHistory: false }),
    ).rejects.toThrow(/不基于剧情时/);
  });

  it("锚点还没进谱系（回看中传 null）：明确拒绝，不退成末尾落节点", async () => {
    house = await houseWithImages(true);
    await expect(house.requestCg("p1", "黄昏窗边", { anchorNodeId: null })).rejects.toThrow(
      /还没进谱系/,
    );
  });

  it("锚点指向已不在树上的节点：明确拒绝，不挂到别的世界线上", async () => {
    house = await houseWithImages(true);
    await expect(
      house.requestCg("p1", "黄昏窗边", { anchorNodeId: "e-gone-1" }),
    ).rejects.toThrow(/找不到你看的这一行/);
  });

  it("回看锚点：提示词只写到那一行为止，图挂回那一行旁边（不落节点）", async () => {
    house = await houseWithImages(true);
    // 先演一拍，好有一个「正在看的那一行」（runtime 在这一刻捕获这条假流）
    (house as any).streamFn = createFakeStreamFn([{ text: BEAT_1, beatDone: BEAT_1_STOP }]);
    const runtime = await house.begin("p1");
    await runtime.orchestrator.playerAction({ kind: "free", text: "我到了" });
    const leafBefore = runtime.orchestrator.lineageView().leafId;

    const firstLine = runtime.orchestrator
      .lineageView()
      .nodes.find((n) => n.text === "放学后的走廊空无一人。")!;
    expect(firstLine).toBeDefined();

    // 写提示词这一步换成可控的假流，把送进去的上下文抓下来
    const seen: unknown[] = [];
    const base = createFakeStreamFn([
      { text: "a quiet school corridor at dusk with empty lockers and soft melancholic light through tall windows" },
    ]);
    (house as any).streamFn = (model: unknown, context: unknown, options: unknown) => {
      seen.push(context);
      return base(model as never, context as never, options as never);
    };

    await house.requestCg("p1", undefined, { anchorNodeId: firstLine.id });

    // 提示词按你正看的那一行写：同一拍里后面那句还没发生，不该进上下文
    const composed = JSON.stringify(seen);
    expect(composed).toContain("放学后的走廊空无一人。");
    expect(composed).not.toContain("……太慢了！");

    // 图挂回那一行旁边：树上没有多的 cg 节点，世界线一根不动
    const after = runtime.orchestrator.lineageView();
    expect(after.nodes.some((n) => n.kind === "cg")).toBe(false);
    expect(after.nodes.find((n) => n.id === firstLine.id)!.cgs).toHaveLength(1);
    expect(after.leafId).toBe(leafBefore);
  });

  it("generateImage 手动出图端点：参数校验与目标生成", async () => {
    house = await houseWithImages(true);
    const store = library.store("p1");
    // 写一张角色卡
    const charDir = store.characterDir();
    await mkdir(charDir, { recursive: true });
    await writeFile(join(charDir, "koharu.md"), "---\nname: 小春\n---\n粉发少女", "utf8");

    // Mock playAssets.generate（先装配进缓存，generateImage 会取到同一份）
    const assets = (house as any).playAssetsFor("p1", store);
    assets.generate = async (opts: any) => {
      return [
        {
          id: "koharu_smile",
          type: "sprite",
          url: "/api/plays/p1/assets/sprites/koharu/smile.png",
          path: "assets/sprites/koharu/smile.png",
          prompt: opts.prompt,
        },
      ];
    };

    // 捕获广播
    const messages: any[] = [];
    (house as any).broadcast = (_playId: string, msg: any) => {
      messages.push(msg);
    };

    // 模拟 streamFn 返回完整立绘提示词
    (house as any).streamFn = async () => ({
      async *[Symbol.asyncIterator]() {
        yield {
          type: "text_delta",
          delta: "A beautiful anime girl with pink hair smiling brightly, school uniform, detailed illustration, soft lighting",
        };
        yield { type: "done", reason: "stop" };
      },
    });

    const res = await house.generateImage("p1", {
      kind: "sprite",
      spriteId: "koharu",
      variant: "smile",
    });

    expect(res.target).toBe("sprites/koharu/smile");
    expect(res.path).toBe("assets/sprites/koharu/smile.png");

    // 等待异步 kick 结算
    await new Promise((r) => setTimeout(r, 50));
    expect(messages).toContainEqual({
      type: "image_result",
      target: "sprites/koharu/smile",
      ok: true,
      url: "/api/plays/p1/assets/sprites/koharu/smile.png",
      path: "assets/sprites/koharu/smile.png",
    });
  });
});
