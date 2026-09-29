import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { existsSync } from "node:fs";
import { mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
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
  JSON.stringify({ id, title: "T", premise: "x", characters: [], opening: "（开始）", initialScene: "s" });

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

  it("createEmpty premise 留空 → 就绪门判缺；remove 整目录删除", async () => {
    await library.createEmpty("blank", "空白");
    const readiness = await library.store("blank").readiness();
    expect(readiness.premise).toBe(false);
    expect(readiness.ready).toBe(false);
    await library.remove("blank");
    expect(existsSync(join(root, "blank"))).toBe(false);
  });
});

describe("PlayStore.assetNotes：素材描述表", () => {
  let root: string;
  let library: PlayLibrary;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), "stageai-"));
    library = new PlayLibrary(root);
    await library.importZip(
      zipOf({
        "play.json": PLAY_JSON("p1"),
        "assets/manifest.json": JSON.stringify({ bg_a: "黄昏教室", bg_b: "  ", bad: 42 }),
      }),
    );
  });
  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it("只收非空字符串项，空白与非字符串丢弃", async () => {
    expect(await library.store("p1").assetNotes()).toEqual({ bg_a: "黄昏教室" });
  });

  it("缺文件或非法 JSON 一律空表，不抛错", async () => {
    await library.createEmpty("blank", "空白");
    expect(await library.store("blank").assetNotes()).toEqual({});
    await writeFile(join(root, "p1", "assets", "manifest.json"), "{ 坏 json");
    expect(await library.store("p1").assetNotes()).toEqual({});
  });
});
