import type { AgentTool } from "@earendil-works/pi-agent-core";
import { type Static, Type } from "@earendil-works/pi-ai";
import type { GenerateMusicRequest } from "../playMusic.js";
import { reason, textResult } from "./result.js";

/**
 * `generate_bgm`：给工坊助手（搭台）后台排产一首 BGM，落进 `assets/bgm/`。
 *
 * **只装给工坊**：曲子一分钟上下（实测 ~176s 的片子要 84s），剧作家的一轮只有 240s，
 * 把它塞进演出回路等于整轮都在等一首歌落盘。BGM 又是制作资产——同一套理由让剧作家的
 * `import_asset` 也拿掉了（那个由「引用即导入」这条默认路径顶替，音乐这里由工坊先备好）。
 *
 * **后台排产，不在回合里等**：与 `generate_image` 的 queued 形态同一套口径——发起即返回，
 * 记账挂进 `pendingJobs`（面板上看得见在等什么），跑完经 `asset_ready` 广播，客户端重拉素材页。
 * **没有骨架占位那一层**：BGM 不进时间线，到货只是素材页多了一张可播放的卡。
 *
 * **元数据与 prompt 的分工**：工具描述只讲契约（怎么调、落哪、怎么引用、要等多久），
 * 「什么样的 prompt 才出得来日系 galgame 味」这种长篇知识归技能库（`read_skill` 读
 * `galgame-bgm`）——与出图那条渐进披露同一套规矩：描述里写不下的东西不要往描述里塞，
 * 塞进去它就每轮都付钱。
 */

const musicParams = Type.Object(
  {
    /**
     * 素材 id：剧本里 `<scene bgm="id">` 引用的就是它。一首一首给，起名按曲子自己的
     * 情绪与用途（如 `bgm_school_dusk`、`bgm_memory_warm`），别用 bgm1、test。
     */
    name: Type.String({ minLength: 1, maxLength: 40 }),
    /** 英文出歌提示词：配器 + 情绪走向 + 速度与循环 + 用途。怎么写见技能库 galgame-bgm。 */
    prompt: Type.String({ minLength: 1, maxLength: 2000 }),
    /** 中文标题（素材页与选曲时显示的名字）。不给就用 id。 */
    title: Type.Optional(Type.String({ maxLength: 40 })),
    /** 中文描述：这首曲子垫在哪一段、什么情绪。剧作家靠它决定换不换曲。 */
    description: Type.Optional(Type.String({ maxLength: 300 })),
    tags: Type.Optional(Type.Array(Type.String({ maxLength: 24 }), { maxItems: 8 })),
    /** 情绪词：剧作家选曲的主要依据，**照素材库里既有的词表填**（温柔/忧伤/日常/…），别自造。 */
    mood: Type.Optional(Type.Array(Type.String({ maxLength: 16 }), { maxItems: 8 })),
    /** 适用场景（告白 / 别离 / 回忆 / 日常 / 校园…）：同样照素材库既有词表填。 */
    scene: Type.Optional(Type.Array(Type.String({ maxLength: 16 }), { maxItems: 8 })),
    /** 是否适合循环播放。galgame 的 BGM 绝大多数要一直垫在对话下面，默认按 true 走。 */
    loop: Type.Optional(Type.Boolean()),
    /** 建议默认音量（0–1）。素材库既有条目落在 0.35–0.45，不给按 0.4。 */
    volume: Type.Optional(Type.Number({ minimum: 0, maximum: 1 })),
    /**
     * 剧目里已有同名曲子时是否重生成（默认 false = 跳过）。
     *
     * 默认跳过是防手滑烧配额：一分钟一次的操作，不打招呼就覆盖掉一首用户可能很喜欢的曲子
     * 比多等一轮糟糕得多。**只有用户明确说了要重做这一首时，才传 true**。
     */
    overwrite: Type.Optional(Type.Boolean()),
  },
  { additionalProperties: false },
);

const DESCRIPTION = [
  "后台生成一首 BGM 并落进 `assets/bgm/<name>`（**发起即返回，不等曲子**），之后剧本里用 `<scene bgm=\"name\" />` 引用。",
  "**要曲子先查库**（`list_library`，kind=bgm）：库里已有的直接 `import_asset` 导进来更快、还免得占生成配额；",
  "库里确实没有合适的（缺那个情绪、或用户明确要一首专属的）才生成。**剧目里已有同名曲子会直接跳过**——",
  "用户明确说要重做那一首时才带 `overwrite=true`，那会覆盖同名那首，动手前先跟用户说清楚。",
  "提示词写英文，按「配器 + 情绪走向 + 速度与循环 + 用途」四段写；`seamless loop` 别省（galgame 的 BGM 要反复铺在对话下面，",
  "而实测上游固定给 ~176s，不写循环意图出来的东西往往有明显头尾，接不上）。",
  "怎么写才出得来日系 galgame 味、哪些词会把它推向别的曲风、以及 mood/scene 该填哪些字，",
  "读技能库 `galgame-bgm`（它带着素材库里既有的词表）。",
  "元数据（标题、描述、情绪、适用场景、是否可循环）会一并写进剧目素材表——**剧作家据此选曲**，",
  "所以 mood 与 scene 一定要按这首曲子真实的情绪、照既有词表填，别复制粘贴也别自造词。",
  "**要等一分半上下**（实测一首 ~176s 的曲子要 84s，比出图慢一档）：这段时间面板上「在生成的事」有这一行，",
  "用户看不到新东西，先把话说完再等结果。曲子到货时**素材页多一张可播放的卡**、剧作家下一轮就能按情绪选它；",
  "对话里不会出现它的内联预览——这一轮早就收束了，曲子那时还不存在。",
  "工具只管 BGM。音效（脚步、门响、心跳）没有生成口，库里没有就让用户在素材页上传。",
].join("\n");

export interface MusicToolDeps {
  /** 没配音乐后端时不注册这个工具（装一个必然失败的工具只会诱使模型空转）。 */
  music?: {
    /** 剧目里已有同名曲子时的 URL，没有则 null。 */
    existingUrl: (name: string) => Promise<string | null>;
  };
  /**
   * 后台发起生成（宿主负责记账与到货广播）。
   *
   * 工具这边**不 await**：await 了这一轮就白等一分半，用户看着像卡死。
   * 返回值里带工具自己的回执文案，宿主拿它排完队就广播。
   */
  kick: (req: GenerateMusicRequest, toolCallId: string) => string;
}

export function createGenerateMusicTool(deps?: MusicToolDeps): AgentTool<typeof musicParams>[] {
  // 没配后端就整个不注册（与 libraryTool 同一套）：工具在册但每次调用都失败，
  // 模型只会拿它反复空转，不如压根不出现。
  if (!deps?.music) return [];
  return [generateMusicTool(deps)];
}

function generateMusicTool(deps: NonNullable<MusicToolDeps>): AgentTool<typeof musicParams> {
  return {
    name: "generate_bgm",
    label: "生成 BGM",
    description: DESCRIPTION,
    parameters: musicParams,
    execute: async (toolCallId, params: Static<typeof musicParams>) => {
      const name = params.name.trim();
      try {
        // 已有同名曲子默认就跳过（与生图 queued 那条「剧目里已有同名素材就跳过」同一口径）；
        // 用户明确要重做时才 overwrite——那会覆盖掉同名那一首，回执里说明覆盖了什么
        const existing = await deps.music!.existingUrl(name);
        if (existing && !params.overwrite) {
          return textResult(
            `剧目里已经有同名曲子（${existing}），跳过生成。直接 <scene bgm="${name}" /> 引用它；` +
              "用户明确要重做这一首时，带 overwrite=true 覆盖生成。",
          );
        }
        const receipt = deps.kick(
          {
            name,
            prompt: params.prompt,
            overwrite: params.overwrite,
            title: params.title?.trim() || undefined,
            description: params.description?.trim() || undefined,
            tags: params.tags?.map((t) => t.trim()).filter(Boolean),
            mood: params.mood?.map((m) => m.trim()).filter(Boolean),
            scene: params.scene?.map((s) => s.trim()).filter(Boolean),
            loop: params.loop,
            volume: params.volume,
          },
          toolCallId,
        );
        return textResult(receipt);
      } catch (error) {
        return textResult(`没能发起音乐生成：${reason(error)}`);
      }
    },
  };
}