import { describe, expect, it } from "vitest";
import { createVoiceTool } from "../src/agentkit/voiceTool.js";
import type { VoiceCatalogService } from "../src/voiceCatalog.js";
import { DEFAULT_CRAFT } from "@aivn/core";
import { buildWorkshopPrompt } from "../src/workshop.js";
import type { AgentCapabilities } from "../src/agentkit/kit.js";

/**
 * 音色检索工具。
 *
 * 存在的理由是一个静默故障：角色卡的 voiceId 没有任何校验，填错或留空时
 * `VoicePipeline` 那句 `if (!voiceId) return` 直接跳过合成——整幕台词没有声音，
 * 界面上也看不出来。工坊看不见那 1000 条音色就只会瞎填。
 */

function entries() {
  return {
    fetchedAt: 0,
    totalAvailable: 3,
    stale: false,
    entries: [
      {
        id: "aaa111",
        title: "苍老男声",
        description: "年长男性，声线沙哑，语速慢，适合旁白",
        languages: ["zh"],
        tags: ["male", "narration"],
        likes: 500,
        cover: "",
      },
      {
        id: "bbb222",
        title: "少女音",
        description: "年轻女性，活泼明亮",
        languages: ["ja", "en"],
        tags: ["female", "energetic"],
        likes: 900,
        cover: "",
      },
      {
        id: "ccc333",
        title: "沉稳男声",
        description: "中年男性，低沉克制",
        languages: ["zh"],
        tags: ["male"],
        likes: 800,
        cover: "",
      },
    ],
  };
}

/** 记录查询条件的假窗口服务：language/tags/title 按 Fish 的语义过滤，gender 留给工具本地筛。 */
function service(): VoiceCatalogService & { queries: unknown[] } {
  const queries: unknown[] = [];
  return {
    queries,
    list: async (query: { language?: string; tags?: string[]; title?: string }) => {
      queries.push(query);
      const all = entries().entries;
      return {
        ...entries(),
        entries: all.filter((e) => {
          if (query.language && !e.languages.includes(query.language)) return false;
          if (query.tags?.length && !query.tags.some((tag) => e.tags.includes(tag))) return false;
          if (query.title && !e.title.toLowerCase().includes(query.title.toLowerCase())) return false;
          return true;
        }),
      };
    },
  } as never;
}

async function run(params: Record<string, unknown>): Promise<string> {
  const [tool] = createVoiceTool(service());
  const result = await tool.execute("call-1", params as never);
  return result.content.map((c) => (c as { text: string }).text).join("\n");
}

describe("list_voices", () => {
  it("没配 TTS 就不注册——注册一个必然查不出东西的工具只会诱使模型空转", () => {
    expect(createVoiceTool(undefined)).toEqual([]);
    expect(createVoiceTool(service()).map((t) => t.name)).toEqual(["list_voices"]);
  });

  it("按热度排序，id 和名称都列出来", async () => {
    const out = await run({});
    expect(out).toContain("bbb222");
    expect(out).toContain("苍老男声");
    // 900 > 800 > 500
    expect(out.indexOf("bbb222")).toBeLessThan(out.indexOf("ccc333"));
    expect(out.indexOf("ccc333")).toBeLessThan(out.indexOf("aaa111"));
  });

  it("语言、标签并集、标题搜索都发给服务端窗口，gender 在窗口内本地筛", async () => {
    const fake = service();
    const [tool] = createVoiceTool(fake);
    const text = async (params: Record<string, unknown>): Promise<string> => {
      const result = await tool.execute("call", params as never);
      return result.content.map((c) => (c as { text: string }).text).join("\n");
    };

    expect(await text({ language: "ja" })).toContain("bbb222");
    expect(await text({ tags: ["narration", "energetic"] })).toContain("苍老男声");
    expect(await text({ query: "少女" })).toContain("bbb222");
    expect(await text({ query: "少女" })).not.toContain("苍老男声");

    expect(fake.queries).toEqual([
      { language: "ja", tags: undefined, title: undefined },
      { language: undefined, tags: ["narration", "energetic"], title: undefined },
      { language: undefined, tags: undefined, title: "少女" },
      { language: undefined, tags: undefined, title: "少女" },
    ]);

    // gender 是标签：Fish 没有独立参数，工具在抓回的窗口里本地筛
    expect(await text({ gender: "female" })).toContain("bbb222");
    expect(await text({ gender: "female" })).not.toContain("苍老男声");
  });

  it("筛不出来要说清怎么放宽，别只回一句「没找到」", async () => {
    const out = await run({ query: "机械音" });
    expect(out).toContain("机械音");
    expect(out).toContain("去掉");
  });

  it("描述先立语言这一维，并教二次元与找角色的路子", () => {
    const [tool] = createVoiceTool(service());
    // 后果不写，「♥1200 的二次元嗓子」永远赢过「能不能念这门语言」
    expect(tool.description).toContain("先按剧目的语音语言筛");
    expect(tool.description).toContain("口音");
    expect(tool.description).toContain('"anime","character-voice"');
    expect(tool.description).toContain("全库");
  });

  it("标签词表是实测的常用词，并明确要求照抄不要自己造", () => {
    const [tool] = createVoiceTool(service());
    // 词表是拿真实窗口统计出来的（2026-10-04：全局 1000 + 日语 1000）。
    // 曾经写的 cute 在两个窗口都是 0 条——模型造词的代价是那一轮查询空转。
    expect(tool.description).toContain("别自己造词");
    for (const tag of ["narration", "storytelling", "middle-aged", "bright", "measured", "animated"]) {
      expect(tool.description).toContain(tag);
    }
    expect(tool.description).toContain("语言别当 tag");
  });
});

/** 工坊的常见态；这一组用例只翻 voice 那一位。 */
const caps = (over: Record<string, boolean> = {}): AgentCapabilities => ({
  stage: false,
  nsfw: false,
  characters: false,
  memory: false,
  image: true,
  search: true,
  library: true,
  voice: true,
  shell: false,
  files: true,
  lineage: true,
  skill: true,
  view: true,
  readiness: true,
  ...over,
});

describe("工坊提示词：音色知识不在这里重复", () => {
  const base = {
    title: "T",
    files: "x",
    readiness: { ready: true, missing: [] } as never,
    craft: DEFAULT_CRAFT,
  };

  it("配了 TTS 才教它去查音色库", async () => {
    const on = await buildWorkshopPrompt({ ...base, can: caps({ voice: true }) });
    expect(on).toContain("list_voices");
    expect(on).toContain("32 位 hex");

    const off = await buildWorkshopPrompt({ ...base, can: caps({ voice: false }) });
    expect(off).not.toContain("list_voices");
  });

  it("挑音色的语言跟着剧目的语音语言走，不是跟着系统语言", async () => {
    const capsOn = caps({ voice: true });
    const ja = await buildWorkshopPrompt({ ...base, can: capsOn, voiceLanguage: "ja" });
    expect(ja).toContain('language="ja"');
    expect(ja).toContain("台词先译成它再配音");

    // 未设 = 台词按剧本原文配音，按剧本的书写语言筛（中文剧本 → zh）
    const unset = await buildWorkshopPrompt({ ...base, can: capsOn });
    expect(unset).toContain('language="zh"');
    expect(unset).toContain("未设");
  });
});
