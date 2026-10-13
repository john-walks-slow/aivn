import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import sharp from "sharp";
import { zipSync } from "fflate";
import { libraryEntryMatches, parseCharacterCard, parsePlayAssetManifest, PROTAGONIST_ID } from "@aivn/core";
import { AssetLibrary, assertEntryId } from "../src/library.js";
import { importFromLibrary } from "../src/assetImport.js";
import { createImportAssetTool } from "../src/agentkit/registerTool.js";
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

async function makeEntry(root: string, kind: string, id: string, files: Record<string, string | Uint8Array>, meta?: unknown): Promise<void> {
  const dir = join(root, kind, id);
  await mkdir(dir, { recursive: true });
  for (const [name, body] of Object.entries(files)) await writeFile(join(dir, name), body);
  if (meta !== undefined) await writeFile(join(dir, "meta.json"), typeof meta === "string" ? meta : JSON.stringify(meta));
}

/**
 * 立绘夹具：一张**真**透明 PNG（200×400 画布上贴 100×240 的人物）。
 *
 * 库里那份是作者自己裁的任意画布，而导入要过入库归一化——读不出字节的假图（"n" 这种）
 * 现在会当场报错，所以立绘类目的夹具必须真能解码。
 */
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
    root = await mkdtemp(join(tmpdir(), "aivn-lib-"));
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
    libRoot = await mkdtemp(join(tmpdir(), "aivn-lib-"));
    playsRoot = await mkdtemp(join(tmpdir(), "aivn-plays-"));
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

  it("立绘包：落 sprites/<id>/ 并把呈现声明写进素材表，卡上不再挂差分", async () => {
    await makeEntry(libRoot, "characters", "mio", { "neutral.png": await spritePng(), "smile.png": await spritePng() }, {
      character: { name: "澪", persona: "元气少女" },
      variants: { neutral: { file: "neutral.png" }, smile: { file: "smile.png", description: "笑" } },
    });
    const result = await importFromLibrary(library, plays.store("p1"), { kind: "characters", entryId: "mio" });
    expect(result.files).toEqual(["assets/sprites/mio/neutral.png", "assets/sprites/mio/smile.png"]);
    expect(result.characters).toEqual(["mio"]);
    // neutral 的落位指标归立绘级、smile 归差分级——键位与引擎那条声明规则一致
    expect(result.manifestKeys).toEqual(["mio", "mio/smile"]);
    expect(await readCard(playsRoot, "p1", "mio")).toMatchObject({
      id: "mio",
      name: "澪",
      body: "元气少女",
    });
    // 差分就是目录里的文件名，卡上不再有第二份映射表
    expect(await readCard(playsRoot, "p1", "mio")).not.toHaveProperty("sprites");
    // 角色不再落 play.json：那格是纯元数据，任何运行时逻辑都不读它
    expect(JSON.parse(await readFile(join(playsRoot, "p1", "play.json"), "utf8")).characters).toEqual([]);
    const manifest = JSON.parse(await readFile(join(playsRoot, "p1", "assets", "manifest.json"), "utf8"));
    expect(manifest["mio/smile"]).toMatchObject({ description: "笑" });
    // neutral 归立绘级，不留 `mio/neutral` 那条
    expect(manifest["mio/neutral"]).toBeUndefined();
    // 库里那份是作者裁的 200×400：导入过一遍入库归一化，落进剧目的是该取景的画布 + 两格指标
    expect(manifest.mio).toMatchObject({ figureTop: 96, figureHeight: 1824 });
    expect(manifest["mio/smile"]).toMatchObject({ figureTop: 96, figureHeight: 1824 });
    const neutralFile = await sharp(await readFile(join(playsRoot, "p1", "assets", "sprites", "mio", "neutral.png"))).metadata();
    expect([neutralFile.width, neutralFile.height]).toEqual([1080, 1920]);
  });

  it("立绘取景：条目级 framing 与差分覆盖都进素材表", async () => {
    await makeEntry(libRoot, "characters", "mio", { "neutral.png": await spritePng(), "closeup.png": await spritePng() }, {
      character: { name: "澪", persona: "" },
      framing: "half",
      variants: {
        neutral: { file: "neutral.png" },
        closeup: { file: "closeup.png", framing: "square" },
      },
    });
    await importFromLibrary(library, plays.store("p1"), { kind: "characters", entryId: "mio" });
    const manifest = JSON.parse(await readFile(join(playsRoot, "p1", "assets", "manifest.json"), "utf8"));
    expect(manifest.mio).toMatchObject({ framing: "half" });
    expect(manifest["mio/closeup"]).toMatchObject({ framing: "square" });
    expect(await readCard(playsRoot, "p1", "mio")).not.toHaveProperty("framing");
  });

  /* ── 模型面：登记这一个动词的 `library:<kind>/<entryId>` 来源 ───────────────── */

  /** 装一次 import_asset（工坊那一份），拿到它的 execute 与气泡回调。 */
  function importTool(store: ReturnType<PlayLibrary["store"]>) {
    const bubbles: string[] = [];
    const tool = createImportAssetTool({
      playId: "p1",
      store,
      library,
      onAsset: (path) => bubbles.push(path),
    });
    return { tool, bubbles };
  }

  it("library:// 来源 —— 不在 URI 内嵌分类，背景按落位给的名字落，条目描述进素材表", async () => {
    await makeEntry(libRoot, "backgrounds", "classroom_dusk", { "bg.png": "像素" }, { description: "放学后的空教室" });
    const { tool, bubbles } = importTool(plays.store("p1"));
    const out = await tool.execute(
      "c1",
      { source: "library://classroom_dusk", kind: "background", name: "school", description: "校舍" },
      undefined as never,
    );
    const text = JSON.stringify(out);
    expect(text).toContain("assets/backgrounds/school.png");
    expect(bubbles).toEqual(["assets/backgrounds/school.png"]);
    const manifest = JSON.parse(await readFile(join(playsRoot, "p1", "assets", "manifest.json"), "utf8"));
    // 条目自带的描述被登记时给的那句盖掉（模型补的描述更贴本剧目）
    expect(manifest.school).toMatchObject({ description: "校舍" });
  });

  it("library:// 来源 —— 角色包的图与卡都落在 spriteId 名下（改名不再靠 target 特判）", async () => {
    await makeEntry(libRoot, "characters", "mio", { "neutral.png": await spritePng(), "smile.png": await spritePng() }, {
      character: { name: "澪", persona: "元气少女" },
      variants: { neutral: { file: "neutral.png" }, smile: { file: "smile.png", description: "笑" } },
    });
    const { tool } = importTool(plays.store("p1"));
    const out = await tool.execute(
      "c2",
      { source: "library://mio", kind: "sprite", spriteId: "lin" },
      undefined as never,
    );
    expect(JSON.stringify(out)).toContain("characters/lin.md");
    expect((await readCard(playsRoot, "p1", "lin")).name).toBe("澪");
    expect(existsSync(join(playsRoot, "p1", "assets", "sprites", "lin", "smile.png"))).toBe(true);
    expect(existsSync(join(playsRoot, "p1", "characters", "mio.md"))).toBe(false);
  });

  it("library:// 来源 —— 支持导入 bgm，且库类别与落位对不上就顶回来，一个字节都不落", async () => {
    await makeEntry(libRoot, "bgm", "twilight", { "t.mp3": "音" });
    const { tool, bubbles } = importTool(plays.store("p1"));
    const bad = await tool.execute(
      "c3",
      { source: "library://twilight", kind: "background", name: "twilight" },
      undefined as never,
    );
    expect(JSON.stringify(bad)).toContain("对不上");
    expect(bubbles).toEqual([]);
    expect(existsSync(join(playsRoot, "p1", "assets", "backgrounds", "twilight.mp3"))).toBe(false);

    const ok = await tool.execute(
      "c4",
      { source: "library://twilight", kind: "bgm", name: "twilight" },
      undefined as never,
    );
    expect(JSON.stringify(ok)).toContain("assets/bgm/twilight.mp3");
    expect(existsSync(join(playsRoot, "p1", "assets", "bgm", "twilight.mp3"))).toBe(true);
  });

  it("立绘取景：只导一条差分不该把该主体其它差分的声明抹掉", async () => {
    const store = plays.store("p1");
    await mkdir(join(playsRoot, "p1", "assets"), { recursive: true });
    await writeFile(
      join(playsRoot, "p1", "assets", "manifest.json"),
      JSON.stringify({ mio: { framing: "full" }, "mio/angry": { framing: "square" } }),
    );
    await writeCard(
      playsRoot,
      "p1",
      "mio",
      "---\nid: mio\nname: 澪\nframing: full\nspriteFraming:\n  angry: square\n---\n人设",
    );
    await makeEntry(libRoot, "characters", "mio", { "smile.png": await spritePng() }, {
      character: { name: "澪", persona: "" },
      variants: { smile: { file: "smile.png" } },
    });
    await importFromLibrary(library, store, { kind: "characters", entryId: "mio" });
    // 条目没声明 framing：剧目侧的值原样留着（含别的差分的覆盖），导入不许顺手清掉
    const manifest = JSON.parse(await readFile(join(playsRoot, "p1", "assets", "manifest.json"), "utf8"));
    expect(manifest.mio).toMatchObject({ framing: "full" });
    expect(manifest["mio/angry"]).toEqual({ framing: "square" });
    // 老卡上那两行残留字段被解析器当噪声丢掉，下次写盘它就瘦下来了
    expect(await readCard(playsRoot, "p1", "mio")).toEqual({ id: "mio", name: "澪", body: "人设" });
  });

  it("纯角色卡：没有立绘也能导入（先定人设、图后面再画）", async () => {
    await makeEntry(libRoot, "characters", "yuzuki", {}, {
      character: { name: "柚月", persona: "沉默的转学生", voice: "短句", voiceId: "a".repeat(32) },
    });
    const result = await importFromLibrary(library, plays.store("p1"), { kind: "characters", entryId: "yuzuki" });
    expect(result.files).toEqual([]);
    expect(result.manifestKeys).toEqual([]);
    expect(await readCard(playsRoot, "p1", "yuzuki")).toMatchObject({
      id: "yuzuki",
      name: "柚月",
      voice: "短句",
      voiceId: "a".repeat(32),
      body: "沉默的转学生",
    });
    // 没有图就没有摆位可声明：不为了「有条目」凭空写一条素材表记录
    expect(existsSync(join(playsRoot, "p1", "assets", "manifest.json"))).toBe(false);
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

  it("as=protagonist 写固定 id 的主角卡：卡与立绘都落在 protagonist 名下，play.json 一个字节不动", async () => {
    await makeEntry(libRoot, "characters", "rio", { "neutral.png": await spritePng() }, {
      character: { name: "理央", persona: "玩家扮演" },
      variants: { neutral: { file: "neutral.png" } },
    });
    const store = plays.store("p1");
    await writeFile(
      join(playsRoot, "p1", "play.json"),
      JSON.stringify({ id: "p1", title: "T", characters: [], opening: "（开始）", initialScene: "s" }),
    );
    const before = await readFile(join(playsRoot, "p1", "play.json"), "utf8");

    const result = await importFromLibrary(library, store, { kind: "characters", entryId: "rio", as: PROTAGONIST_ID });

    expect(result.protagonist).toBe(true);
    expect(result.characters).toEqual(["protagonist"]);
    expect(await readCard(playsRoot, "p1", "protagonist")).toMatchObject({ name: "理央", body: "玩家扮演" });
    // 主角和别的角色一样能上台，所以立绘照导——落在 sprites/protagonist/
    expect(result.files).toEqual(["assets/sprites/protagonist/neutral.png"]);
    expect(existsSync(join(playsRoot, "p1", "assets", "sprites", "protagonist", "neutral.png"))).toBe(true);
    expect(await readFile(join(playsRoot, "p1", "play.json"), "utf8")).toBe(before);
  });

  it("只导选中的差分，已有的别的差分原样留着", async () => {
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
    await makeEntry(libRoot, "characters", "mio", { "neutral.png": await spritePng(), "sad.png": await spritePng() });
    const store = plays.store("p2");
    await importFromLibrary(library, store, { kind: "characters", entryId: "mio", variants: ["sad"] });
    const dir = join(playsRoot, "p2", "assets", "sprites", "mio");
    expect(existsSync(join(dir, "happy.png"))).toBe(true);
    expect(existsSync(join(dir, "sad.png"))).toBe(true);
    // 没点名的那条不导
    expect(existsSync(join(dir, "neutral.png"))).toBe(false);
    // 卡上没有映射表了，老卡那两行被当噪声丢掉
    expect(await readCard(playsRoot, "p2", "mio")).toEqual({ id: "mio", name: "澪", body: "p" });
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
    libRoot = await mkdtemp(join(tmpdir(), "aivn-libq-"));
    playsRoot = await mkdtemp(join(tmpdir(), "aivn-playsq-"));
    library = new AssetLibrary(libRoot);
    plays = new PlayLibrary(playsRoot);
    await plays.importZip(zipOf({ "play.json": PLAY_JSON("p1") }));
  });
  afterEach(async () => {
    await rm(libRoot, { recursive: true, force: true });
    await rm(playsRoot, { recursive: true, force: true });
  });

  it("并发导两个角色包：两份呈现声明都得在（各读旧素材表会互相冲掉）", async () => {
    await makeEntry(libRoot, "characters", "mio", { "neutral.png": await spritePng() }, { framing: "full" });
    await makeEntry(libRoot, "characters", "rio", { "neutral.png": await spritePng() }, { framing: "half" });
    // 刻意各调一次 plays.store()：真实 REST 路径就是这样，每个请求各持一份新实例。
    // 复用同一个 store 变量会让锁的 key 恰好对上，把串行假象测出来。
    await Promise.all([
      importFromLibrary(library, plays.store("p1"), { kind: "characters", entryId: "mio" }),
      importFromLibrary(library, plays.store("p1"), { kind: "characters", entryId: "rio" }),
    ]);
    const manifest = JSON.parse(await readFile(join(playsRoot, "p1", "assets", "manifest.json"), "utf8"));
    expect(manifest.mio).toMatchObject({ framing: "full" });
    expect(manifest.rio).toMatchObject({ framing: "half" });
    for (const id of ["mio", "rio"]) {
      expect(existsSync(join(playsRoot, "p1", "assets", "sprites", id, "neutral.png"))).toBe(true);
    }
  });

  it("同一个包分两次导不同差分：后一次不能把前一次的声明冲掉", async () => {
    await makeEntry(libRoot, "characters", "mio", { "neutral.png": await spritePng(), "smile.png": await spritePng(), "sad.png": await spritePng() }, {
      framing: "full",
      variants: { smile: { file: "smile.png", framing: "square" } },
    });
    await Promise.all([
      importFromLibrary(library, plays.store("p1"), { kind: "characters", entryId: "mio", variants: ["neutral", "smile"] }),
      importFromLibrary(library, plays.store("p1"), { kind: "characters", entryId: "mio", variants: ["sad"] }),
    ]);
    const manifest = JSON.parse(await readFile(join(playsRoot, "p1", "assets", "manifest.json"), "utf8"));
    expect(manifest.mio).toMatchObject({ framing: "full" });
    expect(manifest["mio/smile"]).toMatchObject({ framing: "square" });
    for (const variant of ["neutral", "smile", "sad"]) {
      expect(existsSync(join(playsRoot, "p1", "assets", "sprites", "mio", `${variant}.png`))).toBe(true);
    }
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

  it("素材表没改动就不推刷新信号：空操作会让各页白重拉一次", async () => {
    await makeEntry(libRoot, "backgrounds", "hall", { "a.png": "图" });
    const store = plays.store("p1");
    await importFromLibrary(library, store, { kind: "backgrounds", entryId: "hall" });
    const second = await importFromLibrary(library, plays.store("p1"), { kind: "backgrounds", entryId: "hall" });
    expect(second.writes.filter((w) => w.path === "assets/manifest.json")).toEqual([]);
  });

  it("导入要报出改过的路径：工坊据此重拉各页", async () => {
    await makeEntry(libRoot, "characters", "mio", { "neutral.png": await spritePng() }, {
      description: "澪的立绘",
      character: { name: "澪" },
    });
    const result = await importFromLibrary(library, plays.store("p1"), { kind: "characters", entryId: "mio" });
    const paths = result.writes.map((w) => w.path).sort();
    expect(paths).toEqual(["assets/manifest.json", "characters/mio.md"]);
  });
});
