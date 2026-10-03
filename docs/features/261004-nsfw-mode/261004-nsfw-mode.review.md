# 检视报告

## 概要

本次检视为「剧作家主动进入/退出限制级（NSFW）剧情分支」在落实上一轮建议修改项后的最终检视。
针对上一轮提出的全部建议修改项（REC-01 异步竞态闭环、REC-02 提示词规则对齐、REC-03 全局模型选择器补齐）以及非阻塞问题（NON-02），开发团队均已彻底高质量落实，架构与代码细节严谨，前后端协同一致。
全量核心包测试秒级通过，无阻塞与高优先级遗留问题，评定结论为**准入**。

## 需求对齐

| 检查项 | 建议要求 | 落实情况 | 状态 |
| :--- | :--- | :--- | :--- |
| **REC-01 异步竞态闭环** | `engaged` getter 判定纳入 `this.pendingSfwSwitch !== null`，并在 `finally` 与 `flushIdleWaiters` 中妥善等待与唤醒 | 已在 `orchestrator.ts:671` 的 `engaged` 中正式纳入 `pendingSfwSwitch !== null`，并在 `switchBackToSfw` 的 `finally` 块及时置空与触发 `flushIdleWaiters`，`whenIdle`、`flushIdleWaiters` 及 `executeBeat` 开跑处均正确等待 `pendingSfwSwitch` 落地。彻底避免了后台生成 SFW 摘要期间前台操作（编辑、跳转、分岔）穿透导致的 Agent 实例覆盖与竞态。 | ✅ 彻底落实 |
| **REC-02 提示词规则对齐** | 消除 `prompt.ts` 第 245 行与第 149/152 行关于 `beat_done` 独占性的规则矛盾 | `prompt.ts:245` 已补充澄清：“（除 enter_nsfw / exit_nsfw 等模式切换工具可同批发出外，不与 create_character、update_state 等其他工具放在同一批里）”。规则逻辑完全一致，消除了模型的理解分歧与额外轮次开销。 | ✅ 彻底落实 |
| **REC-03 全局模型设置项** | `SettingsScreen.tsx` 增加 NSFW 专用模型选择，`api.ts` 补齐类型声明 | `apps/web/src/api.ts` 的 `Settings["model"]` 已补齐 `nsfwModelId?: string; nsfwPrompt?: string;`；`SettingsScreen.tsx` 复用 `ModelSelect` 增加了「限制级（NSFW）专用模型」项，支持空值时自动显示“跟随主模型”并回退，体验完整且优雅。 | ✅ 彻底落实 |
| **NON-02 快照字段补齐** | 补齐 `orchestrator.ts` 私有方法 `snapshotMemory()` 中的 `nsfw` 字段 | `orchestrator.ts:1219` 已补充 `nsfw: this.nsfwActive`，与内联快照结构严格统一。 | ✅ 彻底落实 |
| **NON-01 角色配置守卫** | `parseAgentConfig` 限制 `nsfw*` 仅在 `role === "playwriter"` 时解析 | 经代码核查，第 220 行尚未增加 `if (role === "playwriter")` 守卫，`workshop` 理论上仍能接收未过滤的 `nsfw*` 字段（见非阻塞问题）。 | ⚠️ 遗留备忘 |

## 阻塞问题

无。

## 建议修改

无。

## 非阻塞问题

| ID | 位置 | 问题 | 建议 |
| :--- | :--- | :--- | :--- |
| **NON-01** | `packages/core/src/play/config.ts:220` | **`parseAgentConfig` 未对 `nsfw*` 字段添加 `role === "playwriter"` 守卫**。<br>目前循环遍历所有角色时直接解析了 `nsfwModel`/`nsfwThinking`/`nsfwPrompt`。虽然目前 UI 层面 Workshop 卡片不提供该字段输入、运行时也不读取 `workshop` 的限制级配置，不会产生运行时副作用，但与第 217 行 `workshop` 的 `prompt` 解析风格不一致。 | 可在 220 行将三项解析收敛至 `if (role === "playwriter") { ... }` 块中，与设计意图严格对齐。 |

## 准入结论

**结论**：`准入`

**说明**：上一轮提出的所有建议修改项（REC-01、REC-02、REC-03）均已高质量落地，异步竞态、提示词矛盾和全局设置缺项均已彻底闭环；全量测试秒级通过，代码健壮。遗存的 NON-01 仅为无运行时影响的规范性小项，不阻碍交付。准予合并入主分支。
