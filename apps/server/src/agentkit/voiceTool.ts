import type { AgentTool } from "@earendil-works/pi-agent-core";
import { type Static, Type } from "@earendil-works/pi-ai";
import type { VoiceCatalogService } from "../voiceCatalog.js";
import { textResult } from "./result.js";

/**
 * 音色库检索（只读）：从 Fish Audio 公共音色库里按描述挑一个给角色配 voiceId。
 *
 * 为什么要有这个工具：角色卡的规范写着「voiceId 从预置音色库挑」，但 1000 条音色
 * 模型看不见也猜不出——id 是 32 位 hex。填错不报错，演出时 `VoicePipeline` 那句
 * `if (!voiceId) return` 直接跳过合成，整幕静默哑掉，界面上看不出来。
 *
 * 与 list_library 的分工：那边搜的是「这台剧目现在有什么素材」，这边搜的是「有什么嗓子」。
 * 音色是全局的，不随剧目分发，所以不进素材资源库。
 *
 * 没有配 TTS 时不注册——注册一个必然查不出东西的工具只会诱使模型空转。
 */

/** 一行能塞进上下文的描述长度上限：Fish 的 description 社区作者随手写，有几百字的。 */
const DESC_MAX = 90;
/** 单次最多列多少条。1000 条全列出去能把一整轮预算烧光。 */
const LIST_LIMIT = 25;

const listVoicesParams = Type.Object(
  {
    /** 关键词：匹配 id / 名称 / 描述 / 标签。1000 条里靠翻是翻不完的。 */
    query: Type.Optional(Type.String({ maxLength: 100 })),
    /** 语言（ISO 639-1，如 ja / en / zh）。多语言音色在每个语言下都出现。 */
    language: Type.Optional(Type.String({ maxLength: 8 })),
    /** 性别标签：传 male / female 可用于快速收窄。 */
    gender: Type.Optional(Type.Union([Type.Literal("male"), Type.Literal("female")])),
    /** 风格标签，如 narration / energetic / cute。 */
    tag: Type.Optional(Type.String({ maxLength: 40 })),
  },
  { additionalProperties: false },
);

export function createVoiceTool(voices?: VoiceCatalogService): AgentTool<any>[] {
  if (!voices) return [];

  const listVoices: AgentTool<typeof listVoicesParams> = {
    name: "list_voices",
    label: "查音色库",
    description:
      "从公共音色库里挑一个给角色配 voiceId（Fish Audio 公共库，免费档可达前 1000 条，已全量落盘在本机）。\n" +
      "**建角色卡时必须先查这里**：voiceId 是 32 位 hex，猜不出来；填错不报错，演出时那句台词会静默没有声音。\n" +
      "按 `query`（匹配 id / 名称 / 描述 / 标签）、`language`（ja / en / zh…）、`gender`（male / female）、" +
      "`tag`（narration / energetic / cute…）筛。筛选后从返回结果里挑一条，把它的 id 写进角色卡的 `voiceId`。\n" +
      "每行是：id | 名称 | 语言 | 标签 | 收藏数 | 描述。收藏数是热度，同条件下优先挑高的。\n" +
      "**按角色人设挑**，不是按名字挑：description 写的是这个嗓子听起来什么样（年龄感、语气、语速），" +
      "挑和 persona 说得通的那条。",
    parameters: listVoicesParams,
    execute: async (_id, params: Static<typeof listVoicesParams>) => {
      const catalog = await voices.get();
      const query = (params.query ?? "").trim().toLowerCase();
      const gender = params.gender?.toLowerCase();
      const tag = params.tag?.trim().toLowerCase();
      const language = params.language?.trim().toLowerCase();

      const matched = catalog.entries
        .filter((e) => {
          if (language && !e.languages.some((l) => l.toLowerCase() === language)) return false;
          if (gender && !e.tags.some((t) => t.toLowerCase() === gender)) return false;
          if (tag && !e.tags.some((t) => t.toLowerCase() === tag)) return false;
          if (!query) return true;
          return (
            e.id.toLowerCase().includes(query) ||
            e.title.toLowerCase().includes(query) ||
            e.description.toLowerCase().includes(query) ||
            e.tags.some((t) => t.toLowerCase().includes(query))
          );
        })
        // 热度是 Fish 自己给的可信度信号：同条件下没有理由优先选冷门的
        .sort((a, b) => b.likes - a.likes);

      if (matched.length === 0) {
        // 回显筛的条件：只说「没找到」的话模型不知道该换哪个词
        const used = [
          query ? `关键词=${params.query}` : "",
          params.language ? `语言=${params.language}` : "",
          params.gender ? `性别=${params.gender}` : "",
          params.tag ? `标签=${params.tag}` : "",
        ].filter(Boolean);
        return textResult(
          `没有匹配${used.length ? `（${used.join("，")}）` : ""}的音色（全库 ${catalog.entries.length} 条，换个词或去掉过滤再试；` +
            `标签只有 Fish 那边作者自己打的，猜不到就只按 query 搜描述）。`,
        );
      }

      const shown = matched.slice(0, LIST_LIMIT);
      const lines = shown.map((e) => {
        const desc = e.description.replace(/\s+/g, " ").trim();
        const brief = desc.length > DESC_MAX ? `${desc.slice(0, DESC_MAX)}…` : desc;
        return `${e.id} | ${e.title} | ${e.languages.join(",")} | ${e.tags.join(",") || "-"} | ♥${e.likes} | ${brief}`;
      });
      if (matched.length > shown.length) {
        lines.push(`（共 ${matched.length} 条，这里只列了热度前 ${shown.length} 条；用 query 收窄后再看）`);
      }
      if (catalog.stale) lines.push("（注意：这份目录是磁盘快照，Fish 那边暂时拉不到，可能是旧的）");
      return textResult(lines.join("\n"));
    },
  };

  return [listVoices];
}
