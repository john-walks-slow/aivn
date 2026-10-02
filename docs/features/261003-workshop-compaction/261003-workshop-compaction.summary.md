# 工坊线程上下文压缩 · 交付小结

## 做了什么

给工坊 agent（搭台助手）补上上下文自动压缩——此前它每轮重建 Agent 并全量回灌线程历史，没有任何计量/截断/摘要，聊长了直接顶爆窗口报 400。

- 判定时机与演出侧纪元压缩一致：每轮开跑前。计量与切点复用 `compaction.ts` 的同一把尺子（provider 实测 usage 标定 scale，中文下 pi 的 chars/4 低估约 4 倍）。
- 产物落**线程**而不是 `memory/arcs`：工坊会话是搭台过程不是剧目事实，进 arcs 会污染剧作家每轮注入的 A 区。
- **消息文件一条不删**：只有前 `cutAt` 条移出 agent 上下文，用户眼前的历史保持完整，面板对话流中间多一条可点开的分隔。
- 摘要回注 A 区（工坊 A 区本就每轮重建，没有前缀缓存约束）；多轮是拿旧定稿**重写成一份完整文档**而不是叠加（`capDigest` 封顶 6000 字）。
- 工坊模型可以和剧作家不同，阈值另有一套 `STAGE_WORKSHOP_*` env（缺省逐项沿用全局），生效值再与模型自带窗口取 min。
- 摘要失败只告警不切不降级（压缩是优化不是正确性前提，与演出侧同一约定）。

## 文件

| 文件 | 变更 |
| --- | --- |
| `apps/server/src/compaction.ts` | 新增工坊侧纯函数（`estimateThreadTokens` / `pickThreadCutIndex` / `calibrateTokenScale` / `capDigest`）；`renderTranscript` 拆出可指定说话人标签的 `renderTranscriptAs` |
| `apps/server/src/workshop.ts` | `WORKSHOP_DIGEST_SYSTEM` + `summarizeThread()`；A 区加 digest 段；`runWorkshopTurn` 回传本轮标定的 scale |
| `apps/server/src/workshopThreads.ts` | `WorkshopThread` 加可选 `compaction` / `tokenScale`，新增 `ThreadCompaction` |
| `apps/server/src/workshopSession.ts` | 新增 `maybeCompact()`；`sendHistory` 下行带 compaction；`chat()` 的并发占位提前到入口 |
| `apps/server/src/config.ts` | `workshopContext` 三项 + 三条新 env + 启动交叉校验对两组各跑一遍 |
| `apps/server/src/playhouse.ts` | 装配工坊压缩参数（窗口取 min） |
| `packages/core/src/ws/protocol.ts` | `workshop_history` 带 `compaction`，新增 `WorkshopCompactionView` |
| `apps/web/src/workshop/*`、`app.css` | 对话流分隔线（默认折叠一句话摘要，点开看全文）+ 两条新样式 |
| 测试 | `compaction.test.ts` 6 条纯函数、`workshop.test.ts` 3 条端到端；`helpers.ts` 的假流支持回填 usage |

## 自验

- `pnpm -r typecheck`：本次改动涉及的文件全部干净。
- 受影响测试：`compaction` / `workshop` / `workshopPrompt` / `config` / `configApi` / `playhouse` / `http` 共 89 条通过。
- `orchestrator.test.ts` 有 2 条 `write_memory` 用例失败、`playhouse.ts` 两处类型错误（`characterName` / `PlayConfig`）——**不是本次改动**：那是仓库里另一个 agent 并发在做的角色记忆重构（roles frontmatter 化），涉及 `agentkit/memoryTool.ts`、`kit.ts`、`packages/core/src/play/config.ts`，与本需求无交集。

## 检视结论

`docs/features/261003-workshop-compaction/261003-workshop-compaction.review.md`：条件准入，无阻塞。两条建议已修——分隔摘要在窄屏下单行截断（ellipsis）、切换会话时收起摘要；一条非阻塞建议（写回 `tokenScale` 时同步内存对象）顺手做了。

## 遗留

- `STAGE_WORKSHOP_*` 是 env-only，没进设置面板（与 `beatTimeoutMs`、`STAGE_PASSWORD` 同例）。要进面板走 `configApi.ts` 的 `.env` 单一入口。
- 压缩后仍超窗口时不做硬截断兜底（单轮内容极大才会遇到），与演出侧一致。
- 拿不到 usage 的网关 scale 退回 1，中文下压缩偏晚——演出侧同一暴露面。