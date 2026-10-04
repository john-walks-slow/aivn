# 检视报告

## 概要

检视范围覆盖 `261004-rewrite-instruction` 问题的全量改动（涉及 `packages/core`、`apps/server`、`apps/web` 及配套测试与指引文档）。
本次修复架构清晰、协议扩展与领域语义自然贴合，彻底解决了「带交代重写时交代落入下一轮排队」的动词错位问题，核心链路与时序处理严密。整体评定为**条件准入**。

## 需求对齐

- **需求达成**：完全满足需求。
  1. 协议层将 `instruction?: string` 纳入 `ClientMessage` 的 `fork` 动词；
  2. 服务端在 `forkTo` 中通过 `deliverForkInstruction` 统一复用 `deliverPrompts` 机制，将交代作为新枝首轮的第一条输入，同时下发正文、落地谱系 prompt 节点并广播 `player_input` 事件，不进入待注入队列；
  3. 客户端在路线卡片重写（`RouteCanvas` / `StageScreen`）、舞台导演栏重新生成（`StageTheater.restart`）及舞台分岔（`StageTheater.fork`）三处均对齐新协议，移除了原先二次调用 `queuePrompt` / `onPrompt` 的旁路逻辑；
  4. 变异测试已通过，核心场景断言精准。
- **与计划/spec 差异**：无偏差，未引入过度设计。

---

## 阻塞问题

无。

---

## 建议修改

| ID | 位置 | 问题 | 建议 |
|---|---|---|---|
| S-01 | `apps/server/test/orchestrator.test.ts:2311` | **缺少「分岔 · 带着这句」（`resume: false` + `instruction`）的测试用例**<br>本次修改不仅支持了 `resume: true` 的重写交代，还在 `orchestrator.ts:1178` 与 `StageTheater.tsx:536` 实现了分岔带交代（新分支开出后立刻照这句开演）。但新增测试仅覆盖了 `resume: true` 场景，`resume: false` 带 instruction 的分支未被用例覆盖。 | 建议在 `orchestrator.test.ts` 中补充一条用例：断言在 `resume: false`（分岔）且附带 `instruction` 时，新分支正确启动并以该 instruction 作为首轮输入。 |
| S-02 | `apps/web/src/views/StageScreen.tsx:427` 与 `StageTheater.tsx:529` | **舞台导演栏「重新生成」的锚点可能存在轮次偏倚风险（潜在架构债）**<br>`StageScreen` 中 `targets.beatId` 取值为 `beatAtLine(cards, line)?.id`（即当前拍首个节点的 ID，属于本拍内部），而 `RouteCanvas.tsx:305` 重写使用的是 `card.forkFromId`（即本拍首节点的父节点，即上一拍的末尾）。在第一轮时两者一致；但在第二轮及之后，若使用 `card.id` 作为 `forkTo` 的锚点，世界线将截断至第二轮首句之后而非退回第二轮开头之前。 | 建议核实 `targets.beatId` 是否应取 `beatAtLine(cards, line)?.forkFromId`，使舞台导演栏的「重新生成」与路线图卡片的「重写」在锚点计算上保持完全一致。 |

---

## 非阻塞问题

| ID | 位置 | 问题 | 建议 |
|---|---|---|---|
| N-01 | `apps/server/test/orchestrator.test.ts:2311` | **判废退回（retry fail）时交代回滚到队列的测试覆盖建议**<br>`troubleshoot.md` 与 `AGENTS.md` 中提及「判废退回时交代照常由 `returnBeatSteers` 回到队列」，代码逻辑通过复用 `deliverPrompts` 隐式继承了此机制，但缺乏显式测试保护以防后续重构破坏。 | 可在后续测试补充中，增加一条模拟重写轮判废失败时、交代被退回 `prompt_queue` 的断言用例。 |
| N-02 | `apps/web/src/stage/StageTheater.tsx:47-50` | **`StageTheaterProps.onFork` 的入参类型与 `sendFork` 略有不对称**<br>`sendFork` 支持 `replaced?: string`，而 `StageTheaterProps.onFork` 仅声明了 `{ resume?: boolean; instruction?: string }`。虽然舞台端当前通过谱系链 `ancestorChain` 自动回溯上一轮来源，暂时无需显式传 `replaced`，但统一接口类型或在注释中点明差异有助于维护。 | 可考虑在 `StageTheaterProps.onFork` 补齐 `replaced?: string` 可选参数，或在 JSDoc 保持对齐说明。 |

---

## 准入结论

**结论**：`条件准入`

**说明**：核心 bug 修复完整且方案规范，核心代码逻辑与文档同步到位，无阻断性问题。建议在合入前或紧接的用例维护阶段补充 `resume: false` 带 instruction 的测试用例（S-01），并评估确认舞台重写锚点（S-02）。
