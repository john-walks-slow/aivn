import { describe, expect, it } from "vitest";
import type { VoiceEntry } from "@aivn/core";
import { renderVoiceRow, voiceList, VOICES_PER_PAGE } from "../src/capabilities/voice/list.js";

function entry(id: string, over: Partial<VoiceEntry> = {}): VoiceEntry {
  return {
    id,
    title: id,
    languages: ["ja"],
    tags: ["anime"],
    likes: 1,
    description: `${id} 的说明`,
    ...over,
  } as VoiceEntry;
}

/** 假窗口：能力只认「给我一个条件窗口」，抓取与缓存不在这一层。 */
function deps(entries: VoiceEntry[], over: { total?: number; stale?: boolean } = {}) {
  const queries: unknown[] = [];
  return {
    queries,
    list: async (query: unknown) => {
      queries.push(query);
      return { entries, total: over.total ?? entries.length, stale: over.stale };
    },
  };
}

describe("voice.list", () => {
  it("条件全透传给窗口，gender 在本地按标签筛、结果按热度降序", async () => {
    const fake = deps([
      entry("aaa", { likes: 1, tags: ["anime", "male"] }),
      entry("bbb", { likes: 900, tags: ["anime", "female"] }),
      entry("ccc", { likes: 50, tags: ["anime"] }),
    ]);
    const out = await voiceList.execute({ query: "少女", language: "ja", gender: "female", tags: ["anime"] }, fake);
    expect(fake.queries).toEqual([{ language: "ja", tags: ["anime"], title: "少女" }]);
    expect(out).toContain("bbb");
    expect(out).not.toContain("aaa");
    expect(out).toContain("共 1 条匹配");
  });

  it("没筛出来要回显条件并说清怎么放宽（只说「没找到」模型不知道换哪个词）", async () => {
    const out = await voiceList.execute({ query: "机械音", tags: ["anime"] }, deps([]));
    expect(out).toContain("关键词=机械音");
    expect(out).toContain("标签=anime");
    expect(out).toContain("去掉 tags 与 gender");
  });

  it("分页：一页 25 条，末尾给下一页页码；翻过头说清只有几页", async () => {
    const many = Array.from({ length: VOICES_PER_PAGE + 3 }, (_, i) => entry(`v${String(i).padStart(3, "0")}`, { likes: i }));
    const first = await voiceList.execute({}, deps(many));
    expect(first).toContain("第 1/2 页");
    expect(first).toContain("下一页 page=2");
    expect(first.split("\n").at(-1)).toContain("省预算");

    const second = await voiceList.execute({ page: 2 }, deps(many));
    expect(second).toContain("第 2/2 页");
    expect(second).toContain("已是本窗口最后一页");

    const third = await voiceList.execute({ page: 9 }, deps(many));
    expect(third).toContain("第 9 页没有内容");
  });

  it("快照旧了就照实说：目录是磁盘快照，可能是旧的", async () => {
    const out = await voiceList.execute({}, deps([entry("aaa")], { stale: true }));
    expect(out).toContain("磁盘快照");
  });

  it("一行音色：id | 名称 | 语言 | 标签 | 收藏数 | 描述（长描述截断、没有的用 - 占位）", () => {
    expect(renderVoiceRow(entry("aaa", { languages: [], tags: [], likes: 12, description: " 多   空白 " }))).toBe(
      "aaa | aaa | - | - | ♥12 | 多 空白",
    );
    const long = renderVoiceRow(entry("bbb", { description: "x".repeat(200) }));
    expect(long.endsWith("…")).toBe(true);
    expect(long.length).toBeLessThan(200);
  });
});
