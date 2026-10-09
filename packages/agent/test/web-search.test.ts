import { describe, expect, it } from "vitest";
import { CAPABILITIES, renderSearchResults, webSearch, type SearchDeps } from "../src/index.js";
import { assertCommonSubset } from "../src/index.js";

function stub(results: Awaited<ReturnType<SearchDeps["search"]>> | Error): { deps: SearchDeps; calls: [string, number][] } {
  const calls: [string, number][] = [];
  return {
    calls,
    deps: {
      async search(query, numResults) {
        calls.push([query, numResults]);
        if (results instanceof Error) throw results;
        return results;
      },
    },
  };
}

describe("web.search 能力", () => {
  it("没给条数就用默认 5；给超界的值当场夹住（宿主校验弱也不能溢出）", async () => {
    const a = stub([]);
    await webSearch.execute({ query: "x" }, a.deps);
    await webSearch.execute({ query: "x", numResults: 99 }, a.deps);
    await webSearch.execute({ query: "x", numResults: 0 }, a.deps);
    expect(a.calls).toEqual([["x", 5], ["x", 10], ["x", 1]]);
  });

  it("结果逐条渲染：序号 + 标题 + 链接 + 日期 + 正文；空正文有交代", async () => {
    const { deps } = stub([
      { title: "昭和喫茶店", url: "https://example.com/a", publishedDate: "2024-05-01T00:00:00Z", text: "正文甲" },
      { title: "无正文", url: "https://example.com/b", text: "  " },
    ]);
    expect(await webSearch.execute({ query: "喫茶店" }, deps)).toBe(
      "1. 昭和喫茶店\nhttps://example.com/a　2024-05-01\n正文甲\n\n" +
        "2. 无正文\nhttps://example.com/b\n（这条没有正文，只有标题与链接）",
    );
  });

  it("没有结果时把 query 复述回去，并给一条出路", () => {
    expect(renderSearchResults("喫茶店 内装", [])).toBe("「喫茶店 内装」没有结果。换个说法再试一次，或者放弃这条线。");
  });

  it("检索失败不抛出去，当一条正文回给模型（检索是配角，不炸整轮）", async () => {
    const { deps } = stub(new Error("exa 全部 key 失败: HTTP 429"));
    expect(await webSearch.execute({ query: "x" }, deps)).toBe("检索失败：exa 全部 key 失败: HTTP 429");
  });
});

describe("能力表", () => {
  it("每份能力的字段都落在两个宿主都表达得出的共同子集里", () => {
    for (const capability of CAPABILITIES) assertCommonSubset(capability.fields, capability.id);
  });

  it("每份能力都有文档正文（DESCRIPTION 的唯一真相源）", () => {
    for (const capability of CAPABILITIES) expect(capability.doc.trim().length).toBeGreaterThan(0);
  });
});
