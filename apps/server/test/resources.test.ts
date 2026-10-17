import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PlayStore } from "../src/store.js";
import {
  attachmentNote,
  inlineImages,
  readResource,
  resourceNameOf,
  safeResourceName,
  uniqueResourceName,
  withAttachmentNotes,
} from "../src/resources.js";
import type { WorkshopAttachment } from "@aivn/core";

/** PNG 头（够嗅探认出来就行）：附件是图片还是文件按**字节**定，不看扩展名。 */
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0, 0, 0, 0, 0]);

describe("附件：文件名消毒", () => {
  it("只留纯文件名一段，路径与 Windows 非法字符都去掉", () => {
    expect(safeResourceName("../../etc/passwd")).toBe("passwd");
    expect(safeResourceName("C:\\Users\\me\\原作.epub")).toBe("原作.epub");
    expect(safeResourceName("a:b*c?.txt")).toBe("abc.txt");
    expect(safeResourceName("  带空格 的名字.epub  ")).toBe("带空格 的名字.epub");
  });

  it("前导点去掉：隐藏文件与 .. 都从这儿挡", () => {
    expect(safeResourceName(".env")).toBe("env");
    expect(() => safeResourceName("..")).toThrow(/文件名不合法/);
    expect(() => safeResourceName("   ")).toThrow(/文件名不合法/);
    expect(() => safeResourceName("/")).toThrow(/文件名不合法/);
  });

  it("超长名截断但保住扩展名", () => {
    const long = `${"字".repeat(200)}.epub`;
    const safe = safeResourceName(long);
    expect(safe.length).toBeLessThanOrEqual(96);
    expect(safe.endsWith(".epub")).toBe(true);
  });

  it("重名不覆盖，加 -2 后缀", () => {
    const taken = new Set(["原作.epub", "原作-2.epub"]);
    expect(uniqueResourceName("原作.epub", (c) => taken.has(c))).toBe("原作-3.epub");
    expect(uniqueResourceName("新书.epub", (c) => taken.has(c))).toBe("新书.epub");
  });

  it("路径校验：只认 resources/<一段>", () => {
    expect(resourceNameOf("resources/原作.epub")).toBe("原作.epub");
    expect(() => resourceNameOf("assets/原作.epub")).toThrow(/不是资源路径/);
    expect(() => resourceNameOf("resources/a/b.txt")).toThrow(/不是资源路径/);
    expect(() => resourceNameOf("resources/../session.json")).toThrow(/不是资源路径/);
    expect(() => resourceNameOf("resources/.hidden")).toThrow(/不是资源路径/);
  });
});

describe("附件：按盘上那份现算", () => {
  let root: string;
  let store: PlayStore;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), "stage-resources-"));
    store = new PlayStore(root);
    await mkdir(join(root, "resources"), { recursive: true });
  });
  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it("尺寸与 url 来自盘上那份，kind 看字节头", async () => {
    await writeFile(join(root, "resources", "封面.png"), PNG);
    await writeFile(join(root, "resources", "原作.epub"), "PK\u0003\u0004 假装是 zip");

    const image = await readResource(store, "resources/封面.png", "p1");
    expect(image).toMatchObject({ name: "封面.png", size: PNG.length, kind: "image" });
    expect(image.url).toBe(`/plays/p1/resources/${encodeURIComponent("封面.png")}`);

    // 后缀是 .epub 的文本照样按内容定性
    const book = await readResource(store, "resources/原作.epub", "p1");
    expect(book.kind).toBe("file");
    expect(book.path).toBe("resources/原作.epub");
  });

  it("盘上没有就报错——客户端说的不算数", async () => {
    await expect(readResource(store, "resources/没有这个.epub", "p1")).rejects.toThrow(/不存在/);
    await expect(readResource(store, "session.json", "p1")).rejects.toThrow(/不是资源路径/);
  });

  it("图片附件内联成 image 块，非图片不内联", async () => {
    await writeFile(join(root, "resources", "封面.png"), PNG);
    await writeFile(join(root, "resources", "原作.epub"), "PK\u0003\u0004");
    const items = [
      await readResource(store, "resources/封面.png", "p1"),
      await readResource(store, "resources/原作.epub", "p1"),
    ];
    const images = await inlineImages(store, items);
    expect(images).toHaveLength(1);
    expect(images[0]).toMatchObject({ type: "image", mimeType: "image/png" });
    expect(images[0]!.data).toBe(PNG.toString("base64"));
  });
});

describe("附件：给模型看的那行注脚", () => {
  const view = (over: Partial<WorkshopAttachment> = {}): WorkshopAttachment => ({
    path: "resources/原作.epub",
    name: "原作.epub",
    size: 2 * 1024 * 1024,
    kind: "file",
    url: "/plays/p1/resources/%E5%8E%9F%E4%BD%9C.epub",
    ...over,
  });

  it("名字、大小、格式、路径都在", () => {
    expect(attachmentNote(view())).toBe("[附件] 原作.epub（2.0MB，epub）→ resources/原作.epub");
    expect(attachmentNote(view({ name: "封面.png", kind: "image", size: 900 }))).toBe(
      "[附件] 封面.png（900B，图片）→ resources/原作.epub",
    );
  });

  it("当前轮与历史回灌共用同一份拼装", () => {
    expect(withAttachmentNotes("把这本书改编一下", [view()])).toBe(
      "把这本书改编一下\n\n[附件] 原作.epub（2.0MB，epub）→ resources/原作.epub",
    );
    // 只发附件没写字：注脚就是这一轮的全部输入
    expect(withAttachmentNotes("", [view()])).toBe("[附件] 原作.epub（2.0MB，epub）→ resources/原作.epub");
    // 没有附件时一字不改（老线程照旧）
    expect(withAttachmentNotes("只有正文", undefined)).toBe("只有正文");
    expect(withAttachmentNotes("只有正文", [])).toBe("只有正文");
  });
});
