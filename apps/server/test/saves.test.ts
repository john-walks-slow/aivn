import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { existsSync } from "node:fs";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { LineageTree } from "@stage-ai/core";
import { PlayLibrary } from "../src/store.js";
import { PlaySaves, assertSaveId, saveDirOf } from "../src/saves.js";

const PLAY_JSON = JSON.stringify({
  id: "p1",
  title: "T",
  premise: "x",
  characters: [],
  opening: "（开始）",
  initialScene: "s",
});

/** 一棵只追加不分支的树，n 拍。 */
function treeOf(beats: number, texts: string[]): LineageTree {
  const tree = new LineageTree();
  texts.forEach((text) => tree.append("say", { text, payload: { seq: tree.events.length } }));
  for (let i = 0; i < beats; i += 1) tree.append("beat_end", { text: "", payload: { reason: "pause" } });
  return tree;
}

const engine = { flags: {}, sceneDetails: {}, activeThreads: [] };

describe("PlaySaves 周目档管理", () => {
  let root: string;
  let playDir: string;
  let saves: PlaySaves;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), "stageai-saves-"));
    playDir = join(root, "p1");
    await import("node:fs/promises").then((fs) => fs.mkdir(playDir, { recursive: true }));
    await writeFile(join(playDir, "play.json"), PLAY_JSON);
    saves = new PlaySaves(playDir);
  });
  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it("has() 区分「有这棵周目」与「没有」，非法 id 一律 false", async () => {
    const a = await saves.create();
    expect(await saves.has(a.id)).toBe(true);
    expect(await saves.has("s-nope")).toBe(false);
    expect(await saves.has("../etc")).toBe(false);
    expect(await saves.has("")).toBe(false);
    await saves.remove(a.id);
    expect(await saves.has(a.id)).toBe(false);
  });

  it("新建周目：默认名按序递增，重名自动加后缀，id 互不相同", async () => {
    const a = await saves.create();
    const b = await saves.create();
    const c = await saves.create();
    expect([a.name, b.name, c.name]).toEqual(["第 1 周目", "第 2 周目", "第 3 周目"]);
    expect(new Set([a.id, b.id, c.id]).size).toBe(3);

    // 默认名撞车（玩家已把某一档改成「第 1 周目」）时另起一个而不是覆盖
    await saves.rename(c.id, "第 1 周目");
    const d = await saves.create();
    expect(d.name).toBe("第 4 周目");
  });

  it("改名只动标签：id 与 active 指针都不变", async () => {
    const a = await saves.create();
    await saves.activate(a.id);
    await saves.rename(a.id, "深夜档");
    expect(await saves.nameOf(a.id)).toBe("深夜档");
    expect(await saves.readActive()).toBe(a.id);
    expect(existsSync(saveDirOf(playDir, a.id))).toBe(true);
  });

  it("非法 id 直接拒：它会拼进文件路径与 REST 路径", () => {
    expect(assertSaveId("s123")).toBe("s123");
    expect(() => assertSaveId("../逃逸")).toThrow(/非法存档 id/);
    expect(() => assertSaveId("a/b")).toThrow(/非法存档 id/);
  });

  it("列目录只认真 meta.json：孤立目录不拖垮列表", async () => {
    const a = await saves.create();
    const { mkdir } = await import("node:fs/promises");
    await mkdir(join(playDir, "saves", "s孤儿目录"), { recursive: true });
    await writeFile(join(playDir, "saves", "s孤儿目录", "meta.json"), "{ 不是 json");

    const list = await saves.list();
    expect(list.map((s) => s.id)).toEqual([a.id]);
    expect(list[0]?.current).toBe(true);
  });

  it("删除活动档：指针落到剩下的第一棵，全删光则空指针", async () => {
    const a = await saves.create();
    const b = await saves.create();
    await saves.activate(a.id);

    await saves.remove(a.id);
    expect(await saves.readActive()).toBe(b.id);
    expect(existsSync(saveDirOf(playDir, a.id))).toBe(false);

    await saves.remove(b.id);
    expect(await saves.readActive()).toBeNull();
  });
});

describe("PlayStore 按周目隔离会话", () => {
  let root: string;
  let library: PlayLibrary;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), "stageai-saves-store-"));
    library = new PlayLibrary(root);
    const { mkdir } = await import("node:fs/promises");
    const playDir = join(root, "p1");
    await mkdir(playDir, { recursive: true });
    await writeFile(join(playDir, "play.json"), PLAY_JSON);
  });
  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it("两棵树的会话互不覆盖：开新周目后旧周目原样还在", async () => {
    const saves = library.saves("p1");
    const first = await saves.create();
    const firstStore = library.saveStore("p1", first.id);
    await firstStore.saveSession(treeOf(2, ["第一句", "第二句"]), engine, "场景甲");

    const second = await saves.create();
    const secondStore = library.saveStore("p1", second.id);
    await secondStore.saveSession(treeOf(1, ["新周目的第一句"]), engine, "场景乙");

    // 新周目是空树起步：这里刻意存一棵独立的树，不该碰到旧周目
    const reloaded = await library.saveStore("p1", first.id).loadSession();
    expect(reloaded?.scene).toBe("场景甲");
    const texts = reloaded?.store.events.filter((e) => e.kind === "say").map((e) => e.text);
    expect(texts).toEqual(["第一句", "第二句"]);

    const fresh = await library.saveStore("p1", second.id).loadSession();
    expect(fresh?.scene).toBe("场景乙");
    expect(fresh?.store.events.filter((e) => e.kind === "say").map((e) => e.text)).toEqual([
      "新周目的第一句",
    ]);
  });

  it("档元信息随会话更新：拍数与最后一句取当前路径", async () => {
    const saves = library.saves("p1");
    const save = await saves.create();
    const store = library.saveStore("p1", save.id);
    await store.saveSession(treeOf(3, ["甲", "乙", "丙"]), engine, "s");

    const meta = await saves.list().then((l) => l[0]!);
    expect(meta.beats).toBe(3);
    expect(meta.preview).toBe("丙");
  });

  it("剧目级 store 没有存档作用域：会话面必须落在某一棵树上", async () => {
    const playStore = library.store("p1");
    expect(playStore.saveId).toBeNull();
    expect(await playStore.loadSession()).toBeNull();
    await expect(playStore.saveSession(treeOf(1, ["x"]), engine, "s")).rejects.toThrow(/无存档作用域/);
  });

  it("就绪门：有没有周目，而不是有没有根目录 session.json", async () => {
    const playStore = library.store("p1");
    expect((await playStore.readiness()).hasSession).toBe(false);

    const save = await library.saves("p1").create();
    await library.saveStore("p1", save.id).saveSession(treeOf(1, ["x"]), engine, "s");
    expect((await playStore.readiness()).hasSession).toBe(true);
  });

  it("导出不带运行时数据：saves/ 与 active.json 排除在剧目包之外", async () => {
    const save = await library.saves("p1").create();
    await library.saveStore("p1", save.id).saveSession(treeOf(1, ["x"]), engine, "s");

    const zip = await library.exportZip("p1");
    const text = new TextDecoder().decode(zip);
    expect(text).toContain("play.json");
    expect(text).not.toContain("session.json");
    expect(text).not.toContain("active.json");
  });
});
