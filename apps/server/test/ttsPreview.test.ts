import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PlayHouse } from "../src/playhouse.js";
import { PlayLibrary } from "../src/store.js";
import { AssetLibrary } from "../src/library.js";
import { settingsFromEnv } from "../src/config.js";
import { VoiceCatalogService, type VoiceSample } from "../src/voiceCatalog.js";
import { FishTts } from "../src/tts.js";
import { settingsStoreFor } from "./helpers.js";

const { undiciFetch } = vi.hoisted(() => ({ undiciFetch: vi.fn() }));
vi.mock("undici", () => ({ fetch: undiciFetch, ProxyAgent: class {} }));

const VOICE = "0c7771ca5910484e8a4933068017fcee";
const PLAY_JSON = JSON.stringify({ id: "p1", title: "T", characters: [], opening: "（开始）" });

/** 只带 sample() 的音色库替身：试听这条路只碰它。 */
function fakeVoices(sample: VoiceSample): { voices: VoiceCatalogService; sampleFn: ReturnType<typeof vi.fn> } {
  const sampleFn = vi.fn(async () => sample);
  return { voices: { sample: sampleFn } as unknown as VoiceCatalogService, sampleFn };
}

describe("音色试听：官方样本优先，兜底按音色母语", () => {
  let root: string;
  let house: PlayHouse;

  const makeHouse = (voices: VoiceCatalogService): PlayHouse => {
    const config = settingsFromEnv({ STAGE_TTS_KEYS: "mock-token", STAGE_IMAGE_ENABLED: "false" });
    return new PlayHouse(
      new PlayLibrary(root),
      settingsStoreFor(config),
      new AssetLibrary(join(root, "library")),
      voices,
    );
  };

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), "aivn-tts-preview-"));
    await mkdir(join(root, "p1"), { recursive: true });
    await writeFile(join(root, "p1", "play.json"), PLAY_JSON);
    undiciFetch.mockReset();
    undiciFetch.mockResolvedValue({ ok: true, arrayBuffer: async () => Buffer.from("mp3-bytes") });
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    await rm(root, { recursive: true, force: true });
  });

  it("有官方样本就放样本：下载落盘后回本地 URL，不再合成", async () => {
    const { voices } = fakeVoices({ audio: "https://example.invalid/sample.mp3", text: "サンプル", languages: ["ja"] });
    house = makeHouse(voices);
    const fetchSample = vi
      .spyOn(FishTts.prototype, "fetchSample")
      .mockResolvedValue({ file: `preview-${VOICE}.mp3`, cached: false });
    const synthesize = vi.spyOn(FishTts.prototype, "synthesize").mockResolvedValue({ file: "x.mp3", cached: false });

    await expect(house.ttsPreview("p1", VOICE)).resolves.toBe(`/plays/p1/media/tts/preview-${VOICE}.mp3`);
    expect(fetchSample).toHaveBeenCalledWith(
      "https://example.invalid/sample.mp3",
      VOICE,
      join(root, "p1", "media-cache", "tts"),
    );
    expect(synthesize).not.toHaveBeenCalled();
  });

  it("盘上已有样本时直接放，不再打上游取元数据", async () => {
    const dir = join(root, "p1", "media-cache", "tts");
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, `preview-${VOICE}.mp3`), "cached");
    const { voices, sampleFn } = fakeVoices({ audio: "https://example.invalid/sample.mp3", text: "", languages: ["ja"] });
    house = makeHouse(voices);

    await expect(house.ttsPreview("p1", VOICE)).resolves.toBe(`/plays/p1/media/tts/preview-${VOICE}.mp3`);
    expect(sampleFn).not.toHaveBeenCalled();
  });

  it("没有样本时合成官方示例文本（音色母语），不翻成剧目的语音语言", async () => {
    const { voices } = fakeVoices({ audio: "", text: "おはようございます。", languages: ["ja"] });
    house = makeHouse(voices);
    const synthesize = vi.spyOn(FishTts.prototype, "synthesize").mockResolvedValue({ file: "h.mp3", cached: false });
    vi.spyOn(FishTts.prototype, "fetchSample").mockResolvedValue({ file: "unused.mp3", cached: false });

    await expect(house.ttsPreview("p1", VOICE)).resolves.toBe("/plays/p1/media/tts/h.mp3");
    expect(synthesize).toHaveBeenCalledWith("おはようございます。", VOICE, join(root, "p1", "media-cache", "tts"));
  });

  it("连示例文本都没有时按语言标签兜底：日语念日文，不再是一句中文", async () => {
    const { voices } = fakeVoices({ audio: "", text: "", languages: ["ja"] });
    house = makeHouse(voices);
    const synthesize = vi.spyOn(FishTts.prototype, "synthesize").mockResolvedValue({ file: "h.mp3", cached: false });

    await house.ttsPreview("p1", VOICE);
    const [text] = synthesize.mock.calls[0]!;
    expect(text).toContain("こんにちは");
    expect(text).not.toContain("你好");
  });

  it("没有语言标签或语种未收录时兜底到英语", async () => {
    const synthesize = vi.spyOn(FishTts.prototype, "synthesize").mockResolvedValue({ file: "h.mp3", cached: false });
    for (const languages of [[], ["xx"]]) {
      house = makeHouse(fakeVoices({ audio: "", text: "", languages }).voices);
      await house.ttsPreview("p1", VOICE);
      expect(synthesize.mock.calls.at(-1)![0]).toBe("Hi there, this is what I sound like.");
    }
  });

  it("剧目不存在就报错，不凭空造出一个缓存目录", async () => {
    house = makeHouse(fakeVoices({ audio: "https://example.invalid/sample.mp3", text: "", languages: ["en"] }).voices);
    await expect(house.ttsPreview("nope", VOICE)).rejects.toThrow("剧目不存在");
  });
});

describe("FishTts 样本落盘", () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "aivn-tts-cache-"));
    undiciFetch.mockReset();
    undiciFetch.mockResolvedValue({ ok: true, arrayBuffer: async () => Buffer.from("mp3-bytes") });
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    await rm(dir, { recursive: true, force: true });
  });

  const tts = (): FishTts =>
    new FishTts({ keys: ["mock-token"], baseUrl: "https://api.fish.audio", model: "s2.1-pro-free", timeoutMs: 5000 });

  it("按 voiceId 落一个能过静态服务的文件名，同一个音色只下一次", async () => {
    const client = tts();
    const first = await client.fetchSample("https://example.invalid/a.mp3", VOICE, dir);

    expect(first.file).toBe(`preview-${VOICE}.mp3`);
    expect(first.cached).toBe(false);
    expect(existsSync(join(dir, first.file))).toBe(true);

    const again = await client.fetchSample("https://example.invalid/a.mp3", VOICE, dir);
    expect(again.cached).toBe(true);
    expect(undiciFetch).toHaveBeenCalledTimes(1);
  });

  it("上游报错时如实抛错，不落半个文件", async () => {
    undiciFetch.mockResolvedValue({ ok: false, status: 403 });
    await expect(tts().fetchSample("https://example.invalid/a.mp3", VOICE, dir)).rejects.toThrow("试听样本下载失败 HTTP 403");
  });
});

describe("VoiceCatalogService.sample：现取试听素材", () => {
  const entity = (over: Record<string, unknown> = {}): Record<string, unknown> => ({
    _id: VOICE,
    title: "Rem",
    state: "trained",
    languages: ["ja"],
    default_text: "はい、スバルくん。",
    samples: [{ text: "サンプル", audio: "https://example.invalid/sample.mp3" }],
    ...over,
  });

  const service = (raw: Record<string, unknown>): VoiceCatalogService =>
    new VoiceCatalogService(
      settingsStoreFor(settingsFromEnv({})),
      join(tmpdir(), "unused-voices.json"),
      async <T,>(path: string): Promise<T> => {
        expect(path).toBe(`/model/${VOICE}`);
        return raw as T;
      },
    );

  it("取出官方音频、示例文本与语言标签", async () => {
    await expect(service(entity()).sample(VOICE)).resolves.toEqual({
      audio: "https://example.invalid/sample.mp3",
      text: "はい、スバルくん。",
      languages: ["ja"],
    });
  });

  it("没有 default_text 就用样本自带的文本", async () => {
    const catalog = service(entity({ default_text: undefined }));
    await expect(catalog.sample(VOICE)).resolves.toMatchObject({ text: "サンプル" });
  });

  it("未训练完的音色直接报错——它合不出声，试听也不该装作能听", async () => {
    await expect(service(entity({ state: "training" })).sample(VOICE)).rejects.toThrow("不存在或未训练完成");
  });
});
