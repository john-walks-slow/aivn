import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { zipSync } from "fflate";
import { LineageTree } from "@aivn/core";
import { PlayLibrary, type PlayStore } from "../src/store.js";

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
    root = await mkdtemp(join(tmpdir(), "aivn-"));
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
          "assets/../../../tmp/aivn-pwn.txt": new Uint8Array([1]),
        }),
      ),
    ).rejects.toThrow("非法路径");
    expect(await readdir(root)).toEqual([]);
    expect(existsSync("/tmp/aivn-pwn.txt")).toBe(false);
  });

  it("非法剧目 id（目录穿越）被拒", async () => {
    await expect(
      library.importZip(zipOf({ "play.json": PLAY_JSON("../escape") })),
    ).rejects.toThrow("非法剧目 id");
  });

  it("createEmpty 落两份空设定 + 一张主角卡；remove 整目录删除", async () => {
    await library.createEmpty("blank", "空白");
    const store = library.store("blank");
    // 两份设定默认就是空的：引导写在输入框的 placeholder 里，写进文件只会让人
    // 以为「已经填过了」，而模板正文还会让就绪门误判前提已就位
    expect((await store.premise()).trim()).toBe("");
    expect((await store.readiness()).premise).toBe(false);
    expect((await readFile(join(root, "blank", "memory/always/craft.md"), "utf8")).trim()).toBe("");
    // 主角卡在顶层 characters/，一建剧目就有：id 固定，空文件会让它从角色表里消失
    const protagonist = await readFile(join(root, "blank", "characters/protagonist.md"), "utf8");
    expect(protagonist).toContain("name: 你");
    await library.remove("blank");
    expect(existsSync(join(root, "blank"))).toBe(false);
  });

  it("没有图只是「还没有」，不挡开演（工坊出图是后话）", async () => {
    await library.createEmpty("pic", "图不多");
    const store = library.store("pic");
    await writeFile(join(root, "pic", "play.json"), PLAY_JSON("pic"));
    await store.savePremise("黄昏的走廊。\n");
    const readiness = await store.readiness();
    expect(readiness.sprites).toBe(false);
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
    root = await mkdtemp(join(tmpdir(), "aivn-"));
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

describe("PlayStore.saveSession 原子写", () => {
  let root: string;
  let library: PlayLibrary;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), "aivn-session-"));
    library = new PlayLibrary(root);
    await library.createEmpty("p1", "剧目");
    // create 自己会建目录并激活，返回带 id 的 SaveInfo
    await library.saves("p1").create("第一周目");
  });
  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  const saveDir = async (): Promise<string> => {
    const id = await library.saves("p1").readActive();
    return join(root, "p1", "saves", id!);
  };
  /** 会话面必须落在某一棵树上：按档取 store（剧目级 store 无 saveId）。 */
  const sessionStore = async (): Promise<PlayStore> =>
    library.saveStore("p1", (await library.saves("p1").readActive())!);

  const treeWithBeat = (): LineageTree => {
    const tree = new LineageTree();
    tree.append("say", { text: "第一轮", payload: { seq: 1 } });
    tree.append("beat_end", { text: "", payload: { reason: "pause" } });
    return tree;
  };

  it("落盘后可 loadSession 读回，且不留 tmp 残留", async () => {
    const store = await sessionStore();
    const tree = treeWithBeat();
    await store.saveSession(tree, { turn: 1, affinity: { mio: 10 }, flags: {} }, "走廊", undefined, []);

    const loaded = await store.loadSession();
    expect(loaded?.scene).toBe("走廊");
    expect(loaded?.engine.affinity.mio).toBe(10);

    const files = await readdir(await saveDir());
    expect(files.filter((f) => f.includes(".tmp"))).toEqual([]);
    // 写两次内容不同，旧档被整体替换而不是追加
    await store.saveSession(tree, { turn: 2, affinity: {}, flags: {} }, "天台", undefined, []);
    expect((await store.loadSession())?.scene).toBe("天台");
  });

  it("崩在写一半上：旧 session.json 原样保住（tmp + rename 的意义）", async () => {
    const store = await sessionStore();
    const tree = treeWithBeat();
    await store.saveSession(tree, { turn: 1, affinity: {}, flags: {} }, "走廊");
    const before = await readFile(join(await saveDir(), "session.json"), "utf8");

    // 序列化阶段炸（history 里塞了不可序列化的东西）：崩在写 tmp 之前，
    // 盘上那份 session.json 一个字节都不该被动——这是这条不变式要保的东西。
    const poisoned = {
      type: "assistant",
      content: [{ type: "toolCall", id: "c1", name: "beat_done", arguments: BigInt(1) }],
    } as never;
    await expect(
      store.saveSession(tree, { turn: 9, affinity: {}, flags: {} }, "毒档", undefined, [poisoned]),
    ).rejects.toThrow();

    const after = await readFile(join(await saveDir(), "session.json"), "utf8");
    expect(after).toBe(before);
    expect((await store.loadSession())?.scene).toBe("走廊");
    // 崩在 rename 之前，tmp 不该留在盘上
    const files = await readdir(await saveDir());
    expect(files.filter((f) => f.includes(".tmp"))).toEqual([]);
  });
});
