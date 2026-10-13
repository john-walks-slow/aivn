# 工坊与舞台上下文压缩合理性检视与修复 · 交付小结

## 背景与评估

围绕工坊（Workshop）和舞台（Stage）两条上下文压缩链路开展了全链路合理性检视与真机端到端测试：
- **架构合理之处**：两侧共用同一把 CJK 加权计量尺子（`estimateMessageTokens` / `localTextTokens` + provider `usage` 标定 `scale`）和同一套单位切点算法（`pickCompactionCut`），产物按真相源分离（舞台随谱系快照由 `lineageToBeats` 投影、跳回切点前自动还原原文；工坊落线程元数据回注 A 区、原消息一条不删），且限制级通道（`nsfwActive`）期间跳过纪元压缩。
- **检视发现并修复的 6 项不合理/缺陷**：
  1. `estimateMessageTokens` 对 `role: "system"` 消息错扣 `Math.ceil(prose.length / 4)`（[`compaction.ts`](../../../apps/server/src/compaction.ts)）。
  2. 舞台 `carryOver` 硬截断 8000 token（`CARRY_OVER_TOKENS = 8000`），在写卡/改设定触发轮边界重建时切掉首拍 `【前情提要】` 与未压缩剧情（[`orchestrator.ts`](../../../apps/server/src/orchestrator.ts)）。
  3. 舞台 `maybeCompactEpoch` 生成摘要后未同步写入当前路径最近 `beat_end` 的谱系快照，导致 `persist()` 空转且本拍判废重演时丢失摘要并二次请求（[`orchestrator.ts`](../../../apps/server/src/orchestrator.ts)）。
  4. 舞台二次压缩时单条消息 2000 字截断只留头部，吞掉拍末 `<stop>` 选项或与旧前情提要并入的首拍输入；改为共享固定首尾标记 `COMPACTION_SEED_HEADER` / `COMPACTION_SEED_FOOTER` 精确切分，超长消息按前 70% + 后 30%（换行对齐）头尾保留（[`compaction.ts`](../../../apps/server/src/compaction.ts)、[`rebuild.ts`](../../../apps/server/src/rebuild.ts)）。
  5. 工坊上下文回灌与摘要转录原先只取最后一步的 `m.text`，丢弃了调工具前的方案陈述及 `m.parts` 中的工具调用记录（写盘路径、出图草稿路径）；新增 `workshopMessageText` 与多步 `lastAssistant` 汇总（[`workshop.ts`](../../../apps/server/src/workshop.ts)）。
  6. 工坊 `workshopContext` 设置保存后因复用 `old.workshop` 未动态读取而无法热生效，且长会话摘要单发 `maxTokens` 偏小；改为每轮从 `getRunConfig` 动态读取 `workshopContext`、透传 `turnAbort.signal`，并将摘要 `maxTokens` 放宽至 `SUMMARY_MAX_TOKENS = 4096`（[`playhouse.ts`](../../../apps/server/src/playhouse.ts)、[`workshopSession.ts`](../../../apps/server/src/workshopSession.ts)、[`llm.ts`](../../../apps/server/src/llm.ts)）。

## 交付文档

- 根因与合理性排查：[261013-context-compaction-rationality.troubleshoot.md](261013-context-compaction-rationality.troubleshoot.md)
- 代码检视报告（结论：**准入**，0 阻塞）：[261013-context-compaction-rationality.review.md](261013-context-compaction-rationality.review.md)
- 端到端测试报告（含 9 张实拍截图）：[261013-context-compaction-rationality-e2e-report.md](e2e/261013-context-compaction-rationality/261013-context-compaction-rationality-e2e-report.md)
