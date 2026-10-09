import type { AgentTool } from "@earendil-works/pi-agent-core";
import type { TSchema } from "@earendil-works/pi-ai";
import { pick, tighten, voiceList, voiceListFields, type InferArgs, type VoiceListDeps } from "@aivn/agent";
import type { VoiceCatalogService } from "../voiceCatalog.js";
import { textResult } from "./result.js";
import { toPi } from "./schema.js";

/**
 * 音色库检索（只读）——**服务端的 face**。
 *
 * 能力（参数真相源、描述正文、实现）在 `@aivn/agent` 的 `voice.list`；这里只声明服务端这一面：
 * 露哪几格、叫什么名字、以及 pi 运行时认得的长度收紧（DSH 侧的 schema 子集不认 maxLength）。
 *
 * 与 list_library 的分工：那边搜的是「这台剧目现在有什么素材」，这边搜的是「有什么嗓子」。
 * 音色是全局的，不随剧目分发，所以不进素材资源库。
 *
 * 没有配 TTS 时不注册——注册一个必然查不出东西的工具只会诱使模型空转。
 */

/** 工具面：五格都露，长度与枚举的上限由 pi 硬校验。 */
const FACE = tighten(pick(voiceListFields, ["query", "language", "gender", "tags", "page"]), {
  query: { maxLength: 60 },
  language: { maxLength: 8 },
  tags: { maxItems: 4 },
});

const PARAMETERS: TSchema = toPi(FACE);

type VoiceListArgs = InferArgs<typeof voiceListFields>;

export function createVoiceTool(voices?: VoiceCatalogService): AgentTool<any>[] {
  if (!voices) return [];

  // 依赖只取它要的那一点：能力不认识 VoiceCatalogService，只认识「给我一个条件窗口」。
  // 服务端的目录服务把总数叫 totalAvailable，这里翻成能力认的名字。
  const deps: VoiceListDeps = {
    list: async (query) => {
      const catalog = await voices.list(query);
      return { entries: catalog.entries, total: catalog.totalAvailable, stale: catalog.stale };
    },
  };

  const listVoices: AgentTool<typeof PARAMETERS> = {
    name: "list_voices",
    label: "查音色库",
    description: voiceList.doc,
    parameters: PARAMETERS,
    execute: async (_toolCallId, params) => textResult(await voiceList.execute(params as VoiceListArgs, deps)),
  };

  return [listVoices];
}
