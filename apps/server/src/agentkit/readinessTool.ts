import type { AgentTool } from "@earendil-works/pi-agent-core";
import { Type } from "@earendil-works/pi-ai";
import type { WorkshopKitDeps } from "./deps.js";
import { renderReadiness } from "./readiness.js";
import { textResult } from "./result.js";

const emptyParams = Type.Object({}, { additionalProperties: false });

/**
 * 开演条件自查。与工坊提示词的「当前状态」章节共用 `renderReadiness`——
 * 同一句话不该有两个版本，否则改了提示词忘了工具，模型问出来的和它读到的不一致。
 */
export function createReadinessTool(deps: Pick<WorkshopKitDeps, "store">): AgentTool<typeof emptyParams> {
  return {
    name: "get_readiness",
    label: "检查开演条件",
    description: "检查剧目是否达到可开演条件（premise / 立绘 / 背景图）。",
    parameters: emptyParams,
    execute: async () => textResult(renderReadiness(await deps.store.readiness())),
  };
}
