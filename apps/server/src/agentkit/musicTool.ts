import type { AgentTool } from "@earendil-works/pi-agent-core";
import { type Static, Type } from "@earendil-works/pi-ai";
import type { PlayMusic } from "../playMusic.js";
import { reason, textResult } from "./result.js";

/**
 * `generate_bgm`：给工坊助手（搭台）生成一首曲子，落进 `assets/bgm/`。
 *
 * **只装给工坊**：曲子要 84 秒上下（实测一首 ~175s），剧作家的一轮只有 240s，
 * 把它塞进演出回路等于整轮都在等一首歌落盘。BGM 又是制作资产——同一套理由让剧作家的
 * `import_asset` 也拿掉了（那个由「引用即导入」这条默认路径顶替，音乐这里由工坊先备好）。
 *
 * **元数据与 prompt 的分工**：工具描述只讲契约（怎么调、落哪、怎么引用、要等多久），
 * 「什么样的 prompt 才出得来日系 galgame 味」这种长篇知识归技能库（`read_skill` 读
 * `galgame-bgm`）——同一套渐进披露，渐进披露的边界与生图那条一致：
 * 描述里写不下的东西不要往描述里塞，塞进去它就每轮都付钱。
 */

const musicParams = Type.Object(
  {
    /**
     * 素材 id：剧本里 `<scene bgm="id">` 引用的就是它。一首一首给，起名按曲子自己的
     * 情绪与用途（如 `bgm_school_dusk`、`bgm_memory_warm`），别用 bgm1、test。
     */
    name: Type.String({ minLength: 1, maxLength: 40 }),
    /** 英文出歌提示词：配器 + 情绪 + 速度 + 用途。怎么写见技能库 galgame-bgm。 */
    prompt: Type.String({ minLength: 1, maxLength: 2000 }),
    /** 中文标题（素材页与选曲时显示的名字）。不给就用 id。 */
    title: Type.Optional(Type.String({ maxLength: 40 })),
    /** 中文描述：这首曲子垫在哪一段、什么情绪。剧作家按它选曲，写不准等于没写。 */
    description: Type.Optional(Type.String({ maxLength: 300 })),
    tags: Type.Optional(Type.Array(Type.String({ maxLength: 24 }), { maxItems: 8 })),
    /** 情绪词（忧伤 / 温柔 / 紧张 / 轻快…）：剧作家选曲的主要依据。 */
    mood: Type.Optional(Type.Array(Type.String({ maxLength: 16 }), { maxItems: 8 })),
    /** 适用场景（告白 / 别离 / 回忆 / 日常 / 悬疑…）。 */
    scene: Type.Optional(Type.Array(Type.String({ maxLength: 16 }), { maxItems: 8 })),
    /** 是否适合循环播放：填了就在素材表里标「可循环」，剧作家据此判断能不能一直垫着。 */
    loop: Type.Optional(Type.Boolean()),
    /** 建议默认音量（0–1），不给按 0.4。 */
    volume: Type.Optional(Type.Number({ minimum: 0, maximum: 1 })),
  },
  { additionalProperties: false },
);

const DESCRIPTION = [
  "生成一首 BGM 并落进 `assets/bgm/<name>`，之后剧本里用 `<scene bgm=\"name\" />` 引用。",
  "**要曲子先查库**（`list_library`，kind=bgm）：库里已有的曲子直接 `import_asset` 导进来更快、还免得占生成配额；",
  "库里确实没有合适的（缺那个情绪、或用户明确要一首专属的）才生成。",
  "提示词写英文，说清**配器、情绪、速度、以及它的用途**（'solo piano accompaniment, slow, for dialogue' 这种），",
  "怎么写才出得来日系 galgame 味、哪些词会把它推向别的曲风，读技能库 `galgame-bgm`。",
  "元数据（标题、描述、情绪、适用场景、是否可循环）会一并写进剧目素材表——**剧作家据此选曲**，",
  "所以 mood 与 scene 一定要按这首曲子真实的情绪填，别复制粘贴。",
  "**要等一分半上下**（实测一首 ~175s 要 84s）。这段时间用户看不到新东西，先把话说完。",
  "同一首曲子重生成会**覆盖**剧目里同名的那首，覆盖前先跟用户说清楚。",
  "工具只管 BGM。音效（脚步、门响、心跳）没有生成口，库里没有就让用户在素材页上传。",
].join("\n");

export interface MusicToolDeps {
  /** 没配音乐后端时不注册这个工具（装一个必然失败的工具只会诱使模型空转）。 */
  music?: PlayMusic;
}

export function createGenerateMusicTool(deps?: MusicToolDeps): AgentTool<typeof musicParams>[] {
  const music = deps?.music;
  // 没配后端就整个不注册（与 libraryTool 同一套）：工具在册但每次调用都失败，
  // 模型只会拿它反复空转，不如压根不出现。
  if (!music) return [];
  return [generateMusicTool(music)];
}

function generateMusicTool(music: PlayMusic): AgentTool<typeof musicParams> {
  return {
    name: "generate_bgm",
    label: "生成 BGM",
    description: DESCRIPTION,
    parameters: musicParams,
    execute: async (toolCallId, params: Static<typeof musicParams>) => {
      try {
        const asset = await music.generate(
          {
            name: params.name,
            prompt: params.prompt,
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
        return textResult(
          `已生成${asset.replaced ? "并覆盖同名素材" : ""}：${asset.path}\n` +
            `剧本里这样引用：<scene bgm="${asset.id}" />\n` +
            "元数据已写进 assets/manifest.json，剧作家会按情绪与场景选它。",
        );
      } catch (error) {
        return textResult(`音乐生成失败：${reason(error)}`);
      }
    },
  };
}