# 限制级（NSFW）内容隔离计划

日期：2026-10-04 · 状态：已实施（`4c1d71b`）· 基线：main（`177dd76`，已含 memory-state 5 项）

## 1. 目标

限制级内容对 SFW 侧**只有那段带出的 SFW 摘要可见**，露骨原文只存在于 NSFW 通道。

「SFW 侧」指三处读者：

- 剧作家 SFW 模型的上下文（每轮 A 区 + 对话体）；
- 从谱系重建上下文的路径（分支跳转、改一行、将来的重启恢复）；
- 记忆层（archive 切片检索、epoch 压缩产出的 arc）。

不进这条线的是**前台演出**：舞台事件、回看、路线卡片照旧完整，玩家自己看过的内容不删——需求约束的是模型能看到什么，不是玩家能看到什么。

## 2. 现状：四处泄漏

### 2.1 退出时的净化只活在内存里（最直接的一处）

`switchBackToSfw` 把净化后的上下文重建为 `sfwBaselineMessages + 两轮过渡`（`orchestrator.ts:1894-1916`），那两轮过渡**没有进谱系树**。而任何从树重建上下文的路径都会把原文捞回来：

- `rebuildBranchAt` → `renderBeats(lineageToBeats(chain))`（`:1283`）：整条链的 `say`/`narrate` 原文照渲。锚点快照说 `nsfw: false`（段后），于是原文直接进 SFW 模型，而带摘要的过渡轮不在树上、捞不回来——**既泄漏又丢摘要**。
- `editLine` → `renderBeats(this.opts.tree.materialize())`（`:1166`）：同一路径。

`rebuild.ts` 的 `lineageToBeats` 对 nsfw 一无所知（`:48-105`，`say`/`thought`/`narrate` 无条件取 `event.text`）。

### 2.2 archive 逐轮切片是原文

`closeBeat` 每轮把 `beatLines.join("\n")` 切一片进 archive（`:1846-1858`）。限制级轮次的露骨台词原样入档，之后 `search_archive` 搜到就贴进上下文。

### 2.3 谱系事件原文无标

`appendLineage` 不区分模式，`say`/`narrate`/`thought` 的 `text` 恒为原文。今天只影响上面的重建路径与将来的恢复源（方向 §7）。

### 2.4 段落中途压缩会把原文永久化

`maybeCompactEpoch`（`:1659`）只看对话体大小，不看 `nsfwActive`。段落中途触发压缩，`summarizeEpoch` 直接吃露骨原文，产出的 arc 落进 `memory/arcs/`，此后每个纪元的 A 区记忆索引都带着它——`visibleCards` 只按分支（`arcIds`）过滤，不看模式。这是唯一会把泄漏**写进长期记忆**的一条。

### 2.5 已确认的相邻事实

- 退出时的对话体净化**对当前实例是有效的**：主模型只看得到摘要。
- 摘要由**独立的一次 LLM 调用**生成（`generateSfwSummary`，专用 `SFW_SUMMARY_SYSTEM` 提示词 + 段落期间攒下的 `nsfwLines`）。`exit_nsfw(summary=…)` 那个参数只是可选参考：无台词记录时才直接当摘要用。
- 冷启动（重启后首次装配）`seed` 为空 → 对话体从零，不构成泄漏（近期记忆丢失是方向 §7 的事）。
- `generateSfwSummary` 有兜底：调用失败也返回一句摘要，所以「摘要在树上一定有落点」这条可以当不变式用。

## 3. 设计

### 3.1 不变式

限制级段落结束时，**摘要必须落进谱系树**；此后任何按 SFW 模式渲染或检索的读者，看到的都只有摘要。

### 3.2 摘要的落点

段末那一拍的 `beat_end` 事件 payload 上带 `nsfwSummary: string`；限制级期间产生的每个事件 payload 带 `nsfw: true`。

选 `beat_end` 而不是新增事件类型：`LineagePayload` 有索引签名（`model.ts:38`），加两个可选字段不动 `LineageEventKind` 联合，客户端、JSONL、`toNodeView` 一行不用改。段落的边界也就有了——从第一个带 `nsfw` 标的节点，到带 `nsfwSummary` 的那个 `beat_end`。

### 3.3 摘要生成时机：beat_done 等它

**摘要的生成方式不变**（仍是那一次专门的 LLM 调用），改的是时序：`closeBeat` 在落 `beat_end` 之前**等摘要生成完**，把结果同时用在两处——写进 `beat_end` payload，以及重建净化后的对话体。

这样段落结束时摘要必然存在，不需要占位、不需要回填、不需要第二次写盘。代价是退出那一拍多等一次 LLM 调用（几秒），玩家看到的是转场略长；位置在亲密戏收尾，本身也合节奏。

`closeBeat` 因此变异步，`finishBeat` 等它——`beat_settled` 在摘要落地之后才发。现成的 `pendingSfwSwitch` 与 `isIdle()`（`:708`）可以收编或简化，不再需要「结算已发、切换还在飞」这个中间态。

### 3.4 渲染：按模式折叠

`lineageToBeats` 增加渲染模式入参：

- **SFW 模式**：整段限制级折叠成一条 `（前情提要）<摘要>`，中间的原文台词与玩家输入都不进消息；折叠后按原有规则归入它所属的拍。
- **NSFW 模式**：原文照渲，`nsfwSummary` 不使用（避免同一段既出原文又出摘要）。

调用点两处：`rebuildBeats`（`:1402`）与 `editLine`，模式取 `this.nsfwActive`（分支跳转到段内时快照恢复为 true，天然正确）。

### 3.5 检索：SFW 只看得到摘要

- `ArchiveSlice` 加 `nsfw?: boolean`；限制级期间每轮的切片打标。
- 段落结束时**另写一条** `nsfw: false` 的切片，内容就是那句摘要，`entryId` = 段末叶节点。
- `searchArchive` 增加模式参数：SFW 模式跳过 `nsfw` 切片、保留摘要切片；NSFW 模式两者都返回。

于是 SFW 检索搜得到那一段、看到的是含蓄摘要（不断片），而不是「存在但不可读」。

### 3.6 压缩：段落期间不压

`maybeCompactEpoch` 在 `nsfwActive` 时早退，段落内不压缩。

两条理由：中途压缩时摘要还不存在（段没结束），压缩必然吃原文；而退出后上下文本来就会重建为净化版、体积回退，不差这一下。

由此 **arc 天然干净**——压缩器永远看不到露骨原文（要么段没结束不压，要么退出后上下文已净化）。所以原 §8 设想的那套「arc 打标记 + `visibleCards` 按模式过滤」不需要做，`memory/arcs`、A 区注入、`visibleCards` 一行不改。

## 4. 改动清单

| 文件 | 改动 |
| --- | --- |
| `packages/core/src/lineage/model.ts` | `LineagePayload` 加可选 `nsfw?: boolean`、`nsfwSummary?: string` |
| `apps/server/src/orchestrator.ts` | `appendLineage` 在 `nsfwActive` 时给 payload 打 `nsfw`；`closeBeat` 变异步并等摘要、写进 `beat_end` payload；`switchBackToSfw` 改为返回摘要（一次生成、两处使用）；段落结束写摘要切片并给段内切片打标；`maybeCompactEpoch` 在 `nsfwActive` 时早退；`rebuildBeats` 收模式入参；二处调用点传 `this.nsfwActive` |
| `apps/server/src/rebuild.ts` | `lineageToBeats` 收模式入参，SFW 模式折叠限制级段 |
| `apps/server/src/memory.ts` | `ArchiveSlice.nsfw`；`appendArchive` 透传；`searchArchive` 按模式过滤 |
| `apps/server/src/agentkit/memoryTool.ts` | `search_archive` 把 `deps.isNsfw()` 传进去 |
| `apps/server/AGENTS.md` | 「限制级（NSFW）通道」章节补：摘要在树上的落点、beat 等待、压缩早退、检索过滤 |

## 5. 边界与不做的事

- **不改摘要生成方式**：仍是专用 LLM 调用 + `nsfwLines`，`exit_nsfw` 的 `summary` 参数地位不变（参考/兜底）。
- **不做老档迁移**：老档的限制级事件没有标记，SFW 重建时原文照渲（等于维持现状），不会更糟。
- **不删前台内容**：舞台事件、回看、路线卡片、`lineage.jsonl` 的原文一律保留。
- **不动 §7 的恢复源**：本次只保证 `lineageToBeats` 有正确的渲染规则；等「从谱系重建上下文」真做时，它天然吃到这条规则，届时不要再在恢复侧另写一套过滤。
- **不碰 A 区**：arcs、`visibleCards`、记忆索引无改动。

## 6. 测试

| 层 | 用例 |
| --- | --- |
| `rebuild` 单测 | SFW 模式：限制级段折叠成一条摘要，原文与段内玩家输入都不出现；NSFW 模式：原文照渲、摘要不出现；段外内容两种模式一致；无标记的老档不受影响 |
| `orchestrator` | 退出那一拍的 `beat_end` payload 带 `nsfwSummary`；`beat_settled` 在摘要生成之后才发；`nsfwActive` 期间压缩不触发；段内每一轮的事件都带 `nsfw` 标 |
| `orchestrator` 分支 | 跳转到段内（快照 `nsfw: true`）→ 原文照渲；跳转到段后（`nsfw: false`）→ 只剩摘要 |
| `memory` | SFW 模式检索跳过 `nsfw` 切片、命中摘要切片；NSFW 模式两者都返回 |
| 回归 | 摘要生成失败走兜底句，`beat_end` 仍有 `nsfwSummary`，织下来的链路不空 |

## 7. 风险

- **`closeBeat` 变异步**：收束时序是本文件里最敏感的一段（判废回滚、`beat_settled` 只发一次、`beatPending` 占位）。要先确认所有调用者对「这一拍何时真的完了」的假设，不能出现「结算发了但摘要没落树」的缝。
- **退出等待期间玩家行为**：多等一次 LLM 调用意味着 `busy` 持续更久，玩家的输入要照旧排队（现有队列机制），不能因为等待而丢输入或误判空闲。
- **与 memory-state 分支的重叠**：两边都改 `orchestrator.ts`、`memory.ts`、`memoryTool.ts`（函数不重叠）。实施时按「memory-state 合入后再开 NSFW」的顺序走，避免同文件冲突；**计划文档本身也应随 NSFW 分支一起进主干**。
