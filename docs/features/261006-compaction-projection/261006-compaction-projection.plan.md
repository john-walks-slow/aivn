# 纪元压缩改造：从「记忆卡」回到「树上的压缩记录」

日期：2026-10-06 · 状态：计划（待对齐）

## 1. 背景

### 1.1 现状

剧作家的上下文（B 区对话体）不是真相源，而是「当前分支路径 + 读者身份」的导出物（`rebuild.ts` 的 `lineageToBeats`）。但纪元压缩是目前**唯一一个不走投影的结构性操作**：

- `maybeCompactEpoch`（`orchestrator.ts`）在轮边界把早期轮次交给 `completeText` 压成一份摘要，写 `memory/arcs/<arcId>.md`，并把摘要正文 `withSeed` **并进保留段第一条 user 消息**（`compaction.ts`）；
- 摘要同时以「记忆卡」身份进 `PlayMemory.cards`，靠 `arcIds`（写在 `MemorySnapshot` 里、随谱系快照走）在 A 区「记忆索引」里按分支过滤可见性；
- 一旦任何重建发生（跳转/分岔/删除/判废重演/编辑台词/退出限制级/冷启动），对话体从树上重放，`withSeed` 的正文就丢了——摘要的「纳入上下文」这一半不可重建，只剩「记忆卡」那一半是持久的。

2026-10-06 的 expert crosscheck（报告：`/tmp/aivn-context-crosscheck.report.md`，要点见 §附录 A）确认由此产生四个问题：压缩被摊平（C1）、冷启动 B 区为空（C3）、重放后第一次压缩判定因无 usage 而低估 CJK 约 4 倍、长周目 + 结构操作可致正演软卡死（C4）、压缩→收束之间崩溃会让 arcId 不进快照（孤儿 arc）。

### 1.2 考古：arcs 为什么长成「卡」

（依据 `docs/features/260928-stage-ai-mvp/260928-stage-ai-mvp.plan.md` §D7、`docs/features/261004-memory-state/`、`docs/features/261004-memory-curator/261004-memory-curator.plan.md`）

- D7 定的三层记忆里，`index/` 层的机制就是「卡」：**标题 + 一句话摘要进 A 区，详情按需 `read_memory_detail`**，为的是渐进披露与前缀缓存。压缩产物直接借用了这一层（当时落在 `memory/index/arcs/`），白拿了三件事：摘要自动进 A 区、详情可按需读、靠 `arcIds` 做分支可见性过滤。
- 261004 把它从 `index/` 挪到顶层 `memory/arcs/` 并加 `arc: true` 标记，因为用户也能在 index 下建卡，混在一起会出现「用户的卡跟着分支消失」与「手改绕过防剧透」。
- **计划原本写的是 canonical 路线**：§D7 表格「长会话压缩：直接用 pi compaction（纪元边界一次性重建）」；正文落地时改成「复用 pi 的 `estimateContextTokens`/`shouldCompact` 做计量，摘要自生成——不用 pi 的 `compact()`，它绑死 pi session 的 `Entry[]`」。**计量借了，「压缩 = 树上一等记录」的形状没借**——洞由此而来。
- 旁证：同期调研已记下 Anthropic 的立场——`compaction` 与 `memory tool` 是两个不同的 API 原语（`docs/freeform/261004-background-memory-agent.research.md` §691）。把压缩产物做成记忆卡，正是把两个原语合并。

### 1.3 调研结论

（`docs/freeform/261006-branching-context-compaction.research.md`，891 行 / 约 130 条来源）

带分支/回退语义的系统**一边倒**把压缩做成日志里的一等记录，messages 是投影：pi（`CompactionEntry`/`BranchSummaryEntry`）、Codex（`RolloutItem::Compacted`）、Claude Code（`compact_boundary`）、OpenHands（`Condensation`）、Anthropic（compaction block）、OpenAI（encrypted compaction item）。最小形态四字段：

```
{ 位置（parentId 天然给出）, summary, 保留边界（指针 或 内联尾）, tokensBefore }
```

投影规则：取路径上**最后一条**压缩记录 → `[摘要] + 保留边界之后的条目`；路径上没有 → 自动回原文。三种回退情形（回到压缩点之前 / 跳到别的分支 / 再跳回来）不需要任何撤销逻辑。

反面经验（摘要做成卡 + 另维护可见性过滤）的代价是可枚举的：Gemini CLI `/compress` 不落盘 → resume 后压缩消失；Roo Code resume 剥掉尾部摘要 → `condenseParent` 孤儿化 → 整段历史重发；Claude Code `compact_boundary.parentUuid = null` 把 rewind 树切断。

**本仓已有同构先例**：限制级摘要挂在 `beat_end.payload.nsfwSummary` 上，`lineageToBeats` 按读者身份投影成 `nsfwTransitionBeat(summary)`（`rebuild.ts`），且注释已写明「实时退出与从谱系重建共用它——两处各写一套必然漂移」。本次改造就是让压缩向它看齐。

### 1.4 目标（用户视角）

| 路径 | 现在 | 改造后 |
|---|---|---|
| 跳到别的分支再跳回来 | 摘要回注消失，早期轮次以原文回来（上下文膨胀，可能顶爆窗口） | 与离开那一刻完全一致：摘要 + 压缩点之后的原文 |
| 跳回压缩点之前 | 原文（正确） | 原文（不变，因为该路径上没有压缩记录） |
| 关掉服务再打开、点「继续」 | 剧作家静默失忆最近若干轮（B 区为空） | 从树上投影出与关机前一致的对话体 |
| 长周目做一次跳转/编辑 | 可能正演软卡死（每次输入失败→重演→失败） | 不再出现（重放后是「摘要 + 尾」，体积小） |

用户可见的界面不变（路线视图、舞台、工坊都不动）。

### 1.5 非目标

- 不动 `archive`（逐轮切片）与 `searchArchive` 的防剧透过滤；
- 不动压缩阈值配置、工坊线程自己的压缩（它落线程元数据，本就不进 arcs）；
- 不做存档/周目层的隔离改造（archive/arcs 的剧目级共享问题单列，见 §7）。

## 2. 方案

### 2.1 数据形态

`MemorySnapshot`（`packages/core/src/lineage/model.ts`）里的 `arcs: string[]` 换成一条压缩记录：

```ts
/** 纪元压缩记录：这条分支最近一次压缩的产物与切点。 */
export interface CompactionRecord {
  /** 前情提要正文（并进保留段首条 user 消息的那段文字）。 */
  summary: string;
  /** 切点：该节点及其之前的一切都已被 summary 覆盖（恒为路径上的一个 beat_end）。 */
  cutNodeId: string;
  /** 压缩前的上下文 token 量（记账/日志/UI 用）。 */
  tokensBefore: number;
}

export interface MemorySnapshot {
  state: Record<string, string>;
  compaction?: CompactionRecord;   // 原 arcs: string[]
  nsfw?: boolean;
}
```

位置由「它写在哪个快照里」天然给出——快照本身挂在谱系节点上、随分支走（`latestSnapshotOnPath`）。**不新增事件类型**，因此不影响 `lineage.jsonl`、`LineageNodeView` 与客户端（路线视图、beat 切分、`toNodeView` 全部不动）。

老档兼容：旧快照里的 `arcs` 字段被读代码忽略（`saveSnapshot`/`load` 不做校验），该档在下一次压缩后自然获得新记录。

### 2.2 投影规则（唯一新增的机制）

`lineageToBeats(chain, names, opening, mode)` 的 `RebuildMode` 增加一个可选字段，并按如下规则投影：

```ts
mode.compaction?: CompactionRecord

// 1. cutNodeId 不在链上 → 忽略记录，按原文渲染（回到压缩点之前、旧档、记录所在节点被剪掉）
// 2. 在链上 → 只渲染 cutNodeId 之后的链；把 renderSeed(summary) 并进第一拍的 user 文本顶部
//    （沿用 withSeed 的合并策略：不新起一条 user——相邻同角色消息在部分 OpenAI 兼容网关会被拒）
// 3. 若切点之后没有任何拍（压缩发生在末尾）→ 产出单独一拍：user = seed，assistant = 一句确认
```

为了能给出切点，`lineageToBeats` 需要给每一拍附带**它的前边界节点 id**（`RebuiltBeat.boundaryId`：该拍之前最近的那个 `beat_end`，第一拍为 `null`）。这样「按拍数保留」可以精确落回树上的一个节点。

### 2.3 压缩流程（`maybeCompactEpoch` 重写）

1. **预算判定**：`measureContext(messages)`；无 usage 时按 CJK 加权（见 2.6）。`used <= budget` → 返回。
2. **切点**：先把消息按「拍」分组——每遇一条 `role === "user"` 开新的一组（压缩只在轮边界跑，每拍恒一条 user；工具结果与同拍的 assistant 归入该组），逐组累加 token，从尾部往前保留到 `keepRecentTokens`，得到第一条保留拍。组数由**同一次投影**（`rebuildBeats(materialize())`，纯函数、便宜）给出，与消息分组一一对应；取该拍的 `boundaryId` 即 `cutNodeId`。第一条保留拍就是第一拍（无可压段）→ 返回。
3. **摘要输入**：被压掉的那段消息（`slice(1, 第一条保留消息的下标)`）交给 `renderTranscript` + `EPOCH_SUMMARY_SYSTEM`，产物简化成一段文本（不再拆 `oneLiner`/`body`；只做「跳过通用标题」的清理）。
4. **落记录**：`this.compaction = { summary, cutNodeId, tokensBefore }`；由下一次 `closeBeat` 写进快照（与 `state`/`nsfw` 同一个对象）。
5. **重建 Agent**：`buildAgent(renderBeats(rebuildBeats(materialize())))` —— 因为 `restoreBranchState/stateAt` 已经带上 `compaction`，投影自动生效，不需要 `withSeed`。
6. `persist()`。

`epochNo` / `arcId` 命名（`epoch-<leaf>-<n>`）不再需要（不再有文件、不再有跨分支同名覆盖问题）。日志里保留「第 N 次压缩」的计数即可。

### 2.4 四条重建路径自动正确

| 路径 | 现在 | 改造后 |
|---|---|---|
| `rebuildBranchAt`（跳转/分岔/删除/判废/走原路） | `rebuildBeats(chain)` 原文 | `stateAt(node).compaction` → 投影 |
| `editLine` | `materialize()` 原文 | 同上（`stateAt(leaf)`） |
| `switchBackToSfw`（退出限制级） | `materialize()` 原文 | 同上 |
| 构造函数（冷启动/切档） | `buildAgent(seed ?? [])` —— 空 | `restored` 时按 leaf 投影（见 2.5） |

四处的共同点：都调 `stateAt(nodeId)` 或等价地取「路径上最近的快照」。改造后 `restoreBranchState` 先装 `compaction`，`rebuildBeats` 再把它传给 `lineageToBeats`——顺序与 NSFW 折叠模式同理（先装分支状态、再按读者渲染）。

### 2.5 冷启动

构造函数 `restored` 分支末尾，把 `buildAgent(opts.seed ? ... : [])` 改成：

```ts
// 从树上投影出与关机前一致的对话体（含纪元摘要）；seed 仍优先（工坊重建接力）
const body = opts.seed
  ? withSeed(opts.seed.messages, opts.seed.note)
  : this.renderBeats(this.rebuildBeats(this.opts.tree.materialize()).beats);
this.agent = this.buildAgent(body);
```

前提是 2.6 的计量修正：旧档（没有压缩记录）的首次冷启动会把整条原文投影出来，若估算仍低估 CJK，可能第一拍就超窗。计量修正后，`runBeatTurn` 会在第一次 `agent.prompt` **之前**跑 `maybeCompactEpoch`，把它压回去。

### 2.6 计量修正（C4）

`measureContext`（`compaction.ts`）在 `lastUsageIndex === null`（没有真实 usage 可标定）时，不再直接 `scale = 1`，而是按内容给一个保守的下限系数：

- 统计待估文本里的 CJK 字符占比，按 `estimate * (1 + 3 * cjkRatio)` 量级回补（等价于「CJK 约 1 token/字、拉丁约 1/4 token/字」）；
- 或把「上一次真实标定出的 scale」随 `OrchestratorRuntimeState` 持久化、跨重建复用。

建议前者（无状态、一行判断、工坊侧同一套受益）。修正后 `scale=1` 的盲区消失，2.5 的冷启动预热与 §2.3 的重放重建都安全。

### 2.7 删掉的东西

- `MemorySnapshot.arcs`、`stateAt/restoreBranchState/构造函数` 里对它的读写（`orchestrator.ts`）；
- `PlayMemory`：`loadArcs`、`appendArc`、`IndexCard.arc`、`arcsDir`、`cards` 里的 arcs 段、`visibleCards(arcIds)`/`visibleContext(arcIds)`/`readCard(name, arcIds)` 的 arc 过滤（`memory.ts`）；
- A 区：`PromptContext.arcIds`、`indexSection` 的 arcs 行、arcs 卡 path 恒 null 的分支（`prompt.ts`）；
- 工具面：`createMemoryTools` 依赖里的 `arcIds`、`readCard` 的第二参、`read_memory_detail` 描述里的「按分支过滤」措辞（`memoryTool.ts`、`deps.ts`、`kit.ts`）；
- 文件面：`GENERATED_PREFIXES` 的 `memory/arcs/`（`playFiles.ts`）、`playEnv.ts` 注释与读面文案里的 arcs；
- 前端：`MemoryPane` 过滤 arcs 的分支；
- 「用户卡在前、arcs 在后、arcs 不参与 localeCompare」这条行序不变量（`loadCards` 的 sort 与相关用例）。

**不再写 `memory/arcs/<id>.md`**：摘要只活在快照里。磁盘上已有的旧文件按数据留着、代码不再读（清理可另做）。

### 2.8 保留的东西

- 三层记忆的 `always` / `index`（用户卡）/ `archive` 三层与它们的注入、检索、防剧透过滤；
- `EPOCH_SUMMARY_SYSTEM`、`renderTranscript`、`pickCutIndex`（工坊线程仍在用）、`withSeed` 的合并策略（投影时复用它的「并进首条 user」写法）、`renderSeed` 文案（措辞改为不依赖「纪元 N 文件」）；
- NSFW 段落期间不压缩、限制级摘要走 `nsfwSummary` 的既有机制；
- 压缩阈值三件套（`contextWindow` / `compactRatio` / `keepRecentTokens`）与设置页、README 字段表。

## 3. 决策点

### 3.1 需要你拍板

**A. 旧纪元摘要还要不要能被模型按需读回？**
现状：A 区列一行摘要 + `read_memory_detail` 可读全文。
- 建议：**不要**。canonical 里压缩过的原文与摘要都只是上下文的一部分（Claude Code 压掉就没）；而且「最近一次压缩的摘要」永远在上下文里，更早的已被它折叠，单独读回价值低。
- 代价：A 区「记忆索引」只剩用户设定卡；模型无法主动翻旧纪元摘要。
- 备选：保留一个薄工具（按节点/轮次读摘要），但那等于把「外挂记忆」又加回来一半。

**B. 压缩记录写在哪一层快照语义里？**
- 建议：直接进 `MemorySnapshot`（与 `state`/`nsfw` 并列）。它就是分支状态，`latestSnapshotOnPath` 免费给出，冷启动/重建/分岔都不用新代码路径。
- 备选：挂在触发那一拍的 `beat_end.payload`（与 `nsfwSummary` 完全同形）。语义更「事件化」，但投影端要多一个「沿链找最后一条带摘要的 beat_end」，且记录会进 `lineage.jsonl`/客户端可见面。

### 3.2 我直接定的（有异议再说）

- 不再写 `memory/arcs/*.md`；不做存量迁移（旧档第一次压缩后自然获得记录）。
- 二次压缩从投影后的对话体重算，**不做** pi 式的「拿旧摘要当底稿迭代改写」——重算一次的输入本来就含旧摘要，效果等价且少一层状态。
- 摘要产物简化为一段文本，去掉 `oneLiner`/`body` 二分（那是为卡服务的）。
- 压缩→收束之间崩溃会丢这一条记录（下次压缩重算）。比现状的「孤儿 arc 永久不可见」好，不做额外补偿。

## 4. 实现清单

> 完整触点清单（约 118 处 / 32 文件）见 `/tmp/aivn-arcs-touchpoints.md`；下表是必须改的部分。

| 文件 | 改动 |
|---|---|
| `packages/core/src/lineage/model.ts` | `MemorySnapshot.arcs` → `compaction?: CompactionRecord`；导出新类型 |
| `apps/server/src/rebuild.ts` | `RebuildMode.compaction`；`RebuiltBeat.boundaryId`；切点切片 + `renderSeed` 并入首拍 |
| `apps/server/src/compaction.ts` | `measureContext` 的 CJK 下限系数；`splitSummary` 简化为单段 |
| `apps/server/src/orchestrator.ts` | 删 `arcIds` 字段与 kit 依赖；`compaction` 字段；`stateAt/restoreBranchState` 带出记录；`rebuildBeats` 传记录；`maybeCompactEpoch` 重写（投影切点 + 落记录）；构造函数冷启动投影；`closeBeat` 快照写记录 |
| `apps/server/src/memory.ts` | 删 `loadArcs`/`appendArc`/`arcsDir`/`IndexCard.arc`/arc 过滤；`load` 不再拼 arcs |
| `apps/server/src/prompt.ts` | 删 `PromptContext.arcIds` 与 indexSection 的 arc 分支；`MEMORY_RULES` 措辞 |
| `apps/server/src/agentkit/memoryTool.ts` / `deps.ts` / `kit.ts` | 删 `arcIds` 依赖与 `readCard` 第二参 |
| `apps/server/src/playFiles.ts` / `agentkit/playEnv.ts` | `GENERATED_PREFIXES` 去掉 `memory/arcs/`；读面文案 |
| `apps/web/src/workshop/MemoryPane.tsx` | 删 arcs 过滤分支 |
| `README.md` / `apps/server/AGENTS.md` | 重写「纪元压缩」一段：产物形态、重放不摊平、无 arcs 卡；删掉旧取舍那句 |

## 5. 测试

按「只为会坏的地方写用例」的口径，改/加这些（只跑受影响的文件）：

- `compaction.test.ts`：新增「投影」用例——构造带 `compaction` 的链，断言投影结果 = `[seed] + 切点之后的拍`；断言 `cutNodeId` 不在链上时回原文；改写现有 arcs 卡断言。
- `orchestrator.test.ts`：核心回归——压缩后跳走再跳回，断言重建出的对话体含摘要且不含被压原文；冷启动（`restored` + 无 seed）断言 B 区非空且含摘要；判废/编辑路径的既有回归不动。
- `memory.test.ts` / `prompt.test.ts` / `playFiles.test.ts` / `playEnv.test.ts`：删 arcs 相关断言，补一条「`memory/arcs/` 不再作为引擎产物路径（只读拒答的只剩 archive）」。
- 不新增 harness、不做全量跑。

## 6. 风险与不变量

| 风险 | 处理 |
|---|---|
| 投影与实时对话体不一致（同 nsfwSummary 的「两处各写一套必然漂移」） | 投影是**唯一**实现：实时压缩也走 `lineageToBeats` 重放后的结果（§2.3 第 5 步），不再有 `withSeed` 这条并行路径 |
| 切点落在被折叠的限制级段内 | 压缩在 `nsfwActive` 时早退；退出后再压，切点由**投影后**的拍列表给出（限制级段已折成一拍），天然合法 |
| 老档首启投影出整条原文、顶爆窗口 | §2.6 计量修正 + `maybeCompactEpoch` 在首次 prompt 之前运行 |
| 记录写在快照里、快照只在收束时写 → 压缩→收束间崩溃丢记录 | 接受（下次压缩重算）；不再有「孤儿 arc 永久不可见」 |
| `beat_end` 切点与「拍」的对齐误差（±1 拍） | 摘要覆盖范围与保留尾由同一次投影同时决定，误差只会让一拍多算/少算进摘要，不产生内容缺口 |
| 剪子树把切点删掉 | 投影时 `cutNodeId` 不在链上 → 回原文；不会崩（已有 `tree.get` 判定） |

不变量（写进代码注释与 AGENTS.md）：
1. 摘要只以**投影**的方式进上下文，任何路径都不再直接改 messages；
2. 压缩记录是分支状态，随快照走；
3. 压缩期间不碰 `archive`（原文始终可检索）。

## 7. 范围外（单列，另议）

- `archive` / 压缩记录的**剧目级共享**（多周目物理隔离）——与本次改造正交；
- 工坊线程压缩的机制统一（它现在落线程元数据，工作正常）；
- 压缩失败的用户可见提示（可选：连续失败且为超窗时提示「上下文过长，请回退或开新周目」）。

## 附录 A：crosscheck 结论要点

（完整报告 `/tmp/aivn-context-crosscheck.report.md`）

- C1 成立：压缩只回注 B 区，不写谱系事件；`rebuildBranchAt`/`editLine`/`switchBackToSfw` 全链重放原文；`session.json` 不含 messages。
- C2 成立：`arcs` 的持久化与可见性过滤是两件事，改造后由投影取代。
- C3 成立：冷启动 B 区为空，seed 只来自工坊重建两处。
- C4 成立：重放后零 usage → `scale=1` → chars/4 低估 2.4–4 倍；第一拍超窗则软卡死（`BEAT_RETRY_LIMIT=1`，无熔断）。
- C5 部分成立：复杂度一半是承重设计（NSFW 折叠/防剧透/重放），一半是本方案要删掉的实现缺陷。
