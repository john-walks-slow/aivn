import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { zipSync } from "fflate";
import { libraryEntryMatches, parseCharacterCard, parsePlayAssetManifest } from "@stage-ai/core";
import { AssetLibrary, assertEntryId } from "../src/library.js";
import { importFromLibrary } from "../src/assetImport.js";
import { PlayLibrary } from "../src/store.js";

/**
 * 资源库与导入：库里是用户在本地目录里手摆的文件夹，导入是复制进剧目。
 * 这里盯三件事——扫得出来（含坏 meta 的告警）、不越界、导入后剧目自包含。
 */

const PLAY_JSON = (id: string): string =>
  JSON.stringify({ id, title: "T", premise: "x", characters: [], opening: "（开始）", initialScene: "s" });

function zipOf(files: Record<string, string | Uint8Array>): Buffer {
  return Buffer.from(
    zipSync(
      Object.fromEntries(
        Object.entries(files).map(([k, v]) => [k, typeof v === "string" ? new TextEncoder().encode(v) : v]),
      ),
    ),
  );
}

async function makeEntry(root: string, kind: string, id: string, files: Record<string, string>, meta?: unknown): Promise<void> {
  const dir = join(root, kind, id);
  await mkdir(dir, { recursive: true });
  for (const [name, body] of Object.entries(files)) await writeFile(join(dir, name), body);
  if (meta !== undefined) await writeFile(join(dir, "meta.json"), typeof meta === "string" ? meta : JSON.stringify(meta));
}

/** 角色卡（characters/<id>.md）：角色的唯一真相源，导入写它而不是 play.json。 */
async function readCard(playsRoot: string, playId: string, charId: string) {
  const text = await readFile(join(playsRoot, playId, "characters", `${charId}.md`), "utf8");
  return parseCharacterCard(text);
}

async function writeCard(playsRoot: string, playId: string, charId: string, text: string): Promise<void> {
  const dir = join(playsRoot, playId, "characters");
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, `${charId}.md`), text, "utf8");
}

describe("AssetLibrary：扫描本地资源库目录", () => {
  let root: string;
  let library: AssetLibrary;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), "stageai-lib-"));
    library = new AssetLibrary(root);
  });
  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it("库目录不存在时是空库，不报错", async () => {
    expect(await new AssetLibrary(join(root, "nope")).list()).toEqual([]);
  });

  it("扫出全部条目，元数据与文件一起带出", async () => {
    await makeEntry(root, "backgrounds", "classroom_dusk", { "bg.png": "x" }, {
      title: "黄昏教室",
      description: "放学后的空教室，落日余晖",
      tags: ["室内", "黄昏"],
    });
    await makeEntry(root, "bgm", "twilight", { "t.mp3": "x" }, {
      description: "钢琴小品",
      mood: ["忧伤", "温柔"],
      durationSec: 92,
      loop: true,
    });
    const entries = await library.list();
    expect(entries.map((e) => `${e.kind}/${e.id}`)).toEqual(["backgrounds/classroom_dusk", "bgm/twilight"]);
    expect(entries[0]!.title).toBe("黄昏教室");
    expect(entries[0]!.files).toEqual([{ name: "bg.png", size: 1 }]);
    expect(entries[1]!.meta.loop).toBe(true);
    expect(entries[1]!.meta.mood).toEqual(["忧伤", "温柔"]);
  });

  it("空目录不算条目，坏 meta 只告警不丢条目", async () => {
    await makeEntry(root, "backgrounds", "empty", {});
    await makeEntry(root, "backgrounds", "broken", { "bg.png": "x" }, "{ 不是 json");
    await makeEntry(root, "backgrounds", "wrong", { "bg.png": "x" }, "[1,2]");
    const entries = await library.list();
    expect(entries.map((e) => e.id)).toEqual(["broken", "wrong"]);
    expect(entries[0]!.warnings?.[0]).toContain("meta.json 解析失败");
    expect(entries[1]!.warnings?.[0]).toContain("不是对象");
  });

  it("单文件类别多放了文件：取一个，其余列成告警", async () => {
    await makeEntry(root, "backgrounds", "room", { "a.png": "x", "b.png": "x" });
    const entry = await library.entry("backgrounds", "room");
    expect(entry!.files).toEqual([{ name: "a.png", size: 1 }]);
    expect(entry!.warnings?.[0]).toContain("只取一个文件");
  });

  it("立绘差分指向不存在的文件时提前告警", async () => {
    await makeEntry(root, "characters", "mio", { "neutral.png": "x" }, {
      expressions: { neutral: { file: "neutral.png" }, sad: { file: "sad.png" } },
    });
    const entry = await library.entry("characters", "mio");
    expect(entry!.warnings?.[0]).toBe("差分 sad 指向的 sad.png 不在目录里");
  });

  it("filePath 只放行条目清单里的文件", async () => {
    await makeEntry(root, "backgrounds", "room", { "a.png": "x" });
    expect(await library.filePath("backgrounds", "room", "a.png")).toBe(join(root, "backgrounds", "room", "a.png"));
    await expect(library.filePath("backgrounds", "room", "../secret")).rejects.toThrow();
    await expect(library.filePath("backgrounds", "room", "meta.json")).rejects.toThrow();
    await expect(library.filePath("nope", "room", "a.png")).rejects.toThrow();
  });

  it("条目 id 形状受约束（id 会直接变成剧目里的文件名）", () => {
    expect(assertEntryId("classroom_dusk")).toBe("classroom_dusk");
    expect(() => assertEntryId("../evil")).toThrow();
    expect(() => assertEntryId("")).toThrow();
  });
});

describe("libraryEntryMatches：关键词搜索", () => {
  const entry = {
    kind: "bgm",
    id: "twilight",
    title: "黄昏",
    description: "钢琴小品",
    meta: { mood: ["忧伤"], tags: ["钢琴"] },
    files: [],
    size: 0,
  } as const;

  it("中英混合、大小写不敏感", () => {
    expect(libraryEntryMatches(entry, "Twilight")).toBe(true);
    expect(libraryEntryMatches(entry, "钢琴")).toBe(true);
    expect(libraryEntryMatches(entry, "忧伤")).toBe(true);
    expect(libraryEntryMatches(entry, "明快")).toBe(false);
  });
});

describe("importFromLibrary：资源库 → 剧目", () => {
  let libRoot: string;
  let playsRoot: string;
  let library: AssetLibrary;
  let plays: PlayLibrary;

  beforeEach(async () => {
    libRoot = await mkdtemp(join(tmpdir(), "stageai-lib-"));
    playsRoot = await mkdtemp(join(tmpdir(), "stageai-plays-"));
    library = new AssetLibrary(libRoot);
    plays = new PlayLibrary(playsRoot);
    await plays.importZip(zipOf({ "play.json": PLAY_JSON("p1") }));
  });
  afterEach(async () => {
    await rm(libRoot, { recursive: true, force: true });
    await rm(playsRoot, { recursive: true, force: true });
  });

  it("背景：复制进剧目并把元数据写进素材表", async () => {
    await makeEntry(libRoot, "backgrounds", "classroom_dusk", { "bg.png": "像素" }, {
      description: "放学后的空教室",
      tags: ["黄昏"],
    });
    const result = await importFromLibrary(library, plays.store("p1"), { kind: "backgrounds", entryId: "classroom_dusk" });
    expect(result.files).toEqual(["assets/backgrounds/classroom_dusk.png"]);
    expect(result.manifestKeys).toEqual(["classroom_dusk"]);
    const copied = await readFile(join(playsRoot, "p1", "assets", "backgrounds", "classroom_dusk.png"), "utf8");
    expect(copied).toBe("像素");
    const manifest = parsePlayAssetManifest(JSON.parse(await readFile(join(playsRoot, "p1", "assets", "manifest.json"), "utf8")));
    expect(manifest.classroom_dusk).toEqual({ description: "放学后的空教室", tags: ["黄昏"] });
  });

  it("音乐：情绪/时长/可循环一并进素材表，剧作家才选得出曲子", async () => {
    await makeEntry(libRoot, "bgm", "twilight", { "t.mp3": "音" }, {
      description: "钢琴小品",
      mood: ["忧伤"],
      durationSec: 92,
      loop: true,
      volume: 0.3,
    });
    await importFromLibrary(library, plays.store("p1"), { kind: "bgm", entryId: "twilight" });
    const manifest = JSON.parse(await readFile(join(playsRoot, "p1", "assets", "manifest.json"), "utf8"));
    expect(manifest.twilight).toMatchObject({ mood: ["忧伤"], durationSec: 92, loop: true, volume: 0.3 });
  });

  it("重导入会清掉同名旧扩展名，别让旧图留在那儿抢引用", async () => {
    const store = plays.store("p1");
    await makeEntry(libRoot, "backgrounds", "room", { "a.png": "新" });
    await store.writeAsset("backgrounds", "room.jpg", Buffer.from("旧"));
    await importFromLibrary(library, store, { kind: "backgrounds", entryId: "room" });
    expect(existsSync(join(playsRoot, "p1", "assets", "backgrounds", "room.jpg"))).toBe(false);
    expect((await store.listAssets()).backgrounds).toEqual(["room.png"]);
  });

  it("立绘包：落 sprites/<id>/ 并把差分写进角色卡", async () => {
    await makeEntry(libRoot, "characters", "mio", { "neutral.png": "n", "smile.png": "s" }, {
      character: { name: "澪", persona: "元气少女" },
      expressions: { neutral: { file: "neutral.png" }, smile: { file: "smile.png", description: "笑" } },
    });
    const result = await importFromLibrary(library, plays.store("p1"), { kind: "characters", entryId: "mio" });
    expect(result.files).toEqual(["assets/sprites/mio/neutral.png", "assets/sprites/mio/smile.png"]);
    expect(result.characters).toEqual(["mio"]);
    expect(result.manifestKeys).toEqual(["mio/neutral", "mio/smile"]);
    expect(await readCard(playsRoot, "p1", "mio")).toMatchObject({
      id: "mio",
      name: "澪",
      body: "元气少女",
      sprites: { neutral: "neutral.png", smile: "smile.png" },
    });
    // 角色不再落 play.json：那格是纯元数据，任何运行时逻辑都不读它
    expect(JSON.parse(await readFile(join(playsRoot, "p1", "play.json"), "utf8")).characters).toEqual([]);
    const manifest = JSON.parse(await readFile(join(playsRoot, "p1", "assets", "manifest.json"), "utf8"));
    expect(manifest["mio/smile"]).toMatchObject({ description: "笑" });
  });

  it("立绘取景：条目级 framing 与差分覆盖都进角色卡", async () => {
    await makeEntry(libRoot, "characters", "mio", { "neutral.png": "n", "closeup.png": "c" }, {
      character: { name: "澪", persona: "" },
      framing: "half",
      expressions: {
        neutral: { file: "neutral.png" },
        closeup: { file: "closeup.png", framing: "square" },
      },
    });
    await importFromLibrary(library, plays.store("p1"), { kind: "characters", entryId: "mio" });
    expect(await readCard(playsRoot, "p1", "mio")).toMatchObject({ framing: "half", spriteFraming: { closeup: "square" } });
  });

  it("立绘取景：只导一条差分不该把该角色其它差分的取景覆盖抹掉", async () => {
    const store = plays.store("p1");
    await writeCard(
      playsRoot,
      "p1",
      "mio",
      "---\nid: mio\nname: 澪\nframing: full\nspriteFraming:\n  angry: square\n---\n人设",
    );
    await makeEntry(libRoot, "characters", "mio", { "smile.png": "s" }, {
      character: { name: "澪", persona: "" },
      expressions: { smile: { file: "smile.png" } },
    });
    await importFromLibrary(library, store, { kind: "characters", entryId: "mio" });
    // 条目没声明 framing：剧目侧的值原样留着（含别的差分的覆盖），导入不许顺手清掉
    const card = await readCard(playsRoot, "p1", "mio");
    expect(card.framing).toBe("full");
    expect(card.spriteFraming).toEqual({ angry: "square" });
  });

  it("纯角色卡：没有立绘也能导入（先定人设、图后面再画）", async () => {
    await makeEntry(libRoot, "characters", "yuzuki", {}, {
      character: { name: "柚月", persona: "沉默的转学生", voice: "短句", voiceId: "a".repeat(32) },
    });
    const result = await importFromLibrary(library, plays.store("p1"), { kind: "characters", entryId: "yuzuki" });
    expect(result.files).toEqual([]);
    expect(result.characters).toEqual(["yuzuki"]);
    expect(await readCard(playsRoot, "p1", "yuzuki")).toMatchObject({
      id: "yuzuki",
      name: "柚月",
      voice: "短句",
      voiceId: "a".repeat(32),
      body: "沉默的转学生",
    });
  });

  it("导入已有角色：库里写了什么覆盖什么，没写的字段留住剧目侧手改", async () => {
    const store = plays.store("p1");
    await writeCard(
      playsRoot,
      "p1",
      "yuzuki",
      "---\nid: yuzuki\nname: 旧名\nvoice: 旧语气\n---\n剧目里手写的补充",
    );
    // meta 只写了 name 与 persona：voice 没写，剧目侧那一条得原样留下
    await makeEntry(libRoot, "characters", "yuzuki", {}, { character: { name: "新月", persona: "库里的版本" } });
    await importFromLibrary(library, store, { kind: "characters", entryId: "yuzuki" });
    expect(await readCard(playsRoot, "p1", "yuzuki")).toMatchObject({
      name: "新月",
      voice: "旧语气",
      body: "库里的版本",
    });
  });

  it("target=protagonist 写固定 id 的主角卡：卡与立绘都落在 protagonist 名下，play.json 一个字节不动", async () => {
    await makeEntry(libRoot, "characters", "rio", { "neutral.png": "n" }, {
      character: { name: "理央", persona: "玩家扮演" },
      expressions: { neutral: { file: "neutral.png" } },
    });
    const store = plays.store("p1");
    await writeFile(
      join(playsRoot, "p1", "play.json"),
      JSON.stringify({ id: "p1", title: "T", characters: [], opening: "（开始）", initialScene: "s" }),
    );
    const before = await readFile(join(playsRoot, "p1", "play.json"), "utf8");

    const result = await importFromLibrary(library, store, { kind: "characters", entryId: "rio", target: "protagonist" });

    expect(result.protagonist).toBe(true);
    expect(result.characters).toEqual(["protagonist"]);
    expect(await readCard(playsRoot, "p1", "protagonist")).toMatchObject({ name: "理央", body: "玩家扮演" });
    // 主角和别的角色一样能上台，所以立绘照导——落在 sprites/protagonist/，差分映射挂它的卡
    expect(result.files).toEqual(["assets/sprites/protagonist/neutral.png"]);
    expect(existsSync(join(playsRoot, "p1", "assets", "sprites", "protagonist", "neutral.png"))).toBe(true);
    expect(await readFile(join(playsRoot, "p1", "play.json"), "utf8")).toBe(before);
  });

  it("只导选中的差分，且不冲掉角色卡里已有的其它差分", async () => {
    await plays.importZip(
      zipOf({
        "play.json": JSON.stringify({
          id: "p2",
          title: "T",
          premise: "x",
          opening: "（开始）",
          initialScene: "s",
          characters: [],
        }),
        "assets/sprites/mio/happy.png": "已有",
      }),
    );
    await writeCard(playsRoot, "p2", "mio", "---\nid: mio\nname: 澪\nsprites:\n  happy: happy.png\n---\np");
    await makeEntry(libRoot, "characters", "mio", { "neutral.png": "n", "sad.png": "s" });
    const store = plays.store("p2");
    await importFromLibrary(library, store, { kind: "characters", entryId: "mio", expressions: ["sad"] });
    expect((await readCard(playsRoot, "p2", "mio")).sprites).toEqual({ happy: "happy.png", sad: "sad.png" });
    expect(existsSync(join(playsRoot, "p2", "assets", "sprites", "mio", "happy.png"))).toBe(true);
    expect(existsSync(join(playsRoot, "p2", "assets", "sprites", "mio", "neutral.png"))).toBe(false);
  });

  it("库里没有这条就报错，不静默成功", async () => {
    await expect(importFromLibrary(library, plays.store("p1"), { kind: "bgm", entryId: "nope" })).rejects.toThrow(
      "资源库里没有",
    );
  });

  it("剧目里手写的补充说明不会被一份缺字段的 meta 冲掉", async () => {
    const store = plays.store("p1");
    await store.writeAsset("backgrounds", "room.jpg", Buffer.from("旧"));
    await mkdir(join(playsRoot, "p1", "assets"), { recursive: true });
    await writeFile(
      join(playsRoot, "p1", "assets", "manifest.json"),
      JSON.stringify({ room: { description: "我自己写的说明", tags: ["旧标签"] } }),
    );
    await makeEntry(libRoot, "backgrounds", "room", { "a.png": "新" }, { description: "库里的说明" });
    await importFromLibrary(library, store, { kind: "backgrounds", entryId: "room" });
    const manifest = JSON.parse(await readFile(join(playsRoot, "p1", "assets", "manifest.json"), "utf8"));
    expect(manifest.room.description).toBe("库里的说明");
    expect(manifest.room.tags).toEqual(["旧标签"]);
  });
});

describe("play.json 读改写串行：立绘包导入之间不能互相覆盖", () => {
  let libRoot: string;
  let playsRoot: string;
  let library: AssetLibrary;
  let plays: PlayLibrary;

  beforeEach(async () => {
    libRoot = await mkdtemp(join(tmpdir(), "stageai-libq-"));
    playsRoot = await mkdtemp(join(tmpdir(), "stageai-playsq-"));
    library = new AssetLibrary(libRoot);
    plays = new PlayLibrary(playsRoot);
    await plays.importZip(zipOf({ "play.json": PLAY_JSON("p1") }));
  });
  afterEach(async () => {
    await rm(libRoot, { recursive: true, force: true });
    await rm(playsRoot, { recursive: true, force: true });
  });

  it("并发导两个角色包：两份差分映射都得在（各读旧角色卡会互相冲掉）", async () => {
    await makeEntry(libRoot, "characters", "mio", { "neutral.png": "n" });
    await makeEntry(libRoot, "characters", "rio", { "neutral.png": "n" });
    // 刻意各调一次 plays.store()：真实 REST 路径就是这样，每个请求各持一份新实例。
    // 复用同一个 store 变量会让锁的 key 恰好对上，把串行假象测出来。
    await Promise.all([
      importFromLibrary(library, plays.store("p1"), { kind: "characters", entryId: "mio" }),
      importFromLibrary(library, plays.store("p1"), { kind: "characters", entryId: "rio" }),
    ]);
    for (const id of ["mio", "rio"]) {
      expect((await readCard(playsRoot, "p1", id)).sprites).toEqual({ neutral: "neutral.png" });
    }
  });

  it("同一个包分两次导不同差分：后一次不能把前一次的差分冲掉", async () => {
    await makeEntry(libRoot, "characters", "mio", { "neutral.png": "n", "smile.png": "s", "sad.png": "d" });
    await Promise.all([
      importFromLibrary(library, plays.store("p1"), { kind: "characters", entryId: "mio", expressions: ["neutral", "smile"] }),
      importFromLibrary(library, plays.store("p1"), { kind: "characters", entryId: "mio", expressions: ["sad"] }),
    ]);
    expect((await readCard(playsRoot, "p1", "mio")).sprites).toMatchObject({
      neutral: "neutral.png",
      smile: "smile.png",
      sad: "sad.png",
    });
  });

  it("并发导两个背景：素材表条目不能互相覆盖", async () => {
    await makeEntry(libRoot, "backgrounds", "hall", { "a.png": "甲", "meta.json": JSON.stringify({ description: "甲的说明" }) });
    await makeEntry(libRoot, "backgrounds", "yard", { "a.png": "乙", "meta.json": JSON.stringify({ description: "乙的说明" }) });
    await Promise.all([
      importFromLibrary(library, plays.store("p1"), { kind: "backgrounds", entryId: "hall" }),
      importFromLibrary(library, plays.store("p1"), { kind: "backgrounds", entryId: "yard" }),
    ]);
    const manifest = JSON.parse(await readFile(join(playsRoot, "p1", "assets", "manifest.json"), "utf8"));
    expect(manifest.hall.description).toBe("甲的说明");
    expect(manifest.yard.description).toBe("乙的说明");
  });

  it("素材表没改动就不记撤销条：撤销条里混着空操作会误导用户", async () => {
    await makeEntry(libRoot, "backgrounds", "hall", { "a.png": "图" });
    const store = plays.store("p1");
    await importFromLibrary(library, store, { kind: "backgrounds", entryId: "hall" });
    const second = await importFromLibrary(library, plays.store("p1"), { kind: "backgrounds", entryId: "hall" });
    expect(second.writes.filter((w) => w.path === "assets/manifest.json")).toEqual([]);
  });

  it("导入要报出改过的文本：工坊据此给撤销条", async () => {
    await makeEntry(libRoot, "characters", "mio", { "neutral.png": "n" });
    const result = await importFromLibrary(library, plays.store("p1"), { kind: "characters", entryId: "mio" });
    const paths = result.writes.map((w) => w.path).sort();
    expect(paths).toEqual(["assets/manifest.json", "characters/mio.md"]);
    for (const w of result.writes) {
      // before 是写盘前的原样内容，撤销条靠它回滚
      expect(w.after.length).toBeGreaterThan(0);
      expect(w.before === null || typeof w.before === "string").toBe(true);
    }
    // 素材表本来不存在 → before 为 null，撤销就是删掉整个文件
    expect(result.writes.find((w) => w.path === "assets/manifest.json")!.before).toBeNull();
    // 角色卡同理：本来没有这张卡，撤销即删除
    expect(result.writes.find((w) => w.path.startsWith("characters/"))!.before).toBeNull();
  });
});
