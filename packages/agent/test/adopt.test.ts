import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  adoptDraft,
  draftDir,
  keepSpriteSource,
  newDraftId,
  persistAsset,
  writeDraft,
  type AssetIo,
  type AssetManifest,
  type AssetRef,
  type LedgerEntry,
} from "../src/index.js";

/**
 * 落位 / 留底 / 采用这条链：两个宿主共用同一套编排，差别只在 IO 与锁。
 * 这里用真临时目录 + 一个最朴素的 io 实现（与插件的实现同形）。
 */

let play = "";

const io = (dir: string): AssetIo => ({
  list: (kindPath) => readdir(join(dir, "assets", kindPath)).catch(() => []),
  write: async (rel, data) => {
    const { mkdir } = await import("node:fs/promises");
    await mkdir(join(dir, rel, ".."), { recursive: true });
    await writeFile(join(dir, rel), data);
  },
  remove: (rel) => rm(join(dir, rel), { force: true }),
});

const girl: AssetRef = {
  kind: "sprite",
  kindPath: "sprites/probe_girl",
  stem: "neutral",
  spriteId: "probe_girl",
  variant: "neutral",
  framing: "full",
};

beforeEach(async () => {
  play = await mkdtemp(join(tmpdir(), "aivn-adopt-"));
});

afterEach(async () => {
  await rm(play, { recursive: true, force: true });
});

describe("落位", () => {
  it("写新图并报出「此前有没有」，第一次是覆盖为假", async () => {
    const first = await persistAsset(io(play), girl, Buffer.from("A"), ".png");
    expect(first).toEqual({ rel: "assets/sprites/probe_girl/neutral.png", replaced: false });
    const again = await persistAsset(io(play), girl, Buffer.from("B"), ".png");
    expect(again.replaced).toBe(true);
    expect(await readFile(join(play, "assets/sprites/probe_girl/neutral.png"), "utf8")).toBe("B");
  });

  it("换扩展名时旧的同 stem 文件被清掉，别人的图不碰", async () => {
    const dir = join(play, "assets/backgrounds");
    await persistAsset(io(play), { kind: "background", kindPath: "backgrounds", stem: "rooftop" }, Buffer.from("J"), ".jpg");
    await writeFile(join(play, "assets/backgrounds/keep.jpg"), "其他素材").catch(async () => {
      const { mkdir } = await import("node:fs/promises");
      await mkdir(dir, { recursive: true });
      await writeFile(join(dir, "keep.jpg"), "其他素材");
    });
    const swapped = await persistAsset(
      io(play),
      { kind: "background", kindPath: "backgrounds", stem: "rooftop" },
      Buffer.from("P"),
      ".png",
    );
    expect(swapped.replaced).toBe(true);
    expect(existsSync(join(play, "assets/backgrounds/rooftop.jpg"))).toBe(false);
    expect(existsSync(join(play, "assets/backgrounds/rooftop.png"))).toBe(true);
    expect(existsSync(join(play, "assets/backgrounds/keep.jpg"))).toBe(true);
  });
});

describe("留底", () => {
  it("留底原片并按 stem 清旧扩展名，返回剧目内相对路径", async () => {
    const rel = await keepSpriteSource(play, girl, Buffer.from("RAW"), ".jpg");
    expect(rel).toBe("media-cache/sprite-sources/probe_girl/neutral.jpg");
    const next = await keepSpriteSource(play, girl, Buffer.from("RAW2"), ".png");
    expect(next).toBe("media-cache/sprite-sources/probe_girl/neutral.png");
    expect(await readdir(join(play, "media-cache/sprite-sources/probe_girl"))).toEqual(["neutral.png"]);
  });

  it("背景 / CG 没有原片这回事", async () => {
    expect(await keepSpriteSource(play, { kind: "cg", kindPath: "cg", stem: "kiss" }, Buffer.from("X"), ".png")).toBeNull();
  });
});

describe("采用", () => {
  it("草稿 → 素材：落位、补素材表、记台账（用草稿里的 prompt）、留底与留痕一次做完", async () => {
    const draftId = newDraftId();
    await writeDraft(
      play,
      {
        draftId,
        kind: "sprite",
        spriteId: "probe_girl",
        variant: "neutral",
        framing: "full",
        aspect: "3:4",
        prompt: "a silver-haired girl, full body",
        createdAt: "2026-10-09T00:00:00.000Z",
      },
      { image: Buffer.from("CUT"), imageExt: ".png", source: { data: Buffer.from("RAW"), ext: ".jpg" } },
    );

    let manifest: AssetManifest = {};
    const ledger: LedgerEntry[] = [];
    const adopted = await adoptDraft(
      {
        playDir: play,
        assets: io(play),
        updateManifest: async (mutate) => {
          manifest = mutate(manifest);
        },
        recordLedger: async (entry) => {
          ledger.push(entry);
        },
      },
      // 宿主通常从 draft.json 读回来再解析；这里直接用同一份意图。
      {
        draftId,
        kind: "sprite",
        spriteId: "probe_girl",
        variant: "neutral",
        framing: "full",
        aspect: "3:4",
        prompt: "a silver-haired girl, full body",
        imageExt: ".png",
        sourceExt: ".jpg",
        createdAt: "2026-10-09T00:00:00.000Z",
      },
      { ...girl, variant: "neutral" },
    );

    expect(adopted.rel).toBe("assets/sprites/probe_girl/neutral.png");
    expect(adopted.sourceRel).toBe("media-cache/sprite-sources/probe_girl/neutral.jpg");
    expect(manifest.probe_girl).toEqual({ framing: "full" });
    expect(ledger).toHaveLength(1);
    expect(ledger[0]).toMatchObject({
      id: "probe_girl/neutral",
      kind: "sprite",
      path: "assets/sprites/probe_girl/neutral.png",
      prompt: "a silver-haired girl, full body",
    });
    expect(await readFile(join(play, "media-cache/sprite-sources/probe_girl/neutral.jpg"), "utf8")).toBe("RAW");
    const record = JSON.parse(await readFile(join(draftDir(play, draftId), "draft.json"), "utf8")) as {
      committedAt?: string;
    };
    expect(record.committedAt).toBeTruthy();
  });
});
