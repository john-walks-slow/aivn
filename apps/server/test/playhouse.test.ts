import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { LineageTree } from "@aivn/core";
import { PlayHouse, helloPayload } from "../src/playhouse.js";
import { PlayLibrary } from "../src/store.js";
import { AssetLibrary } from "../src/library.js";
import { settingsFromEnv } from "../src/config.js";
import { settingsStoreFor, createFakeStreamFn, BEAT_1, BEAT_1_STOP } from "./helpers.js";
import { readPlayStateText, writePlayStateText } from "../src/playState.js";

const PLAY_JSON = JSON.stringify({
  id: "p1",
  title: "T",
  premise: "x",
  characters: [],
  opening: "（开始）",
  initialScene: "s",
  initialState: { turn: 0, affinity: { mio: 1 }, flags: {} },
});

const engine = { flags: {}, sceneDetails: {}, activeThreads: [] };

describe("PlayHouse 单树作用域：runtime 直接绑定剧目根", () => {
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
    config = settingsFromEnv({ STAGE_IMAGE_ENABLED: "false" });
    house = new PlayHouse(library, settingsStoreFor(config), new AssetLibrary(join(root, "library")));
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it("hello 带上骨架兜底上界", async () => {
    const runtime = await house.get("p1");
    expect(helloPayload("p1", runtime).type).toBe("hello");
    const hello = helloPayload("p1", runtime) as { assetsTtlMs?: number };
    expect(hello.assetsTtlMs).toBe(1_080_000);
  });

  it("get 与 begin 都复用同一个单树 runtime，不创建周目", async () => {
    const runtime = await house.get("p1");
    expect(runtime.store.dir).toBe(join(root, "p1"));
    expect(await house.begin("p1")).toBe(runtime);
    expect(existsSync(join(root, "p1", "saves"))).toBe(false);
  });

  it("单树从剧目根 session 恢复", async () => {
    const store = library.store("p1");
    const tree = new LineageTree();
    tree.append("say", { text: "已保存", payload: {} });
    await store.saveSession(tree, engine, "s");
    const runtime = await house.get("p1");
    expect(runtime.orchestrator.lineageView().nodes.some((node) => node.text === "已保存")).toBe(true);
  });

  it("并发 get 共享同一次装配", async () => {
    const [a, b] = await Promise.all([house.get("p1"), house.get("p1")]);
    expect(a).toBe(b);
  });

  it("重建失败：旧 runtime 原样留着（没做完的语音活儿不跟着一起没）", async () => {
    const before = await house.get("p1");
    await writeFile(join(root, "p1", "play.json"), "{ 这不是 JSON");
    await expect(house.reload("p1")).rejects.toThrow();
    // 新实例没建出来，旧实例还在位：语音队列的交接只发生在新实例**建好之后**（见 handOverVoice）
    expect(await house.get("p1")).toBe(before);
  });

  it("开演前插的提示在 begin 后仍保留", async () => {
    const runtime = await house.get("p1");
    await runtime.orchestrator.playerAction({ kind: "prompt", text: "让她先别说话" });
    const same = await house.begin("p1");
    const queued = (same.orchestrator as unknown as { pending: { text: string }[] }).pending;
    expect(queued.map((item) => item.text)).toEqual(["让她先别说话"]);
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

    // 模拟 streamFn 返回完整立绘提示词；顺手把喂给模型的那份上下文留下来（人设从这儿进提示词）
    let sent = "";
    (house as any).streamFn = async (...args: any[]) => {
      sent = JSON.stringify(args[1] ?? "");
      return {
        async *[Symbol.asyncIterator]() {
          yield {
            type: "text_delta",
            delta:
              "A beautiful anime girl with pink hair smiling brightly, school uniform, detailed illustration, soft lighting",
          };
          yield { type: "done", reason: "stop" };
        },
      };
    };

    const res = await house.generateImage("p1", {
      kind: "sprite",
      spriteId: "koharu",
      variant: "smile",
    });

    expect(res.target).toBe("sprites/koharu/smile");
    expect(res.path).toBe("assets/sprites/koharu/smile.png");
    expect(sent).toContain("小春");

    // 等待异步 kick 结算
    await new Promise((r) => setTimeout(r, 50));
    expect(messages).toContainEqual({
      type: "image_result",
      target: "sprites/koharu/smile",
      ok: true,
      url: "/api/plays/p1/assets/sprites/koharu/smile.png",
      path: "assets/sprites/koharu/smile.png",
    });

    // 显式绑定：出图的 spriteId 是**立绘目录名**，人设要按目录反查卡（拿目录去查角色表会扑空）
    await writeFile(join(charDir, "rin.md"), "---\nname: 铃音\nsprite: rinne\n---\n金发狐耳少女", "utf8");
    const bound = await house.generateImage("p1", {
      kind: "sprite",
      spriteId: "rinne",
      variant: "neutral",
    });
    expect(bound.target).toBe("sprites/rinne/neutral");
    expect(sent).toContain("铃音");
    expect(sent).toContain("金发狐耳少女");
  });

});
