import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  applyEditsToNormalizedContent,
  detectLineEnding,
  normalizeToLF,
  restoreLineEndings,
  stripBom,
} from "../src/agentkit/editText.js";
import { createAgentKit, defaultToolsFor } from "../src/agentkit/kit.js";
import type { WorkshopKitDeps } from "../src/agentkit/deps.js";
import { PlayFiles } from "../src/playFiles.js";

/**
 * 定点编辑的契约：**匹配语义照 pi 原生那套（精确 → 模糊、唯一性、重叠、BOM/行尾保留），
 * 差别只有路径范围**。工具层的断言都落在真实临时目录上——白名单与落盘是这层的事。
 */

describe("定点替换的匹配语义", () => {
  it("精确命中：未触碰的行按原字节保留（含行尾空白）", () => {
    const { newContent } = applyEditsToNormalizedContent("A   \nB\nC\n", [{ oldText: "B", newText: "B2" }], "f.md");
    expect(newContent).toBe("A   \nB2\nC\n");
  });

  it("模糊命中：引号/行尾空白不一致也能改，且只重写被触碰的行", () => {
    const original = 'A   \nB "x"  \nC\n';
    const { newContent } = applyEditsToNormalizedContent(
      normalizeToLF(original),
      [{ oldText: 'B “x”', newText: 'B "y"' }],
      "f.md",
    );
    expect(newContent).toBe('A   \nB "y"\nC\n');
  });

  it("多段替换都对同一份原文匹配，按位置从后往前应用", () => {
    const { newContent } = applyEditsToNormalizedContent(
      "1\n2\n3\n",
      [
        { oldText: "1", newText: "一" },
        { oldText: "3", newText: "三" },
      ],
      "f.md",
    );
    expect(newContent).toBe("一\n2\n三\n");
  });

  it("命中不唯一就拒绝（宁可不改，也不猜改哪一处）", () => {
    expect(() => applyEditsToNormalizedContent("x\nx\n", [{ oldText: "x", newText: "y" }], "f.md")).toThrow(/必须唯一/);
  });

  it("重叠的两段拒绝", () => {
    expect(() =>
      applyEditsToNormalizedContent("abcdef\n", [
        { oldText: "abcd", newText: "1" },
        { oldText: "cdef", newText: "2" },
      ], "f.md"),
    ).toThrow(/重叠/);
  });

  it("oldText 为空、原文找不到、替换后没变化——三种都拒绝并说清原因", () => {
    expect(() => applyEditsToNormalizedContent("abc\n", [{ oldText: "", newText: "x" }], "f.md")).toThrow(/不能为空/);
    expect(() => applyEditsToNormalizedContent("abc\n", [{ oldText: "zzz", newText: "x" }], "f.md")).toThrow(/找不到/);
    expect(() => applyEditsToNormalizedContent("abc\n", [{ oldText: "abc", newText: "abc" }], "f.md")).toThrow(/没有改动/);
  });

  it("行尾与 BOM 的读写是一对可逆操作", () => {
    expect(detectLineEnding("a\r\nb\r\n")).toBe("\r\n");
    expect(restoreLineEndings(normalizeToLF("a\r\nb\r\n"), "\r\n")).toBe("a\r\nb\r\n");
    expect(stripBom("\uFEFFa\n")).toEqual({ bom: "\uFEFF", text: "a\n" });
    expect(stripBom("a\n")).toEqual({ bom: "", text: "a\n" });
  });
});

async function tempPlay(file: string, content: string): Promise<{ dir: string; writes: { before: string | null; after: string }[] }> {
  const dir = await mkdtemp(join(tmpdir(), "stage-edit-"));
  await mkdir(dirname(join(dir, file)), { recursive: true });
  await writeFile(join(dir, file), content, "utf8");
  return { dir, writes: [] };
}

function editTool(dir: string, writes: { before: string | null; after: string }[]) {
  const deps = {
    role: "workshop",
    playId: "t",
    enabled: new Set(defaultToolsFor("workshop")),
    files: new PlayFiles({ dir } as never),
    store: {} as never,
    onWrite: (w: { before: string | null; after: string }) => writes.push(w),
    onAsset: () => {},
    saves: {} as never,
    saveStore: () => ({}) as never,
  } as unknown as WorkshopKitDeps;
  return createAgentKit(deps).tools.find((t) => t.name === "edit_file")!;
}

describe("edit_file 工具（工坊）", () => {
  it("改一小段后落盘，并把 before/after 交给撤销条", async () => {
    const { dir, writes } = await tempPlay("memory/always/craft.md", "# 画风\n柔和的夏日色调。\n");
    const tool = editTool(dir, writes);
    const result = await tool.execute("c1", {
      path: "memory/always/craft.md",
      edits: [{ oldText: "柔和的夏日色调。", newText: "柔和的夏日色调，线稿偏细。" }],
    });
    expect(result.content[0].text).toContain("已替换 1 处");
    expect(await readFile(join(dir, "memory/always/craft.md"), "utf8")).toBe("# 画风\n柔和的夏日色调，线稿偏细。\n");
    expect(writes).toEqual([{ path: "memory/always/craft.md", before: "# 画风\n柔和的夏日色调。\n", after: "# 画风\n柔和的夏日色调，线稿偏细。\n" }]);
  });

  it("行尾与 BOM 原样保留（模型看不见它们，工具不能顺手改掉）", async () => {
    const { dir, writes } = await tempPlay("memory/always/craft.md", "\uFEFFa\r\nb\r\n");
    const tool = editTool(dir, writes);
    await tool.execute("c1", { path: "memory/always/craft.md", edits: [{ oldText: "b", newText: "B" }] });
    expect(await readFile(join(dir, "memory/always/craft.md"), "utf8")).toBe("\uFEFFa\r\nB\r\n");
  });

  it("白名单外与不存在的文件都拒绝，不落盘", async () => {
    const { dir, writes } = await tempPlay("memory/always/craft.md", "x\n");
    const tool = editTool(dir, writes);
    const outside = await tool.execute("c1", { path: "session.json", edits: [{ oldText: "x", newText: "y" }] });
    expect(outside.content[0].text).toContain("编辑失败");
    const missing = await tool.execute("c1", { path: "memory/always/none.md", edits: [{ oldText: "x", newText: "y" }] });
    expect(missing.content[0].text).toContain("文件不存在");
    expect(writes).toEqual([]);
  });

  it("play.json 改坏结构就不落盘（和 write_file 同一道校验）", async () => {
    const config = JSON.stringify({ id: "t", title: "T", characters: [] }, null, 2);
    const { dir, writes } = await tempPlay("play.json", config);
    const tool = editTool(dir, writes);
    const broken = await tool.execute("c1", {
      path: "play.json",
      edits: [{ oldText: '"characters": []', newText: '"characters": [' }],
    });
    expect(broken.content[0].text).toContain("play.json 校验失败");
    expect(await readFile(join(dir, "play.json"), "utf8")).toBe(config);

    const ok = await tool.execute("c1", { path: "play.json", edits: [{ oldText: '"title": "T"', newText: '"title": "T2"' }] });
    expect(ok.content[0].text).toContain("已替换 1 处");
    expect(JSON.parse(await readFile(join(dir, "play.json"), "utf8")).title).toBe("T2");
  });

  it("兼容模型把 edits 写成 JSON 字符串 / 单个对象 / 顶层 oldText+newText", () => {
    const { dir, writes } = { dir: "/tmp", writes: [] };
    const prepare = editTool(dir, writes).prepareArguments!;
    const edits = [{ oldText: "a", newText: "b" }];
    expect(prepare({ path: "p", edits: JSON.stringify(edits) })).toEqual({ path: "p", edits });
    expect(prepare({ path: "p", edits: edits[0] })).toEqual({ path: "p", edits });
    expect(prepare({ path: "p", oldText: "a", newText: "b" })).toEqual({ path: "p", edits });
  });
});
