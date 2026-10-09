/**
 * A 区（剧作家系统提示词的固定前部）里**两个宿主逐字相同**的那几段。
 *
 * 边界和 `stage-dsl.ts` 一样：只收两边本来就是同一份拷贝的渲染——
 * 数据来源（服务端从运行期对象拿、插件从盘上读）、外层包装（服务端还有「已生成的图」与
 * 资源库指引，插件有「素材清单」的引言与空清单提示）、记忆索引末尾那句按各自工具面写的
 * 引导语，都留在宿主手里拼，这里只出中间那段。
 */
import { characterCardPath, describeAsset, isProtagonist, type AssetMeta } from "@aivn/core";

/**
 * 配乐与音效的编排规则。**只在真有 bgm/sfx 时注入**（清单是空的还讲怎么用，等于白烧 token）。
 *
 * 引擎行为是 bgm/ambient 缺省保持、`none` 停，换曲与停乐自动交叉淡入淡出。
 * 「换场景顺手重写一遍 bgm」是模型最常犯的毛病，所以这条写得最重。
 */
export const AUDIO_RULES = `# 配乐与音效（怎么用）

- **缺省 = 保持当前**：<scene> 不写 bgm/ambient 就继续放现在这首。换场景通常不换乐，
  只有情绪或地点真的变了才换 id；每拍都重写一遍 bgm 是最常见的毛病。
- 想停：<scene bgm="none"/>，ambient 同理（静默场面、回忆结束、进入字幕）。
- 音量自己给：<scene bgm_volume="0.4"/>、<scene ambient_volume="0.3"/>、<sfx src="…" volume="0.6"/>。
  音乐与音效都给台词让位——拿不准就把音量调小。
- 换曲与停乐会自动交叉淡入淡出，不用自己写淡出。
- ambient 是持续的环境底噪（雨、风、人声、车流），比 bgm 轻，一场戏给一次就够。
- sfx 放在动作发生的那一行之前：开门、转身、翻书、东西落地，一个动作一条，别连着堆。
- 按描述和情绪选：清单里带情绪、适用场景、时长的条目，挑与这一拍情绪对得上的那条；
  只挑清单里真有的 id，没有合适的宁可不给。`;

/**
 * 素材清单的四段（空类目不出现）。
 *
 * 每项带上素材表里的说明——差分名未必与画面相符，剧作家挑素材靠的是「这一张画的是什么」。
 * 配乐规则插在 sfx 与 cg 之间：它讲的是怎么用上面那份清单，位置贴着它才读得懂。
 */
export function renderAssetSections(
  index: Readonly<Record<string, readonly string[]>>,
  meta: (id: string) => AssetMeta,
  opts: { audioRules?: string } = {},
): string {
  const stems = (kind: string): string[] => (index[kind] ?? []).map((file) => file.replace(/\.\w+$/, ""));
  const section = (heading: string, kind: string, tail = ""): string => {
    const list = stems(kind);
    if (list.length === 0) return "";
    const rows = list.map((id) => {
      const detail = describeAsset(meta(id));
      return `- ${detail ? `${id}（${detail}）` : id}`;
    });
    return `\n# ${heading}\n\n${rows.join("\n")}${tail}\n`;
  };

  // 每个块自带前导换行（`section` 与这里都如此），块与块之间才是一行空行
  const audio = opts.audioRules && (stems("bgm").length > 0 || stems("sfx").length > 0) ? `\n${opts.audioRules}` : "";
  return [
    section("可用背景 bg", "backgrounds", "\n<scene> 的 bg 优先取这些 id。"),
    section("可用音乐 bgm", "bgm"),
    section("可用音效 sfx", "sfx"),
    audio,
    section("已有插图 cg", "cg"),
  ].join("");
}

/** 记忆索引里的一行（分类 / 标题 / 摘要 / 卡的路径）。 */
export interface MemoryIndexCard {
  layer: string;
  name: string;
  summary: string;
  path: string;
}

/**
 * 记忆索引：每行带 `[分类]` 前缀与**这张卡自己的路径**。
 *
 * 标题与文件名可以不一样，路径推不出来，只能这里给——模型要按需 read 详情。
 * 末尾那句引导语按各宿主的工具面写（服务端有 `read_memory_detail` / `search_archive`，
 * 插件只有 read），所以由调用方传进来；没有卡时整段不出现。
 */
export function renderMemoryIndex(cards: readonly MemoryIndexCard[], tail: string): string {
  if (cards.length === 0) return "";
  const rows = cards.map((c) => `- ${c.layer ? `[${c.layer}] ` : ""}${c.name}（${c.path}）：${c.summary}`);
  return `# 记忆索引（按需查详情）\n\n${rows.join("\n")}\n\n${tail}`;
}

/** 角色表里的标题行：id、卡路径、是否玩家扮演都给全（模型不该为了改一张卡去推路径）。 */
export function castTitle(id: string, name?: string): string {
  return `${name ?? id}（id: ${id}，卡片 ${characterCardPath(id)}${isProtagonist(id) ? "，玩家扮演" : ""}）`;
}

/** 角色表里的一张全卡所需的全部数据（宿主各自去凑：服务端从运行期对象、插件从盘上读）。 */
export interface CastCardView {
  id: string;
  name?: string;
  body: string;
  voice?: string;
  /** 立绘目录名：卡上显式绑定优先，与卡不同名时要写出来——出图与差分都以目录名寻址。 */
  spriteDir: string;
  /** 该目录里已有的差分名（不含扩展名）。 */
  variants: readonly string[];
}

/** 一张全卡：标题 + 正文 + 音色 + 立绘差分（没有的空行不留，差分项带素材表里的说明）。 */
export function renderCastCard(
  card: CastCardView,
  meta: (id: string, charId?: string) => AssetMeta,
): string {
  const variants = card.variants.map((variant) => {
    const detail = describeAsset(meta(variant, card.spriteDir));
    return detail ? `${variant}（${detail}）` : variant;
  });
  return [
    `### ${castTitle(card.id, card.name)}`,
    card.body.trim(),
    card.voice ? `音色：${card.voice}` : "",
    variants.length > 0
      ? `立绘${card.spriteDir === card.id ? "" : `（目录 ${card.spriteDir}）`}差分 variant：${variants.join(" | ")}`
      : "",
  ]
    .filter((part) => part !== "")
    .join("\n");
}

/**
 * 只有立绘、没有角色卡的主体（机甲、猫、道具）：它们进不了角色表——角色表就是角色卡目录，
 * 但剧作家得知道它们存在、能按 variant 上台。不给这份清单，它就只会重新出图或干脆不用。
 */
export function renderBareSprites(
  dirs: readonly string[],
  variantsOf: (spriteDir: string) => readonly string[],
  meta: (id: string, charId?: string) => AssetMeta,
): string {
  if (dirs.length === 0) return "";
  const rows = dirs.map((dir) => {
    const title = meta(dir).title;
    const variants = variantsOf(dir).map((variant) => {
      const detail = describeAsset(meta(variant, dir));
      return detail ? `${variant}（${detail}）` : variant;
    });
    return `- ${title ? `${dir}（${title}）` : dir}：variant ${variants.join(" | ")}`;
  });
  return `\n\n# 台上其它主体（有立绘，没有角色卡）\n\n${rows.join("\n")}\n\n它们与角色同权：\`<actor id="…" variant="…">\` 直接上台，不用建档。`;
}
