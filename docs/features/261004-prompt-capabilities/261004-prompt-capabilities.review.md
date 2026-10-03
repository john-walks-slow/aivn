# 检视报告

## 概要

本次检视针对 `refactor/prompt-capabilities` 分支（基于 `main@4281ad7`），涵盖 `apps/server/src/agentkit/kit.ts`、`apps/server/src/prompt.ts`、`apps/server/src/orchestrator.ts` 及相关测试文件。
重构将剧作家提示词中散落的 3 个可选布尔能力位与搭台助手的能力位收敛统一为同一套 `can: AgentCapabilities`，由工具映射表单一真相源派生计算。整体设计精炼、边界恪守严密、对外行为逐字等价、回归测试靶向明确，是一次高质量的去债重构。

## 需求对齐

- **两端表达统一**：剧作家 `PromptContext.can` 与搭台助手 `WorkshopPromptContext.can` 统一为完全相同的 `AgentCapabilities` 类型，生产调用点统一为 `can: this.kit.can`，彻底消除了“两份提示词两种写法”的认知负荷与改动分歧。
- **并集形状与派生机制**：未引入针对角色的二次切片类型（避免了再次形成维护割裂），而是通过常量表 `CAPABILITY_TOOLS` 统一收敛 5 项能力，并由纯函数 `capabilitiesOf(enabled)` 从装载工具动态计算，符合设计预期。
- **对外行为零破坏**：原先 `ctx.canImage !== false` 的三态隐式逻辑改为显式必填布尔值，在生产环境中与 `kit.can.image` 行为完全重合；结合 12 组上下文组合的逐字对比（12/12 variants 完全一致）以及 480 条 server 测试全绿，证明对外行为无漂移。
- **防止两边不一致的回归防护**：新增 `apps/server/test/promptCapabilities.test.ts`（7 条用例），覆盖了能力工具目录真实性、`capabilitiesOf` 计算、同一能力对象喂给两端、图像/素材库能力开闭对两端的控制效果，以及剧作家对 `voice`/`shell` 无关位的免疫隔离。
- **边界控制**：严格遵守债务简报边界，未触碰 `workshop.ts`、`playFiles.ts`、`playEnv.ts`、`workshopSession.ts`，未触碰 `TOOL_CATALOG` 结构。

## 阻塞问题

无。

| ID  | 位置 | 问题 | 建议 |
| --- | ---- | ---- | ---- |
| 无  | 无   | 无   | 无   |

## 建议修改

无。

| ID  | 位置 | 问题 | 建议 |
| --- | ---- | ---- | ---- |
| 无  | 无   | 无   | 无   |

## 非阻塞问题

| ID  | 位置 | 问题 | 建议 |
| --- | ---- | ---- | ---- |
| N-01 | [promptCapabilities.test.ts:48-85](apps/server/test/promptCapabilities.test.ts:48-85) | `promptCapabilities.test.ts` 针对 `library`、`image`、`voice/shell` 均编写了精准的跨角色消费断言，但对 `search` 位未编写显式的正反测试用例（虽然 `search` 在 `prompt.test.ts` 及全量 diff 中已有覆盖）。 | 可在后续维护中补充一条 `can.search` 为 true/false 时两端对 `SEARCH_GUIDE` 注入/剔除的断言，使 5 个能力位的跨提示词消费在单测上完全对称。 |

## 准入结论

**结论**：`准入`

**说明**：重构方案精准解决了能力位表达不统一和潜在修改漂移的技术债务。设计单一真相源明确、实现干净利落、类型约束强，且对外输出与既有行为严格逐字等价，测试防护周全，无任何阻塞问题。
