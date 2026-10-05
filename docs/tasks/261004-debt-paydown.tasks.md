# 261004 设计债清偿 · 任务台账

来源：2026-10-04 那次「搭台 agent 换成 pi 内建工具」实施过程中记录的设计债清单。
用户选定修 1~4 与 6（5「工具报错文案实际是 API」本轮不做）。

每一项都在**独立 git worktree** 里做，各自一个分支，最后逐个合回 main（无锁 CAS）。
本台账中所有路径均相对 `/root/projects/stage-ai`。

| # | 任务 | 类型 | 状态 | 分派至 | 工作区 | 产出文档 | 备注 |
|---|------|------|------|--------|--------|----------|------|
| 1+4 | 工坊写路径统一：`play.json` 校验收敛到唯一文本写口 `PlayFiles.write`；「剧目被改动了」收敛为一个置脏口 + 一个收束口 | 架构类 | 待验证 | 本会话（自己） | `.worktrees/workshop-shell`（`refactor/workshop-write-path`） | [summary](.worktrees/workshop-shell/docs/features/261004-write-path-unification/261004-write-path-unification.summary.md) · [validation](.worktrees/workshop-shell/docs/features/261004-write-path-unification/261004-write-path-unification.validation.md) · [review](.worktrees/workshop-shell/docs/features/261004-write-path-unification/261004-write-path-unification.review.md) | 用户指定「自己负责最困难的」。commit `1e81143` + `9f8f717`，tsc 干净、176 用例通过、HTTP 面实测两次非法写盘均 400 且盘上未变。检视结论**准入 / 0 阻塞**。**债单事实更正**：白名单并没有写两遍，`playEnv.denial()` 是委派 `PlayFiles.pathOf` 的 |
| 2 | 工具 id 清单收敛为一份：删 `ROLE_INSTALLABLE`，角色可见性成为 `TOOL_CATALOG` 每项的 `roles` 属性 | 优化点类 | 待验证 | 子代理 A | `.worktrees/tool-catalog-roles`（`refactor/tool-catalog-roles`） | [summary](.worktrees/tool-catalog-roles/docs/features/261004-tool-catalog-roles/261004-tool-catalog-roles.summary.md) · [validation](.worktrees/tool-catalog-roles/docs/features/261004-tool-catalog-roles/261004-tool-catalog-roles.validation.md) | commit `851e42b` + 文档 `bbd3dcd`，113 例全绿，检视「条件准入」两条建议已落地（reviewer 是在线检视、无独立报告，结论记在 summary 里）。**顺手修掉一条假测试**：原来那条「目录 == 工厂产物」是拿启用集比自己，工厂多装一个未登记的工具也过得去；现在比工厂原样产物，两个方向都用变异验证过会红 |
| 3 | 两份提示词的能力位统一为同一套 `can: AgentCapabilities`（新增 `CAPABILITY_TOOLS` 表，`capabilitiesOf` 算位） | 优化点类 | 待验证 | 子代理 B | `.worktrees/prompt-capabilities`（`refactor/prompt-capabilities`） | [summary](.worktrees/prompt-capabilities/docs/features/261004-prompt-capabilities/261004-prompt-capabilities.summary.md) · [validation](.worktrees/prompt-capabilities/docs/features/261004-prompt-capabilities/261004-prompt-capabilities.validation.md) · [review](.worktrees/prompt-capabilities/docs/features/261004-prompt-capabilities/261004-prompt-capabilities.review.md) | commit `3210cff`，全 server 480 例全绿，检视**准入**。对外行为逐字不变：改动前后 12 组上下文的剧作家 system prompt 逐字 diff 12/12 一致 |
| 6 | 根 `AGENTS.md` 巨型单行（最长行 10,258 字符，项目自己的 read 工具读不了）拆成模块级指引 | 优化点类 | 待验证 | 子代理 C | `.worktrees/module-agents-md`（`docs/module-agents-md`） | [summary](.worktrees/module-agents-md/docs/features/261004-module-agents-md/261004-module-agents-md.summary.md) · [validation](.worktrees/module-agents-md/docs/features/261004-module-agents-md/261004-module-agents-md.validation.md) · [review](.worktrees/module-agents-md/docs/features/261004-module-agents-md/261004-module-agents-md.review.md) | commit `ae96959`，基线已跟上 `main@ecb60e8`（发现 main 推进后重做，避免丢新段落）。3 行/最长 10258 → 根 21 行/852 字符 + `apps/web/AGENTS.md` 47 行 + `apps/server/AGENTS.md` 140 行。零丢失的机械证明：去标点后内容字符逐字全等，三对全 PASS，映射表连续无空洞。检视**准入**。坑：`library/` 不进 git，那 4 条事实留在根 |

## 冲突与顺序

- 1+4（我）动 `playFiles.ts` / `agentkit/playEnv.ts` / `workshopSession.ts` / `http.ts`。
- 2（A）动 `agentkit/kit.ts` / `agentkit/role.ts` / `agentkit.test.ts`。
- 3（B）动 `prompt.ts` / `kit.ts`（仅能力位定义）/ 调用点 / 提示词测试。
- 6（C）只动 Markdown。
- **无人冲突**：6 与全部代码任务；2 与 1+4。
- **潜在重叠**：1+4 与 3 可能同时碰 `playhouse.ts`（写后重建 vs 提示词构造）。两边各改各的区域，合并冲突按语义解。
- 合并顺序建议：6 → 2 → 3 → 1+4（文档与局部改动先进，最难的最后落，减少变基次数）。

## 任务简报（交给子代理的问题描述与边界）

- 2 → `/tmp/debt-briefs/2-tool-catalog-roles.md`
- 3 → `/tmp/debt-briefs/3-prompt-capabilities.md`
- 6 → `/tmp/debt-briefs/6-module-agents-md.md`

## 合并后统一处理（我来做，避免与 6 号抢同一个文件）

根 `AGENTS.md` 有三处因本轮改动失效。等 6 号把它拆成 `apps/server/AGENTS.md` 之后一次改到位：

1. 「`play.json` 结构校验…收在 `agentkit/playEnv.ts`」→ 校验已收口到 `PlayFiles.write`（债 1）。
2. 「`prompt.ts` 的 `LIBRARY_REF`，按 `canLibrary` 注入」→ 现为 `can.library`（债 3）。
3. 工具清单那段：`ROLE_INSTALLABLE` 已删，角色可见性是 `TOOL_CATALOG` 每项的 `roles`（债 2）。

## 未纳入本轮

- 5「工具报错文案实际上是 API」（`PlayFiles.pathOf` 抛中文串、测试用正则断言它）：用户明确本轮不做。

## 合并结果（2026-10-04 04:00）

四路按 6 → 2 → 3 → 1+4 合入 main。A×B 在 `apps/server/src/agentkit/kit.ts` 的 content conflict 由 B 在自己 worktree 内解开（保留 A 的 `roles`/`installableTools`/`agentToolEntry`/`roleTools` + B 的 `CAPABILITY_TOOLS`/`capabilitiesOf`），合并脚本本身没再报冲突。

| 路 | main 上的提交 | 备注 |
| --- | --- | --- |
| 6 | `ae96959` | 纯文档 |
| 2 | `e4d61c8` + `1b0f5d1` | 代码 + 文档 |
| 3 | `1050b52` | 基于 2，冲突已在 worktree 内解开 |
| 1+4 | `d358e58` + `6fcb565` | 本轮我自己负责的那条 |
| 后补 | `4105eac` | 按四路改动修正 `apps/server/AGENTS.md` 里失效的描述 |

**main 上的最终验证**：重建 `@stage-ai/core` 后，`apps/server` 与 `apps/web` 型检全干净；server 全量 **38 文件 / 496 用例全绿**（排除需真实外部 API 的 `e2e-live-*`）；工作树无未提交的已跟踪改动。

**用户验证**：用户选择「合并后在 main 上顺带看一眼」，四路各自的 `.validation.md` 保留原验收项，未单独安排实机确认。
