import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { VoiceCatalogService, type VoiceFetcher } from "../src/voiceCatalog.js";
import { settingsFromEnv } from "../src/config.js";
import { settingsStoreFor } from "./helpers.js";

/** 假 fish 目录：第 1~2 页有数据，第 3 页起空。 */
function fakePages(counts: { title: string; languages: string[]; likes: number; trained?: boolean }[][]) {
  const calls: string[] = [];
  const fetchJson: VoiceFetcher = async <T>(path: string): Promise<T> => {
    calls.push(path);
    if (path.startsWith("/model/")) return { _id: path.slice(7), state: "trained" } as T;
    const page = Number(new URL(path, "http://x").searchParams.get("page_number"));
    const items = (counts[page - 1] ?? []).map((v, i) => ({
      // 定宽的 id：直接 `${page}${i}` 再补零会撞号（"19" 与 "190" 补零后同串），
      // 去重时会把同页的两条吞成一条
      _id: `${page}${String(i).padStart(3, "0")}`.padEnd(32, "0"),
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
  const config = settingsFromEnv({ STAGE_TTS_PROXY: "" });
  return { svc: new VoiceCatalogService(settingsStoreFor(config), join(dir, "voices.json"), fetchJson), calls, dir };
}

describe("VoiceCatalogService", () => {
  it("分页抓满目录并按收藏数降序", async () => {
    const { svc, calls } = await service([
      // 第 1 页必须满页（100 条）才会触发后续页——短页即停是自适应翻页的约定
      Array.from({ length: 100 }, (_, i) => ({ title: `A${i}`, languages: ["zh"], likes: 3 })),
      [{ title: "B", languages: ["hi"], likes: 9 }],
    ]);
    const catalog = await svc.get();
    expect(catalog.entries[0]?.title).toBe("B");
    expect(catalog.entries).toHaveLength(101);
    expect(catalog.totalAvailable).toBe(1000);
    expect(calls).toHaveLength(10); // 第 1 页探路 + 满页后补 2~10 页
  });

  it("10 页一次并发打完（串行要三十多秒）", async () => {
    const dir = await mkdtemp(join(tmpdir(), "voices-"));
    const config = settingsFromEnv({ STAGE_TTS_PROXY: "" });
    let inFlight = 0;
    let peak = 0;
    const svc = new VoiceCatalogService(settingsStoreFor(config), join(dir, "voices.json"), async <T>(path: string): Promise<T> => {
      inFlight += 1;
      peak = Math.max(peak, inFlight);
      await new Promise((resolve) => setTimeout(resolve, 5));
      inFlight -= 1;
      const page = Number(new URL(path, "http://x").searchParams.get("page_number"));
      return {
        total: 1000,
        items: [{ _id: `${page}`.padStart(32, "0"), state: "trained", title: `p${page}`, like_count: page }],
      } as T;
    });
    await svc.get();
    expect(peak).toBe(10);
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
    const config = settingsFromEnv({ STAGE_TTS_PROXY: "" });
    const svc = new VoiceCatalogService(settingsStoreFor(config), join(dir, "voices.json"), async () => {
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
    const config = settingsFromEnv({ STAGE_TTS_PROXY: "" });
    const svc = new VoiceCatalogService(settingsStoreFor(config), cacheFile, async () => {
      throw new Error("代理不通");
    });
    const catalog = await svc.get();
    expect(catalog.stale).toBe(true);
    expect(catalog.entries[0]?.title).toBe("旧音色");
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });

  it("抓取失败后进入静默期：后续查询直接用旧快照，不再重打上游", async () => {
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
    const config = settingsFromEnv({ STAGE_TTS_PROXY: "" });
    let calls = 0;
    const svc = new VoiceCatalogService(settingsStoreFor(config), cacheFile, async () => {
      calls += 1;
      throw new Error("代理不通");
    });

    // 失败不推进 fetchedAt（推进了就把旧快照谎称成新的），所以没有静默期的话
    // 后面每次查询都会重付一遍完整抓取的代价——上游一坏就变成「每次都卡」。
    expect((await svc.get()).stale).toBe(true);
    const afterFirst = calls;
    expect(afterFirst).toBeGreaterThan(0);

    expect((await svc.get()).entries[0]?.title).toBe("旧音色");
    expect(calls).toBe(afterFirst);

    // 用户显式点刷新要能穿透静默期，否则那个按钮按下去没反应
    // （强制刷新本来就不带 fallback，拉不到就如实抛错）
    await expect(svc.get(true)).rejects.toThrow("代理不通");
    expect(calls).toBeGreaterThan(afterFirst);
    warn.mockRestore();
  });

  it("按 id 解析目录外音色（demo 剧目的 voiceId 不在热门 1000 内）", async () => {
    const dir = await mkdtemp(join(tmpdir(), "voices-"));
    const config = settingsFromEnv({ STAGE_TTS_PROXY: "" });
    const svc = new VoiceCatalogService(settingsStoreFor(config), join(dir, "voices.json"), async () => ({
      _id: "f82e3885ac22468eb6c773b96f2c5752",
      state: "trained",
      title: "萝莉萌妹",
      languages: ["zh"],
    }) as never);
    expect((await svc.resolve("f82e3885ac22468eb6c773b96f2c5752")).title).toBe("萝莉萌妹");
  });
});

describe("VoiceCatalogService 查询窗口", () => {
  /** 一整页（100 条）——自适应翻页只认满页才继续翻。 */
  const fullPage = (prefix: string) =>
    Array.from({ length: 100 }, (_, i) => ({ title: `${prefix}${i}`, languages: ["ja"], likes: i }));

  it("条件拼进 Fish 查询：language 小写（JA 是 0 条）、tag 原样（大小写敏感）、title 编码", async () => {
    const { svc, calls } = await service([[{ title: "雷姆", languages: ["ja"], likes: 1 }]]);
    await svc.list({ language: "JA", tags: ["anime"], title: "Rem Re:Zero" });
    expect(calls[0]).toContain("language=ja");
    expect(calls[0]).toContain("tag=anime");
    expect(calls[0]).toContain(`title=${encodeURIComponent("rem re:zero")}`);
  });

  it("第 1 页不满就停：标题搜索常常只有一页", async () => {
    const { svc, calls } = await service([[{ title: "A", languages: ["ja"], likes: 1 }]]);
    const catalog = await svc.list({ title: "rem" });
    expect(catalog.entries).toHaveLength(1);
    expect(calls).toHaveLength(1);
  });

  it("语言/标签窗口 10 页一次并发打完（探路要两轮往返，慢一倍）", async () => {
    const { svc, calls } = await service([fullPage("a"), fullPage("b")]);
    const catalog = await svc.list({ language: "ja" });
    expect(catalog.entries).toHaveLength(200);
    expect(calls).toHaveLength(10);
  });

  it("窗口进内存缓存：同条件第二次不再打 fish，refresh 才重抓", async () => {
    const { svc, calls } = await service([[{ title: "A", languages: ["ja"], likes: 1 }]]);
    await svc.list({ language: "ja" });
    const after = calls.length;
    expect(after).toBe(10);
    await svc.list({ language: "ja" });
    expect(calls).toHaveLength(after);
    await svc.list({ language: "ja" }, true);
    expect(calls.length).toBeGreaterThan(after);
  });

  it("同条件的并发查询只打一轮 fish", async () => {
    const { svc, calls } = await service([[{ title: "A", languages: ["ja"], likes: 1 }]]);
    await Promise.all([svc.list({ language: "ja" }), svc.list({ language: "ja" })]);
    expect(calls).toHaveLength(10); // 一轮 10 页，不是两轮
  });

  it("窗口查空不报错——标题搜不到是正常答案（空目录报错只属于基础目录）", async () => {
    const { svc } = await service([[]]);
    const catalog = await svc.list({ title: "不存在的名字" });
    expect(catalog.entries).toHaveLength(0);
  });

  it("空条件走基础目录那条路（磁盘快照 + 命中不再打 fish）", async () => {
    const { svc, calls, dir } = await service([[{ title: "A", languages: ["zh"], likes: 1 }]]);
    await svc.list({});
    const onDisk = JSON.parse(await readFile(join(dir, "voices.json"), "utf8"));
    expect(onDisk.entries).toHaveLength(1);
    expect(calls).toHaveLength(10); // 基础目录 = 10 页一轮
    await svc.list({});
    expect(calls).toHaveLength(10);
  });

  it("窗口缓存有上限：第 17 个窗口把最旧的挤出去", async () => {
    const { svc, calls } = await service([[{ title: "A", languages: ["ja"], likes: 1 }]]);
    for (let i = 0; i < 17; i += 1) await svc.list({ title: `t${i}` });
    expect(calls).toHaveLength(17);
    await svc.list({ title: "t16" }); // 还在缓存里
    expect(calls).toHaveLength(17);
    await svc.list({ title: "t0" }); // 已被逐出，重打
    expect(calls).toHaveLength(18);
  });
});
