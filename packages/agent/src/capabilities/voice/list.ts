import type { FieldMap } from "../../schema/ir.js";
import type { VoiceEntry } from "@aivn/core";
import type { VoiceQuery } from "../../voice/catalog.js";
import type { Capability } from "../capability.js";

/**
 * `voice.list` —— 查 Fish 音色库，挑一个填进角色卡（两个宿主共用）。
 *
 * 为什么要有这个工具：角色卡的规范写着「voice 从预置音色库挑」，但上千条音色模型看不见也猜不出
 * ——id 是 32 位 hex。填错不报错，演出时那句台词直接静默哑掉，界面上看不出来。
 *
 * 条件（语言 / 标签 / 标题关键词）全发给上游抓对应窗口，`gender` 因为 Fish 没有独立参数而在本地筛；
 * 筛完按 `likes` 降序——热度是 Fish 给的可信度信号，同条件下没有理由优先选冷门的。
 *
 * 窗口动辄上千条，一次全列出去能把一轮预算烧光，所以一次只列一页（`page` 从 1 起）。
 */

/** 一页列多少条：够挑就行。别与上游抓取页 `PAGE_SIZE`（在 `voice/catalog`）混用。 */
export const VOICES_PER_PAGE = 25;

/** 一行能塞进上下文的描述长度上限：Fish 的 description 社区作者随手写，有几百字的。 */
const DESC_MAX = 90;

/** 参数真相源：两个宿主的 face 都 pick 这五格（服务端另加长度收紧）。 */
export const voiceListFields = {
  query: {
    type: "string",
    description: "标题关键词（全库标题子串搜索），比如「雷姆」「maid」。",
  },
  language: {
    type: "string",
    description: "语言代码，小写：ja / zh / en / ko…（上游按小写匹配）。",
  },
  gender: {
    type: "string",
    enum: ["male", "female"],
    description: "按标签本地筛性别；只在作者给它打了 male/female 标签的音色上生效。",
  },
  tags: {
    type: "array",
    items: { type: "string", description: "一个标签，原样透传（大小写敏感）" },
    description: "若干标签，取**并集**（Fish 的多 tag 参数就是并集）。",
  },
  page: {
    type: "integer",
    description: `第几页，从 1 起，每页 ${VOICES_PER_PAGE} 条；小于 1 按 1 算。结果超过一页时看末尾给的下一页页码。`,
  },
} as const satisfies FieldMap;

export const VOICE_LIST_DOC = `从公共音色库里挑一个给角色配 voice（Fish Audio 公共库；角色卡 frontmatter 的 \`voice\` 字段填的就是这里的 id）。

**建角色卡时必须先查这里**：id 是 32 位 hex，猜不出来；填错不报错，演出时那句台词会静默没有声音。
每个查询组合各有一个 1000 条窗口，按需抓取（首次几秒，之后走本机缓存）：
- \`language\`（ja / en / zh，小写）：**先按剧目的语音语言筛**——台词会译成那个语言再送 TTS（未设语音语言时就是剧本原文），选一个不支持它的嗓子，整段台词会带着那个音色的口音念出来。
- \`tags\`（并集；Fish 作者自己打的，**大小写敏感、猜错就是 0 条**）：二次元/角色向用 \`["anime","character-voice"]\`。**照抄下面这批，别自己造词**——性别年龄 female / male / young / middle-aged / old；语气 energetic / calm / confident / cheerful / bright / serious / dramatic / expressive / friendly；质感 deep / clear / smooth / high / measured；用途 narration / storytelling / advertisement / social-media / entertainment / educational；画风 animated。语言别当 tag（Japanese / Mandarin 是作者顺手打的，语言维度走 \`language\`）。
- \`query\`：按名字全库搜索（雷姆、Frieren、Hatsune Miku），比翻热门榜单准。
- \`gender\`：male / female。
每行是：id | 名称 | 语言 | 标签 | 收藏数 | 描述。收藏数是热度，同条件下优先挑高的；结果按热度降序分页返回，这一页没有合适的就把末尾给的下一页页码填进 \`page\`。
**按角色人设挑**，不是按名字挑：description 写的是这个嗓子听起来什么样（年龄感、语气、语速），挑和 persona 说得通的那条。`;

/** 音色库要的那一点点后端：宿主自己的目录服务结构化地满足它，单测可以塞一个假的。 */
export interface VoiceListDeps {
  /** 一个条件窗口；`stale` = 这份目录是磁盘快照、上游暂时拉不到（照实说给模型听）。 */
  list(query: VoiceQuery): Promise<{ entries: VoiceEntry[]; total: number; stale?: boolean }>;
}

export const voiceList: Capability<typeof voiceListFields, VoiceListDeps, string> = {
  id: "voice.list",
  fields: voiceListFields,
  doc: VOICE_LIST_DOC,
  async execute(args, deps) {
    const window = await deps.list({ language: args.language, tags: args.tags, title: args.query });
    const gender = args.gender?.toLowerCase();
    // filter 顺手复制一份，避免 sort 动到缓存里的窗口
    const matched = window.entries
      .filter((entry) => !gender || entry.tags.some((tag) => tag.toLowerCase() === gender))
      .sort((a, b) => b.likes - a.likes);

    // 回显筛的条件：只说「没找到」的话模型不知道该换哪个词
    if (matched.length === 0) {
      const used = [
        args.query ? `关键词=${args.query}` : "",
        args.language ? `语言=${args.language}` : "",
        args.gender ? `性别=${args.gender}` : "",
        args.tags?.length ? `标签=${args.tags.join(",")}` : "",
      ].filter(Boolean);
      return (
        `没有匹配${used.length > 0 ? `（${used.join("，")}）` : ""}的音色（本窗口 ${window.entries.length} 条）。` +
        "标签是作者自己打的、大小写敏感，猜不到就去掉 tags 与 gender，只按 query / language 查。"
      );
    }

    const totalPages = Math.ceil(matched.length / VOICES_PER_PAGE);
    const page = Math.max(1, args.page ?? 1);
    const shown = matched.slice((page - 1) * VOICES_PER_PAGE, page * VOICES_PER_PAGE);
    const windowNote = `本窗口 ${window.entries.length} 条，全库 ${window.total}`;
    if (shown.length === 0) {
      return `第 ${page} 页没有内容：共 ${matched.length} 条匹配（${windowNote}），只有 ${totalPages} 页（page 从 1 起）。`;
    }

    const lines = shown.map(renderVoiceRow);
    const tail = [`共 ${matched.length} 条匹配（${windowNote}）`, `第 ${page}/${totalPages} 页`];
    if (page < totalPages) tail.push(`下一页 page=${page + 1}`);
    else if (page > 1) tail.push("已是本窗口最后一页");
    lines.push(tail.join("；"));
    if (page === 1 && totalPages > 1) {
      lines.push("条件越具体越准：先用 language / tags / query 收窄，比一页页翻省预算。");
    }
    if (window.stale) lines.push("（注意：这份目录是磁盘快照，上游暂时拉不到，可能是旧的）");
    return lines.join("\n");
  },
};

/** 一行音色：id | 名称 | 语言 | 标签 | 收藏数 | 描述（描述压成一行再截断）。 */
export function renderVoiceRow(entry: VoiceEntry): string {
  const description = entry.description.replace(/\s+/g, " ").trim();
  const brief = description.length > DESC_MAX ? `${description.slice(0, DESC_MAX)}…` : description;
  return [
    entry.id,
    entry.title,
    entry.languages.join(",") || "-",
    entry.tags.join(",") || "-",
    `♥${entry.likes}`,
    brief,
  ]
    .filter((part) => part !== "")
    .join(" | ");
}
