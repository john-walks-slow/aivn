import type { AgentTool } from "@earendil-works/pi-agent-core";
import { type Static, Type } from "@earendil-works/pi-ai";
import type { VoiceCatalogService } from "../voiceCatalog.js";
import { textResult } from "./result.js";

/**
 * 音色库检索（只读）：从 Fish Audio 公共音色库里按条件挑一个给角色配 voiceId。
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
/** 单次最多列多少条。窗口最多 1000 条，全列出去能把一整轮预算烧光。 */
const LIST_LIMIT = 25;

const listVoicesParams = Type.Object(
  {
    /** 全库标题搜索（子串、不分大小写）：找特定角色（雷姆 / Frieren）直达，热门榜单外的也能搜到。 */
    query: Type.Optional(Type.String({ maxLength: 60 })),
    /** 语言（ISO 639-1 小写两位码，如 ja / en / zh）。多语言音色在每个语言窗口都出现。 */
    language: Type.Optional(Type.String({ maxLength: 8 })),
    /** 性别标签：male / female。Fish 没有独立的性别参数，在抓回的窗口里本地筛。 */
    gender: Type.Optional(Type.Union([Type.Literal("male"), Type.Literal("female")])),
    /** Fish 标签，原样小写（anime / character-voice / cute / narration…），≤4 个、之间取并集。 */
    tags: Type.Optional(Type.Array(Type.String({ maxLength: 40 }), { minItems: 1, maxItems: 4 })),
  },
  { additionalProperties: false },
);

export function createVoiceTool(voices?: VoiceCatalogService): AgentTool<any>[] {
  if (!voices) return [];

  const listVoices: AgentTool<typeof listVoicesParams> = {
    name: "list_voices",
    label: "查音色库",
    description:
      "从公共音色库里挑一个给角色配 voiceId（Fish Audio 公共库）。\n" +
      "**建角色卡时必须先查这里**：voiceId 是 32 位 hex，猜不出来；填错不报错，演出时那句台词会静默没有声音。\n" +
      "每个查询组合各有一个 1000 条窗口，按需抓取（首次几秒，之后走本机缓存）：\n" +
      "- `language`（ja / en / zh，小写）：**先按剧目的语音语言筛**——台词会译成那个语言再送 TTS" +
      "（未设语音语言时就是剧本原文），选一个不支持它的嗓子，整段台词会带着那个音色的口音念出来。\n" +
      "- `tags`（并集；Fish 作者自己打的，**大小写敏感、猜错就是 0 条**）：二次元/角色向用 " +
      "`[\"anime\",\"character-voice\"]`。**照抄下面这批，别自己造词**——" +
      "性别年龄 female / male / young / middle-aged / old；" +
      "语气 energetic / calm / confident / cheerful / bright / serious / dramatic / expressive / friendly；" +
      "质感 deep / clear / smooth / high / measured；" +
      "用途 narration / storytelling / advertisement / social-media / entertainment / educational；" +
      "画风 animated。语言别当 tag（Japanese / Mandarin 是作者顺手打的，语言维度走 `language`）。\n" +
      "- `query`：按名字全库搜索（雷姆、Frieren、Hatsune Miku），比翻热门榜单准。\n" +
      "- `gender`：male / female。\n" +
      "每行是：id | 名称 | 语言 | 标签 | 收藏数 | 描述。收藏数是热度，同条件下优先挑高的。\n" +
      "**按角色人设挑**，不是按名字挑：description 写的是这个嗓子听起来什么样（年龄感、语气、语速），" +
      "挑和 persona 说得通的那条。",
    parameters: listVoicesParams,
    execute: async (_id, params: Static<typeof listVoicesParams>) => {
      // 条件全发给服务端抓对应窗口；gender 是标签，Fish 没有独立参数，本地筛
      const window = await voices.list({
        language: params.language,
        tags: params.tags,
        title: params.query,
      });
      const gender = params.gender?.toLowerCase();
      // filter 顺手复制一份，避免 sort 动到缓存里的窗口；热度是 Fish 给的可信度信号，
      // 同条件下没有理由优先选冷门的
      const matched = window.entries
        .filter((e) => !gender || e.tags.some((t) => t.toLowerCase() === gender))
        .sort((a, b) => b.likes - a.likes);

      if (matched.length === 0) {
        // 回显筛的条件：只说「没找到」的话模型不知道该换哪个词
        const used = [
          params.query ? `关键词=${params.query}` : "",
          params.language ? `语言=${params.language}` : "",
          params.gender ? `性别=${params.gender}` : "",
          params.tags?.length ? `标签=${params.tags.join(",")}` : "",
        ].filter(Boolean);
        return textResult(
          `没有匹配${used.length ? `（${used.join("，")}）` : ""}的音色（本窗口 ${window.entries.length} 条；` +
            `标签是 Fish 作者自己打的、大小写敏感，猜不到就去掉 tags 只按 query/language 查）。`,
        );
      }

      const shown = matched.slice(0, LIST_LIMIT);
      const lines = shown.map((e) => {
        const desc = e.description.replace(/\s+/g, " ").trim();
        const brief = desc.length > DESC_MAX ? `${desc.slice(0, DESC_MAX)}…` : desc;
        return `${e.id} | ${e.title} | ${e.languages.join(",")} | ${e.tags.join(",") || "-"} | ♥${e.likes} | ${brief}`;
      });
      if (matched.length > shown.length) {
        lines.push(`（共 ${matched.length} 条，这里只列了热度前 ${shown.length} 条；用 query 或 tags 收窄后再看）`);
      }
      if (window.stale) lines.push("（注意：这份目录是磁盘快照，Fish 那边暂时拉不到，可能是旧的）");
      return textResult(lines.join("\n"));
    },
  };

  return [listVoices];
}
