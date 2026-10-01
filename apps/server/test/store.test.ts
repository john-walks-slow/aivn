import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { zipSync } from "fflate";
import { PlayLibrary } from "../src/store.js";

function zipOf(files: Record<string, string | Uint8Array>): Buffer {
  return Buffer.from(
    zipSync(
      Object.fromEntries(
        Object.entries(files).map(([k, v]) => [k, typeof v === "string" ? new TextEncoder().encode(v) : v]),
      ),
    ),
  );
}

const PLAY_JSON = (id: string): string =>
  JSON.stringify({ id, title: "T", characters: [], opening: "（开始）", initialScene: "s" });

describe("PlayLibrary 剧目包导入与删除", () => {
  let root: string;
  let library: PlayLibrary;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), "stageai-"));
    library = new PlayLibrary(root);
  });
  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it("正常导入：play.json + 素材落盘，list 可见", async () => {
    const id = await library.importZip(
      zipOf({
        "play.json": PLAY_JSON("p1"),
        "assets/backgrounds/bg.png": new Uint8Array([1, 2, 3]),
      }),
    );
    expect(id).toBe("p1");
    expect(existsSync(join(root, "p1", "assets", "backgrounds", "bg.png"))).toBe(true);
    expect((await library.list()).map((p) => p.id)).toEqual(["p1"]);
  });

  it("Zip Slip：路径穿越条目被拒，且零残留（先全量校验再落盘）", async () => {
    await expect(
      library.importZip(
        zipOf({
          "play.json": PLAY_JSON("evil"),
          "assets/../../../tmp/stageai-pwn.txt": new Uint8Array([1]),
        }),
      ),
    ).rejects.toThrow("非法路径");
    expect(await readdir(root)).toEqual([]);
    expect(existsSync("/tmp/stageai-pwn.txt")).toBe(false);
  });

  it("非法剧目 id（目录穿越）被拒", async () => {
    await expect(
      library.importZip(zipOf({ "play.json": PLAY_JSON("../escape") })),
    ).rejects.toThrow("非法剧目 id");
  });

  it("createEmpty 落两份空设定；remove 整目录删除", async () => {
    await library.createEmpty("blank", "空白");
    const store = library.store("blank");
    // 两份设定默认就是空的：引导写在输入框的 placeholder 里，写进文件只会让人
    // 以为「已经填过了」，而模板正文还会让就绪门误判前提已就位
    expect((await store.premise()).trim()).toBe("");
    expect((await store.readiness()).premise).toBe(false);
    expect((await readFile(join(root, "blank", "memory/always/craft.md"), "utf8")).trim()).toBe("");
    await library.remove("blank");
    expect(existsSync(join(root, "blank"))).toBe(false);
  });

  it("没有图只是「还没有」，不挡开演（工坊出图是后话）", async () => {
    await library.createEmpty("pic", "图不多");
    const store = library.store("pic");
    await writeFile(join(root, "pic", "play.json"), PLAY_JSON("pic"));
    await store.savePremise("黄昏的走廊。\n");
    const readiness = await store.readiness();
    expect(readiness.characterSprites).toBe(false);
    expect(readiness.background).toBe(false);
    expect(readiness.premise).toBe(true);
  });

  it("play.json 留空但写了 memory/always/premise.md 才算数", async () => {
    await library.createEmpty("mem", "记忆卡");
    await writeFile(join(root, "mem", "play.json"), PLAY_JSON("mem"));
    const store = library.store("mem");
    // premise 已从 play.json 移出：唯一真相源是 memory/always/premise.md
    await rm(join(root, "mem", "memory/always/premise.md"));
    expect((await store.readiness()).premise).toBe(false);
    expect(await store.premise()).toBe("");

    await store.savePremise("# 前提\n黄昏的走廊。\n");
    expect((await store.readiness()).premise).toBe(true);
    expect(await store.premise()).toContain("黄昏");
  });

  it("旧剧目：前提还躺在 play.json 里也认（否则用户的剧会空掉）", async () => {
    await library.createEmpty("old", "旧剧目");
    await rm(join(root, "old", "memory/always/premise.md"), { force: true });
    await writeFile(
      join(root, "old", "play.json"),
      JSON.stringify({ id: "old", title: "T", premise: "黄昏的走廊。", characters: [], opening: "（开始）", initialScene: "s" }),
    );
    const store = library.store("old");
    expect(await store.premise()).toBe("黄昏的走廊。");
    expect((await store.readiness()).premise).toBe(true);
    // 用户把前提存进 memory 之后，以 memory 为准
    await store.savePremise("新写的前提。\n");
    expect(await store.premise()).toBe("新写的前提。\n");
  });

  it("立绘清单排序稳定（素材页每次打开顺序一致）", async () => {
    await library.importZip(
      zipOf({
        "play.json": PLAY_JSON("sprites"),
        "assets/sprites/mio/angry.png": new Uint8Array([1]),
        "assets/sprites/mio/neutral.png": new Uint8Array([1]),
        "assets/sprites/mio/blush.png": new Uint8Array([1]),
      }),
    );
    const twice = [await library.store("sprites").listAssets(), await library.store("sprites").listAssets()];
    expect(twice[0]).toEqual(twice[1]);
    expect(twice[0]!["sprites/mio"]).toEqual(["angry.png", "blush.png", "neutral.png"]);
  });
});

describe("PlayStore.assetMeta：素材描述表", () => {
  let root: string;
  let library: PlayLibrary;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), "stageai-"));
    library = new PlayLibrary(root);
    await library.importZip(
      zipOf({
        "play.json": PLAY_JSON("p1"),
        "assets/manifest.json": JSON.stringify({
          bg_a: "黄昏教室",
          bg_b: "  ",
          bad: 42,
          bg_c: { description: "雨夜天台", tags: ["夜"], mood: ["忧伤"] },
        }),
      }),
    );
  });
  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it("旧格式的纯字符串归一化成元数据，空白与非字符串丢弃", async () => {
    expect(await library.store("p1").assetMeta()).toEqual({
      bg_a: { description: "黄昏教室" },
      bg_c: { description: "雨夜天台", tags: ["夜"], mood: ["忧伤"] },
    });
  });

  it("缺文件或非法 JSON 一律空表，不抛错", async () => {
    await library.createEmpty("blank", "空白");
    expect(await library.store("blank").assetMeta()).toEqual({});
    await writeFile(join(root, "p1", "assets", "manifest.json"), "{ 坏 json");
    expect(await library.store("p1").assetMeta()).toEqual({});
  });
});
