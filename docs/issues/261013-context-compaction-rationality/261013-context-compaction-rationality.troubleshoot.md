# 工坊与舞台上下文压缩合理性检视与修复

日期：2026-10-13

## 1. 检视范围

对 AIVN 的两条上下文压缩链路进行全链路合理性检视：
- **核心计量与切点层**：[`apps/server/src/compaction.ts`](../../../apps/server/src/compaction.ts)、[`apps/server/src/llm.ts`](../../../apps/server/src/llm.ts)
- **舞台（剧作家）纪元压缩与重放投影层**：[`apps/server/src/orchestrator.ts`](../../../apps/server/src/orchestrator.ts)、[`apps/server/src/rebuild.ts`](../../../apps/server/src/rebuild.ts)、[`packages/core/src/lineage/model.ts`](../../../packages/core/src/lineage/model.ts)
- **工坊（搭台助手）线程压缩与回注层**：[`apps/server/src/workshopSession.ts`](../../../apps/server/src/workshopSession.ts)、[`apps/server/src/workshop.ts`](../../../apps/server/src/workshop.ts)、[`apps/server/src/workshopThreads.ts`](../../../apps/server/src/workshopThreads.ts)、[`apps/server/src/playhouse.ts`](../../../apps/server/src/playhouse.ts)
- **前端展示与设置面**：[`apps/web/src/workshop/WorkshopPane.tsx`](../../../apps/web/src/workshop/WorkshopPane.tsx)、[`apps/web/src/workshop/useWorkshop.ts`](../../../apps/web/src/workshop/useWorkshop.ts)、[`apps/web/src/views/SettingsScreen.tsx`](../../../apps/web/src/views/SettingsScreen.tsx)

## 2. 合理性评估：架构设计合理之处

1. **真相源分离与同尺计量**：
   - 舞台与工坊共用同一套 CJK 加权计量（`estimateMessageTokens` / `localTextTokens` + provider `usage` 标定 `scale`）和同一套切点算法（`pickCompactionCut`，分别以「一拍」和「一轮」为最小不可拆单位，保证半拍/半轮不进保留段、连最后一拍/轮都超预算时至少保留最后一条）。
   - 产物落点按语义解耦：舞台压缩记录 `CompactionRecord` 随谱系快照跟分支走，由 `lineageToBeats` 投影生效（跳回压缩点之前的分支自动回退到未压缩原文，无需撤销逻辑；且不写 `memory/arcs` 文件污染剧目层）；工坊压缩记录 `ThreadCompaction` 落线程元数据，通过每轮重建的 A 区 `# 本会话已确定（早期对话已压缩）` 回注，且原消息文件 `<threadId>.json` 一条不删，前端在 `cutAt` 处渲染可折叠摘要分隔条。
2. **限制级（NSFW）通道保护**：
   - 舞台在 `nsfwActive` 期间跳过纪元压缩，避免将未收束的露骨原文写进跨分支持久化的纪元摘要；退出限制级时先由 `nsfwSummary` 折叠成日常过渡拍，再参与后续投影与纪元压缩。

## 3. 检视发现的不合理之处与缺陷（共 6 项）

### P1：`estimateMessageTokens` 对 `role: "system"` 消息错扣 `Math.ceil(prose.length / 4)`
- **位置**：[`apps/server/src/compaction.ts:81-87`](../../../apps/server/src/compaction.ts#L81-L87)
- **根因**：`pi-agent-core` 的 `estimateTokens(message)` 不含 `case "system"`，返回 `0`（代码也写了 `const base = message.role === "system" ? 0 : estimateTokens(message)`）。但紧接着执行 `base + localTextTokens(prose) - Math.ceil(prose.length / 4)`，对 `base = 0` 的 `system` 消息凭空减去了从未加进 `base` 的 `chars/4`。
- **后果**：舞台 `agent.state.messages[0]` 是 `system` 消息，其中的英文/DSL 标签被计为 **0 token**、中文被低估 **25%**（0.75 token/字）；有 provider `usage` 标定时分母 `localPrefix` 偏小导致 `scale` 偏高，进而虚增切点计算中每拍的 token 成本。
- **修复**：`if (message.role === "system") return localTextTokens(prose);`。

### P2：舞台 `carryOver` 硬截断 8000 token（`CARRY_OVER_TOKENS = 8000`），在写卡/改设定重建时抹掉 `【前情提要】` 与未压缩剧情
- **位置**：[`apps/server/src/orchestrator.ts:62-63, 767-781`](../../../apps/server/src/orchestrator.ts#L767-L781)
- **根因**：`carryOver` 是 `261006-compaction-projection` 之前（冷启动 B 区为空时代）遗留的接力裁剪。当前默认 `keepRecentTokens = 20000`（实机 `settings.json` 甚至设为 `80000`），而纪元压缩后的 `【前情提要】` 并入在保留段首拍 `messages[1]`。一旦发生剧作家写角色卡/记忆卡、资源库自动导角色、工坊改设定或设置页保存（均触发 `reloadAfterWorkshopWrite` / `reload` → `carryOver`），`carryOver` 从尾部只留 8000 token：
  1. 未达压缩线时（例如演了 15000 token），前 7000 token 原文在**不生成任何摘要**的情况下直接丢失；
  2. 已压缩过时（保留段 20000 token），位于头部的 `messages[1]`（含 `【前情提要】`）及前 12000 token 保留拍被直接切掉，新编排器彻底丢失纪元摘要。
- **修复**：删除 `CARRY_OVER_TOKENS = 8000` 硬截断，`carryOver` 完整接力当前纪元的对话消息（剥离 `system` 与 `NSFW_PRE_TURNS`，保留首拍 `【前情提要】`、当前纪元各拍及 `assistant` 上的 `usage` 标定数据）；上下文长度统一由轮边界的 `maybeCompactEpoch` 治理。

### P3：舞台 `maybeCompactEpoch` 生成摘要后未更新当前路径最近快照，`persist()` 空转且本轮判废重演会丢失摘要并重复请求
- **位置**：[`apps/server/src/orchestrator.ts:2017-2023`](../../../apps/server/src/orchestrator.ts#L2017-L2023)
- **根因**：`maybeCompactEpoch` 在开轮前更新了 `this.compaction`，但未写入 `this.opts.tree` 上最近一拍 `beat_end` 的谱系快照（快照原本只在拍末 `closeBeat` 写入）。
- **后果**：① 末尾调用的 `this.persist()` 保存的 `tree` 不含新 `compaction`；② 若本拍首跑判废触发 `rewindFailedBeat` → `rebuildBranchAt` → `restoreBranchState`，`this.compaction` 会被快照里的旧值覆写回 `null`，紧接着自动重演（`attempt = 1`）时再次触发一次多余的 LLM 摘要请求。
- **修复**：`maybeCompactEpoch` 生成 `this.compaction` 后，立即通过 `saveSnapshotAt` 更新 `latestSnapshotOnPath` 节点的快照，再执行 `persist()`。

### P4：舞台二次压缩（Multi-Epoch）时单条消息 2000 字截断会吞掉首拍玩家输入与拍末 `<stop>` 选项，且提示词未说明合并旧提要
- **位置**：[`apps/server/src/compaction.ts:27-40, 223-260`](../../../apps/server/src/compaction.ts#L27-L40)
- **根因**：二次压缩直接对投影后的 `beats` 切片重算，首拍 `user` 为 `【前情提要】（旧摘要）+ 【用户输入】（该拍输入）`。`renderMessage` 一刀切按 `TRANSCRIPT_CHARS_PER_MESSAGE = 2000` 只留头部（`clipHead`），旧摘要较长时会把旧摘要尾部的「未回收伏笔」及该拍真正的 `【用户输入】` 截掉；同时长拍剧本（`assistant`）只留头部会切掉拍末的关键转折与 `<stop>` 选项。
- **修复**：① `EPOCH_SUMMARY_SYSTEM` 增加合并既有 `【前情提要】` 的指令；② `renderMessage` 识别首条 `【前情提要】` 完整保留并单独截断其后的玩家输入；③ `truncate` 改为保留前 70% + 后 30%（头尾保留），兼顾开场与拍末停止点。

### P5：工坊上下文回灌与压缩转录丢弃了 `parts` 中的工具调用记录与多步正文
- **位置**：[`apps/server/src/workshop.ts:369-390, 527-577`](../../../apps/server/src/workshop.ts#L369-L390)
- **根因**：`WORKSHOP_DIGEST_SYSTEM` 要求列出「已落盘的文件（路径 + 改成了什么样）」与「已出图 / 已导入的素材连 id 一起记」，但 `historyToMessages` 只取 `m.text`，丢弃了 `m.parts` 中的全部工具调用（`write`/`edit`/`generate_image`/`import_asset` 等）及产出素材路径；且 `lastAssistant` 只取最后一个 step 的文本，丢掉了调工具前的方案说明。
- **修复**：① `lastAssistant` 汇总本轮所有新增 `assistant` 消息的正文；② 新增 `workshopMessageText`，将 `m.parts` 中的多步文本与工具调用简明注脚（剔除 `content`/`newText`/`oldText`/`prompt` 等大段正文参数，保留路径/id 与产出 `assets` 路径）合成为纯文本回灌，并同步用于 `pickThreadCutIndex` 计量。

### P6：工坊 `workshopContext` 设置保存后未就地生效，且摘要请求 `maxTokens` 上限偏小、未透传中止信号
- **位置**：[`apps/server/src/playhouse.ts:1382-1399`](../../../apps/server/src/playhouse.ts#L1382-L1399)、[`apps/server/src/workshopSession.ts:139-160, 523-550`](../../../apps/server/src/workshopSession.ts#L523-L550)、[`apps/server/src/llm.ts:13`](../../../apps/server/src/llm.ts#L13)
- **根因**：`reloadAfterWorkshopWrite` / `applySettings` 复用了 `old.workshop`，而 `WorkshopSession` 只读构造时的静态 `opts.compaction`，导致设置页修改 `workshopContext` 后不重启不生效；`completeText` 固定 `MAX_TOKENS = 2048`（含 `low` 思考），而工坊定稿上限 `DIGEST_MAX_CHARS = 6000`，超 2048 token 即因 `stopReason === "length"` 抛错导致压缩失败。
- **修复**：① `getRunConfig` 每轮动态返回最新 `this.config.workshopContext`，`maybeCompact` 优先取当轮最新配置并透传 `turnAbort.signal`；② `completeText` 支持 `maxTokens` 参数，纪元与工坊摘要统一放宽至 `SUMMARY_MAX_TOKENS = 4096`。
