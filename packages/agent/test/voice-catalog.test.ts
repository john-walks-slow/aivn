import { describe, expect, it } from "vitest";
import {
  fetchVoiceWindow,
  firstVoiceSample,
  readVoiceSample,
  toVoiceEntry,
  VoiceClient,
  voiceQueryKey,
  voiceQuerySuffix,
  VOICE_MAX_PAGES,
  VOICE_PAGE_SIZE,
  type VoiceJsonFetcher,
} from "../src/index.js";

/**
 * 音色窗口：条件必须发给上游（全局热门窗口里几乎没有中文音色），解析必须挡住未训练的音色。
 * 这里用一个假 fetchJson 记录请求过的路径，把分页与缓存策略钉住。
 */

const HEX = "0123456789abcdef";
const id = (n: number): string => (n.toString(16) + HEX.repeat(4)).slice(0, 32);

const raw = (n: number, extra: Record<string, unknown> = {}) => ({
  _id: id(n),
  state: "trained",
  title: `voice-${n}`,
  like_count: n,
  languages: ["ja"],
  tags: ["anime"],
  ...extra,
});

function fakeFetch(pages: Record<string, unknown>): { paths: string[]; fetchJson: VoiceJsonFetcher } {
  const paths: string[] = [];
  const fetchJson = (async (path: string) => {
    paths.push(path);
    return pages[path] ?? { total: 0, items: [] };
  }) as VoiceJsonFetcher;
  return { paths, fetchJson };
}

describe("解析上游条目", () => {
  it("未训练完的、id 不是 32 位 hex 的一律不要", () => {
    expect(toVoiceEntry(raw(1))).toMatchObject({ title: "voice-1", likes: 1 });
    expect(toVoiceEntry(raw(1, { state: "training" }))).toBeNull();
    expect(toVoiceEntry({ _id: "not-a-reference-id", state: "trained" })).toBeNull();
  });

  it("没有标题就用 id 前缀兜底，封面照原样带上", () => {
    const entry = toVoiceEntry({ _id: id(2), state: "trained", cover_image: "coverimage/x" });
    expect(entry?.title).toBe(id(2).slice(0, 8));
    expect(entry?.cover).toBe("coverimage/x");
  });

  it("示例样本：官方示例文本优先，其次作者录样本时写的那句", () => {
    expect(firstVoiceSample({ samples: [{ audio: "u", text: "t" }] })).toEqual({ audio: "u", text: "t" });
    expect(firstVoiceSample({ samples: [] })).toBeUndefined();
    expect(readVoiceSample({ samples: [{ audio: "u", text: "t" }], languages: ["ja"] })).toEqual({
      audio: "u",
      text: "t",
      languages: ["ja"],
    });
    expect(readVoiceSample({ default_text: "官方", samples: [{ audio: "u", text: "作者" }] }).text).toBe("官方");
    expect(readVoiceSample({}).audio).toBe("");
  });
});

describe("查询条件", () => {
  it("语言转小写、标签排序去重，拼进上游参数", () => {
    const query = { language: " JA ", tags: ["anime", " female ", "anime"], title: "Rem" };
    expect(voiceQueryKey(query)).toBe("language=ja&tag=anime&tag=female&title=rem");
    expect(voiceQuerySuffix(query)).toBe("&language=ja&tag=anime&tag=female&title=rem");
  });

  it("无条件就是基础目录，后缀为空", () => {
    expect(voiceQuerySuffix({})).toBe("");
    expect(voiceQueryKey({})).toBe("");
  });
});

describe("窗口抓取", () => {
  it("无条件窗口并发打满 10 页，按 id 去重、按热度排序", async () => {
    const pages: Record<string, unknown> = {};
    for (let n = 1; n <= VOICE_MAX_PAGES; n += 1) {
      pages[`/model?page_size=${VOICE_PAGE_SIZE}&page_number=${n}&self=false&sort_by=score`] = {
        total: 300,
        items: n === 1 ? [raw(5), raw(9), raw(9, { title: "dup" })] : [raw(n)],
      };
    }
    const { paths, fetchJson } = fakeFetch(pages);
    const window = await fetchVoiceWindow(fetchJson, "", false);
    expect(paths).toHaveLength(VOICE_MAX_PAGES);
    expect(window.total).toBe(300);
    expect(window.entries.map((entry) => entry.likes)).toEqual([...window.entries.map((e) => e.likes)].sort((a, b) => b - a));
    expect(new Set(window.entries.map((entry) => entry.id)).size).toBe(window.entries.length);
  });

  it("标题搜索先探一页：不满页就不补剩下的", async () => {
    const { paths, fetchJson } = fakeFetch({
      [`/model?page_size=${VOICE_PAGE_SIZE}&page_number=1&self=false&sort_by=score&title=rem`]: {
        total: 3,
        items: [raw(1), raw(2)],
      },
    });
    const window = await fetchVoiceWindow(fetchJson, "&title=rem", true);
    expect(paths).toHaveLength(1);
    expect(window.total).toBe(3);
    expect(window.entries).toHaveLength(2);
  });
});

describe("窗口缓存", () => {
  it("同一条件第二次不再打上游；显式刷新才重打", async () => {
    const { paths, fetchJson } = fakeFetch({
      [`/model?page_size=${VOICE_PAGE_SIZE}&page_number=1&self=false&sort_by=score&language=ja`]: {
        total: 1,
        items: [raw(1)],
      },
    });
    const client = new VoiceClient(fetchJson);
    await client.list({ language: "ja" });
    const afterFirst = paths.length;
    await client.list({ language: "JA " });
    expect(paths).toHaveLength(afterFirst);
    await client.list({ language: "ja" }, true);
    expect(paths.length).toBeGreaterThan(afterFirst);
  });

  it("同窗并发只打一轮上游", async () => {
    const { paths, fetchJson } = fakeFetch({
      [`/model?page_size=${VOICE_PAGE_SIZE}&page_number=1&self=false&sort_by=score&tag=anime`]: {
        total: 1,
        items: [raw(1)],
      },
    });
    const client = new VoiceClient(fetchJson);
    await Promise.all([client.list({ tags: ["anime"] }), client.list({ tags: ["anime"] })]);
    // 无条件窗口一轮就并发打满 10 页：两次调用共享同一轮，不是 20 页
    expect(paths).toHaveLength(VOICE_MAX_PAGES);
  });
});
