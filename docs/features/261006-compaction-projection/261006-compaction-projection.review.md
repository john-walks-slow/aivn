# 检视报告

## 概要

检视范围：`feat/compaction-projection` 分支在 worktree 中的全部未提交改动（包括 core 谱系快照模型变更、rebuild 纯函数投影、compaction 计量与整形、orchestrator 运行时改造、memory 与 prompt 简化、以及相关单元测试与文档）。
整体评价：**架构清晰且实现扎实**。重构精准对齐了「长会话压缩回归树上状态与投影」的 canonical 设计，彻底消除了旧实现因记忆卡外挂（`memory/arcs/*.md` + `arcIds`）导致的跨分支状态泄露、冷启动失忆与手动维护撤销逻辑等架构隐患；同时补齐了 CJK token 保守加权计量缺陷。全流程无阻塞缺陷，达到了高可用与高维护性标准。

## 需求对齐

本变更完全满足并严格兑现了 `261006-compaction-projection.plan.md` 的既定需求与取舍：
1. **状态模型转换**：`MemorySnapshot` 去掉 `arcs: string[]`，引入 `compaction?: CompactionRecord`（包含 `summary`、`cutNodeId`、`tokensBefore`），不新增事件类型，保持 `lineage.jsonl` 与节点协议兼容。
2. **纯函数投影重放**：在 `rebuild.ts` 的 `lineageToBeats` 实现了以 `cutNodeId` 为边界的切片与前情提要合并（`compactionSeedBeat` 并进保留段首条 user），并为 `RebuiltBeat` 提供了 `boundaryId`；切点不在当前分支时自然回退至原文，使跳转/分岔/编辑/读档具有幂等的单一路经。
3. **冷启动与重放闭环**：`PlaywrightOrchestrator` 构造函数由原本的空对话体改为从树投影重放（`renderBeats(rebuildBeats(materialize()).beats)`），老档或重演后均可正确持有上下文。
4. **计量修正**：在 `compaction.ts` 中通过 `estimateMessageTokens` 与 `localTextTokens` 对正文与思考引入 CJK 字符加权，避免无 usage（冷启动/从树重放）时退回 pi 的 `chars/4` 导致的 2.4–4 倍低估，有效防止长周目超窗。
5. **废弃资产清理与文档同步**：彻底废弃了 `memory/arcs/` 的文件写入与 `PlayMemory` 中的 arcs 读取及过滤；`README.md`、`apps/server/AGENTS.md`、`apps/web/AGENTS.md` 均完成同步更新。

## 阻塞问题

无。

## 建议修改

| ID | 位置 | 问题 | 建议 |
| --- | ---- | ---- | ---- |
| S1 | `apps/server/src/rebuild.ts:129` | 边界初始值语义在保留段前有悬空事件时存在隐性歧义：当 `cutAt >= 0` 时，`let boundaryId = compaction!.cutNodeId`。如果切点之后紧跟的若干事件不是常规开拍节点（例如紧随其后的若干事件被跳过或首拍前有未处理事件），第一拍虽然正确获得了 `cutNodeId`，但若第一段是空拍或直接触发了某些边界刷新，`boundaryId` 的语义继承链可能不直观。 | 当前实现 `cutAt` 后的第一拍会直接拿到 `cutNodeId` 作为前驱边界，逻辑是正确的。建议在该变量声明处增加简要注释，说明保留段首拍前置边界恒为切点节点自身。 |
| S2 | `apps/server/src/orchestrator.ts:1920` | `this.compaction` 在内存中被更新并重建 `buildAgent` 后，其持久化依赖于当次 `this.persist()`（写 session.json）以及后续每轮收束时的 `closeBeat`（写 LineageTree 快照）。如果在「压缩成功后、下一拍 `closeBeat` 之前」服务进程异常终止，虽然 `session.json` 持久化了会话元数据，但树上该轮节点的快照尚未打入 `compaction`，重启后将退回压缩前的原文。 | 计划文档 §3.2 中已将此作为权衡（崩溃丢失本条记录、下次开轮重新计算，优于产生孤儿卡）。建议在 `orchestrator.ts` 的 `maybeCompactEpoch` 提交注释中明确记录该设计取舍，提醒后续维护者无需在此额外增加侵入性快照刷盘。 |

## 非阻塞问题

| ID | 位置 | 问题 | 建议 |
| --- | ---- | ---- | ---- |
| N1 | `apps/server/src/compaction.ts:246-274` | `localTextTokens` 中的 CJK 字符码点判定覆盖了常用的中日韩表意区与假名/全角符号，但对于 Unicode CJK 扩展区（如 Ext-B 及以上）未纳入检测（会回退到 `chars/4`）。 | 视觉小说绝大多数常用字符与标点均在已覆盖范围内，极端罕见字回退至 chars/4 不影响整体计量量级；未来若有生僻古籍/冷门汉字需求可再扩展码点范围。 |
| N2 | `apps/server/src/rebuild.ts:215` | `if (first) first.user = `${seed.user}\n\n${first.user}`;` 直接修改了 `beats[0]` 的属性。由于 `beats` 是当次函数局部生成的对象数组，并不会污染外部，但相较于纯函数不可变更新风格存在就地修改。 | 无副作用，仅为编码风格备忘，保持现状即可。 |

## 准入结论

**结论**：`准入`

**说明**：核心设计严谨自洽，完美践行了「投影替代突变」的架构演进，删除了大量复杂的条件分支与废弃工具参数，同时修复了关键的 token 计量与冷启动失忆缺陷。测试覆盖完备，代码质量极高，符合直接合并入主干标准。

---

# 第二轮检视报告（残渣清理、快照拍扁与切点合一）

## 概要

检视范围：第一轮准入后的三批增量重构与优化（HEAD `235510af`），包括：
1. **tidy 残渣清理**：`visibleCards()` 移除、`visibleContext()` 路径类型收窄、`bodyFromTree()` 投影抽取与未用类型/过期注释清理；
2. **谱系快照拍扁与接口收束**（`packages/core/src/lineage/model.ts`）：废除 `MemorySnapshot` 中间层，`LineageSnapshot` 拍平为四要素并列，新增 `SnapshotFacts` 统一保存入口；
3. **切点原语合一**（`apps/server/src/compaction.ts`）：抽象 `pickCompactionCut`，统一演出侧（按拍）与工坊侧（按轮）的保留切点计算与超窗底线策略。

整体评价：**重构极具工程品味，代码清爽度与架构正交性显著提升**。不仅彻底清理了第一轮演化遗留的过渡层，还将两侧的切点逻辑成功收束为零副作用的纯函数模型；快照模型的拍扁剥离了名不副实的「Memory」概念外壳，让谱系树状态真实还原为各维度的分支事实集合。改动完整通过全部构建与受影响套件测试，架构债务归零。

## 需求对齐

三批改动严格落实了既定重构目标与规范要求：
1. **残渣清理彻底**：
   - `PlayMemory.visibleCards()` 完全删除，无多余间接层；
   - `visibleContext()` 中 `path` 明确为 `string`，提示词（`prompt.ts`）与注释同步更新为「每行带路径」，与底层能力强契合；
   - `orchestrator.ts` 提炼 `bodyFromTree()` 并在构造函数、`maybeCompactEpoch`、`switchBackToSfw` 处统一复用，彻底消除了重放时漏调投影导致的潜在回归风险；
   - 过期注释与未使用 import 彻底清理。
2. **谱系快照模型重构**：
   - 彻底移除了 `MemorySnapshot`，将 `engine`、`stateFiles`、`compaction`、`nsfw` 四项并列平铺入 `LineageSnapshot`，消除伪层次，语义清晰；
   - 引入 `SnapshotFacts`，将 `saveSnapshot` 与 `saveSnapshotAt` 参数合并为对象传参，私有复用 `putSnapshot`，避免多位置参数带来的调用错位隐患；
   - `orchestrator.ts` 中构造恢复、`stateAt` 读取与 `closeBeat` 落盘全链路一致对齐，无需兼容负担，设计直接到位。
3. **切点原语统一**：
   - `compaction.ts` 抽离出纯函数 `pickCompactionCut(unitTokens, keepRecentTokens)`，演出侧（按拍 token 映射）与工坊侧（按轮消息 token 映射）共同复用；
   - 统一了临界安全策略：单条单元超出预算时至少保留末尾一条（`length - 1`），坚决阻断因放弃压缩导致请求撞击上下文硬上限的风险；
   - 针对演出侧与工坊侧的不同持久化真相源（谱系快照 vs 线程元数据）保持各自独立的存取与摘要整形逻辑，避免了过度合并带来的耦合。

## 阻塞问题

无。

## 建议修改

无。

## 非阻塞问题

| ID | 位置 | 问题 | 建议 |
| --- | ---- | ---- | ---- |
| N3 | `apps/server/src/compaction.ts:343` | `unit.tokens += turnTokens(turn) * scale;` 中 `turnTokens` 计算的是未格式化文本，而工坊实际装配每轮历史时可能包含角色标签（如 `【用户】` / `【搭台助手】`）。目前直接累加单轮正文，估算相较真实完整消息略有细微偏差（每轮相差几个字符量级）。 | 属于极微小的保守估算偏差，工坊本身已有 `scale` 标定机制，且切点以轮为单位，个位数 token 差异不影响轮次截断决策，保持现状即可。 |

## 准入结论

**结论**：`准入`

**说明**：本次重构在保持业务逻辑高度健壮的同时，干净利落地完成了概念拍扁、残渣清理与通用算法归一。所有模块边界清晰、代码结构优雅，可放心并入主分支。

