import type { AgentTool } from "@earendil-works/pi-agent-core";
import { type Static, Type } from "@earendil-works/pi-ai";
import { textResult } from "./result.js";

const enterNsfwParams = Type.Object(
  {
    /** 进入限制级（NSFW）剧情的简要原因或铺垫（如：两人拥吻并准备进一步亲密互动）。 */
    reason: Type.Optional(Type.String({ maxLength: 500 })),
  },
  { additionalProperties: false },
);

const exitNsfwParams = Type.Object(
  {
    /** 限制级剧情的简要概述（可选，供系统生成全年龄 SFW 摘要时参考）。 */
    summary: Type.Optional(Type.String({ maxLength: 500 })),
  },
  { additionalProperties: false },
);

export interface NsfwToolDeps {
  onEnterNsfw: (reason?: string) => void;
  onExitNsfw: (summary?: string) => void;
  isNsfw: () => boolean;
}

export function createNsfwTools(deps: NsfwToolDeps): AgentTool<any>[] {
  const enterNsfw: AgentTool<typeof enterNsfwParams> = {
    name: "enter_nsfw",
    label: "进入限制级剧情",
    description: [
      "在剧情推进到即将发生亲密、成人或限制级（NSFW）接触时调用。",
      "调用后将开启限制级剧情通道，由专用模型接管后续成人细节描写。",
      "不要在普通日常模式下直接描写露骨细节。调用本工具后完成本轮收束并调用 beat_done，下一轮起将由专用模型展开描写；亦可与 beat_done 在同一批次工具调用中一同发出。",
    ].join("\n"),
    parameters: enterNsfwParams,
    execute: async (_toolCallId, params: Static<typeof enterNsfwParams>) => {
      if (deps.isNsfw()) {
        return textResult("当前已经处于限制级剧情通道中，无需重复调用 enter_nsfw。");
      }
      deps.onEnterNsfw(params.reason?.trim());
      return textResult(
        "已请求进入限制级（NSFW）剧情通道。请继续完成本轮收束并调用 beat_done，下一轮起将由限制级专用模型与专属提示词接管展开细腻描写。",
      );
    },
  };

  const exitNsfw: AgentTool<typeof exitNsfwParams> = {
    name: "exit_nsfw",
    label: "退出限制级剧情",
    description: [
      "在限制级（NSFW）亲密剧情告一段落、即将回归正常日常或主线情节时调用。",
      "**明确支持且推荐与 beat_done 在同一批次工具调用中一同发出**（写完收尾台词后，同批调用 exit_nsfw + beat_done 交出停止点）。",
      "本轮收束时，系统将自动对该段限制级剧情提炼全年龄（SFW）含蓄摘要并切回主模型。主模型后续只保留剧情进展摘要，不包含露骨细节。",
    ].join("\n"),
    parameters: exitNsfwParams,
    execute: async (_toolCallId, params: Static<typeof exitNsfwParams>) => {
      if (!deps.isNsfw()) {
        return textResult("当前未处于限制级剧情通道中，无需调用 exit_nsfw。");
      }
      deps.onExitNsfw(params.summary?.trim());
      return textResult(
        "已请求退出限制级（NSFW）剧情通道。请调用 beat_done 收束本轮，本轮结束后系统将生成全年龄 SFW 摘要并切回主模型继续后续演出。",
      );
    },
  };

  return [enterNsfw, exitNsfw];
}
