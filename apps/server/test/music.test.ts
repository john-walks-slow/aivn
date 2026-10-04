import { describe, expect, it } from "vitest";
import { mkdtemp, readFile, readdir, writeFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { GeminiMusicGen, type MusicBackendOptions } from "../src/musicBackend.js";
import { PlayMusic } from "../src/playMusic.js";
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

  it("素材到货带着调用号，工坊据此把播放器挂到那次工具调用的行上", async () => {
    const store = await playDir();
    const seen: { path: string; replaced: boolean; toolCallId?: string }[] = [];
    const music = new PlayMusic({
      playId: "p1",
      store,
      files: new PlayFiles(store),
      backend: new GeminiMusicGen(opts, fakeFetch(() => inlineResponse("audio/mp4")).fetchImpl as never),
      onWrite: () => {},
      onAsset: (asset, replaced, toolCallId) => seen.push({ ...asset, replaced, toolCallId }),
    });
    await music.generate({ name: "bgm_x", prompt: "p" }, "call-42");
    expect(seen[0]).toMatchObject({ path: "assets/bgm/bgm_x.m4a", replaced: false, toolCallId: "call-42" });
  });

  it("素材名非法当场报错（id 会变成 assets/ 下的路径）", async () => {
    const store = await playDir();
    await expect(musicAt(store).generate({ name: "../escape", prompt: "p" })).rejects.toThrow(/非法/);
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