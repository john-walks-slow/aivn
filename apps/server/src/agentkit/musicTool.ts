import type { AgentTool } from "@earendil-works/pi-agent-core";
import type { TSchema } from "@earendil-works/pi-ai";
import { musicGenerate, musicGenerateFields, pick, tighten, type InferArgs, type MusicGenerateRequest } from "@aivn/agent";
import type { GenerateMusicRequest } from "../playMusic.js";
import { textResult } from "./result.js";
import { toPi } from "./schema.js";

/**
 * `generate_bgm`：给工坊助手（搭台）后台排产一首 BGM —— **服务端的 face**。
 *
 * 能力（参数真相源、描述正文、查重与请求归一化）在 `@aivn/agent` 的 `music.generate`；
 * 这里只声明服务端这一面：露哪几格、pi 认的长度收紧、以及**投递方式**
 * ——后台排产（`kick` 发起即返回，跑完经 `asset_ready` 广播），工具这边不 await。
 *
 * **只装给工坊**：曲子一分钟上下（实测 ~176s 的片子要 84s），剧作家的一轮只有 240s，
 * 把它塞进演出回路等于整轮都在等一首歌落盘。BGM 又是制作资产。
 */

/** 工具面：除 `model` 外都露（服务端还没有剧目级音乐模型的接线口），范围由 pi 硬校验。 */
const FACE = tighten(
  pick(musicGenerateFields, [
    "name",
    "prompt",
    "title",
    "description",
    "tags",
    "mood",
    "scene",
    "loop",
    "volume",
    "overwrite",
  ]),
  {
    name: { minLength: 1, maxLength: 40 },
    prompt: { minLength: 1, maxLength: 2000 },
    title: { maxLength: 40 },
    description: { maxLength: 300 },
    tags: { maxItems: 8 },
    mood: { maxItems: 8 },
    scene: { maxItems: 8 },
    volume: { minimum: 0, maximum: 1 },
  },
);

const PARAMETERS: TSchema = toPi(FACE);

type MusicArgs = InferArgs<typeof musicGenerateFields>;

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
   * 返回值就是给模型的那句回执，宿主拿它排完队就广播。
   */
  kick: (req: GenerateMusicRequest, toolCallId: string) => string;
}

export function createGenerateMusicTool(deps?: MusicToolDeps): AgentTool<typeof PARAMETERS>[] {
  // 没配后端就整个不注册（与 libraryTool 同一套）：工具在册但每次调用都失败，
  // 模型只会拿它反复空转，不如压根不出现。
  if (!deps?.music) return [];
  return [generateMusicTool(deps as Required<MusicToolDeps>)];
}

function generateMusicTool(deps: Required<MusicToolDeps>): AgentTool<typeof PARAMETERS> {
  return {
    name: "generate_bgm",
    label: "生成 BGM",
    description: musicGenerate.doc,
    parameters: PARAMETERS,
    execute: async (toolCallId, params) =>
      textResult(
        await musicGenerate.execute(params as MusicArgs, {
          existing: (name) => deps.music.existingUrl(name),
          // 排产：发起即返回，回执由宿主的队列给（写的是「已发起」而不是「已入库」）
          start: async (request: MusicGenerateRequest) =>
            deps.kick(request as GenerateMusicRequest, toolCallId),
        }),
      ),
  };
}
