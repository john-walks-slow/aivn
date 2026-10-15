import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { unzipSync } from "fflate";
import { PlayLibrary } from "../src/store.js";
import { extractZipFromHtml } from "../src/exportReplay.js";

const PLAY_JSON = (id: string, title = "测试剧目"): string =>
  JSON.stringify({ id, title, characters: [], opening: "开始", initialScene: "s" });

describe("演后剧目导出单 HTML 与导入", () => {
  let root: string;
  let library: PlayLibrary;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), "aivn-export-"));
    library = new PlayLibrary(root);
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it("导出单 HTML 并能提取内置 Zip 还原剧目，同名自动派生 -continued", async () => {
    const playDir = join(root, "p-demo");
    await mkdir(join(playDir, "assets", "backgrounds"), { recursive: true });
    await mkdir(join(playDir, "media-cache", "tts"), { recursive: true });
    await writeFile(join(playDir, "play.json"), PLAY_JSON("p-demo", "Demo 标题"));
    await writeFile(join(playDir, "session.json"), JSON.stringify({ version: 1, lineage: { events: [] } }));
    await writeFile(join(playDir, "lineage.jsonl"), '{"id":"root"}\n');
    await writeFile(join(playDir, "assets", "backgrounds", "bg.jpg"), new Uint8Array([10, 20, 30]));
    await writeFile(join(playDir, "media-cache", "tts", "voice.mp3"), new Uint8Array([40, 50, 60]));

    // 导出单 HTML
    const mockAssets = { js: "console.log('player')", css: "body { margin: 0; }" };
    const html = await library.exportPlayedHtml("p-demo", mockAssets);
    expect(html).toContain("<!DOCTYPE html>");
    expect(html).toContain('<script id="aivn-data" type="text/plain">');
    expect(html).toContain("Demo 标题");
    expect(html).toContain("console.log('player')");

    // 测试提取
    const zipBytes = extractZipFromHtml(Buffer.from(html, "utf8"));
    expect(zipBytes).not.toBeNull();
    const files = unzipSync(zipBytes!);
    expect(files["play.json"]).toBeDefined();
    expect(files["session.json"]).toBeDefined();
    expect(files["assets/backgrounds/bg.jpg"]).toBeDefined();
    expect(files["media-cache/tts/voice.mp3"]).toBeDefined();

    // 导入 HTML 文件：因为本地已存在 p-demo，自动派生 p-demo-continued
    const importedId = await library.importZip(Buffer.from(html, "utf8"));
    expect(importedId).toBe("p-demo-continued");
    expect(existsSync(join(root, "p-demo-continued", "session.json"))).toBe(true);
    expect(existsSync(join(root, "p-demo-continued", "media-cache", "tts", "voice.mp3"))).toBe(true);

    const importedPlay = JSON.parse(await readFile(join(root, "p-demo-continued", "play.json"), "utf8"));
    expect(importedPlay.id).toBe("p-demo-continued");
    expect(importedPlay.title).toContain("(续演)");
  });
});
