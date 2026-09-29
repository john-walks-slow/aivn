# 检视报告：P4b 纪元压缩（Epoch Compaction）

## 概要

本报告包含对 stage-ai 项目 P4b「纪元压缩（epoch compaction）」的两轮完整检视记录。第二轮检视重点复核了第一轮报告中提出的 3 项阻塞、5 项建议与 2 项非阻塞问题的修复质量，并针对修复引入的新状态机守卫（`engaged`）、尺度标定（`measureContext`）、生命周期（`disposed`）及三区装配契约进行了深度推演。

结论：**全部 10 项历史问题均已高质量修复，未引入阻塞性缺陷，代码达到准入标准。**

---

## 第一轮检视问题与修复对照

| 原 ID | 位置 | 原问题描述 | 修复方案与处理结果 | 复核状态 |
|---|---|---|---|---|
| **BLK-01** | `apps/server/src/orchestrator.ts` | **压缩异步期间处于假空闲态（`busy=false`），导致并发穿透与重入竞态**。<br/>`maybeCompactEpoch()` 在 `beginBeat` 开头调用，网络等待期间玩家输入或 OOC steer 会穿透校验打架。 | 引入 `beatPending` 标记，新增 `engaged` getter（`busy \|\| beatPending`）；`playerAction` / `autostart` 均以 `engaged` 作为拦截判据；`beginBeat` 全生命周期被 `try...finally` 包裹兜底收束。压缩期间拒绝并发表态与 OOC。 | ✅ 已彻底修复 |
| **BLK-02** | `apps/server/src/compaction.ts`<br/>`apps/server/src/orchestrator.ts` | **中文语境下 `estimateTokens`（chars/4）与真实 Provider Usage 脱节，导致生产环境切尾点计算必为 0、压缩死锁失效**。 | 实现 `measureContext`：以最后一条 assistant 消息的 provider 真实 usage 为基准标定 `scale = usageTokens / localPrefix`；`maybeCompactEpoch` 触发阈值与 `pickCutIndex` 保留段计算统一吃同一个 `scale`，同一把尺子度量。 | ✅ 已彻底修复 |
| **BLK-03** | `apps/server/src/orchestrator.ts` | **压缩异步期间被 `dispose()` 导致 Agent 实例僵尸复活与资源/状态泄漏**。 | 在 `maybeCompactEpoch` 内的每个关键异步点（`completeText`、`appendArc`）之后以及 `beginBeat` 开窗前，严密检查 `if (this.disposed) return;`，立即截断后续落盘与 Agent 重建。 | ✅ 已彻底修复 |
| **SUG-01** | `apps/server/src/compaction.ts` | `renderMessage` 假设 `assistant.content` 必然为数组，缺少防御。 | 改用 `Array.isArray(message.content) ? message.content : []`，增强对字符串或异构 content 的类型防御。 | ✅ 已修复 |
| **SUG-02** | `apps/server/src/orchestrator.ts` | 重建后的消息列表开头存在连续两条 `user` 角色消息相邻的非规范结构。 | 新增 `withSeed(tail, seed)`：将前情提要直接并进保留段首条 `user` 消息顶部（`${seed}\n\n${blockText(head.content)}`），避免出现连续相邻同角色消息；非 user 时退化为独立消息。 | ✅ 已修复 |
| **SUG-03** | `apps/server/src/memory.ts` | `loadCards` 读取磁盘 `arcs` 目录未使用确定性排序，可能破坏 KV 前缀缓存。 | 增加 `(await readdir(dir)).sort()` 字母序排序，保证启动与恢复时 A 区拼接顺序逐字节稳定。 | ✅ 已修复 |
| **SUG-04** | `apps/server/src/compaction.ts` | `splitSummary` 无法应对模型输出顶层 Markdown 标题，可能提取出占位短语。 | 建立 `GENERIC_TITLES` 集合，`splitSummary` 会自动跳过开头的常见类目标题行（如 `# 前情提要`），提取首段真实正文作为 `oneLiner`。 | ✅ 已修复 |
| **SUG-05** | `apps/server/src/config.ts` | 缺少配置交叉校验：`keepRecentTokens ≥ contextWindow * compactRatio` 会导致死锁。 | 在 `loadConfig` 末尾增加硬性警告：当保留预算大于或等于触发阈值时输出告警，提醒部署者调整参数。 | ✅ 已修复 |
| **ADV-01** | `apps/server/src/compaction.ts` | 转录文本硬截断可能拦腰截断 UTF-16 代理对（截断 emoji 乱码）。 | `clipHead` 与 `clipTail` 改用 `[...text]` 展开为 Unicode 码点切片。 | ✅ 已优化 |
| **ADV-02** | `apps/server/test/` | 测试用例全零 usage 掩盖了真实网关路径，缺边界与竞态测试。 | 补充了 `measureContext` 真实 usage 标定单测、`withSeed` 结构单测、压缩异步期间 `dispose()` 竞态单测与 `config.test.ts` 交叉校验单测。 | ✅ 已覆盖 |

---

## 第二轮检视

### 1. 核心修复质量复核

#### 1.1 `engaged` 互斥守卫与生命周期闭环（针对 BLK-01）
- `engaged` 综合了 `this.busy` 与 `this.beatPending`。在纪元压缩执行期间（`beatPending = true, busy = false`），外部 `playerAction` 接收到表态请求时会被 `if (this.engaged)` 守卫拦截并回送可恢复的错误提示；若收到 OOC 指令，因 `busy` 为 false 且即将重建 Agent，不会错误调用旧实例的 `agent.steer`，同样被拦截保护。
- `beginBeat` 使用了规范的 `try...catch...finally` 块。无论 `agent.prompt` 抛出何种异常，`finally` 块保证了：若在开窗后发生异常，通过 `this.finishBeat()` 统一收束空拍与快照清理；无论正常还是异常结束，`this.beatPending = false` 均会被执行，杜绝状态机死锁或 busy 泄漏。

#### 1.2 `measureContext` 动态尺度标定（针对 BLK-02）
- 实现了统一尺度的优雅解法：利用当前上下文最后一条带 usage 的 assistant 消息，换算得出 `scale = usageTokens / localPrefix`（反映中文 BPE token 相对 `chars / 4` 的膨胀倍数）。
- 异常保护严密：
  - 无 assistant 消息、无 usage 或 usage 全零时，安全退回 `scale = 1`；
  - `localPrefix <= 0` 时保护为 `scale = 1`，避免除以零；
  - 设置了 `scale > 10` 以及 `!Number.isFinite(scale)` 的安全上界，防止上游网关错报天文数字导致切出越界保留段；
  - 尾部未结算的 `trailingTokens` 同样乘以 `scale` 补齐中文折算，且 `pickCutIndex` 保留段也以相同 `scale` 倒推，彻底消除中文下的压缩死锁。

#### 1.3 生命周期与 `disposed` 检查（针对 BLK-03）
- `maybeCompactEpoch` 在异步调用 `completeText` 之后、`appendArc` 之后，以及 `beginBeat` 在压缩完成之后，均严格检查了 `if (this.disposed) return;`。外部若发生 `reload`、`startFresh` 或会话回收，已在飞的补全即使返回也不会引发磁盘写入或 Agent 实例僵尸复活。

#### 1.4 装配契约与 `withSeed`
- `withSeed` 将纪元摘要融入保留段的第一条 `user` 消息开头（`${seed}\n\n${blockText(head.content)}`）。
- 经仔细核对三区装配时序：`tail[0]` 承载的是旧纪元末期的历史状态与开场，而当前节拍的新状态（轮尾 C 区）依然由紧随其后的 `agent.prompt(userText)` 正常追加在整个上下文的最末尾。**完全未破坏「轮尾 C 区状态块在末尾」的既有契约**，且消除了一轮对话体内连续出现两条 `user` 消息的角色错位问题。

---

### 2. 阻塞问题

**无**。

---

### 3. 建议修改

| ID | 位置 | 问题 | 建议 |
|---|---|---|---|
| **SUG-06** | `apps/server/src/orchestrator.ts:637-642` | **`appendArc` 磁盘写入缺少局部异常保护，违背「压缩为优化非前提」原则**。<br/>`completeText` 包裹了 `try...catch`（失败只 warn 跳过压缩），但紧接着的 `await this.opts.memory.appendArc(...)` 涉及磁盘文件写入。若遭遇磁盘满或权限等瞬态 IO 异常，未捕获异常会导致整轮 `beginBeat` 直接终止，未能开拍。 | 将 `appendArc` 及之后的 Agent 重建一并纳入同一 `try...catch` 块中；若磁盘写入失败，打 warn 并跳过本次压缩，允许本节拍直接在未压缩状态下继续演出。 |
| **SUG-07** | `apps/server/src/llm.ts:19-37`<br/>`apps/server/src/orchestrator.ts:413-419` | **`completeText` 未接收 `AbortSignal`，`dispose()` 时无法立即中断底层网络流**。<br/>虽然 `maybeCompactEpoch` 在 `await completeText` 返回后检查了 `disposed` 避免了僵尸复活，但由于未向底层注入 signal，在极端长耗时请求期间回收编排器时，网络连接仍会空转直到超时。 | 为 `OneShotOptions` 增加可选的 `signal?: AbortSignal`，在编排器 `dispose()` 时通过专属 AbortController 触发中断。 |

---

### 4. 非阻塞问题

| ID | 位置 | 问题 | 建议 |
|---|---|---|---|
| **ADV-03** | `apps/server/src/compaction.ts:85-87` | `pickCutIndex` 在极端边缘（如仅有一条 user 且长度极大）时退出顺延可能触发 `cut >= messages.length` 返回 0，表现符合预期但可增加单测固化该边界行为。 | 在单测中增加单消息对话体的边缘切点测试。 |

---

### 5. 文档一致性待同步清单

为保证工程与用户体验的一致性，请在交付或后续文档迭代中同步补充以下内容（**不要漏项**）：

1. **`README.md`**：
   - 在「配置项（.env）/ LLM 网关」表格中补充纪元压缩三项配置：
     - `STAGE_CONTEXT_WINDOW`（默认 `131072`）：会话上下文窗口总预算；
     - `STAGE_COMPACT_RATIO`（默认 `0.6`）：触发纪元压缩的窗口占比阈值；
     - `STAGE_KEEP_RECENT_TOKENS`（默认 `20000`）：压缩后保留的最近轮次 Token 预算；
     - 附带交叉约束提示：`STAGE_KEEP_RECENT_TOKENS` 必须明显小于 `STAGE_CONTEXT_WINDOW * STAGE_COMPACT_RATIO`，否则保留预算过大将导致切不出可压段。
   - 在「剧目记忆（memory/ 目录）」章节中，补充 `index/arcs/` 目录的机制说明（由纪元压缩运行时自动生成，包含各纪元的前情提要，按当前谱系祖先链过滤，无需手工维护）。
2. **`AGENTS.md`**：
   - 在「规范」章节补充沉淀 P4b 纪元压缩的三项设计铁律：
     - **纪元边界突变**：拍与拍之间是唯一允许突变 A 区（新增 arcs 索引）和 B 区（切除早前轮次 + 注入 seed 摘要）的时刻；纪元内保持 A/B 区逐 token 冻结以命中前缀缓存。
     - **中文计量同尺**：必须通过 `measureContext` 以 provider 真实 usage 标定本地字符估算比例，触发判定与切尾点 `pickCutIndex` 必须使用同一个 `scale`。
     - **状态机互斥防线**：开拍与压缩过程由 `engaged`（`busy || beatPending`）全程覆盖，压缩在飞期间拒绝并发表态与 OOC steer，防止重入与消息错投至废弃实例。
3. **计划文档（`docs/features/260928-stage-ai-mvp/260928-stage-ai-mvp.plan.md`）**：
   - 将实施进度与 D7 章节中 P4 待办项的「纪元压缩→arcs（P4b，60% 窗口触发）」标记更新为「已完成（P4b 交付，待真机验证）」。
4. **验证文档（`docs/features/260928-stage-ai-mvp/260928-stage-ai-mvp.validation.md`）**：
   - 补充 P4b 纪元压缩的用户验证与回归场景：
     - 自动化单测全绿覆盖（含 `compaction.test.ts` 与 `config.test.ts`）；
     - 长会话多轮推进到达窗口阈值时的自动压缩行为验证（检查控制台日志、`memory/index/arcs/` 卡落盘以及 A 区索引注入）；
     - 谱系分岔与重开恢复验证（验证旧分支与新分支之间 arcs 摘要卡的祖先隔离与防剧透）。

---

## 准入结论

**结论**：`准入`

**说明**：第一轮发现的 3 项阻塞性缺陷（并发假空闲态、中文 Token 计量死锁、销毁后僵尸复活）已全部彻底修复，代码逻辑严密，测试覆盖完整，未引入新的阻塞性问题。建议修改项为防御性增强，可与文档同步工作并行或在后续迭代中推进。
