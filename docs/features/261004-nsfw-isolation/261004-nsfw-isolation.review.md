# 检视报告

## 概要

本次检视针对 commit `4c1d71b`（限制级内容按读者隔离，SFW 侧只留带出的摘要）。整体架构方向清晰，设计上采用「事件层打标 + 读者身份折叠 + 段末异步结拍收束」来替代单点内存净化的思路具备先进性。但在关键边界的实现上，存在**进入/退出限制级时玩家输入打标时序错位导致漏标/误标**，以及**中途分支操作后退出时回退逻辑失效导致限制级原文全量泄漏**两项重大阻塞缺陷；同时存在组件销毁并发处理不全及测试用例假绿现象。

## 需求对齐

基本设计思路与计划文档（`261004-nsfw-isolation.plan.md`）保持一致，且在跳过限制级期间纪元压缩（使 arcs 天然干净）的处理上做出了合理的简化。然而在核心不变式「限制级内容对全年龄读者只留带出的 SFW 摘要」的落实上，由于实现中的时序与分支恢复漏洞，在玩家带输入进入限制级或在段内发生分支操作的真实场景下无法满足隔离需求。

## 阻塞问题

| ID | 位置 | 问题 | 建议 |
| --- | ---- | ---- | ---- |
| BLOCK-01 | [apps/server/src/orchestrator.ts:996](apps/server/src/orchestrator.ts#L996) 与 [apps/server/src/orchestrator.ts:2088-2090](apps/server/src/orchestrator.ts#L2088-L2090) | **进入限制级首轮玩家输入（`prompt`）漏打 `nsfw` 标，退出后首个日常轮玩家输入误打 `nsfw` 标**。<br>1. 玩家通过 `choice` 或 `free` 驱动新轮次时，`deliverPrompts` 在 `beginBeat` 之前就调用了 `appendLineage("prompt")`。在从日常进入限制级的那一轮，`this.beatNsfw` 仍为上一轮的 `false`（`nsfwPendingEnter` 尚未兑现），导致该轮玩家输入没有带 `nsfw: true`。SFW 侧从谱系重建时，该玩家输入因未被折叠而作为普通输入被保留在 `inputs` 中，泄漏到日常轮次中；<br>2. 反之，在退出限制级后，`closeNsfwBeat` 虽重置了 `this.nsfwActive = false`，但未将 `this.beatNsfw` 复位为 `false`，导致首个日常轮玩家输入在 `deliverPrompts` 时被错误打上 `nsfw: true`，在 SFW 重建时被意外吃掉（吞输入）。 | 1. 在 `appendLineage` 打标时，不仅看 `this.beatNsfw`，还需结合即将开启的新轮通道属性（如 `this.beatNsfw \|\| this.nsfwPendingEnter`），或在 `deliverPrompts` 开头即提前结算该轮模式归属；<br>2. 在 `closeNsfwBeat` 退出收束时，同步重置 `this.beatNsfw = false;`，确保后续日常轮输入不会继承限制级标记。 |
| BLOCK-02 | [apps/server/src/orchestrator.ts:2025](apps/server/src/orchestrator.ts#L2025) 与 [apps/server/src/orchestrator.ts:170-175](apps/server/src/orchestrator.ts#L170-L175) | **`switchBackToSfw` 回退分支（`stripNsfwPreTurns`）无正文过滤能力，分支恢复后退出时限制级原文全量泄漏**。<br>若玩家在限制级段落中执行过分支跳转/重写（`restoreBranchState` 会重置 `this.sfwBaselineMessages = []`），或者从档位恢复现场，段落结束调用 `switchBackToSfw` 时将触发 `base = stripNsfwPreTurns(this.agent.state.messages)`。然而 `stripNsfwPreTurns` 仅剔除了带有“设定合规说明”的系统提示，原原本本保留了所有限制级露骨台词和段内输入。这导致日常主模型在后续演出中直接读到了全部限制级原文，严重穿透 SFW 隔离防线。 | 摒弃脆弱的内存消息切片与关键词过滤机制：退出限制级时，统一基于当前分支谱系事件链调用 `lineageToBeats(chain, ..., { nsfw: false })` 重建纯净对话体；保证「实时退出」与「从树重建」遵循完全一致的唯一真相源。 |

## 建议修改

| ID | 位置 | 问题 | 建议 |
| --- | ---- | ---- | ---- |
| SUGG-01 | [apps/server/src/orchestrator.ts:2005-2010](apps/server/src/orchestrator.ts#L2005-L2010) | **`closeNsfwBeat` 的 `finally` 缺少 `this.disposed` 检查，可能向已销毁实例发送事件并开启新轮**。<br>当 orchestrator 在等待 SFW 摘要异步生成期间被 `dispose()` 时，由于 `dispose()` 不会修改 `beatToken`，`finally` 检查中的 `token !== this.beatToken` 为 false（不拦截）。导致已销毁的实例继续执行 `this.onBeatSettled()`，向客户端发送 `beat_settled`，甚至通过 `deliverPrompts` 往谱系树写节点并尝试启动新轮次。 | 在 `closeNsfwBeat` 的 `finally` 块开头增加 `if (this.disposed \|\| token !== this.beatToken) return;` 保护。 |
| SUGG-02 | [apps/server/src/orchestrator.ts:1735](apps/server/src/orchestrator.ts#L1735) | **限制级段落期间完全禁用纪元压缩（`maybeCompactEpoch` 早退）缺乏上下文长度安全护栏**。<br>虽然早退成功避免了限制级原文被固化进长期记忆 `memory/arcs`，但若玩家在限制级通道内进行长时间多轮互动，限制级模型的对话上下文将持续单向膨胀。对于小窗口模型（如 8k/16k）极易触发上下文超限（400/ContextWindowExceeded），且伴随推理成本与延迟剧增。 | 在限制级段落中增加上下文超预算（如达到窗口 80%）时的防御机制，例如：仅在限制级模型上下文内丢弃早期的限制级轮次（滑动窗口），或者向剧作家注入提示词引导其及时调用 `exit_nsfw` 结拍。 |
| SUGG-03 | [apps/server/src/memory.ts:148-154](apps/server/src/memory.ts#L148-L154) | **NSFW 读者检索切片时，段末同一轮次同时命中原文切片与摘要切片，存在冗余**。<br>段末同一轮同时生成了带有原文的切片（`nsfw: true`）与 SFW 摘要切片（未标记）。当读者处于限制级模式（`opts.nsfw === true`）时，两者均满足可见性，`searchArchive` 会同时返回同一轮的原文和摘要，消耗工具调用配额且语义重复。 | 在检索过滤或结果去重时，若同属一个 `turn` 且同时命中原文切片与摘要切片，在 NSFW 模式下优先返回原文切片并抑制该轮的摘要切片。 |

## 非阻塞问题

| ID | 位置 | 问题 | 建议 |
| --- | ---- | ---- | ---- |
| INFO-01 | [apps/server/test/orchestrator.test.ts:1698](apps/server/test/orchestrator.test.ts#L1698) 与 [apps/server/test/lineage-ops.test.ts:503-510](apps/server/test/lineage-ops.test.ts#L503-L510) | **测试用例存在假绿和覆盖盲区**。<br>`orchestrator.test.ts` 中通过 `playerAction({ kind: "continue" })` 进入限制级，因 `continue` 不落 `prompt` 谱系节点，绕过了限制级首轮玩家输入漏标以及后续日常轮输入误标的缺陷；`lineage-ops.test.ts` 中的 `nsfwChain` 采用手动构造数据，掩盖了真实编排器的打标缺陷。此外，缺少对限制级中途跳转后退出的回归测试，以及 `closeNsfwBeat` 异步期间 `forkTo` / `dispose` 的并发测试。 | 补充带自由输入（`kind: "free"`）或选项选择（`kind: "choice"`）的限制级切换端到端测试；补充从限制级内部跳转后退出限制级的测试用例。 |
| INFO-02 | [apps/server/src/orchestrator.ts:1995-1999](apps/server/src/orchestrator.ts#L1995-L1999) | **`closeNsfwBeat` 捕获异常后无降级通知**。<br>若 `closeBeat` 或 `switchBackToSfw` 抛出未预期的同步/异步异常，catch 块仅输出了 `console.warn`，未向前端发送可恢复错误通知，也未对模型上下文做降级处理。 | 在 catch 块中记录 `this.send({ type: "error", recoverable: true, ... })`，提升可观测性。 |

## 准入结论

**结论**：`不准入`

**说明**：本次提交在限制级与日常通道隔离的设计方向上值得肯定，但存在两项严重的隔离漏洞（BLOCK-01 导致带输入的限制级首轮发生泄漏且后续日常输入被吞；BLOCK-02 导致中途跳转/恢复后退出时限制级原文全量泄漏给主模型），违背了「限制级内容对 SFW 侧仅可见带出摘要」的核心安全不变式。须修复阻塞问题并补齐真实路径测试后重新检视。

## 第二轮复检

### 概要

本次复检针对工作树中相对 `4c1d71b` 提交的未提交修复变更（涉及 `apps/server/src/orchestrator.ts`、`apps/server/AGENTS.md` 与 `apps/server/test/orchestrator.test.ts`）。
经独立核实，第一轮检视指出的两项核心安全阻塞问题（BLOCK-01 边界输入通道误标/漏标、BLOCK-02 内存基线失效导致露骨原文回流穿透）及一项并发销毁缺陷（SUGG-01）均已得到彻底且高质量的修复；关于限制级段落跳过纪元压缩（SUGG-02）及检索切片微小冗余（SUGG-03）的取舍分析务实且符合项目架构设计；新增的三组端到端测试用例断言严密、逻辑闭环。整体实现稳健，满足准入要求。

### 需求与第一轮意见对齐

| 第一轮意见项 | 处置方式 | 核实与评估结论 |
| --- | --- | --- |
| **BLOCK-01**（边界输入时序与通道打标错位） | 修复代码 | **已解决**。输入打标提前至 `noteBeatInputs` 并统一度量 `beatChannelNsfw() = nsfwActive \|\| nsfwPendingEnter`。在输入进入谱系树的那一刻即完成通道锁定，彻底解决了进入限制级首轮 `prompt` 漏标与退出后日常首轮输入误标的问题。开场与普通动作均由此处收口，无时序盲区。 |
| **BLOCK-02**（分支操作后退出导致限制级原文全量回流） | 修复代码 | **已解决**。彻底移除脆弱的内存基线 `sfwBaselineMessages`，`switchBackToSfw` 统一从当前分支谱系链经 `rebuildBeats` 折叠渲染 SFW 上下文。从根源上消除了跳转/读档后退出时的上下文污染，保证「实时退出」与「从树重建」遵循完全一致的唯一真相源。 |
| **SUGG-01**（`closeNsfwBeat` 异步期间销毁并发安全） | 修复代码 | **已解决**。`finally` 块补齐 `if (this.disposed \|\| token !== this.beatToken) return;` 保护，且在首行主动解绑 `pendingSfwSwitch = null`，杜绝已销毁实例非法触发结算或唤醒后续轮次。 |
| **SUGG-02**（限制级期间禁用纪元压缩的小窗口风险） | 按已知限制保留 | **取舍可接受**。限制级期间禁用压缩是守住「露骨原文绝不被固化进长期记忆 `memory/arcs`」的核心安全红线。限制级段落作为局部短篇（通常 3-10 拍），现代模型（16k-128k）足以安全容纳；引入复杂的段内滑动窗口会大幅膨胀架构债务。风险边界已在文档中明确界定。 |
| **SUGG-03**（NSFW 读者检索切片时原文与摘要冗余） | 按已知冗余保留 | **取舍可接受**。段末仅产生 1 篇摘要切片与 1 篇原文切片，仅在限制级读者检索时可能占用至多 2 个检索配额（默认上限 5），不破坏任何数据一致性与安全性，保持实现极简是合理的。 |
| **INFO-01**（测试用例假绿与覆盖盲区） | 补充测试 | **已解决**。新增 3 组针对性端到端测试，分别覆盖边界输入打标双向验证、段内跳转后退出原文回流验证、异步等摘要期间销毁与并发保护验证。测试断言严密结实，无假绿漏洞。 |
| **INFO-02**（`closeNsfwBeat` 异常捕获无通知） | 修复代码 | **已解决**。catch 块中增加了 `this.send({ type: "error", message: ..., recoverable: true })`，保证了前台可观测性。 |

### 针对 BLOCK-02 新改法的深度设计评估

本轮将 `switchBackToSfw` 改为直接从谱系链重构（`this.buildAgent(this.renderBeats(this.rebuildBeats(this.opts.tree.materialize()).beats), false)`），对其潜在副作用检视如下：
1. **纪元压缩摊开与上下文体积**：
   - 现行设计中，谱系树（`MemoryTree`）是纯事件日志存储，不记录历史纪元压缩的截断点。因此任何从谱系链重构的操作（包括现存的 `rebuildBranchAt` 与 `editLine`）均会将早期已被压缩的轮次重新展开为对话体。
   - `switchBackToSfw` 采用此做法与项目既有语义与设计完全对齐。且在限制级退出后，后续轮次开跑前的 `maybeCompactEpoch` 拥有完备的预算检测，若展开后的体积超出窗口预算，会自动再次触发摘要压缩，具备自愈能力。
   - 更重要的是，退出点整段 NSFW 原文已在谱系折叠层（`rebuildBeats`）被物理剥离并替换为单条极简过渡轮（`nsfwTransitionBeat`），上下文体积在退出后立刻大幅缩减，不会造成上下文暴涨。
2. **架构一致性与债务消除**：
   - 彻底废除了「在内存里缓存特定历史快照」的有状态黑魔法，抹平了「正常线性推进退出」与「跳转/回档后推进退出」的代码分叉。所有读者上下文均由谱系事件投影得出，系统复杂度显著下降，架构演进方向完全正确。

### 阻塞问题

无。

### 建议修改

无。

### 非阻塞问题

| ID | 位置 | 问题 | 建议 |
| --- | --- | --- | --- |
| INFO-03 | [apps/server/src/orchestrator.ts:2008-2010](apps/server/src/orchestrator.ts#L2008-L2010) | `closeNsfwBeat` 的 catch 块记录了 recoverable 错误并派发给前端，但由于内部 `generateSfwSummary` 自带了兜底默认文本捕获，此处 catch 主要防范的是同步抛错。若未来有意外未捕获异常导致 `closeBeat` 未能执行，实例虽已复位 busy，但可能遗留未落树状态。 | 当前逻辑下 `generateSfwSummary` 不会抛出未捕获异常，`closeBeat` 亦为安全同步方法，现状稳定。后续若对收束流程增加复杂异步 IO，可考虑在 catch 中补全安全降级收束。 |

### 准入结论

**结论**：`准入`

**说明**：第一轮报告中的两项严重阻塞缺陷及并发隐患均已彻底修复，消除了露骨内容穿透 SFW 模型的漏洞。实现方式从底层统一了谱系事件投影的唯一真相源，测试断言结实充分，完全达到准入标准。
