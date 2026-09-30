import { describe, expect, it } from "vitest";
import { Exa } from "../src/exa.js";

/** 假 fetch：记录每次请求，按序吐响应（用完就停）。 */
function fakeFetch(
  responses: (() => Response | Promise<Response>)[],
): { fetchImpl: never; calls: { url: string; key: string; body: Record<string, unknown> }[] } {
  const calls: { url: string; key: string; body: Record<string, unknown> }[] = [];
  const fetchImpl = (async (url: string, init: { headers: Record<string, string>; body: string }) => {
    calls.push({ url, key: init.headers["x-api-key"] ?? "", body: JSON.parse(init.body) });
    const next = responses[calls.length - 1];
    if (!next) throw new Error("假 fetch 收到的请求比预期多");
    return next();
  }) as unknown as never;
  return { fetchImpl, calls };
}

const okBody = {
  results: [
    { title: "昭和喫茶店", url: "https://example.com/a", publishedDate: "2024-05-01T00:00:00Z", text: "正文甲" },
    { url: "https://example.com/b", text: "" },
    { title: "没有链接的条目", text: "应被丢掉" },
  ],
};

const opts = { keys: ["key-1", "key-2"], baseUrl: "https://api.exa.ai", timeoutMs: 1000 };

describe("Exa 检索客户端", () => {
  it("一次 /search 连正文一起取回；正文预算按条数摊分", async () => {
    const { fetchImpl, calls } = fakeFetch([() => new Response(JSON.stringify(okBody), { status: 200 })]);
    const results = await new Exa(opts, fetchImpl).search("昭和喫茶店 内装", 5);

    expect(calls[0]!.url).toBe("https://api.exa.ai/search");
    expect(calls[0]!.key).toBe("key-1");
    expect(calls[0]!.body).toMatchObject({ query: "昭和喫茶店 内装", numResults: 5 });
    // 15000 / 5 = 3000：检索不能把 A 区的预算挤掉
    expect(calls[0]!.body).toMatchObject({ contents: { text: { maxCharacters: 3000 } } });

    // 缺 url 的条目丢掉；缺 title 的回退成 url
    expect(results).toEqual([
      { title: "昭和喫茶店", url: "https://example.com/a", publishedDate: "2024-05-01T00:00:00Z", text: "正文甲" },
      { title: "https://example.com/b", url: "https://example.com/b", text: "" },
    ]);
  });

  it("条数少时单条正文上限抬高，但封顶 6000", async () => {
    const { fetchImpl, calls } = fakeFetch([() => new Response(JSON.stringify({ results: [] }), { status: 200 })]);
    await new Exa(opts, fetchImpl).search("x", 1);
    expect(calls[0]!.body).toMatchObject({ contents: { text: { maxCharacters: 6000 } } });
  });

  it("限流/鉴权失败换下一把 key，成功后从下一把起步", async () => {
    const { fetchImpl, calls } = fakeFetch([
      () => new Response("rate limited", { status: 429 }),
      () => new Response(JSON.stringify(okBody), { status: 200 }),
      () => new Response(JSON.stringify(okBody), { status: 200 }),
    ]);
    const exa = new Exa(opts, fetchImpl);
    expect((await exa.search("a", 5)).length).toBe(2);
    // 第二轮直接从 key-1 起步（成功后光标推到「生效那把」的下一把，两把 key 就是回环）
    await exa.search("b", 5);
    expect(calls.map((c) => c.key)).toEqual(["key-1", "key-2", "key-1"]);
  });

  it("网络错误（超时/连不上）同样轮换下一把 key", async () => {
    const { fetchImpl, calls } = fakeFetch([
      () => {
        throw new DOMException("The operation was aborted due to timeout", "TimeoutError");
      },
      () => new Response(JSON.stringify(okBody), { status: 200 }),
    ]);
    expect((await new Exa(opts, fetchImpl).search("x", 5)).length).toBe(2);
    expect(calls.map((c) => c.key)).toEqual(["key-1", "key-2"]);
  });

  it("持久错误（400）不轮换 key：换一把也一样失败，只白烧往返", async () => {
    const { fetchImpl, calls } = fakeFetch([() => new Response("bad query", { status: 400 })]);
    await expect(new Exa(opts, fetchImpl).search("x", 5)).rejects.toThrow(/HTTP 400: bad query/);
    expect(calls.length).toBe(1);
  });

  it("全部 key 失败时报出最后一条错，且不吞掉原因", async () => {
    const { fetchImpl, calls } = fakeFetch([
      () => new Response("nope", { status: 401 }),
      () => new Response("nope", { status: 429 }),
    ]);
    await expect(new Exa(opts, fetchImpl).search("x", 5)).rejects.toThrow(/全部 key 失败.*HTTP 429/);
    expect(calls.length).toBe(2);
  });
});
