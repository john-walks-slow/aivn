# 实施记录：删出图审批 + 补剧作家补充要求

对应计划：[261010-workshop-config.plan.md](261010-workshop-config.plan.md)

## 需求裁决（2026-10-10）

- 「出图审批」(`ask` / `auto`) 整块删掉。它只是提示词约束，却让搭台助手在出图决策点上畏手畏脚；产品判断是模型自己能拿捏尺度，宁可少也不要多。
- 受它控制的提示词精简：只讲情况（花钱、立绘一张 100 秒起、看不到中间过程）与惯例（先列一张图单跟用户对一下），不写门禁式硬命令。
- 补一处缺口：剧作家也有逐剧目补充要求（原来只有搭台助手有）。

## 改动

| 文件 | 改了什么 |
| --- | --- |
| `packages/core/src/play/config.ts` | 删 `AgentSettings.imageApproval`、`IMAGE_APPROVALS`、`ImageApproval` 与归一化分支；`prompt` 改成两个角色都保留 |
| `apps/server/src/workshop.ts` | `WorkshopPromptContext` 删 `imageApproval`；`setupFlow` / `imageGuide` 去掉审批分叉，改成情况与惯例陈述 |
| `apps/server/src/workshopSession.ts` | 不再传 `imageApproval` |
| `apps/server/src/prompt.ts` | `PromptContext` 加 `customPrompt`，新增 `customSection()` 注入在 A 区、紧挨 `# 演出契约` 之前 |
| `apps/server/src/orchestrator.ts` | `buildAgent` 传 `customPrompt: opts.play.agents?.playwriter?.prompt`；`opts.agents` 注释同步 |
| `apps/web/src/workshop/AgentPane.tsx` | 删审批下拉；补充要求改成两张卡都渲染，各自 placeholder |
| `apps/server/skills/galgame-play-setup/SKILL.md`、`galgame-visual-craft/SKILL.md` | 同一套口径：出图清单照旧，去掉「拿到批准 / 点头之后再出」 |
| `README.md`、`apps/server/AGENTS.md`、`apps/web/AGENTS.md` | 字段表与模块约定同步 |

旧 `play.json` 里残留的 `imageApproval` 由 `parseAgentConfig` 静默丢弃，不需要迁移。

## 验证

- `pnpm typecheck` 全绿；`pnpm -r build` 全绿。
- `pnpm check:agent-contract` 9 项全绿。
- 受影响用例：core `config`（16）、server `prompt`（40）、server `workshop -t "工坊 prompt"`（11 passed / 38 skipped）、web `agentModelOptions`（2）全绿。
- 实机（dev 实例，`#/play/320000` → 工坊 → Agent）：下拉从 7 个降到 6 个（剧作家 4 + 搭台 2），两张卡各有「补充要求」，审批控件消失。
- 检视报告：[261010-workshop-config.review.md](261010-workshop-config.review.md)（条件准入；唯一阻塞项「`galgame-visual-craft` 里残留门禁原文」已修）。

## 遗留

- **跨线重建**：这次动了 `packages/core`，兄弟仓 `dsh-aivn` 的 `lib/` 里打包的是旧 core。`node build.mjs --check` 已报 `lib/index.js 不一致`，需要在那边 `npm run build` 后一并提交（本次未动兄弟仓——它当时有另一个 agent 的未提交改动）。DSH 线不读 `agents.playwriter.prompt`，功能上不受影响。
- `dsh-aivn` 的 `npm run typecheck` 另有一处**与本次无关**的既有漂移：`src/tools/cut.ts` 没返回 core 新加的 `CutoutResult.figureTop`（来自 261010 的抠图归一化改动）。
- `playhouse.reload()` 不 `await whenIdle()`，演出中从 Agent 页保存会重建 runtime——属既有行为，本次未改；README 里「不腰斩演出」这句话在这条链上没有代码保证。

## 追加：出图并发提示（同日）

只要模型肯在一条消息里发多个 `generate_image`，pi 就会并行执行（`toolExecution` 默认 `parallel`），闸门是宿主的 `Limiter`（并发 `image.concurrency`，按剧目一个，工坊与剧作家共用）。问题在于工坊完全不知道这件事，提示词里那句还是收敛语气。

- `generate_image` 的描述加一条（`hostNote()`，现读 `deps.imageConcurrency`）：一批一起发就并发跑、这个部署同时最多几张、排队区最多几张、超出的部分直接失败要分批。
- 排队上限 `DEFAULT_MAX_QUEUE` 12 → 30；`DEFAULT_IMAGE_CONCURRENCY = 6` 提到 `config.ts` 顶部一处定义（原先 `freshSettings` 与 env 回落各写一个 6）。
- 工坊出图章节：改成「这一批要出的图在一条消息里一次全发出去」；定妆照那条改成「同一批发 3 条」。
- 值经 `playhouse → orchestrator / workshopSession → createAgentKit → imageTool` 现读注入。

验证：`pnpm -r build` 全绿；`pnpm check:agent-contract` 9/9；受影响用例 config（25）、agentkit（26，含新增「描述现读并发上限」）、limiter（8）、playhouse `-t 骨架兜底上界`（1）、workshop `-t 工坊 prompt`（11）全绿。`imagePendingTtlMs` 随队列变大：540s → 1080s（测试与 README 同步）。

已知未接线：`Limiter` 的优先级（预发射 high 插工坊 normal 的队）当前所有调用都传 `"normal"`，注释里那句尚未兑现——本次只记录，未改。
