import { describe, expect, it } from "vitest";
import { mkdtemp, readFile, readdir, writeFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { GeminiMusicGen, type MusicBackendOptions } from "../src/musicBackend.js";
import { PlayMusic, type GenerateMusicRequest } from "../src/playMusic.js";
import { createGenerateMusicTool } from "../src/agentkit/musicTool.js";
import { PlayFiles } from "../src/playFiles.js";
import { PlayStore } from "../src/store.js";
import { applyPatch, freshSettings, musicConnectionOf } from "../src/config.js";

/** 抓请求回脚本化响应；不打真网关（真网关一次要 84 秒，且烧配额）。 */
function fakeFetch(responder: (url: string) => Response): { fetchImpl: typeof fetch; urls: string[] } {
  const urls: string[] = [];
  const fetchImpl = (async (url: string) => {
    urls.push(url);
    return responder(url);
  }) as unknown as typeof fetch;
  return { fetchImpl, urls };
}

/** 一段音频字节（本测试只关心字节原样落盘，不必能解码）。 */
const AUDIO = Buffer.from([0x00, 0x01, 0x02, 0xfd, 0xfe, 0xff, 0x10, 0x20]);

const inlineResponse = (mime: string, b64 = AUDIO.toString("base64")): Response =>
  new Response(
    JSON.stringify({ candidates: [{ content: { parts: [{ inlineData: { mimeType: mime, data: b64 } }] } }] }),
    { status: 200 },
  );

const opts: MusicBackendOptions = {
  baseUrl: "http://127.0.0.1:38000",
  apiKey: "test-key",
  model: "flow-music-lyria-3.5",
  timeoutMs: 1000,
};

async function playDir(): Promise<PlayStore> {
  const dir = await mkdtemp(join(tmpdir(), "aivn-music-"));
  return new PlayStore(dir);
}

/** 一个只按脚本回音频的 PlayMusic（每个用例共用装配，省得每条都抄一遍）。 */
function musicAt(store: PlayStore, mime = "audio/mp4"): PlayMusic {
  return new PlayMusic({
    playId: "p1",
    store,
    files: new PlayFiles(store),
    backend: new GeminiMusicGen(opts, fakeFetch(() => inlineResponse(mime)).fetchImpl as never),
    onWrite: () => {},
  });
}

describe("GeminiMusicGen：Gemini 原生音乐生成", () => {
  it("请求形状：模型名进 URL、key 走 x-goog-api-key", async () => {
    const { fetchImpl, urls } = fakeFetch(() => inlineResponse("audio/mp4"));
    await new GeminiMusicGen(opts, fetchImpl as never).generate({ prompt: "solo piano, slow, tender" });
    expect(urls[0]).toBe("http://127.0.0.1:38000/v1beta/models/flow-music-lyria-3.5:generateContent");
  });

  it("剧目覆盖模型名只换 URL 里的模型", async () => {
    const { fetchImpl, urls } = fakeFetch(() => inlineResponse("audio/mp4"));
    await new GeminiMusicGen(opts, fetchImpl as never).generate({ prompt: "x", model: "musicfx" });
    expect(urls[0]).toContain("/v1beta/models/musicfx:generateContent");
  });

  // 落盘扩展名跟着响应的 mime 走：实测 flow2api 回的是 audio/mp4（M4A 容器），
  // 写死 .mp3 会让浏览器按错误的 codec 播。这一格错掉时音乐能生成、但放不出来。
  it("audio/mp4 落 .m4a（实测返回的容器形状），mp3/ogg/wav 各归各", async () => {
    for (const [mime, ext] of [
      ["audio/mp4", ".m4a"],
      ["audio/mpeg", ".mp3"],
      ["audio/ogg", ".ogg"],
      ["audio/wav", ".wav"],
    ] as const) {
      const gen = new GeminiMusicGen(opts, fakeFetch(() => inlineResponse(mime)).fetchImpl as never);
      expect((await gen.generate({ prompt: "x" })).ext).toBe(ext);
    }
  });

  it("音频字节原样透传（base64 解回来是同一段）", async () => {
    const gen = new GeminiMusicGen(opts, fakeFetch(() => inlineResponse("audio/mp4")).fetchImpl as never);
    expect((await gen.generate({ prompt: "x" })).bytes.equals(AUDIO)).toBe(true);
  });

  // 没有产物时报上游原因而不是「解析失败」，并点名模型。
  // finishReason 与 finishMessage 两处都要：安全拦截（SAFETY）通常只带前者。
  it("没有音频时把 finishReason 与 finishMessage 一起报出来", async () => {
    const empty = new Response(
      JSON.stringify({ candidates: [{ content: { parts: [{ text: "sorry" }] }, finishMessage: "quota exceeded" }] }),
      { status: 200 },
    );
    const gen = new GeminiMusicGen(opts, fakeFetch(() => empty).fetchImpl as never);
    await expect(gen.generate({ prompt: "x" })).rejects.toThrow(/quota exceeded/);
    await expect(gen.generate({ prompt: "x" })).rejects.toThrow(/flow-music-lyria-3\.5/);
  });

  it("只带 finishReason 的安全拦截也报得出来（丢掉它就只剩「模型挂错」这个误导）", async () => {
    const blocked = new Response(
      JSON.stringify({ candidates: [{ finishReason: "SAFETY", content: { parts: [{ text: "" }] } }] }),
      { status: 200 },
    );
    const gen = new GeminiMusicGen(opts, fakeFetch(() => blocked).fetchImpl as never);
    await expect(gen.generate({ prompt: "x" })).rejects.toThrow(/SAFETY/);
  });

  it("HTTP 错误带上状态码", async () => {
    const gen = new GeminiMusicGen(opts, fakeFetch(() => new Response("no model", { status: 404 })).fetchImpl as never);
    await expect(gen.generate({ prompt: "x" })).rejects.toThrow(/HTTP 404/);
  });
});

describe("PlayMusic：落盘与素材表", () => {
  it("音频落 assets/bgm/<id><ext>，字节与上游一致", async () => {
    const store = await playDir();
    const asset = await musicAt(store).generate({ name: "bgm_school_dusk", prompt: "soft piano" });
    expect(asset.path).toBe("assets/bgm/bgm_school_dusk.m4a");
    expect(asset.url).toBe("/plays/p1/assets/bgm/bgm_school_dusk.m4a");
    expect((await readFile(join(store.dir, "assets/bgm/bgm_school_dusk.m4a"))).equals(AUDIO)).toBe(true);
  });

  // 剧作家看不见音频，只能按素材表里的情绪与场景选曲——这层不写元数据等于曲子进了黑箱
  it("情绪、场景、可循环与出处写进素材表", async () => {
    const store = await playDir();
    await musicAt(store).generate({
      name: "bgm_confession",
      prompt: "piano",
      title: "心意渐明",
      description: "告白的过场",
      mood: ["温柔", "心动"],
      scene: ["告白"],
      loop: true,
    });
    const meta = await store.assetMeta();
    expect(meta.bgm_confession).toMatchObject({
      title: "心意渐明",
      description: "告白的过场",
      mood: ["温柔", "心动"],
      scene: ["告白"],
      loop: true,
    });
    expect(meta.bgm_confession!.source).toContain("站内生成");
  });

  // 描述归工坊与用户，这一层只补自己知道的格：整表覆盖会把用户写的说明抹掉
  it("已有描述一个字不动，只补自己那几格", async () => {
    const store = await playDir();
    await mkdir(join(store.dir, "assets"), { recursive: true });
    await writeFile(
      join(store.dir, "assets/manifest.json"),
      JSON.stringify({ bgm_confession: { description: "用户手写的说明" } }, null, 2),
    );
    await musicAt(store).generate({ name: "bgm_confession", prompt: "p", title: "新标题" });
    const meta = await store.assetMeta();
    expect(meta.bgm_confession!.description).toBe("用户手写的说明");
    expect(meta.bgm_confession!.title).toBe("新标题");
  });

  // 同 stem 换扩展名时旧的还在，素材索引按 stem 认——会挑到上一首
  it("同名曲子重生成：清掉上一支扩展名，并如实报覆盖", async () => {
    const store = await playDir();
    await mkdir(join(store.dir, "assets/bgm"), { recursive: true });
    await writeFile(join(store.dir, "assets/bgm/bgm_x.mp3"), "old");
    const asset = await musicAt(store).generate({ name: "bgm_x", prompt: "p" });
    expect(asset.replaced).toBe(true);
    expect(await readdir(join(store.dir, "assets/bgm"))).toEqual(["bgm_x.m4a"]);
  });

  // 同名重生成不该把用户在素材页调过的音量拨回缺省——曲子是新的，音量是用户调的
  it("同名重生成保留用户调过的音量，显式给了才改", async () => {
    const store = await playDir();
    await mkdir(join(store.dir, "assets"), { recursive: true });
    await writeFile(join(store.dir, "assets/manifest.json"), JSON.stringify({ bgm_x: { volume: 0.2 } }));
    await musicAt(store).generate({ name: "bgm_x", prompt: "p" });
    expect((await store.assetMeta()).bgm_x!.volume).toBe(0.2);

    await musicAt(store).generate({ name: "bgm_x", prompt: "p", volume: 0.55 });
    expect((await store.assetMeta()).bgm_x!.volume).toBe(0.55);
  });

  // 工坊的 pushAsset 会把前端置成 busy，靠下一条 workshop_done 复位。而 BGM 是 84 秒后才到的，
// 那一轮早收束完了——再置一次 busy 就再没有东西解开它，工坊输入框被永久锁死。
// 所以到货只走 asset_ready，不碰那条面向单轮对话的通道（这条用例守着它别被接回去）。
it("到货不回调工坊对话通道：PlayMusic 上根本没有 onAsset 这个口", async () => {
  const store = await playDir();
  const music = new PlayMusic({
    playId: "p1",
    store,
    files: new PlayFiles(store),
    backend: new GeminiMusicGen(opts, fakeFetch(() => inlineResponse("audio/mp4")).fetchImpl as never),
    onWrite: () => {},
  });
  expect("onAsset" in (music as unknown as Record<string, unknown>)).toBe(false);
  const asset = await music.generate({ name: "bgm_x", prompt: "p" });
  // 到货信息仍在返回值里，由 playhouse.queueMusic 转成 asset_ready 广播
  expect(asset).toMatchObject({ id: "bgm_x", path: "assets/bgm/bgm_x.m4a" });
  expect(asset.url).toBe("/plays/p1/assets/bgm/bgm_x.m4a");
});

  it("素材名非法当场报错（id 会变成 assets/ 下的路径）", async () => {
    const store = await playDir();
    await expect(musicAt(store).generate({ name: "../escape", prompt: "p" })).rejects.toThrow(/非法/);
  });

  // 判重是「不烧那一分半」的唯一依据，而素材名不带扩展名，所以它得逐个扩展名试出来
  it("existingUrl 认得出用户手传的 .mp3（不是只有我们落的 .m4a）", async () => {
    const store = await playDir();
    const music = musicAt(store);
    expect(await music.existingUrl("bgm_a")).toBeNull();
    await music.generate({ name: "bgm_a", prompt: "p" });
    expect(await music.existingUrl("bgm_a")).toBe("/plays/p1/assets/bgm/bgm_a.m4a");

    await mkdir(store.assetPath("bgm"), { recursive: true });
    await writeFile(store.assetPath("bgm/bgm_b.mp3"), AUDIO);
    expect(await music.existingUrl("bgm_b")).toBe("/plays/p1/assets/bgm/bgm_b.mp3");
  });

  // 同一回合里模型并发调两次同名 id：两份各自烧配额、竞态写盘，覆盖标记也说不清
  it("同名并发调用合并成一次生成", async () => {
    const store = await playDir();
    let calls = 0;
    const music = new PlayMusic({
      playId: "p1",
      store,
      files: new PlayFiles(store),
      backend: {
        async generate() {
          calls += 1;
          return { bytes: AUDIO, ext: ".m4a", mimeType: "audio/mp4" };
        },
      } as never,
      onWrite: () => {},
    });
    const [a, b] = await Promise.all([
      music.generate({ name: "bgm_a", prompt: "p" }),
      music.generate({ name: "bgm_a", prompt: "p" }),
    ]);
    expect(calls).toBe(1);
    expect(a).toEqual(b);
  });
});

describe("音乐设置：地址与 key 回落", () => {
  // 本机 flow2api 一个进程同时挂图片与音频模型，两边填两遍是重复劳动
  it("留空就回落生图那一份；单独填了以自己为准", () => {
    const base = freshSettings();
    base.image.baseUrl = "http://127.0.0.1:38000";
    base.image.apiKey = "flow-shared";
    expect(musicConnectionOf(base)).toEqual({ baseUrl: "http://127.0.0.1:38000", apiKey: "flow-shared" });

    const own = applyPatch(base, { music: { baseUrl: "http://other:9", apiKey: "own" } }).next;
    expect(musicConnectionOf(own)).toEqual({ baseUrl: "http://other:9", apiKey: "own" });
  });

  it("新装默认关着、模型给 flow-music-lyria-3.5", () => {
    const fresh = freshSettings();
    expect(fresh.music.enabled).toBe(false);
    expect(fresh.music.baseUrl).toBe("");
    expect(fresh.music.model).toBe("flow-music-lyria-3.5");
  });
});

describe("generate_bgm：后台排产形态", () => {
  /** 装一份工具，只看它调没调 kick、kick 之前是不是先查了库。 */
  function toolWith(existingUrl: (name: string) => Promise<string | null>) {
    const kicked: GenerateMusicRequest[] = [];
    const tools = createGenerateMusicTool({
      music: { existingUrl },
      kick: (req) => {
        kicked.push(req);
        return "已排产";
      },
    });
    expect(tools).toHaveLength(1);
    return { tool: tools[0], kicked };
  }

  async function run(tool: ReturnType<typeof createGenerateMusicTool>[number], args: unknown) {
    const result = await tool.execute("call-1", args as never);
    return { text: result.content.map((c) => (c as { text: string }).text).join(""), result };
  }

  // 一首曲子要等 84 秒。回合里 await 的话这一轮就白等一分半，用户看着像卡死——
  // 所以「发起即返回」是这工具能不能用的前提，不是性能优化。
  it("发起即返回，不等曲子（kick 同步返回，回执就是排产文案）", async () => {
    const { tool, kicked } = toolWith(async () => null);
    const { text } = await run(tool, { name: "bgm_a", prompt: "solo piano, seamless loop" });
    expect(kicked).toHaveLength(1);
    expect(kicked[0]).toMatchObject({ name: "bgm_a", prompt: "solo piano, seamless loop" });
    expect(text).toBe("已排产");
  });

  it("剧目里已有同名曲子就跳过，别烧那一分半", async () => {
    const { tool, kicked } = toolWith(async () => "/plays/p1/assets/bgm/bgm_a.m4a");
    const { text } = await run(tool, { name: "bgm_a", prompt: "solo piano" });
    expect(kicked).toHaveLength(0);
    expect(text).toContain("已经有同名曲子");
    expect(text).toContain("overwrite=true");
    expect(text).toContain('<scene bgm="bgm_a" />');
  });

  // 覆盖是用户明确要求的动作、不是默认行为：默认跳过是防手滑烧配额，
  // 但「把这首重做一遍」是真实需求，没有这条口就永远做不到
  it("用户明确要重做时 overwrite 才放行（默认仍跳过）", async () => {
    const { tool, kicked } = toolWith(async () => "/plays/p1/assets/bgm/bgm_a.m4a");
    await run(tool, { name: "bgm_a", prompt: "solo piano, brighter", overwrite: true });
    expect(kicked).toHaveLength(1);
    expect(kicked[0]).toMatchObject({ name: "bgm_a", overwrite: true });
  });

  it("空白的 mood/scene/tags 项剔掉再传给宿主（别把空串当声明写进素材表）", async () => {
    const { tool, kicked } = toolWith(async () => null);
    await run(tool, {
      name: "bgm_a",
      prompt: "p",
      mood: ["温柔", "  ", ""],
      scene: ["告白"],
      tags: ["日系", " "],
      title: "  心意渐明  ",
    });
    expect(kicked[0].mood).toEqual(["温柔"]);
    expect(kicked[0].tags).toEqual(["日系"]);
    expect(kicked[0].title).toBe("心意渐明");
  });

  it("没配后端就整个不注册（装一个必然失败的工具只会诱使模型空转）", () => {
    expect(createGenerateMusicTool()).toEqual([]);
    expect(createGenerateMusicTool({})).toEqual([]);
  });

  it("元数据参数交宿主后原样带下去：loop / volume / 描述都要送", async () => {
    const { tool, kicked } = toolWith(async () => null);
    await run(tool, {
      name: "bgm_a",
      prompt: "p",
      loop: false,
      volume: 0.35,
      description: "垫底用，音量压低不盖台词",
    });
    expect(kicked[0]).toMatchObject({
      loop: false,
      volume: 0.35,
      description: "垫底用，音量压低不盖台词",
    });
  });
});