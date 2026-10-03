# 检视报告

## 概要

本次改动针对剧作家流式生成中的拒答、空转与故障场景，将空轮判据从「事件数」修正为「零台词且未交出停止点」，并引入了一套完整的「判废回滚 → 原样重发一次 → 二次失败退回上一轮停止点」机制。改动范围收敛在 `apps/server/src/orchestrator.ts` 与 `apps/server/test/orchestrator.test.ts`。在初版实现中遗留了一处导致引擎**无限死循环重开**的阻塞级缺陷，现已完成定点修复并通过真机与自动化回归用例验证，整体实现与状态机闭环严密。

## 需求对齐

变更完全满足计划文档（`261004-beat-fallback.plan.md`）中的各项设计与决策：
- **判废判据**：完全移除 `beatEvents` 计数，改为 `beatHasLines`（检查 `say/narrate/thought` 文本有效性）结合停止点检查，未引入拒答文本启发式规则；
- **回滚与重演**：`finishBeat` 仅记录 `beatVerdict` 结论，回滚动作在 `beginBeat` 等待 Agent 空闲后执行，复用 `rebuildBranchAt` 恢复世界线；重试上限固定为 1 次，超时（`beatTimedOut`）显式关闭重试；
- **失败态恢复与出口兜底**：二次失败退回 `beatTailId`（输入节点落树前的末尾），上一轮停止点原位复原（保留选项）；若上一轮为无停止点（`no_stop`）收束，通过 `failureExit` 补齐 `pause` 停止点，断开自动连续开轮的死循环；本轮注入的 steer 通过 `returnBeatSteers` 幂等放回队首，错误消息保证在 `rebase` 之后广播；
- **已有台词保护**：生成中途报错或超时但已产出台词的轮次正常收束，不回滚不重演；
- **测试覆盖**：重写了旧有关于空轮收束的用例，覆盖了场景指令判废、中途报错不回滚、纯选项轮不判废、二次失败退回复原选项与队列，以及专门针对 `no_stop` 退回防死循环的回归测试。

## 阻塞问题

曾存在 1 项阻塞缺陷（**B-01**，真机实测复现，现已修复）。

| ID  | 位置 | 问题 | 修复与检视意见 |
| --- | ---- | ---- | ---- |
| B-01 | [apps/server/src/orchestrator.ts:987-1020](apps/server/src/orchestrator.ts#L987-L1020), [1292-1300](apps/server/src/orchestrator.ts#L1292-L1300) | **无停止点自然收尾下判废退回导致无限自激死循环**：<br>当上一轮为 `no_stop`（无停止点）自然收尾时，判废退回到 `beatTailId` 后，`restoreStopPoint` 解析出的 `this.lastStop` 为 `null`。而判废退回同时会调用 `returnBeatSteers()` 将本轮未兑现的 steer 复位为 `pending` 放回队首。<br>当 `beginBeat` 执行完毕进入 `finally` 时，会触发 `onBeatSettled()`；`onBeatSettled()` 看到「当前无停止点（`!lastStop`）且队列中有待注入 item」的条件成立，便立即自动自发调用 `deliverPrompts` 开启下一轮。新一轮再次失败 → 再次退回 → 队列仍有待注入项 → 再次自发开轮，造成死循环，每 10~15 秒消耗 2 次 LLM 调用且前端错误 toast 持续堆叠。 | **已修复**：<br>1. `rebuildBranchAt` 新增 `opts.failureExit` 参数：在 `restoreStopPoint` 执行后，若 `opts.failureExit` 为真且 `!this.lastStop`，显式补上 `{ stopType: "pause" }` 停止点；<br>2. `rewindFailedBeat(verdict, false)` 在终态退回时传入 `failureExit: !retry`（重试轮 `resume: true` 不传）；<br>3. 在 `test/orchestrator.test.ts` 新增针对此场景的回归用例，断言 `rebase` 携带 pause、只报一次 error，且 30ms 后流调用次数严格停在 3 次（首跑 1 + 重演 2），未发生自发开轮。<br>**检视意见**：修复思路清晰、侵入性极小。通过赋予失败终态一个 pause 出口，恰好命中了 `onBeatSettled` 的挂起拦截（`if (this.lastStop) return;`），彻底打破了死循环回路，同时不破坏原有上一轮带真选项时的复原逻辑。 |

## 建议修改

[Should fix；不影响准入但建议后续小步重构。]

| ID  | 位置 | 问题 | 建议 |
| --- | ---- | ---- | ---- |
| S-01 | [apps/server/src/orchestrator.ts:689-695](apps/server/src/orchestrator.ts#L689-L695) | `playerAction` 中 `!resolved` 分支手动重复了 `noteBeatInputs`、`appendLineage`、`markSent` 与 `beginBeat` 调用，与 `deliverPrompts(steers, null)` 逻辑重合 | 建议将 `if (!resolved)` 分支简化为 `await this.deliverPrompts(steers, null); return;`。这样所有输入入账、落谱系与广播队列收敛在 `deliverPrompts` 一处，降低分支认知负荷与后续维护漂移风险 |
| S-02 | [apps/server/src/orchestrator.ts:1288](apps/server/src/orchestrator.ts#L1288) | `rewindFailedBeat` 中 `const anchor = retry ? this.beatAnchorId : (this.beatTailId ?? this.beatAnchorId);` 的降级分支在空树且有自由输入时，终态退回会落到本轮 prompt 节点上（因为 `beatTailId` 为 `null`），此时由 `restoreStopPoint` 兜底生成 pause | 建议在该行增加简短注释，注明「空树首次自由输入失败时无前序节点可退，降级停在当前输入节点由 pause 接管」，避免后续维护者对 `?? this.beatAnchorId` 产生疑惑 |

## 非阻塞问题

[Nice to have；记录备忘。]

| ID  | 位置 | 问题 | 建议 |
| --- | ---- | ---- | ---- |
| N-01 | [apps/server/src/orchestrator.ts:69](apps/server/src/orchestrator.ts#L69) | `BEAT_RETRY_LIMIT = 1` 为模块顶层常量，若后续有测试或配置需要单轮调整重试上限时缺乏注入点 | 可在后续迭代根据需要挂入 `OrchestratorOptions.beatRetryLimit`，当前固定为 1 完全满足产品设计 |
| N-02 | [apps/server/src/orchestrator.ts:1335](apps/server/src/orchestrator.ts#L1335) | `returnBeatSteers` 依赖浅拷贝保留的原对象引用（`!restored.includes(item)`）排重 | 目前队列操作均保持了引用一致，安全可用；后续若涉及队列项深拷贝或持久化反序列化，注意改为按 `item.id` 去重 |

## 准入结论

**结论**：`准入`

**说明**：真机实测发现的 `no_stop` 场景下判废死循环缺陷（B-01）已精准修复，补丁在不影响既有结构操作与停止点恢复的前提下有效打破了自发重开链路，回归单测验证完备；当前代码无遗留阻塞性缺陷，可以准入合并。
