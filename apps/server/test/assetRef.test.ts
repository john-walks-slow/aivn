import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import sharp from "sharp";
import { AssetRefResolver, refFromActor, refFromCg, refFromSfx, refsFromScene } from "../src/assetRef.js";
import type { ImportResult } from "../src/assetImport.js";
import { AssetLibrary } from "../src/library.js";
import { PlayLibrary, type PlayStore } from "../src/store.js";

/**
 * 引用即导入：剧本里写了个 id，剧目里没有，宿主就去库里找同名条目搬进来。
 *
 * 这里盯四件事——剧目里已有的不重复导、库里没有的安静跳过、
 * 停止约定（none/空串）不当素材、导入只发生一次。
 */

const PLAY_JSON = JSON.stringify({
  id: "p1",
  title: "T",
  premise: "x",
  characters: [],
  opening: "（开始）",
  initialScene: "s",
});

/** 立绘夹具：真透明 PNG（导入要过入库归一化，假字节解不开）。 */
async function spritePng(): Promise<Buffer> {
  const figure = await sharp({
    create: { width: 100, height: 240, channels: 4, background: { r: 60, g: 70, b: 120, alpha: 1 } },
  })
    .png()
    .toBuffer();
  return sharp({ create: { width: 200, height: 400, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } })
    .composite([{ input: figure, left: 50, top: 60 }])
    .png()
    .toBuffer();
}

async function libraryEntry(root: string, kind: string, id: string, files: Record<string, string | Uint8Array>): Promise<void> {
  const dir = join(root, "lib", kind, id);
  await mkdir(dir, { recursive: true });
  for (const [name, body] of Object.entries(files)) await writeFile(join(dir, name), body);
}

describe("AssetRefResolver：剧本里的 id 缺了就从库里补", () => {
  let root: string;
  let plays: PlayLibrary;
  let store: PlayStore;
  let library: AssetLibrary;
  let imported: ImportResult[];

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), "stage-ref-"));
    plays = new PlayLibrary(root);
    await plays.createEmpty("p1", "黄昏");
    store = plays.store("p1");
    library = new AssetLibrary(join(root, "lib"));
    imported = [];
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  function resolver(extra: { characters?: string[] } = {}): AssetRefResolver {
    return new AssetRefResolver({
      playId: "p1",
      store,
      library,
      characters: async () => extra.characters ?? [],
      onImported: (result) => imported.push(result),
      warn: (message) => console.warn(message),
    });
  }

  it("<scene bg> 里的 id 剧目里没有，库里同名就导进来", async () => {
    await libraryEntry(root, "backgrounds", "moon_rooftop", { "moon_rooftop.jpg": "x" });
    const r = resolver();
    r.resolve(refsFromScene({ bg: "moon_rooftop" }));
    await waitFor(() => imported.length === 1);

    expect(imported[0]).toMatchObject({ kind: "backgrounds", id: "moon_rooftop" });
    expect(existsSync(join(store.dir, "assets", "backgrounds", "moon_rooftop.jpg"))).toBe(true);
  });

  it("剧目里已经有同名素材就不导（用户导入的图优先）", async () => {
    await libraryEntry(root, "backgrounds", "moon_rooftop", { "moon_rooftop.jpg": "x" });
    await mkdir(join(store.dir, "assets", "backgrounds"), { recursive: true });
    await writeFile(join(store.dir, "assets", "backgrounds", "moon_rooftop.png"), "x");

    resolver().resolve(refsFromScene({ bg: "moon_rooftop" }));
    await tick();
    expect(imported).toEqual([]);
  });

  it("库里没有就什么都不做，也不报错（未知 id 是模型起的名字，不是错）", async () => {
    resolver().resolve(refsFromScene({ bg: "nowhere" }));
    await tick();
    expect(imported).toEqual([]);
  });

  it("停止约定 none / 空串不当素材 id", async () => {
    await libraryEntry(root, "bgm", "none", { "none.mp3": "x" });
    const r = resolver();
    r.resolve(refsFromScene({ bgm: "none", ambient: "" }));
    await tick();
    expect(imported).toEqual([]);
  });

  it("环境音先查 ambient，其次音效，再查音乐：ambient 命中就是 ambient", async () => {
    await libraryEntry(root, "ambient", "rain", { "rain.mp3": "x" });
    await libraryEntry(root, "sfx", "rain", { "rain.mp3": "x" });
    await libraryEntry(root, "bgm", "rain", { "rain.mp3": "x" });
    resolver().resolve(refsFromScene({ ambient: "rain" }));
    await waitFor(() => imported.length === 1);
    expect(imported[0]!.kind).toBe("ambient");
  });

  it("环境音 ambient 库里没有时回退查音效：音效命中就是音效", async () => {
    await libraryEntry(root, "sfx", "wind", { "wind.mp3": "x" });
    await libraryEntry(root, "bgm", "wind", { "wind.mp3": "x" });
    resolver().resolve(refsFromScene({ ambient: "wind" }));
    await waitFor(() => imported.length === 1);
    expect(imported[0]!.kind).toBe("sfx");
  });

  it("<cg> 与 <sfx src> 各走各的类别", async () => {
    await libraryEntry(root, "cg", "confession", { "confession.jpg": "x" });
    await libraryEntry(root, "sfx", "door_knock", { "door_knock.mp3": "x" });
    const r = resolver();
    r.resolve([refFromCg("confession"), refFromSfx("door_knock")]);
    await waitFor(() => imported.length === 2);
    expect(imported.map((i) => `${i.kind}/${i.id}`).sort()).toEqual(["cg/confession", "sfx/door_knock"]);
  });

  it("<actor id> 角色表里已经有了就不去库里找", async () => {
    await libraryEntry(root, "characters", "koharu", { "neutral.png": await spritePng(), "meta.json": "{}" });
    resolver({ characters: ["koharu"] }).resolve([refFromActor("koharu")]);
    await tick();
    expect(imported).toEqual([]);
  });

  it("<actor id> 库里只有立绘包也照导：机甲、道具本来就没有卡", async () => {
    await libraryEntry(root, "sprites", "mecha_01", { "neutral.png": await spritePng(), "flare.png": await spritePng() });
    resolver().resolve([refFromActor("mecha_01")]);
    await waitFor(() => imported.length === 1);
    expect(imported[0]).toMatchObject({ kind: "sprites", id: "mecha_01", spriteId: "mecha_01" });
  });

  it("<actor id> 剧目里已有同名立绘目录就不再导", async () => {
    await libraryEntry(root, "sprites", "mecha_01", { "neutral.png": await spritePng() });
    await store.writeAsset("sprites/mecha_01", "neutral.png", Buffer.from("x"));
    resolver().resolve([refFromActor("mecha_01")]);
    await tick();
    expect(imported).toEqual([]);
  });

  it("<actor id> 剧目里只有卡、库里还有同名立绘包时补立绘：两张附件各补各的", async () => {
    await libraryEntry(root, "sprites", "koharu", { "neutral.png": await spritePng() });
    resolver({ characters: ["koharu"] }).resolve([refFromActor("koharu")]);
    await waitFor(() => imported.length === 1);
    expect(imported[0]).toMatchObject({ kind: "sprites", id: "koharu" });
  });

  it("环境音音效库里没有、音乐库里有才落音乐（多类别是按序真的往下试）", async () => {
    await libraryEntry(root, "bgm", "rainy", { "rainy.mp3": "x" });
    resolver().resolve(refsFromScene({ ambient: "rainy" }));
    await waitFor(() => imported.length === 1);
    expect(imported[0]).toMatchObject({ kind: "bgm", id: "rainy" });
  });

  it("同一个 id 被时间线反复引用只导一次", async () => {
    await libraryEntry(root, "backgrounds", "hall", { "hall.jpg": "x" });
    const r = resolver();
    r.resolve(refsFromScene({ bg: "hall" }));
    await waitFor(() => imported.length === 1);
    r.resolve(refsFromScene({ bg: "hall" }));
    await tick();
    expect(imported).toHaveLength(1);
  });
});

/** 让解析器那几轮异步导入走完。 */
async function tick(): Promise<void> {
  for (let i = 0; i < 100; i++) await new Promise((res) => setTimeout(res, 5));
}

async function waitFor(check: () => boolean): Promise<void> {
  for (let i = 0; i < 200; i++) {
    if (check()) return;
    await new Promise((res) => setTimeout(res, 5));
  }
  throw new Error("等待超时");
}
