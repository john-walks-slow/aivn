# 纪元压缩：从「记忆卡 + 可见性过滤」改成「树上的压缩记录 + 重放投影」

## 背景

旧设计把纪元压缩的产物做成一等文件：`memory/arcs/<id>.md` 摘要卡 + A 区索引一行 + `MemorySnapshot.arcs` 的 arcIds 可见性过滤 + 重建对话体时用 `withSeed` 把摘要并进保留段首条消息。

问题出在「压缩是一次就地突变，而分支是常态」：压缩后任何一次重放（跳转 / 分岔 / 编辑 / 退出限制级 / 读档冷启动）都会把摘要摊回原文，得靠下一拍再压一次收回来；`arcs` 卡的内容是剧目级文件、可见性却是分支级引用，两套账要一直对齐；而读档冷启动时构造函数里的对话体是空的（`buildRuntime` 不传 carryOver），等于读档续演从零开始。

调研（`261006-branching-context-compaction.research.md`）结论：带分支的系统一边倒把压缩做成**日志里的一等记录**，messages 只是它的投影（pi 的 `CompactionEntry` + `buildContextEntries`）。本仓已有同形先例：`beat_end.payload.nsfwSummary` + `lineageToBeats` 按读者折叠。

## 做法

- **压缩记录是分支状态**：`CompactionRecord { summary, cutNodeId, tokensBefore }` 存在 `MemorySnapshot.compaction` 里，随谱系快照跟分支走（不新增事件类型、不动客户端协议）。
- **对话体是投影**：`rebuild.ts` 的 `lineageToBeats` 按记录切片——切点（链上的一个 `beat_end`）之前折成一条前情提要并进保留段首拍；切点不在当前链上就照渲原文。跳转/分岔/编辑/读档/退出限制级因此读到的都是同一个结果，**压缩不需要任何撤销逻辑**。
- **二次压缩就是对投影再压一次**：`maybeCompactEpoch` 在投影后的拍列表上按 token 从尾保留定切点（`RebuiltBeat.boundaryId` 就是该拍的前驱 `beat_end`），不拿旧摘要当底稿改写。
- **冷启动补上对话体**：构造函数在没有 carryOver 时从树投影重建（同时修掉 C3「读档 B 区为空」）。
- **计量修正**：`measureContext` 在没有 provider usage 可标定时按 CJK 加权给保守下限（原先退回 pi 的 chars/4，中文低估 2.4–4 倍，压缩永远够不到阈值）；工坊侧的 `estimateThreadTokens` / `calibrateTokenScale` 换用同一把尺子。
- `memory/arcs/` 不再写、不再读、不做迁移（旧文件留着，删掉无影响）；`PlayMemory` 的 arcs 链路、`prompt.ts` 的 `arcIds`、agentkit 的 `arcIds` 依赖、`PlayFiles` 的 `memory/arcs/` 守卫、记忆页的 arcs 过滤一并删除。

## 与计划的两点决策（用户已同意）

- **决策 A**：不保留「按模型需要读回旧纪元摘要」的能力——A 区索引只剩用户设定卡，摘要只活在对话体里。
- **决策 B**：压缩记录存 `MemorySnapshot`，不新增事件类型、不动客户端。

## 实施中与计划的三处偏差

1. `splitSummary` / `EpochSummary` 保留原样（工坊线程的摘要面板要用「一行标题 + 正文」），演出侧另加 `compactionText(raw)` 把模型输出合成一份单段文本——计划里写的「splitSummary 简化为单段文本」会连带改工坊，不值。
2. 限制级折叠段里把 `boundaryId` 推进到**段末那一拍**：否则后续拍的切点会落回段前，按那个切点切片会把整段（连同 `nsfwSummary` 事件）切掉，过渡轮凭空消失。
3. 冷启动把 A 区（system）也算进 `measureContext`：没有 usage 时它是上下文的大头，不算进去会让读档后的第一次判定偏乐观。

## 检视后的清理（tidy）

检视结论为准入后做了一轮残渣清理：删掉 `visibleCards()` 这层只服务于 arcIds 过滤的间接、`parseCard` / `compactionSeedBeat` 收回为模块内私有、记忆索引行的 `path` 类型从 `string | null` 收紧成 `string`（不再有只读卡）、`prompt.ts` 里「带路径的行」的措辞改成每行都带路径、orchestrator 抽出 `bodyFromTree()` 收掉四处重复的投影调用、清掉几处过期注释与 `orchestrator.ts` 里该文件早已不用的类型导入（`--noUnusedLocals` 扫出来的）。清理后再跑：`pnpm -r build` 全绿，受影响用例 224 passed。

两处需要规划的残留（`MemorySnapshot` 的命名、工坊与演出两套压缩机制）记在 `docs/freeform/261006-epoch-compaction-residue.smell.md`，未动手。

## 验证

- `pnpm -r build`、`pnpm typecheck` 全绿。
- 受影响用例：`apps/server` 8 个文件 224 passed（`compaction` / `lineage-ops` / `memory` / `playEnv` / `playFiles` / `prompt` / `agentkit` / `orchestrator`），`packages/core` 的 `lineage.test.ts` 38 passed。
- 检视报告：`261006-compaction-projection.review.md`，结论**准入**（无阻塞；两条建议都是补注释，已照改）。
- 与本次改动无关的既存失败（在 main 的 `152a6961` 上同样失败，未处理）：`apps/server/test/voice.test.ts` 4 条 audio_ready 计数用例；`apps/server/test/workshop.test.ts` 的「read_lineage 分页」（同一提交给谱系树加了哨兵根节点 `root`，而 `describe()` 会把它列进 `read_lineage`，测试 offset 错位一位；主工作区的 `packages/core/dist` 是陈旧构建，那边跑会掩盖它）。

## 检视后的第二处重构（按「无需兼容、走最干净设计」）

两处残留味道都被要求「按最优雅的设计」真做掉了（原 smell 记录随之删除）：

1. **`MemorySnapshot` 这层壳没了**。谱系快照改成扁平结构：`LineageSnapshot { engine, stateFiles, compaction, nsfw }` 四件事并列——它们都是分支事实，谁也不是谁的一层；`MemorySnapshot` 整个类型删除，字段名 `state` → `stateFiles`（与 orchestrator 的字段同名），`nsfw` 从可选变必填。`saveSnapshot(engine, memory)` 的两个位置参数收成一个 `SnapshotFacts` 对象（身份 id/nodeId/turn/createdAt 由树补），两个入口（`saveSnapshot` / `saveSnapshotAt`）共用私有 `putSnapshot`。不做存档字段迁移（用户明确无需兼容）。
2. **两侧的压缩切点合成一个原语**。`compaction.ts` 新增 `pickCompactionCut(unitTokens, keepRecentTokens)`：单位由调用方给（演出侧 = 一拍，工坊侧 = 一轮），切点只落单位边界，`null` = 无可压段。演出侧 `maybeCompactEpoch` 里那段手写循环删掉，工坊的 `pickThreadCutIndex` 改成「把消息切成轮 → 调它 → 映回消息下标」，原先的「向后顺延 / 退回轮首」那套 snap 逻辑随单位粒度一起消失。顺带统一了一个边界行为：**连最后一条单位都超预算时至少留它**（原先演出侧会直接放弃压缩，把整段留在上下文里等撞窗口）。两侧仍然各持一份记录（`CompactionRecord` 落谱系快照 / `ThreadCompaction` 落线程元数据）、摘要策略也各是各的（投影重算 vs 拿旧定稿重写），这两点由真相源决定，写在 `compaction.ts` 的文件头注释里。

## 边界

- 压缩成功之后、下一拍收束之前崩溃会丢这一条记录（退回原文，下次压缩重算）——接受的取舍。
- 不做存量档迁移：旧 `memory/arcs/*.md` 留着不读。
- 范围外：archive / 压缩记录的剧目级物理隔离、工坊线程压缩机制与演出侧的统一、超窗失败的熔断提示。
