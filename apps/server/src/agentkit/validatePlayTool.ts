import type { AgentTool } from "@earendil-works/pi-agent-core";
import { Type } from "@earendil-works/pi-ai";
import { playReadiness, readPlayReadiness } from "@aivn/agent";
import type { WorkshopKitDeps } from "./deps.js";
import { textResult } from "./result.js";

const emptyParams = Type.Object({}, { additionalProperties: false });

/**
 * 剧目自查（`play.readiness`）：判据与报告文本都在包里，与工坊提示词的《当前状态》章节共用一份——
 * 同一句话不该有两个版本，否则改了提示词忘了工具，模型问出来的和它读到的不一致。
 */
export function createValidatePlayTool(deps: Pick<WorkshopKitDeps, "store">): AgentTool<typeof emptyParams> {
  return {
    name: "validate_play",
    label: "检查开演条件",
    description: playReadiness.doc,
    parameters: emptyParams,
    execute: async () => textResult(await playReadiness.execute({}, { read: () => readPlayReadiness(deps.store.dir) })),
  };
}
