# 261004 限制级内容隔离 —— 实施总结

分支：`feat/nsfw-isolation`（基线 main `177dd76`，含 memory-state 5 项）

## 为什么做

需求原话：「NSFW 内容对 SFW 可见的只有带出的 SFW 摘要（压缩也应该基于这个）」。

改动前，限制级内容只在**实时退出的那一刻**被净化——`switchBackToSfw` 把主模型的上下文重建为「净化基线 + 两轮过渡」。但那份过渡只活在内存里，谱系树上没有任何标记。于是有三条回流路径：

1. 任何从树重建上下文的入口（分支跳转、改一行、将来从谱系恢复）都按 `lineageToBeats` 无条件取 `event.text` 渲原文，**既泄漏原文、又丢掉摘要**（摘要版过渡轮不在树上，捞不回来）。
2. `closeBeat` 每轮把原文台词切一片进 `memory/archive`，`search_archive` 搜到就贴进上下文。
3. `maybeCompactEpoch` 不看模式：段落中途一压缩，露骨原文就被 `summarizeEpoch` 吃进去固化成 arc，而 arcs 是每轮注入 A 区的——**唯一会把泄漏写进长期记忆**的一条。

## 做了什么

| # | 项 | 落点 |
|---|---|---|
| 1 | 谱系事件打标 | `packages/core/src/lineage/model.ts`（`LineagePayload.nsfw` / `nsfwSummary`）、`orchestrator.appendLineage` |
| 2 | 摘要落树 + 收束时序 | `orchestrator.closeNsfwBeat` / `finishBeat` / `closeBeat` |
| 3 | 按读者折叠渲染 | `apps/server/src/rebuild.ts`（`lineageToBeats` 收 `{ nsfw }`、`nsfwTransitionBeat`） |
| 4 | 检索按读者过滤 | `apps/server/src/memory.ts`（`ArchiveSlice.nsfw`、`sliceId`、`searchArchive` 选项）、`agentkit/memoryTool.ts` |
| 5 | 段落期间不压缩 | `orchestrator.maybeCompactEpoch` 早退 |
| 6 | 模块指引 | `apps/server/AGENTS.md` 的「限制级（NSFW）通道」段 |

### 1. 打标在事件上，不在轮次上

`LineagePayload` 加两个可选字段（有索引签名，不动 `LineageEventKind` 联合，客户端/JSONL/`toNodeView` 一行不改）。段内每个节点带 `nsfw: true`；段末那一拍的 `beat_end` 额外带 `nsfwSummary: string`。

标记的取值来自 `beatNsfw`，它由 `beatChannelNsfw()` = `nsfwActive || nsfwPendingEnter` 在**这一拍的输入落树时**（`noteBeatInputs`）定下来，`startBeatWindow` 用同一个取值。这是必须的：退出那一拍的 `beat_end` 在 `nsfwActive` 已翻成 false 之后才封，但它承载的仍是限制级原文，所以它照样带标；而 prompt 节点落在开拍之前，按「开拍时才知道的 `nsfwActive`」打标，进出段两边都会错（详见「检视与返工」）。与之相对，那一拍节点上的 **快照** `nsfw` 是 `false`——事件层的「内容是限制级」与快照层的「从这里起世界线是日常」故意不对称。

### 2. 摘要生成完才算收束

时序从「先生成摘要、再重建上下文」改成：`finishBeat` 见 `nsfwPendingExit` → `closeNsfwBeat(stop, token)` → `await generateSfwSummary(...)` → 摘要就绪后**才** `closeBeat(stop, summary)` 封这一拍、才 `switchBackToSfw()` 切回日常。`beat_settled` 随之推后到摘要之后，玩家输入照旧排队等待。

摘要的生成方式没变，仍是那一次专门的 LLM 调用（`nsfwLines` + `SFW_SUMMARY_SYSTEM`）；`exit_nsfw(summary=…)` 的参数地位不变（参考/兜底）。**不变式因此成立**：段末 `beat_end` 上一定有 `nsfwSummary`。

两个并发边界：

- `beatClosing` 闸门。`turn_end` 与 `agent_end` 会各唤醒一次 `finishBeat`，而这条路径上 `busy` 不能像往常那样先落回 false（要一直占着挡下一轮）——没有闸门就会把同一拍封两遍（多一个 `beat_end`、多一片 archive）。这是实施期间自查发现并修掉的真 bug。
- `beatToken` 作废 + `disposed` 拦截。await 期间被 `forkTo` 腰斩（token 变）或组件 `dispose` 就直接返回：不封拍、不清 `nsfwLines`、更不拿净化后的上下文盖掉别人刚重建的现场。`.finally` 里先摘掉自己的 `pendingSfwSwitch`，再在 token 未变且未销毁时才复位 `beatClosing`/`busy`、`flushIdleWaiters`、按需 `onBeatSettled`。

### 3. 按读者折叠

`lineageToBeats(chain, names, opening, mode)`，`mode.nsfw === true` 时原文照渲、不注摘要；否则遇到带 `nsfw` 标的事件就把**整段**折成一条过渡轮，段内原文与段内玩家输入一概不进消息。过渡轮文案的唯一出处是 `nsfwTransitionBeat(summary)`，实时退出与从树上重建走的是同一份（见下）。

调用点：`rebuildBeats` 取 `this.nsfwActive`（`switchBackToSfw`、`rebuildBranchAt`、`editLine` 都经它）。**`rebuildBranchAt` 调了序**：`restoreBranchState` 必须在 `rebuildBeats` 之前，否则折叠模式取的是跳转前的旧模式。

**实时退出也走这条渲染**：`switchBackToSfw` 不留任何内存基线，就是 `renderBeats(rebuildBeats(materialize()))`——摘要早在 `closeBeat` 里落成段末那条过渡轮了。原实现留了一份「进入限制级前的消息快照」当基线，快照为空时退化成 `stripNsfwPreTurns(当前消息)`；而 `restoreBranchState`（跳转/分岔/读档都走它）正好会清空那份快照，此时当前消息组是按 NSFW 模式渲出来的原文，`stripNsfwPreTurns` 只认得那两条合规轮次——一压就是整段回流。

没打标的老档两种模式渲出来一样——不做迁移、不叠第二层特判（维持现状，不会更糟）。

### 4. 检索：搜得到，读的是摘要

- 段内切片带 `nsfw: true`；段末**另写一片不带标**的切片，内容就是那句摘要，`entryId` = 段末叶子。
- `searchArchive` 从 `(query, allowed, limit)` 改成 `(query, allowed, opts)`，命中过滤 `allowed.has(slice.entryId) && (opts.nsfw === true || slice.nsfw !== true)`。SFW 侧滤掉带标片、留下摘要片——于是 SFW 检索能搜到这一段（不断片），看到的是含蓄摘要；NSFW 侧两片都可见。
- `sliceId(slice)` 从 `` `${entryId}:${turn}` `` 改成尾缀 `:nsfw` 区分。同一叶子同一轮写两片，只按 `entryId:turn` 认会被 MiniSearch 当同一篇文档。
- `memoryTool.ts` 的 `Pick<PlaywriterKitDeps, …>` 补 `"isNsfw"`，`search_archive` 把 `deps.isNsfw()` 传进去。

### 5. 压缩早退 ⇒ 原计划 §8 整段作废

`maybeCompactEpoch` 开头 `if (this.nsfwActive) return;`。压缩器的输入是原文对话体，段没结束就还没有摘要可用；而退出后上下文本来就会重建为净化版、体积回退，不差这一下。

由此得到一条比原设想更干净的结论：**arc 天然干净**——压缩器要么在段没结束时被拦住，要么在退出后只看到净化后的上下文。所以原先设想的「arc 打标 + `visibleCards` 按模式过滤」整块作废，`memory/arcs`、A 区注入、`visibleCards` **一行没改**（这一条计划在实施前排定时就已收编进 §3.6）。

### 6. 前台不动

舞台事件、replay、route 卡片、`lineage.jsonl` 一律保留全文。需求约束的是模型读到什么，不是玩家看到什么。

## 检视与返工

第一轮 reviewer 判「不准入」，指出 2 项阻塞、3 项建议、2 项非阻塞（报告见 `261004-nsfw-isolation.review.md` 的第一轮章节）。逐项核实后**全部成立**（BLOCK-01 的两半我都手验过代码路径），处置如下：

**阻塞级**

1. **进出边界那一拍的玩家输入打标错位**（BLOCK-01）。原实现读的是「开拍时」的 `nsfwActive` 快照，而 prompt 节点落在开拍**之前**：进段那一拍的玩家输入拿的是上一拍的 `false`（漏标 → SFW 侧从树上重建时它作为普通输入回流），段后第一句日常输入拿的是退出那一拍残留的 `true`（误标 → 从树上重建时整句被吃掉）。改为在 `noteBeatInputs`——也就是注入这一拍输入的那一刻——把通道定下来，取值走新增的 `beatChannelNsfw()` = `nsfwActive || nsfwPendingEnter`，`startBeatWindow` 用同一个取值。注意不能简单地在 `appendLineage` 里加 `|| nsfwPendingEnter`：那会把 `enter_nsfw` 之后同一拍里写出的 SFW 台词也一并打上标。
2. **跳进段内之后再退出会全量回流**（BLOCK-02）。原来 `switchBackToSfw` 优先用「进入限制级前的内存快照」、快照空了就退化成 `stripNsfwPreTurns(当前消息)`——而 `restoreBranchState` 正好会把那个快照清空（跳转/分岔/读档都走它），此时当前消息组是按 NSFW 模式渲出来的原文，`stripNsfwPreTurns` 只认得那两条合规轮次，一个字都拦不住。改为**不留内存基线**：`switchBackToSfw` 一律从当前分支谱系链渲一遍 SFW 侧上下文（段末 `beat_end` 已带 `nsfwSummary`，折叠出来就是「历史 + 一条过渡轮」），`sfwBaselineMessages` 字段整块删掉。副作用与 `editLine` / `rebuildBranchAt` 同源（从树重放会把纪元压缩摊回原文），下一拍开跑前的压缩会再收一次。

**建议级**

3. `closeNsfwBeat` 的 `finally` 补 `if (this.disposed || token !== this.beatToken) return;`。`dispose()` 不动 `beatToken`，原实现会让已销毁的实例继续 `onBeatSettled` → 消费排队输入 → 往谱系落节点并开新一轮。
4. 限制级段落期间不压缩的**上下文膨胀**（SUGG-02）：按已知限制处理，不改代码——这是计划里明确的取舍（段没结束就没有摘要可压），真要在段内做滑动窗口是另一条需求。
5. 限制级读者检索时原文片与摘要片会同时命中（SUGG-03）：按可接受的小冗余处理，不改代码。

**非阻塞**

6. 测试假绿（INFO-01）：新增 3 条用例补上真实路径——用自由输入进段（而不是 `continue`，后者不落 prompt 节点）、段内跳转之后再退出、等摘要期间被销毁。
7. 收束异常无前端提示（INFO-02）：catch 里补一条 `send({type:"error", recoverable:true})`。

**新用例的反假绿验证**：把 `apps/server/src/orchestrator.ts` 整份换回 `4c1d71b` 版本、保留新用例再跑，3 条全红（分别是「进段那句没带标」「跳转后退出时上下文里仍有 `轻一点`」「销毁后树多长出一个节点」），换回修复版 3 条全绿。

第二轮复检结论见 `261004-nsfw-isolation.review.md`。

## 验证

- `pnpm -r build` 干净；`apps/server` `npx tsc --noEmit` 干净。
- 全量 server 套件：**614 passed / 3 skipped**（43 files passed / 2 skipped），基线 600 passed——新增 14 条（11 + 返工补的 3）。
- 未跑真实 LLM/TTS/生图调用（按项目测试规范，涉及真实外部 API 默认 mock）。

新增测试 14 条：

| 文件 | 条数 | 覆盖 |
|---|---|---|
| `test/lineage-ops.test.ts` | 5 | 「限制级段落的按读者折叠」：SFW 只剩过渡轮、NSFW 照渲原文、段外内容两模式一致、老档不受影响 |
| `test/memory.test.ts` | 2 | 检索过滤：SFW 跳过带标片命中摘要片、NSFW 两片都返回 |
| `test/compaction.test.ts` | 1 | 段落期间不压缩。带**非空证明**：量 `contexts[2].messages` 的 `measureContext(...).tokens > TIGHT.contextWindow * TIGHT.triggerRatio`——若真压了，agent 会被重建，量到的种子就不会超预算，用例因此不会假绿 |
| `test/orchestrator.test.ts` | 6 | 退出那一拍的摘要落点 + 打标 + 快照 + archive；`beat_settled` 推后到摘要之后；分支跳转两个方向（段内照渲 / 段后只剩摘要）；边界那一拍的玩家输入按通道打标；段内跳转之后再退出无原文回流；等摘要期间被销毁不再惊醒下一拍 |

## 用户验收

见 `261004-nsfw-isolation.validation.md`。
