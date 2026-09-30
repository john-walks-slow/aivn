import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { LineageTree } from "@stage-ai/core";
import { PlayHouse } from "../src/playhouse.js";
import { PlayLibrary } from "../src/store.js";
import { AssetLibrary } from "../src/library.js";
import { loadConfig } from "../src/config.js";

const PLAY_JSON = JSON.stringify({
  id: "p1",
  title: "T",
  premise: "x",
  characters: [],
  opening: "（开始）",
  initialScene: "s",
});

const engine = { flags: {}, sceneDetails: {}, activeThreads: [] };

describe("PlayHouse 周目作用域：逛不建，看戏才建", () => {
  let root: string;
  let library: PlayLibrary;
  let house: PlayHouse;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), "stageai-playhouse-"));
    const playDir = join(root, "p1");
    await mkdir(playDir, { recursive: true });
    await writeFile(join(playDir, "play.json"), PLAY_JSON);
    library = new PlayLibrary(root);
    // 生图关掉：runtime 只碰磁盘，不发任何网络请求
    const config = loadConfig({ STAGE_IMAGE_ENABLED: "false" }, root);
    house = new PlayHouse(library, config, new AssetLibrary(join(root, "library")));
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  const saveIds = (): Promise<string[]> => library.saves("p1").list().then((s) => s.map((x) => x.id));

  it("get() 不建周目：runtime 落在无会话作用域上", async () => {
    const runtime = await house.get("p1");
    expect(runtime.save.id).toBe("");
    expect(runtime.store.saveId).toBeNull();
    expect(await saveIds()).toEqual([]);
    await expect(runtime.store.saveSession(new LineageTree(), engine, "s")).rejects.toThrow();
  });

  it("stage() 才建周目，并发的两个舞台连接共用同一个 runtime", async () => {
    const [a, b] = await Promise.all([house.stage("p1"), house.stage("p1")]);
    expect(a.save.id).not.toBe("");
    expect(a).toBe(b);
    expect(a.store.saveId).toBe(b.store.saveId);
    expect(await saveIds()).toEqual([a.save.id]);
  });

  it("逛过工坊再连舞台：无会话那份被换掉，工坊现场留着", async () => {
    const browsing = await house.get("p1");
    const staged = await house.stage("p1");
    expect(browsing).not.toBe(staged);
    expect(browsing.store).not.toBe(staged.store);
    expect(staged.workshop).toBe(browsing.workshop); // 工坊对话现场不能被打断
    expect(staged.save.id).not.toBe("");
    expect(await saveIds()).toEqual([staged.save.id]);
  });

  it("删掉最后一棵周目后回到无会话作用域，下次连舞台再新建一棵", async () => {
    const staged = await house.stage("p1");
    await house.deleteSave("p1", staged.save.id);
    expect(await saveIds()).toEqual([]);

    const again = await house.stage("p1");
    expect(again.save.id).not.toBe("");
    expect(await saveIds()).toEqual([again.save.id]);
  });

  it("已有活动周目时 stage() 挂上去，不另建", async () => {
    const created = await library.saves("p1").create();
    const staged = await house.stage("p1");
    expect(staged.save.id).toBe(created.id);
    expect(staged.save.name).toBe(created.name);
    expect(await saveIds()).toEqual([created.id]);
  });

  it("并发 get() 共享同一次装配，不各装一份 runtime", async () => {
    const [a, b] = await Promise.all([house.get("p1"), house.get("p1")]);
    expect(a).toBe(b);
  });

  it("装配完成后不再留住在飞记录：runtime 被换掉后装得出新的那一份", async () => {
    const browsing = await house.get("p1");
    const staged = await house.stage("p1");
    await house.deleteSave("p1", staged.save.id);
    // 在飞表里若还留着 browsing 这条已兑现的 promise，这里拿回的就是它——
    // 那份 runtime 早已被 stage() 换掉、orchestrator 已 dispose，拿到就是死的
    expect(await house.get("p1")).not.toBe(browsing);
  });
});
