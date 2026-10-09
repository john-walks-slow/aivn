import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { listPlayAssets, readPlayReadiness, renderReadiness } from "../src/index.js";

/**
 * 剧目自查：判据是给 agent 看的底数，不是闸门。
 * 这里盯三条：坏掉的 play.json 要说清哪一行、台账对账只报「登记了但文件不在」、
 * 素材清单的排序稳定（兜底那张脸不能每次换）。
 */

let play = "";

const write = async (rel: string, text: string): Promise<void> => {
  const file = join(play, rel);
  await mkdir(join(file, ".."), { recursive: true });
  await writeFile(file, text);
};

const PLAY_JSON = JSON.stringify({ id: "demo", title: "演示", characters: [], opening: "（开始）", initialScene: "s" });

beforeEach(async () => {
  play = await mkdtemp(join(tmpdir(), "aivn-readiness-"));
});

afterEach(async () => {
  await rm(play, { recursive: true, force: true });
});

describe("判据", () => {
  it("空空的工作目录：还不是一座剧目，但每一行都说得出缺什么", () => {
    const r = readPlayReadiness(play);
    expect(r.play).toBe(false);
    expect(r.problem).toBeUndefined();
    expect(r).toMatchObject({ premise: false, characters: 0, sprites: false, background: false, assets: 0 });
    expect(renderReadiness(r)).toContain("这还不是一座剧目");
  });

  it("play.json 坏掉：报哪一行、不抛异常", async () => {
    await write("play.json", "{ 这不是 JSON }");
    const r = readPlayReadiness(play);
    expect(r.play).toBe(false);
    expect(r.problem).toContain("play.json 读不出来");
    expect(renderReadiness(r)).toContain("✗ 读不出来");
  });

  it("前提、角色卡、立绘、背景各算各的", async () => {
    await write("play.json", PLAY_JSON);
    await write("memory/always/premise.md", "黄昏的走廊。\n");
    await write("characters/a.md", "---\nname: A\n---\n");
    await write("characters/b.md", "---\nname: B\n---\n");
    await write("assets/sprites/alice/neutral.png", "x");
    await write("assets/backgrounds/rooftop.jpg", "x");
    const r = readPlayReadiness(play);
    expect(r).toMatchObject({ play: true, premise: true, characters: 2, sprites: true, background: true });
    // 立绘只看图：空目录不算
    await rm(join(play, "assets/sprites/alice/neutral.png"));
    expect(readPlayReadiness(play).sprites).toBe(false);
  });

  it("写作参数里引擎不认的取值报出来（会被静默当没写）", async () => {
    await write("play.json", JSON.stringify({ id: "d", craft: { beatLength: "epic", assets: { cg: "off" } } }));
    const r = readPlayReadiness(play);
    expect(r.strayCraft).toHaveLength(1);
    expect(r.strayCraft[0]).toContain("craft.beatLength");
    expect(renderReadiness(r)).toContain("写作参数");
  });

  it("世界状态坏掉时报出来", async () => {
    await write("play.json", PLAY_JSON);
    await write("memory/always/state/state.json", JSON.stringify({ affinity: { alice: 120, bob: "高" } }));
    const r = readPlayReadiness(play);
    expect(r.stateProblem).toContain("好感度只认 0~100 的整数");
    expect(r.stateProblem).toContain("alice");
  });

  it("台账对账只报「登记了但文件不在」的条目", async () => {
    await write("play.json", PLAY_JSON);
    await write("assets/backgrounds/rooftop.jpg", "x");
    await write(
      "assets/generated.json",
      JSON.stringify({
        rooftop: { kind: "background", path: "assets/backgrounds/rooftop.jpg", prompt: "p", at: "t" },
        ghost: { kind: "cg", path: "assets/cg/ghost.png", prompt: "p", at: "t" },
      }),
    );
    const r = readPlayReadiness(play);
    expect(r.danglingAssets).toEqual(["ghost"]);
    expect(renderReadiness(r)).toContain("素材对账");
  });

  it("台账坏掉不算「文件不见」", async () => {
    await write("play.json", PLAY_JSON);
    await write("assets/generated.json", "{ 坏 }");
    expect(readPlayReadiness(play).danglingAssets).toEqual([]);
  });
});

describe("素材清单", () => {
  it("立绘按主体拆开、按名字排序，找不到差分时兜底的那张是稳定的", async () => {
    await write("assets/sprites/alice/z.png", "x");
    await write("assets/sprites/alice/a.png", "x");
    await write("assets/sprites/alice/notes.txt", "x");
    await write("assets/backgrounds/rooftop.jpg", "x");
    await write("assets/backgrounds/alley.png", "x");
    const index = listPlayAssets(play);
    expect(index["sprites/alice"]).toEqual(["a.png", "z.png"]);
    expect(index.backgrounds).toEqual(["alley.png", "rooftop.jpg"]);
    expect(index).not.toHaveProperty("cg");
  });
});
