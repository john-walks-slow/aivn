import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { VoiceCatalogService, type VoiceFetcher } from "../src/voiceCatalog.js";
import { loadConfig } from "../src/config.js";

/** 假 fish 目录：第 1~2 页有数据，第 3 页起空。 */
function fakePages(counts: { title: string; languages: string[]; likes: number; trained?: boolean }[][]) {
  const calls: string[] = [];
  const fetchJson: VoiceFetcher = async <T>(path: string): Promise<T> => {
    calls.push(path);
    if (path.startsWith("/model/")) return { _id: path.slice(7), state: "trained" } as T;
    const page = Number(new URL(path, "http://x").searchParams.get("page_number"));
    const items = (counts[page - 1] ?? []).map((v, i) => ({
      _id: `${page}${i}`.padEnd(32, "0"),
      state: v.trained === false ? "pending" : "trained",
      title: v.title,
      languages: v.languages,
      like_count: v.likes,
      tags: ["female"],
      cover_image: "",
      description: "",
    }));
    return { total: 1000, items } as T;
  };
  return { fetchJson, calls };
}

async function service(counts: Parameters<typeof fakePages>[0]) {
  const dir = await mkdtemp(join(tmpdir(), "voices-"));
  const { fetchJson, calls } = fakePages(counts);
  const config = loadConfig({ STAGE_TTS_PROXY: "" }, "/repo");
  return { svc: new VoiceCatalogService(config, join(dir, "voices.json"), fetchJson), calls, dir };
}

describe("VoiceCatalogService", () => {
  it("分页抓满目录并按收藏数降序", async () => {
    const { svc, calls } = await service([
      [{ title: "A", languages: ["zh"], likes: 3 }],
      [{ title: "B", languages: ["hi"], likes: 9 }],
    ]);
    const catalog = await svc.get();
    expect(catalog.entries.map((e) => e.title)).toEqual(["B", "A"]);
    expect(catalog.totalAvailable).toBe(1000);
    expect(calls).toHaveLength(3); // 2 页数据 + 1 页空页探到边界；真实 API 满 10 页时由 MAX_PAGES 收口
  });

  it("丢弃未训练完的音色（进目录只会让用户选到合成失败的音色）", async () => {
    const { svc } = await service([[{ title: "X", languages: ["zh"], likes: 1, trained: false }]]);
    await expect(svc.get()).rejects.toThrow("空目录");
  });

  it("结果落盘，第二次命中缓存不再打 fish", async () => {
    const { svc, calls, dir } = await service([[{ title: "A", languages: ["zh"], likes: 1 }]]);
    await svc.get();
    const callsAfterFetch = calls.length;
    const onDisk = JSON.parse(await readFile(join(dir, "voices.json"), "utf8"));
    expect(onDisk.entries).toHaveLength(1);

    await svc.get();
    expect(calls).toHaveLength(callsAfterFetch);
  });

  it("抓取失败且无快照时抛错（不静默返回空目录）", async () => {
    const dir = await mkdtemp(join(tmpdir(), "voices-"));
    const config = loadConfig({ STAGE_TTS_PROXY: "" }, "/repo");
    const svc = new VoiceCatalogService(config, join(dir, "voices.json"), async () => {
      throw new Error("代理不通");
    });
    await expect(svc.get()).rejects.toThrow("代理不通");
  });

  it("抓取失败时沿用磁盘快照并标 stale（离线也不让面板空白）", async () => {
    const dir = await mkdtemp(join(tmpdir(), "voices-"));
    const cacheFile = join(dir, "voices.json");
    await writeFile(
      cacheFile,
      JSON.stringify({
        entries: [{ id: "a".repeat(32), title: "旧音色", description: "", languages: ["zh"], tags: [], likes: 1, cover: "" }],
        fetchedAt: 0, // 过期，逼下一次走抓取
        totalAvailable: 1000,
        stale: false,
      }),
    );
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const config = loadConfig({ STAGE_TTS_PROXY: "" }, "/repo");
    const svc = new VoiceCatalogService(config, cacheFile, async () => {
      throw new Error("代理不通");
    });
    const catalog = await svc.get();
    expect(catalog.stale).toBe(true);
    expect(catalog.entries[0]?.title).toBe("旧音色");
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });

  it("按 id 解析目录外音色（demo 剧目的 voiceId 不在热门 1000 内）", async () => {
    const dir = await mkdtemp(join(tmpdir(), "voices-"));
    const config = loadConfig({ STAGE_TTS_PROXY: "" }, "/repo");
    const svc = new VoiceCatalogService(config, join(dir, "voices.json"), async () => ({
      _id: "f82e3885ac22468eb6c773b96f2c5752",
      state: "trained",
      title: "萝莉萌妹",
      languages: ["zh"],
    }) as never);
    expect((await svc.resolve("f82e3885ac22468eb6c773b96f2c5752")).title).toBe("萝莉萌妹");
  });
});
