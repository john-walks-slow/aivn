# 多分支对话树下的上下文压缩：业界机制汇编与 canonical 形态

调研日期：2026-10-06
调研对象：pi-agent-core（本地 `node_modules` 0.87.1 dist 源码 + 其公开文档）、Claude Code、Anthropic API、OpenAI Responses / Codex、LangGraph / LangChain / Deep Agents、OpenHands、OpenCode、Hermes、Roo Code、Cline、Gemini CLI、Letta/MemGPT、Pydantic AI、SillyTavern 生态、AI Dungeon，以及若干学术综述与工程事故报告。

---

## 0. 结论速览（先给答案，细节在后面）

1. **业界在"压缩结果存在哪里"上分成两派，而带分支/回退语义的系统一边倒地选了第一派**：
   - **A 派（log-record / node 派）**：压缩结果是**日志里的一条持久记录**（pi 的 `CompactionEntry` / `BranchSummaryEntry`、Codex 的 `RolloutItem::Compacted`、Claude Code 的 `compact_boundary`、OpenHands 的 `Condensation` 事件、Anthropic 的 `compaction` block、OpenAI 的 encrypted `compaction` item）。messages 是对这条记录做**投影**得到的。
   - **B 派（in-place / mutation 派）**：压缩是**对当前 messages 数组的一次原地改写**（LangChain `SummarizationMiddleware` 的 `RemoveMessage(REMOVE_ALL_MESSAGES)` + 新列表）。B 派只有在"messages 数组本身被 checkpoint 持久化"（LangGraph checkpointer）时才对回退友好；否则就是一次性突变。
   - 关键判据不是 A 还是 B，而是**压缩之后的"被压掉的原文"是否仍然可达（addressable）**。只要原文还在树/日志里、且 messages 由"当前路径 + 读取身份"投影出来，那么"跳回压缩点之前再跳回来"就是**投影输入变了**，不需要任何撤销逻辑。

2. **压缩点属于哪条分支 = 投影时路径选择问题，不是可见性过滤问题**。pi 的做法是唯一被多系统反复采用的形态：**messages = f(当前路径)**；投影时取路径上"最靠后的那条 compaction 记录"，把它展开成 `[摘要] + 它自带/指向的保留尾`，再加它之后的条目。路径上不存在该记录 ⇒ 自动回到原文（未压缩态），不需要 undo。

3. **最小 canonical 状态 = 4 个字段 + 一个位置**：
   ```
   { 位置: 该记录挂在路径的哪个节点之后（由 parentId 天然给出）,
     summary: string,
     保留边界: firstKeptEntryId（指针） 或 retainedTail（内联副本）,
     tokensBefore: number }
   ```
   `previousSummary`（迭代改写）与 `details`（文件清单等实现自定义数据）是可选增强。这是 pi、Codex、OpenCode、Hermes、Roo、OpenHands 收敛到的同一个形状。

4. **"摘要做成记忆卡 + 另外维护一套可见性过滤"是已知反模式，且有大量真实事故**：Gemini CLI 的 `/compress` 不落盘（resume 后压缩消失）、Hermes 的 composite carrier 破坏 retry/undo、Roo Code 的 `condenseParent` 孤儿化与 resume 丢摘要、Claude Code 的 compact 把 rewind 树切断、Hermes 的 branch 丢掉 compact 掉的早期轮次。**共同代价**：需要一套私有标记 + 一个"所有消费者都必须调用"的规范化投影函数 + 孤儿清理 + 旧格式前缀的兼容白名单 + 消费者各自的特例分支。

5. 对本仓库（stage-ai）的直接对应：`rebuild.ts` 里**已经存在**这个 canonical 形态——限制级段落末尾那一拍的 `beat_end` 事件 payload 上挂 `nsfwSummary`，`lineageToBeats` 在重放时按读者身份把它换出成 `nsfwTransitionBeat(summary)`。即"摘要作为树节点属性 + 重放时按路径/身份投影"。纪元压缩目前的 `withSeed`（把摘要正文并进保留段第一条 user 消息）恰好是**唯一一个不走这条路的结构性操作**，也是它一旦重放就丢的原因。（此条为对仓库代码的阅读结论，非业界做法。）

---

## 1. 术语与坐标系

先厘清两个正交的轴，后面所有对比都在这个坐标系里。

**轴 A：压缩产物的持久化形态**

| 形态 | 含义 | 代表 |
| --- | --- | --- |
| A1 独立记录节点（entry / item / event / block） | 压缩产物是日志里一条新记录，位置由 append 决定；messages 是投影 | pi、Codex、Claude Code、OpenHands、Anthropic API、OpenAI Responses、Pydantic AI |
| A2 既有节点上的属性/标记 | 不给摘要单独建节点，而是给被压/产生摘要的既有节点打标记（id 引用） | Roo Code（`condenseId`/`condenseParent`/`isSummary`）、SillyTavern-MessageSummarize（每条消息自带摘要）、stage-ai 的 `nsfwSummary` |
| A3 状态内的一次改写（原地） | 直接重写 messages 数组（可能写进 state、可能只改内存） | LangChain `SummarizationMiddleware`、Letta 的部分模式、Gemini CLI `/compress`、Hermes `in_place` |
| A4 外置笔记/memory 卡 | 摘要不占历史位置，作为"长期记忆"外挂，读取时注入 | Letta memory blocks、SillyTavern Summarize、AI Dungeon Story Summary/Memory Bank、Claude Code 的 NOTES/待办 |

**轴 B：压缩产物在"何时/如何"生效**

- B1 **投影时应用**（projection-time）：日志不可变，压缩记录只是投影的一个输入（pi、OpenHands、Deep Agents 的 `_summarization_event`）。
- B2 **写入时应用**（write-time / 持久改写）：压缩把 state 或落盘历史真正改小（LangChain、Gemini CLI、Letta 的 in-place、Hermes 的 in_place）。
- B3 **服务端应用**（server-side）：客户端保原文，服务端请求前裁剪（Anthropic `context_management`、OpenAI `compact_threshold`、Anthropic tool-result clearing / thinking clearing）。

**轴 A 决定分支正确性，轴 B 决定"原文是否还可达"和"存储是否膨胀"。** 下面所有事故都可以归到这两个轴的错配上。

---

## 2. 逐系统机制（Q2 主体）

### 2.1 pi-agent-core（本地 `node_modules/@earendil-works/pi-agent-core` 0.87.1）

这一节是基于**本地 dist 源码**的一手阅读，另附其公开文档（pi.dev）作对照。注意两者是**同一设计的两个世代**，有实质差异（见 2.1.7）。

#### 2.1.1 数据结构（`dist/harness/session/types.d.ts`）

```ts
export type EntryType = "message" | "compaction" | "branch_summary" | "custom";

export interface EntryBase {
  id: string;
  parentId: string | null;   // 树就是这一个字段
  seq: number;
  timestamp: number;
  type: EntryType;
  customType?: string;
}

export interface CompactionEntry extends EntryBase {
  type: "compaction";
  summary: string;
  retainedTail: AgentMessage[];  // 保留段直接内联存在这条记录上
  tokensBefore: number;
  details?: JsonValue;           // 默认装 { readFiles, modifiedFiles }
  usage?: Usage;                 // 生成摘要那次 LLM 调用的用量
  fromHook: boolean;             // 是否由扩展提供
}

export interface BranchSummaryEntry extends EntryBase {
  type: "branch_summary";
  fromId: string | null;         // 从哪个节点导航离开
  summary: string;
  details?: JsonValue;
  usage?: Usage;
  fromHook: boolean;
}
```

要点：
- **压缩/分支摘要都是 session entry，不是在 messages 上做手脚**。`Entry` 是一个 union，压缩产物与普通消息在同一个 append-only 存储里平级共存。
- 每条 entry 只带 `parentId`——"一个 list 就是每个节点恰好有一个孩子的树"，加这个指针几乎零成本，却买到整个结构（这句判断出自第三方分析文，见 [hashnode: Your Agent Session Is a Tree](https://harrisonsec.hashnode.dev/your-agent-session-is-a-tree-your-code-thinks-it-is-a-list)）。
- `CompactionEntry.retainedTail` 是**内联的保留段副本**，不是指针。见 2.1.7 的世代差异。

#### 2.1.2 投影：怎么从树得到 messages（`dist/harness/session/context.js`）

```js
export function buildContextEntries(pathEntries) {
    let compaction; let compactionIndex = -1;
    for (let index = pathEntries.length - 1; index >= 0; index--) {
        const entry = pathEntries[index];
        if (entry?.type === "compaction") { compaction = entry; compactionIndex = index; break; }
    }
    return compaction === undefined
        ? [...pathEntries]
        : [compaction, ...pathEntries.slice(compactionIndex + 1)];
}

export function sessionEntryToContextMessages(entry) {
    switch (entry.type) {
        case "message": return isContextMessage(entry.message) ? [entry.message] : [];
        case "compaction": return [
            createCompactionSummaryMessage(entry.summary, entry.tokensBefore, entry.timestamp),
            ...entry.retainedTail.filter(isContextMessage),
        ];
        case "branch_summary": return entry.summary
            ? [createBranchSummaryMessage(entry.summary, entry.fromId, entry.timestamp)] : [];
        case "custom": return [];
    }
}
```

这段 20 行代码就是整套机制的答案：

1. 输入是**当前路径**（从 leaf 回溯到 root 的 entry 列表）。
2. 找**路径上最后一条** `compaction`。找到 ⇒ 上下文 = `[这条 compaction] + 它之后的所有 entry`；**这条 compaction 之前的 entry 全部不参与**。
3. 找不到 ⇒ 上下文 = 整条原始路径（未压缩态）。
4. compaction 记录本身展开成 `[compactionSummary 消息] + retainedTail`。
5. `branch_summary` 记录展开成一条 `branchSummary` 消息（前缀见下）。

对应的消息壳（`dist/harness/messages.d.ts`）：

```ts
export const COMPACTION_SUMMARY_PREFIX = "The conversation history before this point was compacted into the following summary:\n\n<summary>\n";
export const COMPACTION_SUMMARY_SUFFIX = "\n</summary>";
export const BRANCH_SUMMARY_PREFIX = "The following is a summary of a branch that this conversation came back from:\n\n<summary>\n";
export const BRANCH_SUMMARY_SUFFIX = "</summary>";
```

即压缩摘要是**独立 role**（`role: "compactionSummary"` / `role: "branchSummary"`）的合成消息，不是伪装成 user/assistant 消息。

#### 2.1.3 三种情形在 pi 里的行为

| 情形 | 机制 | 结果 |
| --- | --- | --- |
| **回到压缩点之前** | 导航只是移动 leaf，投影重算。这次路径上不再包含那条 `compaction` entry ⇒ `buildContextEntries` 走 `undefined` 分支 | **自动回到未压缩原文**。压缩记录原封不动地留在树里（成为兄弟分支上的节点），不需要撤销、不需要清理 |
| **跳到另一条分支** | 路径换成另一条；该路径上可能有、也可能没有 compaction 记录。若用户选了 summarize，导航目标处**追加**一条 `BranchSummaryEntry`（`parentId` = 导航目标，`fromId` = 被放弃的旧 leaf） | 新路径上多出一条 `branchSummary` 合成消息，把离开的那条分支的内容带过来；被放弃的分支本身**完整留在树里**，没有删除 |
| **再跳回来** | 路径重新包含原来的 `compaction` entry ⇒ 投影再次展开成 `[摘要 + 保留尾]` | 摘要"自己回来了"。这是 append-only + 路径投影的直接推论，**没有任何"回注"动作参与** |

第 3 条正是本仓库当前缺失的性质：一旦摘要被并进 messages 而不在树上，重放就取不回来。

#### 2.1.4 切点、保留段与多次压缩（`dist/harness/compaction/compaction.js`）

- 触发：`shouldCompact(contextTokens, contextWindow, settings) => contextTokens > contextWindow - settings.reserveTokens`（`reserveTokens` 默认 16384）。
- 切点：`findCutPoint(entries, startIndex, endIndex, keepRecentTokens)` 从尾部往回累加 token 估计直到 `keepRecentTokens`（默认 20k），落在 assistant 消息上时会变成 **split turn**，此时额外生成一份 `turnPrefixMessages` 摘要（`TURN_PREFIX_SUMMARIZATION_PROMPT`）；合法切点**永不落在 tool result 上**（必须与它的 tool call 同侧）。
- **二次压缩**（关键，`prepareCompaction`）：

```js
let compactableEntries = pathEntries;
if (prevCompactionIndex >= 0) {
    const prevCompaction = pathEntries[prevCompactionIndex];
    previousSummary = prevCompaction.summary;              // ← 迭代改写：把旧摘要喂回去
    const virtualRetainedEntries = prevCompaction.retainedTail.map((message, index) => ({
        type: "message",
        id: `${prevCompaction.id}:retained:${index}`,
        parentId: index === 0 ? prevCompaction.id : `${prevCompaction.id}:retained:${index - 1}`,
        seq: prevCompaction.seq,
        timestamp: message.timestamp,
        message,
    }));                                                   // ← 保留段被虚拟化回 entry 序列
    compactableEntries = [...virtualRetainedEntries, ...pathEntries.slice(prevCompactionIndex + 1)];
}
```

  语义：**第二次压缩的摘要范围从"上一次压缩的保留边界"开始，而不是从 compaction 记录本身开始**。这样上次"幸存"的消息会在这次一并被纳入摘要，信息不会因为"处在保留段"而永远无法被压缩。同时 `previousSummary` 被当作改写底稿传入，是**迭代改写而非从零重写**。
- `tokensBefore` 用重建后的上下文重算，不用写入时的旧数。
- 摘要预算被硬性限制在 `0.8 * reserveTokens` 以内，保证摘要一定装得进为它预留的空间（第三方分析文称这是"compaction strategy 与 compaction hope 的分界线"）。

#### 2.1.5 导航 API 与钩子

```ts
export interface NavigateOptions { summarize?: boolean; label?: string; customInstructions?: string; }
```

- 请求形态：`{ kind: "navigation", targetId: string | null, options }`（`targetId: null` = 回到分支根）。
- 结果是**先决策、后提交**的两段式：`SummaryDecidingOperation → SummaryReadyOperation → SummaryEffectPendingOperation → NavigationReadyToCommitOperation`，最后 `commitNavigation` 原子地移动 leaf 并结束操作。即"摘要生成本身是一次可持久化、可重试、可恢复的结构性操作"，不是随手改内存。
- 钩子：`before_compaction`（`event: { reason: "manual"|"threshold"|"overflow", preparation, customInstructions }`，可 `decline` 或直接给 `compaction`）、`before_navigation`（`event: { targetId, preparation: BranchPreparation, customInstructions }`，可 `decline` 或直接给 `summary`）。
- 另有持久化谓词 `ResultBoundary = { kind: "resume_checkpoint" } | { kind: "finish" } | { kind: "commit_navigation", targetId, label }`——导航是被当成"结果边界"对待的。

#### 2.1.6 公开文档补齐的部分（pi.dev）

来自 [pi.dev/docs/latest/compaction](https://pi.dev/docs/latest/compaction) 与 [pi.dev/docs/latest/session-format](https://pi.dev/docs/latest/session-format)：

- 公开版 `CompactionEntry` 的字段是 `firstKeptEntryId`（**指针**）而非内联尾：
  ```ts
  interface CompactionEntry<T = unknown> {
    type: "compaction"; id: string; parentId: string | null; timestamp: string;
    summary: string;
    firstKeptEntryId: string;     // 保留段的第一条 entry id
    tokensBefore: number;
    usage?: Usage; fromHook?: boolean; details?: T;
  }
  ```
  重建规则原文（session-format）：*"Collects all entries on the path; If one or more `CompactionEntry` values are on the path, uses the latest one: includes the compaction entry first; includes non-system entries from `firstKeptEntryId` up to, but not including, the compaction entry; includes entries after the compaction entry."* —— 与本地 dist 的 `buildContextEntries` 完全同构，只是"保留段"用指针而非副本表达。
- 保留段为空的压缩（retain-none）把**自己的 id** 写进 `firstKeptEntryId`。
- compaction entry 还带一个可选的 `systemMessage`（**在压缩边界重放的完整 system prompt + 工具声明**），它成为压缩后上下文的首条 system 消息，保留段里的 system 消息在它面前被丢弃。`context_edit` 条目是"对某个更早的、参与上下文的 entry 的 append-only 改写"，`replacement: null` = 从模型上下文里省略该 entry，原始 entry 在 raw history / UI / 导出 / 计费里**保持不变**。
- **`context_edit` 的这段定义是整份材料里对本问题最重要的一句话**：*"Edits are branch-relative: navigating to a point before the edit reveals the target's original contribution again."* 会话内的"就地突变"一律表达为 append-only 记录 + 分支相对投影。
- 公开文档还描述 `/tree`（同会话改 leaf，可带摘要）、`/fork`（抽取一条路径到新会话文件，从不摘要）两种导航，以及 `session_before_tree` / `session_tree` 钩子。
- 第三方镜像 [hochej.github.io/pi-mono/coding-agent/tree](https://hochej.github.io/pi-mono/coding-agent/tree/) 补了一条规则：**分支摘要的收集在"公共祖先"或"遇到的 compaction 节点"处停止（谁先到算谁）**。
- 摘要模型侧：`SUMMARIZATION_SYSTEM_PROMPT` 明确"不要继续对话，只输出结构化摘要"；摘要请求使用**全新的 routing session id** 且 `cacheRetention: "none"`，避免把一次性摘要提示写进主提示缓存。
- 文件操作在压缩之间**累积**（`details.readFiles/modifiedFiles` 会从上一份压缩继承）。

#### 2.1.7 世代差异（本地 0.87.1 vs 公开 pi 1.0 文档）——必须知道的坑

- 本地 `0.87.1` 的 JSONL 格式是 **v4**（`JSONL_FORMAT_VERSION = 4`），并且带一个 **v3 → v4 升级器**（`dist/harness/session/jsonl/legacy-v3.js`）：

```js
function* retainedTailStructure(compaction, entriesById) {
    let currentId = compaction.parentId;
    while (currentId !== null) {
        const entry = entriesById.get(currentId);
        yield entry;
        if (currentId === compaction.firstKeptEntryId) return;
        currentId = entry.parentId;
    }
    throw new Error(`Legacy v3 compaction ${compaction.id} firstKeptEntryId is not on its parent branch: ${compaction.firstKeptEntryId}`);
}
```

  即 **v4 把 v3 的"保留边界指针"物化成了内联的 `retainedTail` 副本**。两个世代语义等价，代价不同：
  - 指针式：无重复存储；保留段永远反映树的当前内容（**保留段里的消息被改动会同步生效**）；投影时需要回查树，O(保留段长度) 的前缀查找，且"指针找不到"会抛错（legacy-v3.js 里就是这么处理的）。
  - 内联式：投影 O(1)、无回查；但**摘要记录自带一份不可变的尾部副本**——树里后来对同一批消息的编辑/删除不会反映到这份副本上（源码里 `sessionEntryToContextMessages` 直接返回 `entry.retainedTail`，不带任何源 entry id 引用）。
- 本地 0.87.1 **没有** `context_edit` 条目类型，**没有** `systemMessage` 字段；配置（model / thinkingLevel / activeToolNames）是从路径上的 `model_change`/`thinking_level_change`/`active_tools_change` 派生（见 `legacy-v3.js` 的 `selectedConfiguration`），而不是压缩记录自带的 prompt 快照。
- 本地是 "lane + operation" 模型（`LaneConfiguration`、`OperationScope`、durable 的 `SummaryDeciding/Ready/EffectPending/RetryWait` 状态机），比公开文档描述的流程更工程化。

> **对本仓库的含义**：`@earendil-works/pi-agent-core@0.87.1` 的 `CompactionEntry` 是"带内联尾的压缩节点"。如果打算复用它，需要注意内联尾是快照而非视图（编辑保留段不会同步）。

#### 2.1.8 pi 相关事故（反面素材）

- **导航摘要挂错位置**：commit `01dae9eb` 的说明第一条就是 *"Fix summary attachment: attach to navigation target position, not old branch"* ——早期版本把分支摘要挂到了被放弃的旧分支上（[upd.dev 镜像](https://upd.dev/badlogic/pi-mono/commit/01dae9ebcc86ab17d9f49bb391e738754df0f7fa)）。
- **`fromId` 恒等于 `parentId`**：issue #3796 报告 `branch_summary` 的 `fromId` 从未正确记录旧 leaf，扩展无法从事件流重建"发生过树导航"（[pi-mono#3796](https://github.com/badlogic/pi-mono/issues/3796)）。
- **树变了但上下文没换**：issue #1781，扩展在 agent loop 中直接调 `branchWithSummary` 后 `/tree` 显示已切换，但模型仍在预测另一条分支的内容——*"Tree state updates, but the in-flight LLM context buffer is not swapped mid-turn, which causes the tree/context desync"*（[pi-mono#1781](https://github.com/badlogic/pi-mono/issues/1781)）。
- **孤儿 tool_result 被永久写进 JSONL**：`pi-context` issue #23——压缩工具在 `execute()` 内提前把 leaf 移回目标并追加 `branch_summary`，而 harness 在 `execute()` 返回**之后**才把该工具的 `toolResult` 挂到当前 leaf 上，于是 `tool_use` 与 `tool_result` 分到了两条分支；投影从 leaf 到 root 走不会经过 `tool_use`，provider 直接 400，而且**这个孤儿已经被持久化**（[pi-context#23](https://github.com/ttttmr/pi-context/issues/23)）。教训：**树节点级的压缩操作必须整体推迟到 turn 结束**，不能在工具执行中途改 leaf。
- **第三方 gist 里最有用的一段设计说明**（[Durable sessions and reconstruction in Pi](https://gist.github.com/colelawrence/b9b5ebc48abef6ceba8cf5fb91117db5)）：*"The central design decision is whether your state should be: branch-local / causally truthful (`getBranch()`), or session-global / monotonic (`getEntries()`)."* 并明确：`/tree` 只改 leaf 并重建上下文，**不重启扩展运行时**，因此扩展若只在 `session_start` 重建状态就会错；需要在 `session_start` **和** `session_tree` 都重建，且默认应从 `getBranch()` 重建（分支局部真相），只有当状态确实应当"做过了就是做过了"时才改用 `getEntries()` 单调账本。文中还给了一个具体例子：TODO 在分支 B 勾掉后 `/tree` 回到分支 A 的早期位置，A 上它应当显示为未完成——*"That is not a bug. It is the intended meaning of branch-local truth."*

### 2.2 Codex（OpenAI）

Codex 的持久单元是 **`RolloutItem`**，append-only JSONL，由 `reconstruct_history_from_rollout` 重建（[rememorio: Rebuilding Sessions and Forks from Rollout Records](https://rememorio.github.io/blog/codex/en/rollout-recovery/)；[PR #12612](https://github.com/openai/codex/pull/12612)）。

- 压缩记录：
  ```rust
  pub enum RolloutItem {
      SessionMeta(SessionMetaLine),
      ResponseItem(ResponseItem),
      Compacted(CompactedItem),
      TurnContext(TurnContextItem),
      EventMsg(EventMsg),
  }
  pub struct CompactedItem { pub message: String }   // 初版只有一个字符串
  ```
  （[commit 674e3d3, "Add Compact and Turn Context to the rollout items"](https://github.com/openai/codex/commit/674e3d3c90d78508602c720c0f2d304ec5715a26)）后来 `CompactedItem` 还承载 `replacement_history`、`retained context`、window 号与最新 token usage 记录（见上文 rollout-recovery 一文）。
- **重建算法**：先**从新到旧**扫一遍，找"最新的幸存 replacement-history checkpoint + 上一轮设置 + reference context item + window id"；找到这些之后更早的条目不可能再影响重建结果。然后**从该 checkpoint 向前重放后缀**。
- **回退**（`ThreadRolledBack { num_turns }`）在反向扫描里被当作计数器：跳过接下来 N 个"真正包含 user 消息的已完结轮次"。有专门的集成测试：*"rolling back behind a pre-turn compaction should replay append-only history from the rollout file and keep earlier compacted history visible"*，断言回滚后 `hello world`（第一轮）仍可见、`EDITED_AFTER_COMPACT` 被移除、`SUMMARY_TEXT` 仍在（[compact_resume_fork.rs](https://github.com/openai/codex/blob/27c05a52/codex-rs/core/tests/suite/compact_resume_fork.rs)）。
- **fork 与 resume 共用同一套重建**：`RolloutRecorderParams::Create { forked_from_id, forked_from_ordinal_exclusive, parent_thread_id, ... }`；`RolloutRecorderParams::Resume { path }`。`thread/revert` 通过 `rollout_id_override` 写一个新的、不可变的 rollout 文件，**thread id 保持不变**（[recorder.rs](https://github.com/openai/codex/blob/main/codex-rs/rollout/src/recorder.rs)）。fork 有两种持久化策略：普通 fork 用 `ForkPersistence::Copied`，prepared fork 可用 `Referenced` + `history_base` + 继承条目数——*"Forking is therefore not universally a full JSONL copy."*
- **压缩会清掉上下文基线**：*"if mid-turn compaction reinjects full initial context into replacement history, persist a fresh `TurnContextItem` after `Compacted` so resume/fork can re-establish the baseline"*；*"do not treat manual compaction or pre-sampling compaction as creating a new durable baseline on their own"*；*"compaction clears `reference_context_item` until a later `TurnContextItem` re-establishes it"*（[PR #12612](https://github.com/openai/codex/pull/12612)、[PR #12252](https://github.com/openai/codex/pull/12252)）。这是把"压缩改变了模型可见历史 ⇒ 上下文基线失效"写成显式不变量的做法。
- **Codex 侧的踩坑**：
  - `compaction` 是 OpenAI 私有 item（`encrypted_content` 只有 OpenAI 后端能读），第三方 Responses 兼容 provider 直接 400：`item type "compaction" is not supported`；可行 workaround 是在非 OpenAI provider 上把 `Compaction`/`ContextCompaction` item 从 input 里剔掉（[codex#45393](https://github.com/openai/codex/issues/45393)）。**教训：把"不可读的压缩块"放进历史，会让历史与 provider 绑定。**
  - 两处 `RolloutItem::Compacted` 相关的注释里长期挂着 `TODO: fix rollback/backtracking baseline handling more comprehensively`（PR #12252），说明"压缩 + 回退 + 上下文基线"三者的交互是最难收敛的部分。

### 2.3 Claude Code（compact_boundary）

- 落盘形态：JSONL append-only transcript，压缩写入一条 `{"type":"system","subtype":"compact_boundary", ...}`，其后紧跟一条 `isCompactSummary: true` 的 user 消息承载摘要正文；边界可带 `compactMetadata { trigger, preTokens, postTokens, messagesSummarized, durationMs, cumulativeDroppedTokens, preservedSegment { headUuid, anchorUuid, tailUuid } }`（[issue #75413 的真实 dump](https://github.com/anthropics/claude-code/issues/75413)、[架构解析 09](https://jwcrystal.github.io/claude-reviews-claude/en/architecture/09-session-persistence)、[源码镜像：Session Persistence](https://sanbuphy-claude-code-source-code.mintlify.app/architecture/session-persistence)）。
- 重建：`getMessagesAfterCompactBoundary()` 读 transcript 并重建 `[summary_message, compact_boundary, ...recent_messages]`；resume 时定位**最近一条** `compact_boundary`。
- **官方文档对"摘要存哪"的表述**（[code.claude.com/docs/en/checkpointing](https://code.claude.com/docs/en/checkpointing)）：*"Summarizing doesn't change files on disk, and the original messages stay in the session transcript, so Claude can still reference the details."* 以及 rewind 菜单里两个直接对应本问题的动作：
  - **Summarize from here**：把"从这一点往后"的对话压成摘要。
  - **Summarize up to here**：把"这一点之前"的对话压成摘要，保留后面的消息不动。
  - 两者都会在对话里留下一个 `Summarized conversation marker`；**压缩锚点由用户在时间轴上选**，而不是只能锚在尾部。
- **注意 Claude Code 的"树"其实是被切断的**：`compact_boundary` 的 `parentUuid = null`，`logicalParentUuid` 指向压缩前的位置，原意是让 chain walker 在读侧跨过边界。但读侧长期不用这个字段，于是"数据都在 JSONL 里但导航不到"。
- **三种情形**：回到压缩点之前 = rewind 到那个 checkpoint（`parentUuid=null` 造成断裂，见下）；跳到另一分支 = `/branch` / `--fork-session`（新会话、拷贝历史）；再跳回来 = `/resume`（从最近的 compact_boundary 重建）。**Claude Code 没有一个"同一会话内可任意跳的树"**，它用"rewind 列表 + 分支即新会话"近似。

### 2.4 Anthropic API（compaction block）

两套机制并存（[Compaction](https://platform.claude.com/docs/en/build-with-claude/compaction)、[Compaction on demand](https://www.aicodex.to/articles/compaction-on-demand)、[Compaction in the background](https://platform.claude.com/docs/en/build-with-claude/compaction-background)、[Context editing](https://platform.claude.com/docs/en/build-with-claude/context-editing)）：

| | 阈值式（threshold） | 按需式（on demand） |
| --- | --- | --- |
| 开关 | `context_management.edits: [{ type: "compact_20260112", trigger, instructions, pause_after_compaction }]` | beta header `compact-2026-09-04` + 顶层 `compaction: {type:"summarize"}` |
| 时机 | 请求内、跨过阈值时由服务端触发 | 你选时机；可后台跑 |
| 返回 | 该次响应内容里带一个 `compaction` block | 只返回一个 block（`stop_reason: "compaction"`，`usage.iterations` 里计费） |
| 保留最近轮次 | 用 `pause_after_compaction` 暂停后自行插入 | 天然支持：把最后几轮留在压缩请求之外，放在 block 之后 |
| 多次压缩 | 后续请求自动丢弃 block 之前的一切 | 在已以 block 开头的历史上再次压缩，新 block 覆盖"旧摘要 + 之后的全部"；**此后只发最新的一个 block** |

- `compaction` block 有 `content` + `signature`，**必须原样回传并放在 `messages` 首位**。三条服务端规则（原文）：把被摘要的消息留在 block 之前 → 400 `compaction_block_misplaced`；把被摘要的消息留在 block 之后 → 不报错但**你付两次钱**；每个后续请求都要带且只能带一个 block，不带就等于没有摘要。
- 与分支的关系：**官方模型里没有分支**。"编辑历史"与压缩互斥——原文要求 *"Do not edit history between sending the compaction request and making the swap"*，要改 system prompt / tools 就得先整段压缩（不留保留轮次）再改。
- 与缓存的关系：`cache_control` 放在 block 上 = 在摘要后立刻开一个缓存断点，通常正是想要的位置；工具结果清理会作废前缀缓存，所以有 `clear_at_least` 门槛。
- 摘要质量：默认 prompt 因模型而异；`instructions`（≤16384 字符）**完全替换**默认 prompt；要显式告诉模型"不要调用工具"，否则可能拿到空摘要。失败仍返回 200 且照常计费，必须查 `stop_reason`（`max_tokens` / `model_context_window_exceeded` / `tool_use` / `refusal` / `end_turn`）。
- 官方的三层心智模型（[Anthropic cookbook: context engineering](https://platform.claude.com/cookbook/tool-use-context-engineering-context-engineering-tools)）：**compaction 压缩整个窗口（whole-transcript）、tool-result clearing 是窗口内的外科手术（sub-transcript）、memory 把信息搬出窗口以跨会话存活**。并明确 Claude Code 在生产里同时用这三者。
- [Effective context engineering for AI agents](https://www.anthropic.com/engineering/effective-context-engineering-for-ai-agents) 里一句与本问题相关的实现细节：Claude Code 压缩后是 *"continue with this compressed context **plus the five most recently accessed files**"* —— 即压缩后**从外部真实来源重新取回**关键状态，而不是把它塞进保留尾副本。

### 2.5 OpenAI Responses API / Agents SDK

- 服务端压缩（[Compaction](https://developers.openai.com/api/docs/guides/compaction)、[Responses API 博文](https://openai.com/index/equip-responses-api-computer-environment/)）：
  - `context_management: [{ type: "compaction", compact_threshold: 200_000 }]`：跨阈值时服务端做一次压缩，**同一条流里**吐出 compaction item，并在继续推理前裁掉上下文。
  - 独立的 `/responses/compact`：无状态、ZDR 友好，**返回的就是"下一个 canonical context window"**，理财建议是"**不要裁剪 compact 的输出**"，原样传给下一次 `/responses`。
  - item 形态：`{ "type": "compaction", "id": "cmp_...", "encrypted_content": "gAAAAAB..." }`，**opaque，非人类可读**。多次压缩时新 block 叠在旧 block 之上。
  - 延迟提示：如果没用 `previous_response_id`，可以丢掉"最近一个 compaction item 之前"的 item 来减小请求（最新那条已带够上下文）。
  - 已知缺陷：只在模型最终产出 message 的那一轮才吐 compaction；连续的纯 tool-call 轮不会吐，于是工具密集的循环可能在 compaction 出现前就 `context_length_exceeded`（[openai-python#3075](https://github.com/openai/openai-python/issues/3075)）。
- Agents SDK：`OpenAIResponsesCompactionSession` 是**对 session 的装饰器**——*"Session decorator that triggers `responses.compact` when the stored history grows"*，`runCompaction()` 在 runner 持久化完一个 turn 后被调用，*"Implementations may decide to call `responses.compact` ... and **replace the stored history**"*，并带 `addItemsWithCompactionOwnership` / `prepareHistoryItemsForPersistenceComparison` 这类"压缩归属与持久化对账"的钩子（[API 文档](https://openai.github.io/openai-agents-js/openai/agents-openai/classes/openairesponsescompactionsession/)）。**注意它明确跳过了"未被最近一次成功模型输入/输出完全覆盖的历史"**。
  - 这是典型的 B2（写时改写）：压缩通过"替换存储的历史"生效，因此它的分支语义取决于 session store 本身怎么 fork。
- **OpenCode 对 native compaction 的可移植性说明**很值得抄走当反面清单：*"An encrypted checkpoint only works with the same provider, model, and endpoint. If you switch models, the session continues from the original conversation instead."*（[opencode.ai/v2/docs/compaction](https://opencode.ai/v2/docs/compaction)）

### 2.6 LangGraph / LangChain / Deep Agents

这家的演化史本身就是本问题的教科书。

**(a) 起点：state 里做原地改写（轴 A3 + 轴 B2）**

`SummarizationMiddleware.before_model`（[源码](https://github.com/langchain-ai/langchain/blob/98216c0c/libs/langchain_v1/langchain/agents/middleware/summarization.py)）：

```python
return {"messages": [RemoveMessage(id=REMOVE_ALL_MESSAGES), *new_messages, *preserved_messages]}
```

- 与 checkpointer 一起用时，**checkpoint 让这次改写本身可回退**：`update_state` / `forkFrom` 从更早的 checkpoint 分叉，改写之后的 messages 自然不存在（[Checkpointers](https://docs.langchain.com/oss/python/langgraph/checkpointers)、[Use time-travel](https://docs.langchain.com/oss/python/langgraph/use-time-travel)：*"`update_state` does not roll back a thread. It creates a new checkpoint that branches from the specified point. The original execution history remains intact."*）。
- **但代价是把"UI 可读的历史"和"LLM 的工作上下文"混在同一个 state 里**。官方论坛的问答直接把这条写成了架构建议（[LangGraph + PostgreSQL: Chat history and summarization best practice](https://forum.langchain.com/t/langgraph-postgresql-chat-history-and-summarization-best-practice/3521/2)）：*"`SummarizationMiddleware` permanently wipes all messages from the checkpointer state ... if your UI reads from that same checkpointer state, the history disappears from the user's view."* 推荐做法是**两张表**：checkpointer 只当"LLM 工作 RAM"，另建一张 append-only 的 `messages` 表给 UI，二者永不互相裁剪。
- (a) 的事故：
  - `RemoveMessage` 没生效 ⇒ 旧消息留在 checkpoint，摘要消息**叠加**在旧消息旁边，上下文无限增长（40+ 条消息里 8 条摘要，原始全在），每轮都触发摘要（[langgraph#5112](https://github.com/langchain-ai/langgraph/issues/5112)）。该 thread 里明确指出 **deepagentsjs v1.7.5 用 "state rework, move to wrap pattern" 彻底避开了 `RemoveMessage`**。
  - `_trim_messages_for_summary` 用了 `start_on="human"`，在"一条用户请求 + 长工具循环"这种最典型的负载下 `trim_messages` 返回 `[]`，于是 `_create_summary` 返回占位串 `"Previous conversation was too long to summarize."`，而 `before_model` **把这句话当成真摘要**，删掉 75 条消息后替换进去——**摘要在整个过程中根本没被调用过，且被持久化，不可恢复**（[langchain#39261](https://github.com/langchain-ai/langchain/issues/39261)）。

**(b) Deep Agents 的反转：指针式非破坏（轴 A1 + 轴 B1）**

[deepagents summarization 参考](https://reference.langchain.com/python/deepagents/middleware/summarization) 把差异写得非常直白：

> - **Non-mutating message state.** Summarization is tracked in a private `_summarization_event` field via `wrap_model_call`, leaving `state["messages"]` intact. LangChain rewrites it with `RemoveMessage(id=REMOVE_ALL_MESSAGES)` from `before_model`. **Preserving the raw log enables replay, evals, and shared state** with `SummarizationToolMiddleware`'s `compact_conversation` tool.
> - Backend offload of evicted history. Evicted messages are appended to `/conversation_history/{session_id}.md` ... and the summary embeds that path so the agent can re-open it via `read_file` ... LangChain drops evicted messages with no recovery path.

事件结构（源码）：

```python
new_event: SummarizationEvent = {
    "cutoff_index": state_cutoff_index,   # 绝对下标（多次压缩时累加换算）
    "summary_message": new_messages[0],
    "file_path": file_path,
}
...
previous_event = request.state.get("_summarization_event")
state_cutoff_index = previous_event["cutoff_index"] + cutoff_index - 1 if previous_event is not None else cutoff_index
```

即：**摘要 + 一个指回原始 message 列表的切点指针 + 一个外置全文路径**，在 `wrap_model_call` 里"per-call"生效，state 不动。

- (b) 的代价（很重要，Q3 必须交代）：指针式不裁剪 state ⇒ **持久化状态不收缩**。deepagents#2874 明确列出三条：checkpoint 写入放大（每步重新序列化整个 messages 列表）、恢复成本（resume 要反序列化全量历史，虽然只用到 `cutoff_index` 之后）、进程 RSS 增长。作者给的选项是"要么在发事件时同时发一条 reducer-aware 删除，要么保留指针但加一个周期性 materialize 的步骤"（[deepagents#2874](https://github.com/langchain-ai/deepagents/issues/2874)）。
- 路径依赖的顺序问题：`_get_history_path()` 用 `{thread_id}`/session id，offload 是**先写外置文件、失败就中止压缩**（宁可报错也不静默丢）；JS 版一度因为 `StateBackend` 处于 legacy 模式而**静默丢掉 offload**，摘要消息里却仍写着"完整历史已保存到 /conversation_history/xxx.md"——模型照做会 `File not found`（[deepagentsjs#621](https://github.com/langchain-ai/deepagentsjs/issues/621)）。
- 官方博客把三层讲清楚了（[Context Management for Deep Agents](https://www.langchain.com/blog/context-management-for-deepagents)）：大工具结果 offload（>20k token）→ 上下文到 85% 时 offload 旧 write/edit 参数 → **offload 不够用时才做摘要**，而摘要是"in-context summary + filesystem preservation"双轨：*"The complete, original conversation messages are written to the filesystem as a canonical record."* 并且他们的 eval 里有专门一项："在会话早期埋一个针，强制触发一次摘要，之后再问这个针，只能靠 filesystem search 取回"。

**(c) LangMem**：`SummarizationNode` / `summarize_messages` 用**独立的 state key**（默认 `output_messages_key` ≠ `input_messages_key`，示例里叫 `context`）保存 `RunningSummary`（`summary` + `summarized_message_ids` + `last_summarized_message_id`），从而"不重复摘要同一批消息"，并在示例注释里明确建议：*"We recommend using separate LangGraph state keys for the full message history (e.g. `messages`) and summarization results"*，UI 建议渲染"完整、未修改的消息历史"（[LangMem 指南](https://langchain-ai.github.io/langmem/guides/summarization/)）。**这就是"摘要卡 + 可见性过滤"在业界最主流的表述形式**：把两者放进不同的 state key，别让压缩动到用户可见的那份。

### 2.7 OpenHands（Condensation 事件 + View 投影）

这一家给出了"压缩即事件、上下文即投影"的完整实现。

事件（[openhands-sdk event/condenser.py](https://github.com/OpenHands/software-agent-sdk/blob/main/openhands-sdk/openhands/sdk/event/condenser.py)）：

```python
class Condensation(Event):
    forgotten_event_ids: set[EventID]   # 被遗忘（从给 LLM 的 View 里移除）的事件 id
    summary: str | None
    summary_offset: int | None          # 摘要插在"移除后"的位置
    llm_response_id: EventID
    def apply(self, events):            # 投影
        output = [event for event in events if event.id not in self.forgotten_event_ids]
        if self.has_summary_metadata: output.insert(self.summary_offset, self.summary_event)
        return output
```

投影函数（[memory/view.py](https://github.com/OpenHands/OpenHands/blob/bf769d1/openhands/memory/view.py)）：

```python
@staticmethod
def from_events(events): 
    forgotten_event_ids = set()
    for event in events:
        if isinstance(event, CondensationAction):
            forgotten_event_ids.update(event.forgotten)
            forgotten_event_ids.add(event.id)      # 连 condensation 事件自己也忘掉
        ...
    kept_events = [e for e in events if e.id not in forgotten_event_ids]
    # 摘要只认最后一条 condensation 事件（即最近那条）
    for event in reversed(events):
        if isinstance(event, CondensationAction) and event.summary and event.summary_offset is not None:
            summary, summary_offset = event.summary, event.summary_offset; break
    kept_events.insert(summary_offset, AgentCondensationObservation(content=summary))
```

- 设计目标写得很清楚（[PR #7353](https://github.com/All-Hands-AI/OpenHands/pull/7353)）：*"Instead of returning just a condensed history, this new interface allows a condenser to return a `View` of the history or a `Condensation` event. The condensation event can be added to the event stream, which is then one step closer to being **the only source of state needed for the agent**."* 并强调统一事件类型让历史重建"uniform"。
- **已知缺陷**：
  - `forgotten_event_ids` 是完整 id 集合，带来 O(V×F) 的成员判断与 websocket/存盘体积问题；有 PR（#7526）提议改成 start/end 区间被否，理由是可读性与代码复杂度（[#7353 讨论](https://github.com/All-Hands-AI/OpenHands/pull/7353)、[software-agent-sdk#3153](https://github.com/OpenHands/software-agent-sdk/issues/3153) 把"`forgotten_event_ids` list not set"列为 Medium 级性能问题）。
  - 更严重的：**摘要一度不在 history 里**（被 condenser 维护、只在"当作 View 时"插入），于是"从头到尾历史是事件流的单调子序列"这条抽象保住了，但 agent 会出现"忘了、重做旧事"的现象；同时 stuck detector 看不到压缩发生，压缩可以连环触发到 500 轮上限（[PR #7132](https://github.com/All-Hands-AI/OpenHands/pull/7132)、[issue #6706](https://github.com/All-Hands-AI/OpenHands/issues/6706)）。
  - 另一个具体坑：`_ensure_initial_user_message` 需要知道**第一条 user 消息是否已被压缩掉**，否则会把旧指令重新插回去导致重放（源码注释：*"If the initial user action has been condensed (its ID is in forgotten_event_ids), we do NOT re-insert it. This prevents old instructions from being re-executed after conversation condensation."*）。这是"投影必须知道谁被压掉了"的典型连带成本。

### 2.8 OpenCode

- 压缩产物挂在**那条被压缩的 user 消息**上：`CompactionPart`（`{ type: "compaction", tail_start_id }`）——即"压缩点"是消息的一部分，且**记录保留尾的起点 id**（[packages/opencode/src/session/compaction.ts](https://github.com/anomalyco/opencode/blob/57ce1b9c/packages/opencode/src/session/compaction.ts)）。
- 摘要是 `role: "assistant"`、`summary: true`、`mode: "compaction"` 的一条真消息，由隐藏的 `compaction` agent 生成（工具权限全 deny）。
- 二次压缩：`completedCompactions(history)` 找出之前的压缩对，把它们的 user/assistant 两条都放进 `hidden` 集合、从待摘要内容里剔除，`previousSummary = prior.at(-1)?.summary` 用于迭代改写（有专门的 `SUMMARY_UPDATE_INSTRUCTIONS`，明确规则："新对话与旧摘要冲突时以对话为准，说明修正后的事实并丢掉旧说法"）。
- 两级策略：**先 prune 再 summarize**。prune 从尾部倒扫，保护最近 2 轮与最近 40k token 的工具输出，把更早的工具输出替换成 `[output truncated by compaction]` 并打上 `time.compacted` 时间戳（`PRUNE_PROTECT = 40_000`、`PRUNE_MINIMUM = 20_000`、`PRUNE_PROTECTED_TOOLS = ["skill"]`）。
- 溢出的恢复：溢出触发时会把上一条**真实 user 消息克隆一条新的重放**（`replay`），压缩完成后再继续（[DeepWiki: Context Management and Compaction](https://deepwiki.com/sst/opencode/2.4-context-management-and-compaction)）。媒体部件在重放时降级成 `[Attached image/jpeg: filename.jpg]` 文本。
- 官方文档明确 **"Earlier messages remain stored even when they are no longer sent to the model."**，并且 native（OpenAI encrypted）压缩**跨模型/跨 provider 不可移植**。
- 事故：[#6186](https://github.com/anomalyco/opencode/issues/6186)——`revert` 之后立刻 `/compact`，压缩按"revert 从未发生"来执行，被 append 到已被移除的消息后面；配套 issue 还有"压缩后 sidebar 上下文大小不更新"、"压缩后 session 的 Todo 列表被遗忘"。

### 2.9 Hermes（NousResearch）

[官方文档](https://hermes-agent.nousresearch.com/docs/developer-guide/context-compression-and-caching) 是目前把工程细节写得最全的一家。

- **两层压缩**：gateway session hygiene（85%，粗估，兜底）与 in-loop `ContextCompressor`（默认 50%，真实 token 数）。
- **存储形态**：`compression.in_place: true`（默认）*"a compaction rewrites the live message list on the same session id: the system prompt is rebuilt, the summarized middle is swapped in, and the pre-compaction turns are soft-archived under the same id (`active=0, compacted=1` in the session store) — still searchable via `session_search` and recoverable, never deleted."* 文档明确说这个选择**消灭了一整类 session 轮转缺陷**（"lost `/goal` state, orphaned sessions, search gaps across boundaries"）。
- **迭代改写**：*"the previous summary is passed to the LLM with instructions to update it rather than summarize from scratch. This preserves information across multiple compactions — items move from 'In Progress' to 'Done'..."*
- **摘要结构模板**（业界收敛出的同一套）：`## Goal / ## Constraints & Preferences / ## Progress (Done / In Progress / Blocked) / ## Key Decisions / ## Relevant Files / ## Next Steps / ## Critical Context`；`[PR #2323](https://github.com/NousResearch/hermes-agent/pull/2323)` 里直接列了它抄了谁：Pi-mono（结构化模板 + 迭代更新 + token 预算切点 + 文件追踪）、OpenCode（prune 后 summarize 两阶段）、Cline（文件读取去重 + 10 段式摘要）、Codex（**在摘要之外保留用户消息原文**）。
- **`tail_mode: "lean"`**：保留尾被夹到 `2.5% × 上下文窗口`（下限 10k、上限 25k），连续性改由摘要承担——摘要里包含"详细且保留标识符的 session 日志"、"机械抽取的锚点索引（PR 号、SHA、路径、错误串，用正则，绝不改写）"、"**每一条真实 user 消息逐字引用（按新到旧预算）**"，以及一条 `session_search` 恢复指针；摘要尾部有确定性提示：*"The N compacted message(s) remain fully preserved in session history. If you need any detail this summary does not carry ... recover it with: session_search(...) — do not guess at lost specifics when you can look them up."*
- **`SUMMARY_PREFIX` 是一大段"这是参考不是指令"的加固文案**，反复强调：只回应摘要**之后**的最新 user 消息；摘要里的 "Historical Task Snapshot" 等段落一律不是活跃任务；"stop / undo / roll back / never mind" 之类反向信号必须立刻终止摘要里描述的在途工作。文档解释这段越写越长的原因就是真实事故：#11475、#14521（弱模型把摘要里逐字引用的 "## Active Task" 当成新的用户输入）、#33256（把 assistant role 的摘要当成自己的输出吐出来）。
- **摘要并入尾消息的边缘情况**（与本仓库 `withSeed` 同形，代价清单也因此最完整）：
  - 需要 `_MERGED_PRIOR_CONTEXT_HEADER` / `_MERGED_SUMMARY_DELIMITER` / `_SUMMARY_END_MARKER` 三重分隔符，才能让模型分清"哪段是摘要、哪段是真实的新消息"。
  - 需要私有元数据键 `COMPRESSED_SUMMARY_METADATA_KEY` 才能在后来把"压缩机产生的摘要"与"普通 user 输入（哪怕内容里引用了摘要头）"区分开，源码注释里写得很直接：*"Content heuristics alone must never authorize mutating a live turn."*
  - 需要**历史前缀白名单**：`# Handoff prefixes that shipped in earlier releases` 列表，且 *"NEVER mutate or reorder an existing entry — each one is the exact wire text a shipped build persisted, so editing it silently un-normalizes every summary written by that build generation; prepend only."* 并有测试 byte-pin 每一条。**这就是"把摘要写进真实消息"必然带来的长期税。**
- **事故（与本题最相关）**：[#81233 "Composite compaction carriers are skipped by retry and undo"](https://github.com/NousResearch/hermes-agent/issues/81233) —— 压缩途中有一种合法形态是"摘要脚手架 + 当前真实请求"共处同一个 `role=user` 行（composite carrier）。retry/undo 的选择器把"任何带摘要标记的 user 行"当成脚手架跳过，于是 **retry 重发了更早的请求，并在途中把压缩上下文截掉**；用户看到的症状是"`/retry` 不会重发我刚刚说的话、只挑了一条旧消息重发"。修复（[PR #93784](https://github.com/NousResearch/hermes-agent/pull/93784)）的要点：*"one canonical scaffold/live-view projection (`user_originated_turn_view`) for both composite-carrier layouts"*、*"CLI, gateway, TUI/Desktop retry + undo select user-originated turns and resend/prefill only the live ask"*、*"durable rewinds archive the carrier + tail and re-insert one hidden pure scaffold atomically, guarded by a pre-selection transcript snapshot (fails closed on concurrent mutation)"*。
- **[#80973](https://github.com/NousResearch/hermes-agent/issues/80973)（分支复制丢尾部，且在压缩过的会话上更严重）**：`session.branch` 从**内存中的模型投影**取种子历史，而 in-place 压缩之后那份投影已经不含被归档的轮次；`get_resume_conversations` 兜底也只读 `active = 1`。实测：父会话 240 行 = 71 active + 169 compacted，`includeCompacted=True` 有 132 条可见消息，而分支 seed 只有 42 条，三个分支分别只有 8/8/14 行。作者的结论：*"even with a correct count/row_id truncation fix, a compacted parent's earlier turns are unreachable to the branch unless the copy source also includes `compacted` rows"*。**这是"压缩改写实时视图 + 后续操作从实时视图拷贝"的教科书级事故。**
- **micro-compaction**（[文档](https://hermes-agent.nousresearch.com/docs/developer-guide/micro-compaction)）：每轮把最老的一个 exchange 折进一个**滚动摘要**；旧 marker 被取代时丢弃（否则"每轮都在文本里堆近重复副本"）；丢 marker 会让两侧 user 消息相邻，于是把它们合并成一条并打上 `display_metadata.model_only`，**所有展示投影（resume / 分页历史 / 提示时间线）都跳过这次合并**，于是恢复会话时每条输入只显示一次。摘要超过阈值时 `defrag` 就地重写摘要本身，**不动 transcript 结构**。文档也坦白了代价：每轮都改写已发送历史 ⇒ **每一轮都作废 provider 前缀缓存**，因此有 `micro_compact_every_n_turns` 这个频率旋钮。

### 2.10 Roo Code / Cline

这一家是"**摘要卡 + 可见性过滤**"最完整、也最典型地暴露代价的实现。

- 形态：不给摘要单独建节点，而是给消息打标记（[src/core/condense/index.ts](https://github.com/RooCodeInc/Roo-Code/blob/137d3f4f/src/core/condense/index.ts)）：
  - 摘要消息：`isSummary: true` + 唯一 `condenseId`；
  - 被压掉的消息：`condenseParent: <condenseId>`；
  - 滑动窗口截断（截断是压缩失败/禁用时的兜底）：`truncationParent` + 一条 `isTruncationMarker: true` 的标记消息；
  - 发给 API 前用 `getEffectiveApiHistory()` 过滤（"Fresh Start Model"：有摘要就只从摘要往后取）；`cleanupAfterTruncation()` 在摘要/标记被删除后清掉孤儿引用，让消息"复活"。
  - 多摘要字段里还顺手处理了**孤儿 tool_result**：只保留其 `tool_use` 落在被保留范围内的 tool_result 块。
- **代价清单（全部有据）**：
  - **原版是删除而非标记** ⇒ 回退到压缩点之前时消息永久丢失、上下文空白（[PR #9665 "fix: restore context when rewinding after condense"](https://github.com/RooCodeInc/Roo-Code/pull/9665) 的原话：*"When condensing, the system was deleting messages between the first message and the last N messages. When the user later rewound to a point before the condense operation, those deleted messages were permanently lost"*）。
  - **resume 会把摘要当普通 user 消息剥掉** ⇒ 所有 `condenseParent` 变孤儿 ⇒ 过滤逻辑判定它们"复活" ⇒ **整段历史重新发给 API，压缩被彻底撤销**（[PR #11488 "fix: preserve condensation summary during task resume"](https://github.com/RooCodeInc/Roo-Code/pull/11488)，对应 bug 标题是"Condensation resets on task resume — full history sent to API (escalating costs)"）。
  - 必须给"孤儿 `condenseParent`/`truncationParent`"写专门的清理函数，并在每次截断后调用。
  - 官方文档还要专门提醒用户：*"While original messages are preserved if you use Checkpoints to rewind, the summarized version is what's used in ongoing LLM calls"*（[Roo 文档](https://roocodeinc.github.io/Roo-Code/features/intelligent-context-condensing/)）——用户在 UI 看到的和模型看到的是两份东西，这本身就是一个认知负担。
- 相反地，**Cline 选的是"换一个新 task"**：`new_task` 工具 + `.clinerules` 里写明"上下文到 50% 就交接"以及"要带哪些信息过去"，由用户批准后开一个干净会话并预载结构化上下文（[Cline 博客](https://cline.bot/blog/clines-context-window-explained-maximize-performance-minimize-cost)、[Cline context windows](https://cline-cline.mintlify.app/models/context-windows)）。这与 pi 的 `/fork` 同属"分支即新会话"路线，回避了同一会话内的重放问题，代价是丢掉了共享前缀。

### 2.11 Gemini CLI

- 会话是 JSONL，`/resume` 有自动会话浏览器 + **具名 checkpoint**（`/resume save decision-point` / `/resume resume decision-point`），教程里直接把它当"分叉重来"的手段（[session management](https://geminicli.com/docs/cli/session-management/)、[command reference](https://geminicli.com/docs/reference/commands/)、[tutorial](https://geminicli.com/docs/cli/tutorials/session-management/)）。
- `/compress` 的描述是 *"Replace the entire chat context with a summary."*
- 压缩实现（[chatCompressionService.ts](https://github.com/google-gemini/gemini-cli/blob/f8541cf7/packages/core/src/context/chatCompressionService.ts)）有两点很特别：
  - 摘要格式是 `<state_snapshot>` 锚点：若待压历史里已存在 `<state_snapshot>`，就给摘要模型一条指令——*"A previous `<state_snapshot>` exists in the history. You MUST integrate all still-relevant information from that snapshot into the new one, updating it with the more recent events. Do not lose established constraints or critical knowledge."*（迭代改写的另一种措辞）。
  - **两阶段自检**：生成摘要后再跑一次校验轮，让模型自问"你有没有漏掉具体技术细节、文件路径、工具结果或用户约束？"，有则输出最终改进版（"Phase 3: The 'Probe' Verification (Self-Correction)"）。若新上下文 token 数反而比原来大，判定为 `COMPRESSION_FAILED_INFLATED_TOKEN_COUNT` 并放弃压缩。
- **事故（本题最干净的例子）**：[issue #21335 "/compress command is not persistent across session resume"](https://github.com/google-gemini/gemini-cli/issues/21335) —— `/compress` 正确替换了内存里的 chat history，但**没有写回会话文件**；`--resume` 时从磁盘读到的仍是未压缩原文，压缩等于没发生。修复只需在 `tryCompressChat` 里补一句 `this.chatRecordingService.updateMessagesFromHistory(newHistory)`。**这就是"对 messages 的一次性突变"在持久化边界上的失效模式。**

### 2.12 Letta / MemGPT

- 两种压缩模式并存（[letta/services/summarizer/summarizer.py](https://github.com/letta-ai/letta/blob/67013ef1/letta/services/summarizer/summarizer.py)）：
  1. `PARTIAL_EVICT_MESSAGE_BUFFER`（经典 MemGPT 递归摘要）：淘汰一部分消息，**把 `message[1]` 换成递归摘要**（新的 user 消息，创建进 DB），并确保 `message[2]` 是 assistant 以维持角色交替合法。
  2. `STATIC_BUFFER_SUMMARIZATION`：固定条数缓冲，淘汰时**把摘要写进一个 memory block**（不占消息序列）。`EphemeralSummaryAgent` 把新摘要与 `block.value` 里已有的上一版摘要拼起来做增量更新（`--- Previous Summary ---`），然后 `update_block_async` **就地覆盖 block**。
- memory block 的特性（[Memory Blocks 博文](https://www.letta.com/blog/memory-blocks/)、[Agent Memory 博文](https://www.letta.com/blog/agent-memory/)）：有 label / value / size limit / description，**独立持久化、有 block_id，可由 agent 自己用工具改写**；上下文窗口每次请求时"compile"出来（Jinja 模板可定制）。这就是"记忆卡"范式的原型。
- **分支语义**（[Conversations (threads)](https://docs.letta.com/v1-sdk/messages/conversations/)）：一个 agent 可以有多个 conversation，各有**自己的上下文窗口**，但**共享 memory blocks 与可搜索消息历史**。fork 一个 conversation 属于同一个 agent，共享被选中的源消息，并用 agent 当前 memory 重新编译一条 system message；`message_id` 参数可以只 fork 到某条消息（且该消息必须仍在源会话的 in-context 消息里）。原文：*"Long conversations get compacted independently."*
- **这里就是 Q4 的答案所在**：*"When the agent updates a memory block in one conversation, that change is visible in all other conversations."* 换句话说，**外置记忆卡天然是跨分支共享的、非分支局部的**。想让"记忆"尊重分支，就得自己引入可见性/作用域机制；Forlet 那一侧有一个直接证据（[tangle-network/agent-knowledge 的 branch.ts](https://github.com/tangle-network/agent-knowledge/blob/95ae6827/src/memory/branch.ts)）：它把分支 id **烧进物理 namespace**——`namespace = [logical.namespace, stableId('branch', branchId), visibility, stableId('principal', principal)].join('/')`，并声明 `AgentMemoryVisibility = 'private' | 'team' | 'shared'` 与 `AgentMemorySharingPolicy { read: Visibility[]; write: Visibility }`；也就是说，要做到"跨分支不串"，要么用作用域前缀强制隔离（按构造不可能串），要么在每个读写路径上做过滤（可漏）。

### 2.13 SillyTavern 生态与 AI Dungeon（与视觉小说引擎最同源的一支）

这一支是"分支/回退 + 长会话摘要"在消费级产品里最长时间的实战。

- **SillyTavern 内置 Summarize 扩展**（[官方文档](https://docs.sillytavern.app/extensions/summarize/)）：摘要是**独立于聊天的记忆卡**，存在 chat metadata，通过 prompt injection 注入（`Injection Template` 里的 `{{summary}}` 宏、`Injection Position` 支持"指定 depth"）。文档自己就反复警告：*"the outputs may lose some important details or contain hallucinations, so you're always advised to keep track of the summary state and correct it manually if needed."* 并且有 `Update every X messages` 这种"每隔 N 条更新一次"的调度旋钮 —— 本质是"外置卡 + 定期重算"，**与具体分支无关**。
- **qvink/SillyTavern-MessageSummarize** 走的是**每条消息自带摘要**的路线，README 里一句话把好处说清了：*"Each summary is attached to the message it summarizes, so editing/deleting a message only affects the associated memory."* 代价是它必须自己维护"短期/长期"两级注入预算、"注入阈值 + 冻结阈值以保缓存"、"阈值更新触发器"等一整套机制。
- **NovNovikov/SillyTavern-CheckpointSummarize** 是"检查点式摘要"：按**消息区间**建立 checkpoint，可审查/编辑后 lock，lock 后作为稳定记忆注入；配套能力包括 `Per-checkpoint injection toggle`、`Import and export`、**`Range hash warnings when the underlying chat messages changed`**、以及 *"reopen deleted checkpoint ranges as gaps that can be rebuilt"*（[仓库](https://github.com/NovNovikov/SillyTavern-CheckpointSummarize)）。**"区间哈希漂移告警"与"缺口重建"就是把摘要当独立条目、另外维护区间映射时必然长出来的补丁**。
- **unkarelian/timeline-memory**：章节摘要时间线存在 chat metadata，`{{timeline}}` 宏 + inject at depth；另加 "Timeline Fill" 检索与 AI 反向编辑 lorebook。同样是"外置条目 + 注入"。
- **AI Dungeon**（[Memory System](https://help.aidungeon.com/faq/the-memory-system)、[Context 组成](https://help.aidungeon.com/faq/what-goes-into-the-context-sent-to-the-ai)、[Plot Components](https://help.aidungeon.com/faq/plot-components)）的产品化程度最高，也最直接对应"视觉小说"：
  - 每 6 条 action 生成一个 Memory（LLM 摘要），存进 **Memory Bank**（带 embedding），按当前 action 的相关度**检索注入**；每 15 条 action 更新一次 **Story Summary**（全局剧情走向）。
  - 上下文是一份**显式分层、显式配额**的拼装：
    `Instructions(system) → Plot Essentials → Story Cards(触发式) → Story Summary → Memories → History → Author's Note → Last Action → Front Memory`
  - 溢出时的裁剪有明确优先级：Required 元素（Instructions / Plot Essentials / Story Summary / Author's Note / Front Memory / Last Action）争取全量，超过 70% 就按优先级裁；Dynamic 元素（Story Cards / Memory Bank / History）分剩余空间（约 25% / 25% / 50%，Memory Bank 关闭时 History 可拿 75%）。Story Summary 是**第一个被裁掉的**。
  - 注意其**时间边界设计**："等到你已经进行到第 12 条 action 时，才把最老的 6 条（action 1-6）压成第一条 Memory；最近 6 条永不压缩。你可以自由编辑或撤销最近 6 条 action 而不影响 Memories。" —— **压缩永远滞后于编辑窗口**，这正是"支持回退/编辑"的产品在没有显式分支树时的替代方案。

### 2.14 消费者/前端聊天产品的分支实践（旁证）

- **LangGraph 官方 branching-chat 配方**：*"Branching chat treats a conversation as a checkpointed timeline rather than a flat list"*，编辑/重生成都走 `stream.submit({...}, { forkFrom: { checkpointId } })`，用每条消息的 `parentCheckpointId` 作为分叉点（[docs](https://docs.langchain.com/oss/javascript/langchain/frontend/branching-chat)）。相关的实际 bug：编辑时若保留原消息 id，`getMessagesMetadataMap` 的 `findLast` 会解析到旧分支，**所有分支切换器消失**（[langchain docs#3414](https://github.com/langchain-ai/docs/issues/3414)）；编辑后紧接着提交会丢 tool_use/tool_result 配对（[agent-chat-ui#204](https://github.com/langchain-ai/agent-chat-ui/issues/204)）。
- **tianpan: Conversation Branching as a First-Class Primitive**（[链接](https://tianpan.co/blog/2026/04/23/conversation-branching-first-class-primitive)）给出了与本题一致的结构性论证：*"The correct model is copy-on-branch with structural sharing: messages are immutable, branches are pointers into a DAG, and shared prefixes exist exactly once on disk... each message is a node with a parent pointer, branches are leaf refs, and **the 'conversation' the user sees is a path from root to leaf reconstructed at read time**."* 并指出天真的深拷贝会毁掉前缀缓存（前缀字节相同但 cache key 不同）。同一篇文章也点了"共享前缀 + 分支各自的回答互相引用对方上下文"导致的**不可合并性**。
- **Claude Code `/branch` 的 rewind 泄漏**：*"The JSONL files are append-only. `/rewind` does not truncate the file — it marks messages as 'rewound' via an internal pointer, and the UI hides them. `/branch` copies the entire raw JSONL file without transferring or re-applying the rewind pointer"* ⇒ 新分支里出现"已被 rewind 掉的幽灵消息"（[stepcodex 报告](https://www.stepcodex.com/en/issue/branch-from-rewound-session-leaks-rewinded)）。**同一类问题：可见性是"指针 + 过滤"，而复制操作只看原始文件。**
- **LibreChat** 的消息树（编辑/重生成产生兄弟分支）：一段很长的 commit 说明记录了"用 per-fork 记忆修补 → 发现根因在 optimistic render 的切片 → 回滚那个补丁"的完整过程，最终结论是 *"the regenerate-slice fix is the true root cause ... so the original setSiblingIdx(0)-on-length-change never misfires, so the branch-reset is fixed without per-fork memory."*（[commit 9618be6](https://github.com/danny-avila/LibreChat/commit/9618be6eb3824ea4269ad29ddf1e2f17a7ddbb4e)）。**"加一层状态记忆"经常是症状补丁，根因在投影本身。**
- **assistant-ui** 的 branching：分支由 `messages` 数组的变化自动推导，提供 `aui.message().switchToBranch`；分支被建模为"同一位置的多条消息版本"（[文档](https://www.assistant-ui.com/docs/guides/branching)）。

### 2.15 Pydantic AI（把压缩做成"多级策略 + 收据"）

[Compaction 文档](https://pydantic.dev/docs/ai/harness/compaction/) 提供了一条不同的取舍路线，值得作为"多级压缩"的 canonical 参考：

- 大多数策略是 `Capability`，在**请求发出前**改消息历史；`SummarizingCompaction` 保留最近尾并做结构化摘要；`TieredCompaction` 逐级执行、每级后重新量 token，够了就停（顺序应为"便宜的先"：清工具结果 → 去重文件读取 → 摘要）。
- **`incremental=True`（默认）把上一版摘要当作锚点改写**：*"a prior summary is not re-summarized — summarizing summaries decays over successive compactions. It is fed back as an anchored block with an update instruction: preserve still-true details, remove stale ones, merge in new facts. The summary becomes a living document updated in place under a fixed structure."*
- **"收据"（receipt）机制**：*"Compaction is a memory wipe the model cannot veto and often cannot detect, which invites resumption drift — the model confabulates continuity with history it no longer has. A receipt makes the wipe legible: after a boundary-crossing strategy rewrites history it appends a short, deterministic note recording how much was compacted, warning that what survives is secondhand, and — when a handle provider is attached — an identifier for persisted run history."* 摘要式的收据说"上面的摘要是二手的"，纯丢弃式的收据说"那段上下文已经没了"。
- `keep_user_messages=True` 把最近若干**真实用户轮次**与摘要一起保留（用户轮次是单 token 信息量最高的内容，丢失它们是 resumption drift 的主因）；`bridge_prefix` 只在摘要模型与历史模型家族不同时加一句"这是跨模型交接"。
- durable execution 下，摘要调用作为被记录的操作，**replay 时用记录下来的摘要而不是再调一次模型**。
- 它也承认 handle 的局限：*"The handle addresses the persisted run, not a pristine transcript. Compaction's edits persist into the run's message history, so the run's latest snapshot reflects the compacted history — reading it back does not recover what the receipt says was dropped."*

### 2.16 学术侧：可逆性是第一性判据

- **What to Keep, What to Forget: A Rate–Distortion View of Memory Compaction**（[arXiv:2607.08032](https://arxiv.org/html/2607.08032)）把 KV 淘汰/量化、prompt 压缩、架构状态、agent memory 统一成一个率–失真问题，并给出两条贯穿全文的结论：
  1. *"at the same budget, a method that can fetch back what it discarded beats one that cannot, and it wins precisely on the queries that turn on the discarded material."*
  2. *"under repeated irreversible summarization, end-task error grows super-linearly in the number of compaction events, whereas a reversible, retrieval-backed memory stays flat."* ——它把这条列为预测 (4) 并做了参考实验；同时指出"agent 真实执行的反复压缩几乎没人测"（LOCOMO / LongMemEval 只测单次召回）。
- **ReCAP: Persistent Context Graphs**（[arXiv:2609.40118](https://arxiv.org/html/2609.40118)）的对比基线里明确写着 **"Codex-style summarization"**，并指出压缩有两种何时做的取舍："compacting each turn immediately loses accuracy, while waiting for later queries requires keeping the uncompressed cache meanwhile"。它用一张持久图（节点=历史块 + 重要度，边=依赖）在**新请求到达后**再做选择，从而"可以恢复此前被省略的块"——即把"什么时候决定丢什么"推迟到信息最全的时刻。
- **Context Compaction & Agentic Context Engineering: State of the Art Survey**（[redhat memory-hub](https://github.com/redhat-ai-americas/memory-hub/blob/main/research/context-compaction-survey.md)）汇总的可操作结论包括：结构化摘要优于自由格式（Factory.ai 在 36,611 条生产消息上的评测：3.70 vs 3.44(Anthropic) vs 3.35(OpenAI)，artifact tracking 一项三家都只有 2.19–2.45/5.0）；建议在 ~70% 而非 95% 触发；"compaction 是动量"。
- **Zylos 的工程建议**（[链接](https://zylos.ai/research/2026-04-21-agent-context-compaction-long-running-sessions/)）里有两条与本问题直接相关：
  - *"Offload long-lived facts to external memory on write, not at compaction time."*
  - *"Design for compaction chains from day one. Assume any session over 4 hours will compact 10+ times. This means: (a) external memory must be the source of truth for durable facts, not the compaction summary..."*
- 记忆系统综述（[arXiv:2604.01707](https://arxiv.org/html/2604.01707v3)）把 agent memory 拆成"信息抽取 / 记忆管理 / 记忆存储 / 信息检索"四模块，其中"记忆管理"的五个操作（连接、整合、跨层级迁移、更新、过滤）与压缩的关系最紧；也报告了"上下文规模从 50% 扩到 200% 时几乎所有架构的 F1 都下降（噪声压倒信号）"。

---

## 3. 三种情形对照表（Q2 收口）

| 系统 | 回到压缩点之前 | 跳到另一条分支 | 再跳回来 |
| --- | --- | --- | --- |
| **pi-agent-core** | 移动 leaf ⇒ 该 compaction 记录不在路径上 ⇒ 投影自动回原文。**无撤销逻辑** | 移动 leaf；可选在目标处 append 一条 `BranchSummaryEntry`（`parentId`=目标、`fromId`=旧 leaf）。被放弃分支完整保留 | 路径重新包含原 `compaction` ⇒ 摘要**自动回来**。多次压缩时只取路径上最靠后的那条 |
| **Codex** | `ThreadRolledBack { num_turns }` 反向扫描时跳过 N 个含 user 消息的完结轮；从最新幸存 replacement checkpoint 向前重放 | `thread/fork`：新 thread id + 拷贝（或 `Referenced` + `history_base` 引用）历史；`thread/revert` 用 `rollout_id_override` 写新 rollout 文件、thread id 不变 | 从 rollout 反向扫到最近的 replacement-history checkpoint，再向前重放；压缩会清掉 `reference_context_item`，需后续 `TurnContextItem` 重建基线 |
| **Claude Code** | rewind 到该 checkpoint；但 `compact_boundary.parentUuid = null` 使原树被切断，读侧要走 `logicalParentUuid` 才能跨过（多处 issue 说明它长期不可用） | `/branch` / `--fork-session`：新会话 + 拷贝历史（并会把 rewind 掉的幽灵消息一起带过去） | `/resume`：定位最近一条 `compact_boundary` 重建 `[摘要, 边界, ...后续]`。已知多条边界时可能锚到更早那条 |
| **Anthropic API** | 无分支概念：block 之前的一切在后续请求里被丢弃；要"回去"只能改历史并重新压缩 | 不适用（客户端自管） | 必须每次带 block 且放首位；多次压缩后**只发最新一个** |
| **OpenAI Responses** | 不适用 | 不适用 | 必须原样回传 compaction item；换了 provider/模型就不能用（OpenCode 的"不可移植"说明） |
| **LangGraph（RemoveMessage 路线）** | fork 到压缩之前的 checkpoint ⇒ 那次改写根本不存在（**前提：messages 就在被 checkpoint 的 state 里**） | `forkFrom: { checkpointId }` | 与 fork 相同；但若 UI 也从同一份 state 读，历史在用户眼里就消失了 |
| **Deep Agents（指针路线）** | `state["messages"]` 从未被改写 ⇒ 任意分叉都拿到完整原文；投影只按 `cutoff_index` 裁 | 同上（state 是唯一真相） | 指针一直在 state 里 ⇒ 摘要自动生效。代价：state 永不收缩 |
| **OpenHands** | `View.from_events` 只应用"当前事件列表里存在的那条 condensation"；事件被回退后投影自然回到原文 | 事件流本身的回退/分叉由 session/controller 管理 | 与 pi 同构：投影看到 condensation 就应用 |
| **Roo Code** | 用户 rewind 时摘要消息被删 ⇒ `condenseParent` 变孤儿 ⇒ `cleanupAfterTruncation` 清引用 ⇒ 消息复活。**必须有一套完整的孤儿清理** | 新 task 或 rewind | 只要摘要消息还在，`getEffectiveApiHistory` 就继续过滤；**但 resume 剥掉尾部摘要就会把压缩整个撤销** |
| **Gemini CLI** | `/rewind` 到 checkpoint（checkpoint 同时快照文件 + 会话） | `/resume save/resume <tag>` 具名检查点 | 取决于 `/compress` 的结果**有没有落盘**（见 issue #21335：没落盘 ⇒ 压缩消失） |
| **Letta** | conversation fork（`message_id` 可指定只到某条消息）；但 **memory blocks 跨 conversation 共享**，不进分支 | `conversations.fork`：同 agent、共享源消息、用当前 memory 重新编译 system message | 摘要作为消息或 block 独立持久化，"回来"就是重新 compile |
| **AI Dungeon** | 最近 6 条 action 永不压缩，可自由编辑/撤销；更早的已被压成 Memory | 不适用（无分支） | 不适用 |

---

## 4. 最小 canonical 形态（Q3）

### 4.1 四字段形态（业界收敛点）

```
CompactionRecord {
  锚点位置   : 记录在日志中的位置（由 parentId / 序号天然给出，无需额外字段）
  summary    : string                      // 摘要正文
  保留边界   : firstKeptEntryId（指针）    // 二选一
              | retainedTail（内联副本）   // 二选一
  tokensBefore: number                     // 用于计量与决策
}
// 可选：previousSummary（迭代改写底稿）、details（实现自定义数据）、usage、fromHook
```

投影规则（所有系统的等价形式）：

```
entries = 当前路径(leaf → root) 上按时间正序的条目
lastCmp = entries 中最后一条 compaction 记录
messages = (lastCmp == null)
         ? entries.flatMap(toMessages)
         : [ 摘要消息(lastCmp.summary) ] ++ lastCmp.保留段 ++ entries.after(lastCmp).flatMap(toMessages)
```

**这条规则同时解决三个情形**，因为"哪条摘要生效"完全由路径决定。

### 4.2 两种等价的保留边界表达，代价不同

| | 指针式 `firstKeptEntryId` | 内联式 `retainedTail` |
| --- | --- | --- |
| 采用者 | pi 1.0 公开格式、Codex 的 `replacement_history` 后缀重放、OpenCode 的 `tail_start_id`、Anthropic 的"保留最近几轮" | pi-agent-core **0.87.1 本地版本**（v4 从 v3 的指针升级而来） |
| 存盘 | 无重复 | 重复一份保留段 |
| 投影 | 需要回查树（O(保留段)），指针失效要报错或回退到"压缩条目之后那一条" | O(1) |
| 后续编辑 | **保留段里的消息被编辑会同步反映** | 副本是快照，编辑不反映（除非额外做失效处理） |
| 多次压缩 | 从"上次的保留边界"开始重算（能覆盖上次幸存的段） | 虚拟化回条目序列再重算（等价，本仓库源码即如此，见 2.1.4） |

**指针式是更"树原生"的形态**；内联式牺牲正确性一致性换投影简单度。若树上的节点内容可变（本项目"改一句台词"就是这种情况），指针式更稳。

### 4.3 第二种 canonical 形态：把标记打在既有节点上（无独立节点）

若不想新增 entry 类型，可以把摘要挂到**边界事件**上：

- Roo Code：`condenseId` 挂在摘要消息上、`condenseParent` 挂在被压消息上；
- SillyTavern-MessageSummarize：摘要直接挂在它所摘要的那条消息上；
- stage-ai 现状：`nsfwSummary` 挂在限制级段落末拍 `beat_end` 的 `payload` 上，重放时由 `lineageToBeats` 按读者身份换成 `nsfwTransitionBeat(summary)`。

这种形态的**适用条件**：摘要与某个既有事件一一对应、且不需要"跨多个事件聚合"的新位置。它的代价见 §5（可见性过滤、孤儿清理、投影必须全链路统一）。

### 4.4 第三种：把"就地突变"表达成 append-only 记录（pi 的 `ContextEditEntry`）

pi 对 `context_edit` 的定义值得单独抄一遍，因为它是"任何结构性突变在 append-only 世界里怎么表达"的通用答案：

> *"Append-only edit of one earlier context-producing entry. It changes only future model context; the target entry and its metadata remain unchanged in raw history, UI, exports, and session accounting. ... If several edits target the same entry, the latest edit on the active branch wins. **Edits are branch-relative: navigating to a point before the edit reveals the target's original contribution again.**"*

即：**不要改数据，追加一条"从此刻起如何看待那条数据"的记录**，投影时应用。分支正确性自动成立。这条原则可以直接覆盖本项目"改一句台词""切换限制级模式"这两种结构性操作。

---

## 5. 反面经验：把摘要做成"记忆卡 + 可见性过滤"的代价（Q4）

按"代价类型"归类，每条都有出处。

### 5.1 一次性突变 + 持久化边界 ⇒ 压缩"消失"

- **Gemini CLI `/compress` 不落盘**：内存里压缩成功，`--resume` 读回未压缩原文，"压缩等于没发生"（[#21335](https://github.com/google-gemini/gemini-cli/issues/21335)）。
- **Roo Code resume 剥掉尾部摘要** ⇒ 所有 `condenseParent` 孤儿化 ⇒ 过滤逻辑判定消息复活 ⇒ **整段历史重新发给 API，成本回升**（[PR #11488](https://github.com/RooCodeInc/Roo-Code/pull/11488)）。
- **Hermes branch 从实时视图取种子**：in-place 压缩把被压轮次标成 `compacted=1` 后，分支 seed 只剩 42 条（父会话有 132 条可见消息），而 `get_resume_conversations` 兜底只读 `active=1`；**压缩过的父会话，其早期轮次对分支不可达**（[#80973](https://github.com/NousResearch/hermes-agent/issues/80973)）。
- **LangChain 的 `RemoveMessage` 未生效** ⇒ 摘要叠加旧消息，上下文无限增长（[langgraph#5112](https://github.com/langchain-ai/langgraph/issues/5112)）。
- **LangChain 的占位摘要**：摘要模型从未被调用，一句 `"Previous conversation was too long to summarize."` 被当成摘要，删掉 75 条消息后持久化，**不可恢复**（[langchain#39261](https://github.com/langchain-ai/langchain/issues/39261)）。

### 5.2 摘要伪装成普通消息 ⇒ 消费者必须靠"标记/启发式"识别，识别错了就出事

- **Hermes composite carrier**：摘要脚手架与当前真实请求共处同一 `role=user` 行 ⇒ retry/undo 把整行当脚手架跳过 ⇒ **重发旧请求并把压缩上下文截掉**。修复需要：统一投影函数（`user_originated_turn_view`）、私有元数据键、rewind 时"归档 carrier + tail 并原子地重新插入一条隐藏的纯脚手架"（[#81233](https://github.com/NousResearch/hermes-agent/issues/81233)、[PR #93784](https://github.com/NousResearch/hermes-agent/pull/93784)）。
- **Hermes 的历史前缀白名单**：每改一次摘要前缀，就必须把旧前缀**冻结**进一个只能 prepend、不能改不能排序的列表，并有测试逐条 byte-pin；否则"旧前缀里那句指令会残留在正文里继续劫持回复"（[源码注释](https://github.com/NousResearch/hermes-agent/blob/28f7c4e6/agent/context_compressor.py)）。
- **Hermes 的弱模型误读**：逐字引用的 `## Active Task` 被当作新的用户输入（#11475、#14521）；assistant role 的摘要被当成自己的输出吐出来（#33256）。
- **Claude Code 的 `isCompactSummary`**：resume 重建要靠这个 flag 认出"这是摘要而不是用户消息"，进而要区分 `progress` 等不可落盘类型、要重链 `parentUuid`、要在 5MB 以上走"只读边界之后"的优化（[#46603](https://github.com/anthropics/claude-code/issues/46603)、[#61188](https://github.com/anthropics/claude-code/issues/61188)、[#44772](https://github.com/anthropics/claude-code/issues/44772)、[五层叠加分析](https://yurukusa.hashnode.dev/claude-code-scrollback-compaction-five-bugs)）。

### 5.3 可见性过滤是"额外一套需要自己维护正确性的子系统"

Roo Code 的完整代价清单（[PR #9665](https://github.com/RooCodeInc/Roo-Code/pull/9665) 及后续）：

1. 原版**删除**被压消息 ⇒ 回退到压缩点之前时上下文永久丢失；
2. 改为**标记**（`condenseParent` / `truncationParent` / `isSummary` / `isTruncationMarker`）⇒ 需要 `getEffectiveApiHistory()` 这条过滤函数，且所有发 API 的路径都必须走它；
3. 需要 `cleanupAfterTruncation()` 在每次截断后清孤儿引用；
4. 需要处理"孤儿 tool_result"（其 `tool_use` 落在被压区间之外）否则 provider 报错；
5. 需要 UI 消息与摘要消息通过 `condenseId` 成对删除同步；
6. 需要给"连续两次压缩""压缩后截断""回退到两次操作之间"等组合写专门的测试；
7. 用户看到的（UI）与模型看到的（API）是两份不同的历史。

> 这正是系列文章中那个结构性论断的具体体现：*"Compression against a flat sequence has nowhere to attach a summary except in place of the thing it summarised."*（[hashnode](https://harrisonsec.hashnode.dev/your-agent-session-is-a-tree-your-code-thinks-it-is-a-list)）

OpenHands 侧的同构代价：`forgotten_event_ids` 的 O(V×F) 成员判断；`_ensure_initial_user_message` 必须检查"第一条 user 消息是否已被压缩掉"才决定要不要插回去；摘要一度不在历史里导致模型"重做旧事"、stuck detector 看不到压缩而连环触发到 500 轮（[PR #7132](https://github.com/All-Hands-AI/OpenHands/pull/7132)、[#3153](https://github.com/OpenHands/software-agent-sdk/issues/3153)）。

**tangle-network/agent-knowledge 的对照解法**：把分支 id 直接烧进物理 namespace（`.../branch/<branchId>/<visibility>/<principal>`），并声明 `AgentMemorySharingPolicy { read[], write }` 与 `branchIsolation` 能力声明（不支持就**直接抛错**而不是静默降级），并发写用 mutation barrier 串行化。也就是说：要么用命名空间按构造隔离，要么在每个读写路径上过滤——后者就是 Roo/OpenHands 走过的路。

### 5.4 "指针式不破坏"换来的另一头代价：状态不收缩

- deepagents（Python）#2874：`_summarization_event` 只记 `cutoff_index` + `summary_message`，state 永不裁剪 ⇒ checkpoint 写放大（每步重新序列化整个 messages 列表）、resume 反序列化全量历史、进程 RSS 长期持有已被摘要掉的工具输出与大参数（[#2874](https://github.com/langchain-ai/deepagents/issues/2874)）。给的两条出路是"补一条 reducer-aware 删除"或"加周期性 materialize"。
- JS 侧同类问题的另一面：offload 静默失败但摘要里仍写着文件路径 ⇒ 模型照做得到 `File not found`（[deepagentsjs#621](https://github.com/langchain-ai/deepagentsjs/issues/621)）。

**结论**：指针式非破坏是分支正确性最高的方案，但**必须配一个独立的保留/归档/清理策略**（谁可以删、按什么条件删、删了之后"回退到更早"还能不能重建），而这正好是 A1 形态要额外承担的责任。

### 5.5 记忆卡跨分支共享 ⇒ 串味

- Letta 明说 memory blocks 跨 conversation 共享，一个 conversation 的更新对其它 conversation 可见；只有 per-conversation 的上下文窗口是隔离的（[Conversations](https://docs.letta.com/v1-sdk/messages/conversations/)）。
- Hermes 线上的真实事故：#46303 两个并发会话通过 Honcho 注入的 memory-context 互相"看到"对方的在途 checkpoint，*"Session B 'recalls' Session A's checkpoint/observations as if they were its own"*；#98390 则是"另一个会话的内容以工具卡形式渲染进当前 thread"，被用户读成会话污染（并明确说明：*"This is not a data-leak bug: Honcho and session-search are peer-scoped / cross-session by design. The issue is purely presentational"*）——**即"设计如此"与"用户读起来像污染"之间需要一个显式的来源标注**。
- LibreFang #2349：会话 key 只有 `(AgentId, channel)`、无 `chat_id` 分量，导致群聊与私聊共用一个 session、上下文互串；修复是在 key 里加入 `chat_id`（[#2349](https://github.com/librefang/librefang/issues/2349)）。
- 一个反面对照（把"分支=完整命名空间"当成硬规则的项目）：[let-them-talk 的 branch-semantics](https://github.com/Dekelelz/let-them-talk/blob/master/docs/architecture/branch-semantics.md) 明确列出 **"compressed history"属于 branch-local 派生状态**，并规定 *"Switching branches MUST replace the whole migrated branch-local bucket at once. It MUST NOT switch only message/history while leaving the rest shared."* 以及 *"Branch creation snapshots the migrated branch-local state ... copy-on-fork, not a live overlay."*

### 5.6 压缩与"编辑/回退/重试/分支"的交互是最容易出错的面

- Claude Code：压缩切断 rewind 树（[#24471](https://github.com/anthropics/claude-code/issues/24471)）；"Summarize up to here"期间完成的轮次被静默丢弃（[#75413](https://github.com/anthropics/claude-code/issues/75413)）；resume 显示旧摘要（[#43941](https://github.com/anthropics/claude-code/issues/43941)）；resume 不回灌压缩后的在途尾部（[#47508](https://github.com/anthropics/claude-code/issues/47508)）；`/branch` 把 rewind 掉的幽灵消息带进新会话。
- OpenCode：`revert` 后立刻 `/compact` 会按"revert 从未发生"执行（[#6186](https://github.com/anomalyco/opencode/issues/6186)）。
- VS Code Copilot：后台压缩的 summarizer 只以 sessionId 为 key，模型切换或 `/compact` 之后仍被无条件应用 ⇒ 在空间充裕的轮次弹出 "Compacted conversation"（[commit 15bd799](https://github.com/microsoft/vscode/commit/15bd7994c436c45036df0a849ac03fa8c63fe9a6)）。它的修法是给 summarizer 记 `endpointModel` + 应用前再卡一次 `contextRatio >= 0.65`。
- pi：工具执行中途改 leaf ⇒ 孤儿 `tool_result` 被**持久化**到 JSONL，之后每次投影都 400（[pi-context#23](https://github.com/ttttmr/pi-context/issues/23)）。
- Anthropic API：把被摘要的消息留在 block 之后不报错但**付两次钱**；block 不在首位直接 400。

---

## 6. 结论性对比与推荐

### 6.1 谁最 canonical

按"是否把压缩结果当作树/日志的一等记录 + 是否让分支正确性由投影而非过滤保证"这一条判据，业界最 canonical 的两家是：

1. **pi-agent-core / pi**：`CompactionEntry` + `BranchSummaryEntry` + `ContextEditEntry`，全部是带 `parentId` 的 append-only 记录；`buildContextEntries` 是唯一的重建入口；"编辑"也表达为 append-only 记录且**分支相对**。代价是它有约 1,550 行压缩代码（第三方统计），且历史上仍出过"摘要挂错分支""fromId 记错""树变了上下文没换""工具中途改 leaf 造成孤儿"等 bug（见 §2.1.8）。
2. **Codex**：`RolloutItem::Compacted` + 反向扫描选 checkpoint + 向前重放后缀；`thread/fork`、`thread/revert`、`resume` 共用一套重建；回滚穿越压缩有正式测试。代价是 `CompactedItem` 的字段演化与 "compaction 清掉上下文基线" 这类不变量需要显式维护。

**次优但极简**：OpenHands 的 `Condensation{forgotten_event_ids, summary, summary_offset}` + `View.from_events()` —— 用一个事件类型 + 一个纯函数表达全部语义，最容易读懂；代价是 id 集合的体积/性能，以及"摘要是否进历史"这个次生问题。

**"原地改写"派里唯一站得住的**：LangGraph checkpointer 路线 —— 前提是 messages 本身就在被 checkpoint 的 state 里，那么"分叉到压缩之前"就等于"那次改写不存在"。但官方论坛自己也建议把"UI 历史"和"LLM 工作上下文"分成两份存储，否则用户看不到历史。

### 6.2 推荐（按适用条件）

**若能接受"新增一种记录类型"（推荐）**：

- **形态**：一条持久记录 `{ summary, 保留边界, tokensBefore }`，挂在压缩发生的位置上；messages 由"当前路径 + 读取身份"投影生成。
- **保留边界用指针**（`firstKeptEntryId` / `tail_start_id`），不用内联副本——这样树上对保留段的编辑会同步生效（本项目"改一句台词"是常态）。
- **摘要消息用独立 role**（`compactionSummary` / `branchSummary` 这类），不要伪装成 user/assistant。
- **压缩与导航的树变更整体原子化**，绝不在工具执行中途移动位置（pi-context#23 的教训）。
- **必须同时定下保留/归档策略**，否则走 deepagents#2874 的老路（状态不收缩）。
- **回退/分支路径要有专门的集成测试**，至少覆盖：压缩 → 回退到压缩点之前 → 再回退回来；压缩 → 分岔 → 两条分支各自再压缩；多次压缩 × 回退（Codex 的 `compact_resume_fork.rs` 是很好的模板）。

**若不接受新增记录类型（次选）**：把摘要标记挂在**边界事件**上（本项目已有 `beat_end.payload.nsfwSummary` 的先例）。此时必须承认并承担 §5.3 的全部代价：需要一个唯一的投影函数、需要孤儿清理、需要"谁能识别这是摘要"的稳定标记（不能靠内容启发式）、需要旧前缀/旧格式的兼容策略；并且**所有消费者（重试、回退、分支、导出、UI）都必须走同一个投影**，否则 Hermes `#81233` 会重演。

**明确不推荐**：把摘要正文并进一条真实消息（无论并进首条 user 还是尾条 user）。它带来的是：识别歧义（需要私有关键字 + 分隔符 + 前缀白名单）、消费者必须统一投影、回退时"carrier + tail"要原子归档重建、以及"摘要丢失即压缩失效"的单点。Hermes 是把它做到极限之后的完整代价清单，Google 的 `/compress` 则是这条路线在持久化边界上失效的最简例子。

**特殊情形**：如果对话不需要"同一会话内任意跳"，而只需要"回到某个检查点"（像 Cline 的 `new_task`、Gemini 的具名 checkpoint、Claude Code 的 `/branch`），那么"分支 = 新会话 + 拷贝/引用历史"是更省事的选择，代价是失去共享前缀（前缀缓存、结构共享、跨分支一致性都要自己再补）。

### 6.3 一个经常被忽略但必须一并回答的问题

多数系统在压缩后都要处理"**摘要之外，还有哪些状态必须在重放后重新得到**"。业界给出的答案有三种，且它们都指向"不要指望摘要承担全部"：

1. **从外部真实来源重新取回**：Anthropic 说 Claude Code 压缩是 *"compressed context plus the five most recently accessed files"*。
2. **外置全文 + 摘要里埋指针**：Deep Agents 的 `/conversation_history/{id}.md` + `read_file`；Hermes 的 `session_search` 恢复指针 + 机械抽取的锚点索引（PR/SHA/路径/错误串，正则，绝不改写）。
3. **逐字保留高信号原文**：Codex 保留用户原始指令；Hermes `keep_user_messages` / `min_tail_user_messages`；Pydantic AI 的 `keep_user_messages=True`；AI Dungeon"最近 6 条 action 永不压缩"。

---

## 7. 对本仓库现状的锚点（对 stage-ai 代码的阅读，非业界结论）

- `apps/server/src/rebuild.ts` 的 `lineageToBeats(chain, names, opening, { nsfw })` 已经是"**路径 + 读取身份 → 对话轮次**"的纯函数投影：谱系事件日志是唯一真相源，分岔/跳转/编辑之后从日志重放。文件头的注释就写着 *"谱系事件日志是唯一真相源…完成一次突变后即回到 append-only 稳态。"*
- **同一文件里已经有一个 canonical 的先例**：限制级段落末拍的 `beat_end` 上挂 `payload.nsfwSummary`；SFW 侧读者在重放时把整段折叠成 `nsfwTransitionBeat(summary)`，且注释明确写了"实时退出（`orchestrator.switchBackToSfw`）与从谱系重建（`lineageToBeats` 的折叠）共用它——两处各写一套必然漂移，而漂移的表现是「退出前后模型看到的上下文不一样」"。**这正是"摘要作为树节点属性 + 重放时按路径/身份投影"，且已经踩过"两份实现必然漂移"这个坑。**
- `apps/server/src/compaction.ts` 的纪元压缩目前是另一条路：
  - 摘要拆成 `oneLiner`（进 A 区 arcs 卡的 summary）+ `body`（`read_memory_detail` 返回）；
  - `withSeed(tail, seed)` 把回注正文**并进保留段的第一条 user 消息顶部**，注释解释了原因（"相邻两条同角色消息在部分 OpenAI 兼容网关上会被拒或打乱角色结构"）——这与 Hermes 的 merged carrier 是同一个权衡，因此 Hermes §5.2 那份代价清单（分隔符、私有关键字、前缀白名单、统一投影、rewind 特殊处理）在本项目同样适用；
  - 该回注不在谱系上，所以一旦 `lineageToBeats` 重放（跳转、分岔、编辑、进出限制级），它就丢；而摘要文件与"哪些摘要属于这条分支"的 id 清单是持久的——这正是"记忆卡 + 另外维护可见性过滤"的形态。
- 因此本仓库可用的两条自洽路线，都已有先例落在自身代码库里：
  - **把纪元压缩产出做成谱系上的属性**（与 `nsfwSummary` 同构）：在纪元边界那一拍上挂摘要（一句话 + 正文，或正文单独 archive），`lineageToBeats` 重放时按读者身份注入 `withSeed`。这样"跳回压缩点之前 → 原文；再跳回来 → 摘要自动回来"由投影免费获得，`withSeed` 的合并策略与网关兼容问题保持不变。
  - **或新增一条"压缩记录"节点**（`retainedTail`/指针 + `tokensBefore` + `details`），沿用 pi 的 `buildContextEntries` 投影规则。代价是必须同步定下保留/归档与清理策略（§5.4），以及重试/回退/导出等所有消费者统一走同一个投影函数。

---

## 8. 来源清单

**pi-agent-core / pi**
- https://pi.dev/docs/latest/compaction
- https://pi.dev/docs/latest/session-format
- https://hochej.github.io/pi-mono/coding-agent/tree/
- https://gist.github.com/colelawrence/b9b5ebc48abef6ceba8cf5fb91117db5 （Durable sessions and reconstruction in Pi）
- https://upd.dev/badlogic/pi-mono/commit/01dae9ebcc86ab17d9f49bb391e738754df0f7fa
- https://github.com/badlogic/pi-mono/issues/3796
- https://github.com/badlogic/pi-mono/issues/1781
- https://github.com/badlogic/pi-mono/blob/efc58fed/packages/coding-agent/test/agent-session-tree-navigation.test.ts
- https://github.com/badlogic/pi-mono/blob/dd6bea41/packages/agent/src/harness/compaction/branch-summarization.ts
- https://github.com/ttttmr/pi-context/issues/23
- https://github.com/Yeachan-Heo/gajae-code/blob/main/docs/compaction.md
- https://cdn.jsdelivr.net/npm/@hugolsramos01-bit/pi-coding-agent@0.80.7-agentic.1/docs/compaction.md
- 本地源码：`node_modules/@earendil-works/pi-agent-core/dist/harness/{session/types.d.ts, session/context.js, session/jsonl/legacy-v3.js, session/jsonl/types.d.ts, compaction/compaction.js, compaction/compaction.d.ts, compaction/branch-summarization.d.ts, messages.d.ts, agent-harness.d.ts, session/session.d.ts}`（版本 0.87.1，JSONL format v4）

**Codex / OpenAI**
- https://rememorio.github.io/blog/codex/en/rollout-recovery/
- https://github.com/openai/codex/pull/12612
- https://github.com/openai/codex/pull/12252
- https://github.com/openai/codex/pull/3533
- https://github.com/openai/codex/commit/674e3d3c90d78508602c720c0f2d304ec5715a26
- https://github.com/openai/codex/blob/27c05a52/codex-rs/core/tests/suite/compact_resume_fork.rs
- https://github.com/openai/codex/blob/main/codex-rs/rollout/src/recorder.rs
- https://github.com/openai/codex/issues/45393
- https://developers.openai.com/api/docs/guides/compaction
- https://developers.openai.com/api/reference/resources/responses/methods/compact/
- https://openai.com/index/equip-responses-api-computer-environment/
- https://vercel.com/docs/ai-gateway/sdks-and-apis/responses/compaction
- https://openai.github.io/openai-agents-js/openai/agents-openai/classes/openairesponsescompactionsession/
- https://github.com/openai/openai-python/issues/3075

**Claude Code / Anthropic**
- https://code.claude.com/docs/en/checkpointing
- https://platform.claude.com/docs/en/build-with-claude/compaction
- https://platform.claude.com/docs/en/build-with-claude/compaction-background
- https://platform.claude.com/docs/en/build-with-claude/context-editing
- https://docs.anthropic.com/en/build-with-claude/compaction
- https://www.aicodex.to/articles/compaction-on-demand
- https://m2ml.ai/post/anthropic-compaction-api-server-side-context-for-long-agent-sessions-cmod0hehc000l3lnvqdz667m3
- https://www.anthropic.com/engineering/effective-context-engineering-for-ai-agents
- https://platform.claude.com/cookbook/tool-use-context-engineering-context-engineering-tools
- https://sanbuphy-claude-code-source-code.mintlify.app/concepts/context-management
- https://sanbuphy-claude-code-source-code.mintlify.app/architecture/session-persistence
- https://jwcrystal.github.io/claude-reviews-claude/en/architecture/09-session-persistence
- https://github.com/anthropics/claude-code/issues/24471
- https://github.com/anthropics/claude-code/issues/43941
- https://github.com/anthropics/claude-code/issues/44772
- https://github.com/anthropics/claude-code/issues/46603
- https://github.com/anthropics/claude-code/issues/47508
- https://github.com/anthropics/claude-code/issues/55700
- https://github.com/anthropics/claude-code/issues/61188
- https://github.com/anthropics/claude-code/issues/75413
- https://yurukusa.hashnode.dev/claude-code-scrollback-compaction-five-bugs
- https://www.stepcodex.com/en/issue/branch-from-rewound-session-leaks-rewinded
- https://github.com/Jwrede/claude-rescue

**LangGraph / LangChain / Deep Agents / LangMem**
- https://docs.langchain.com/oss/python/langgraph/checkpointers
- https://docs.langchain.com/oss/python/langgraph/use-time-travel
- https://docs.langchain.com/oss/python/langgraph/add-memory
- https://docs.langchain.com/oss/python/langchain/short-term-memory
- https://docs.langchain.com/oss/javascript/langchain/frontend/branching-chat
- https://forum.langchain.com/t/langgraph-postgresql-chat-history-and-summarization-best-practice/3521/2
- https://github.com/langchain-ai/langgraph/issues/5112
- https://github.com/langchain-ai/langchain/issues/39261
- https://github.com/langchain-ai/langchain/blob/98216c0c/libs/langchain_v1/langchain/agents/middleware/summarization.py
- https://github.com/langchain-ai/deepagents/issues/2874
- https://github.com/langchain-ai/deepagentsjs/issues/621
- https://reference.langchain.com/python/deepagents/middleware/summarization
- https://github.com/langchain-ai/deepagents/blob/bdc7da64/libs/deepagents/deepagents/middleware/summarization.py
- https://www.langchain.com/blog/context-management-for-deepagents
- https://langchain-ai.github.io/langmem/guides/summarization/
- https://github.com/langchain-ai/docs/issues/3414
- https://github.com/langchain-ai/agent-chat-ui/issues/204

**OpenHands**
- https://docs.openhands.dev/sdk/arch/condenser
- https://docs.openhands.dev/sdk/guides/context-condenser
- https://github.com/OpenHands/software-agent-sdk/blob/main/openhands-sdk/openhands/sdk/event/condenser.py
- https://github.com/OpenHands/OpenHands/blob/bf769d1/openhands/memory/view.py
- https://github.com/OpenHands/OpenHands/blob/26fa1185/openhands/memory/conversation_memory.py
- https://github.com/All-Hands-AI/OpenHands/issues/6706
- https://github.com/All-Hands-AI/OpenHands/pull/7132
- https://github.com/All-Hands-AI/OpenHands/pull/7311
- https://github.com/All-Hands-AI/OpenHands/pull/7353
- https://github.com/OpenHands/software-agent-sdk/issues/3153
- https://www.openhands.dev/blog/openhands-context-condensensation-for-more-efficient-ai-agents

**OpenCode / Kilo**
- https://opencode.ai/v2/docs/compaction
- https://github.com/anomalyco/opencode/blob/03bba464/packages/core/src/session/compaction.ts
- https://github.com/anomalyco/opencode/blob/57ce1b9c/packages/opencode/src/session/compaction.ts
- https://github.com/anomalyco/opencode/issues/6186
- https://www.opencodebook.xyz/en/chapter_04_session_system/4.5_compaction_context_window_management
- https://deepwiki.com/sst/opencode/2.4-context-management-and-compaction
- https://github.com/Kilo-Org/kilocode/blob/0f55066d/packages/opencode/src/session/compaction.ts

**Hermes**
- https://hermes-agent.nousresearch.com/docs/developer-guide/context-compression-and-caching
- https://hermes-agent.nousresearch.com/docs/developer-guide/micro-compaction
- https://github.com/NousResearch/hermes-agent/blob/28f7c4e6/agent/context_compressor.py
- https://github.com/NousResearch/hermes-agent/blob/dd51931bfdfd0e7abb7b4c953abfd61933b52828/agent/context_compressor.py
- https://github.com/NousResearch/hermes-agent/issues/81233
- https://github.com/NousResearch/hermes-agent/pull/93784
- https://github.com/NousResearch/hermes-agent/issues/80973
- https://github.com/NousResearch/hermes-agent/pull/2323
- https://github.com/NousResearch/hermes-agent/pull/1273
- https://github.com/NousResearch/hermes-agent/pull/915
- https://github.com/NousResearch/hermes-agent/issues/46303
- https://github.com/NousResearch/hermes-agent/issues/98390

**Roo Code / Cline**
- https://github.com/RooCodeInc/Roo-Code/blob/137d3f4f/src/core/condense/index.ts
- https://github.com/RooCodeInc/Roo-Code/blob/137d3f4f/src/core/context-management/index.ts
- https://github.com/RooCodeInc/Roo-Code/blob/137d3f4f/src/core/task/Task.ts
- https://github.com/RooCodeInc/Roo-Code/pull/9665
- https://github.com/RooCodeInc/Roo-Code/pull/11488
- https://roocodeinc.github.io/Roo-Code/features/intelligent-context-condensing/
- https://cline-cline.mintlify.app/models/context-windows
- https://cline.bot/blog/clines-context-window-explained-maximize-performance-minimize-cost

**Gemini CLI**
- https://geminicli.com/docs/cli/session-management/
- https://geminicli.com/docs/reference/commands/
- https://geminicli.com/docs/cli/checkpointing/
- https://geminicli.com/docs/cli/tutorials/session-management/
- https://github.com/google-gemini/gemini-cli/issues/21335
- https://github.com/google-gemini/gemini-cli/blob/f8541cf7/packages/core/src/context/chatCompressionService.ts

**Letta / MemGPT / 其他记忆系统**
- https://github.com/letta-ai/letta/blob/67013ef1/letta/services/summarizer/summarizer.py
- https://github.com/letta-ai/letta/blob/bb52a890/letta/agents/ephemeral_summary_agent.py
- https://www.letta.com/blog/agent-memory/
- https://www.letta.com/blog/memory-blocks/
- https://docs.letta.com/v1-sdk/messages/conversations/
- https://github.com/cpacker/MemGPT/issues/1947
- https://github.com/letta-ai/skills/blob/main/letta/agent-development/SKILL.md
- https://github.com/tangle-network/agent-knowledge/blob/95ae6827/src/memory/branch.ts
- https://github.com/Dekelelz/let-them-talk/blob/master/docs/architecture/branch-semantics.md
- https://github.com/librefang/librefang/issues/2349
- https://github.com/Lilac-Labs/gini-agent/blob/main/docs/adr/agent-memory-isolation.md

**SillyTavern 生态 / AI Dungeon / 前端分支 UI**
- https://docs.sillytavern.app/extensions/summarize/
- https://github.com/SillyTavern/SillyTavern-Docs/blob/main/extensions/Summarize.md
- https://github.com/qvink/SillyTavern-MessageSummarize
- https://github.com/NovNovikov/SillyTavern-CheckpointSummarize
- https://github.com/unkarelian/timeline-memory/
- https://deepwiki.com/SillyTavern/SillyTavern/6-context-and-memory-systems
- https://deepwiki.com/SillyTavern/SillyTavern/3.3-prompt-assembly-pipeline
- https://deepwiki.com/SillyTavern/SillyTavern/9-group-chats-and-multi-character-interactions
- https://help.aidungeon.com/faq/the-memory-system
- https://help.aidungeon.com/faq/what-goes-into-the-context-sent-to-the-ai
- https://help.aidungeon.com/faq/plot-components
- https://help.aidungeon.com/faq/story-cards
- https://help.aidungeon.com/faq/what-is-the-authors-note
- https://help.aidungeon.com/how-do-i-manage-context
- https://github.com/SlumberingMage/AID-Programming-Guide
- https://github.com/Worldsmythe/FoxTweaks/blob/54cf86b3f34406a7f4c4293b4dc0267ebdf3d443/src/aidungeon.d.ts
- https://github.com/danny-avila/LibreChat/commit/9618be6eb3824ea4269ad29ddf1e2f17a7ddbb4e
- https://www.assistant-ui.com/docs/guides/branching
- https://github.com/gptme/gptme/commit/d90b7e727210153ec03e32f5c87104a06222f32e
- https://tianpan.co/blog/2026/04/23/conversation-branching-first-class-primitive
- https://harrisonsec.hashnode.dev/your-agent-session-is-a-tree-your-code-thinks-it-is-a-list

**其他机制实现**
- https://pydantic.dev/docs/ai/harness/compaction/
- https://bastani.mintlify.app/compaction
- https://github.com/microsoft/vscode/commit/15bd7994c436c45036df0a849ac03fa8c63fe9a6
- https://github.com/cartazio/oh-punkin-pi/blob/main/docs/compaction.md
- https://cdn.jsdelivr.net/npm/open-multi-agent-kit@0.93.0/docs/compaction.md

**学术与综述**
- https://arxiv.org/html/2607.08032 （What to Keep, What to Forget: A Rate–Distortion View of Memory Compaction）
- https://arxiv.org/html/2609.40118 （ReCAP: Persistent Context Graphs）
- https://arxiv.org/html/2604.01707v3 （Memory in the LLM Era: Modular Architectures and Strategies）
- https://github.com/redhat-ai-americas/memory-hub/blob/main/research/context-compaction-survey.md
- https://zylos.ai/research/2026-04-21-agent-context-compaction-long-running-sessions/
- https://arxiv.org/html/2607.21503v1 （Solving Agent Memory and Cost by Treating Them as Lifecycle）
- https://factory.ai/news/evaluating-compression （经由上述综述引用）
