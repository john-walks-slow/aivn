import { mkdtemp, readFile, stat, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { DRAFT_TTL_MS, draftDir, loadDraft, markCommitted, newDraftId, pruneDrafts, writeDraft } from "../src/index.js";

/**
 * 草稿区：出图与采用之间的落脚点。两个宿主落在同一个位置、写同一份 `draft.json`，
 * 所以这里的形状与清理策略是共同契约。
 */

let play = "";

beforeEach(async () => {
  play = await mkdtemp(join(tmpdir(), "aivn-draft-"));
});

afterEach(async () => {
  const { rm } = await import("node:fs/promises");
  await rm(play, { recursive: true, force: true });
});

const plan = (draftId: string) => ({
  draftId,
  kind: "sprite" as const,
  spriteId: "probe_girl",
  variant: "smile",
  aspect: "3:4" as const,
  prompt: "a gentle smile",
  createdAt: "2026-10-09T00:00:00.000Z",
});

describe("草稿区", () => {
  it("落一张草稿：成图、留底原片与 draft.json 都在，回执带相对与绝对路径", async () => {
    const draftId = newDraftId();
    const drafted = await writeDraft(
      play,
      plan(draftId),
      { image: Buffer.from("CUT"), imageExt: ".png", source: { data: Buffer.from("RAW"), ext: ".jpg" } },
      { coverage: 0.42, figureHeight: 0.9 },
    );
    expect(drafted.path).toBe(`media-cache/drafts/${draftId}/image.png`);
    expect(drafted.absPath).toBe(join(draftDir(play, draftId), "image.png"));
    expect(drafted.cutout).toEqual({ coverage: 0.42, figureHeight: 0.9 });

    expect(await readFile(join(draftDir(play, draftId), "image.png"), "utf8")).toBe("CUT");
    expect(await readFile(join(draftDir(play, draftId), "source.jpg"), "utf8")).toBe("RAW");

    const record = await loadDraft(play, draftId);
    expect(record.imageExt).toBe(".png");
    expect(record.sourceExt).toBe(".jpg");
    expect(record.prompt).toBe("a gentle smile");
  });

  it("通用出图没有剧目目标，kind 就不落盘", async () => {
    const draftId = newDraftId();
    const drafted = await writeDraft(
      play,
      { draftId, aspect: "1:1", prompt: "a cat", createdAt: "2026-10-09T00:00:00.000Z" },
      { image: Buffer.from("CAT"), imageExt: ".jpg" },
    );
    expect(drafted.kind).toBeUndefined();
    expect(await loadDraft(play, draftId)).not.toHaveProperty("kind");
  });

  it("读不到草稿时说清楚它会过期，非法 id 当场拒", async () => {
    await expect(loadDraft(play, "nope")).rejects.toThrow(/已被清理/);
    await expect(loadDraft(play, "../etc")).rejects.toThrow(/非法/);
  });

  it("采用留痕只加 committedAt，原记录其余字段不动", async () => {
    const draftId = newDraftId();
    await writeDraft(play, plan(draftId), { image: Buffer.from("CUT"), imageExt: ".png" });
    const record = await loadDraft(play, draftId);
    await markCommitted(play, draftId, record);
    const after = await loadDraft(play, draftId);
    expect(after.committedAt).toBeTruthy();
    expect(after.prompt).toBe(record.prompt);
  });

  it("过期的整份目录被清掉，没过期的留着", async () => {
    const fresh = newDraftId();
    const stale = newDraftId();
    await writeDraft(play, plan(fresh), { image: Buffer.from("A"), imageExt: ".png" });
    await writeDraft(play, plan(stale), { image: Buffer.from("B"), imageExt: ".png" });
    const past = new Date(Date.now() - DRAFT_TTL_MS - 60_000);
    await utimes(draftDir(play, stale), past, past);

    await pruneDrafts(play);
    await expect(stat(draftDir(play, fresh))).resolves.toBeTruthy();
    await expect(stat(draftDir(play, stale))).rejects.toThrow();
  });

  it("草稿寿命由共享契约推出来，不手写天数", async () => {
    const { ASSET_DRAFT_RETENTION_DAYS } = await import("@aivn/core");
    expect(DRAFT_TTL_MS).toBe(ASSET_DRAFT_RETENTION_DAYS * 24 * 60 * 60 * 1000);
  });

  it("草稿区不存在时清理是空操作", async () => {
    await writeFile(join(play, "play.json"), "{}");
    await expect(pruneDrafts(play)).resolves.toBeUndefined();
  });
});
