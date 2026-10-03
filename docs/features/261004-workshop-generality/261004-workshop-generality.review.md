# 检视报告

## 概要

本次检视针对 `feat/workshop-shell` 分支（工作目录位于 `.worktrees/workshop-shell`）中「搭台助手通用化：pi 工具基座」的全部未提交变更。
变更彻底下线了自研的 480 余行文件工具（`filesTool.ts`、`editText.ts`）与自造的 `fileLocks`，复用 `@earendil-works/pi-agent-core` 的 `NodeExecutionEnv` 与内建工具（`read`/`write`/`edit`/`bash`），通过轻量装饰类 `PlayEnv` 承载白名单过滤、`play.json` 结构校验与撤销条，并对提示词契约进行了彻底收敛。整体改动设计克制、模块边界清晰、测试覆盖完备，代码坏味道清理彻底。

## 需求对齐

变更完全满足既定计划与用户核心诉求，具体对照如下：

1. **复用通用基座，清除冗余实现**：成功剔除 `filesTool.ts`（238 行）与 `editText.ts`（241 行），直接复用 pi 内建的 `read`、`write`、`edit` 和 `bash`，以 pi 的 `withFileMutationQueue` 替代原先的 `fileLocks`。
2. **装饰模式收敛白名单**：`PlayEnv extends NodeExecutionEnv` 仅覆写 `absolutePath`（读面拦截）与 `writeFile`（写面拦截、`play.json` 校验拦截与 `onWrite` 撤销记录回调）两个口子，14 个 FileSystem 基础方法全部直接继承，符合计划中的判据 5。
3. **零新增配置项与严格权限开关**：未增加任何环境配置项（如 `STAGE_SHELL_*`）；`bash` 复用现有的逐剧目工具开关（`agents.workshop.tools`），在 `DEFAULT_ENABLED.workshop` 中默认关闭。
4. **消灭提示词漂移与暗规则**：工坊提示词移除了与工具契约重复的内容（包括此前已漂移至 9:16 的画幅死规则），将 `WorkshopPromptContext` 的布尔值收束为 `can: AgentCapabilities`，严格遵守「工具知识只写在工具描述里，系统提示词不复述」的既有规范。
5. **异常与破坏性兜底**：通过订阅 `tool_execution_end` 捕获 bash 执行，若 bash 改动导致 `play.json` 解析失败，收束前拦截并跳过运行时重建，向对话流明确广播告警，避免未捕获的 promise rejection 导致界面静默不刷新。

## 阻塞问题

无。

## 建议修改

| ID | 位置 | 问题 | 建议 |
| --- | ---- | ---- | ---- |
| S-01 | [apps/server/src/workshopSession.ts:234](apps/server/src/workshopSession.ts#L234) | `this.opts.emit({ type: "workshop_error", threadId: this.activeId, message: broken })` 中 `this.activeId` 类型为 `string \| null`。虽然在正常 `chat()` 流程中该值已被初始化，但其他异常分支（如 L225）均使用 `this.activeId ?? threadId ?? ""` 做兜底。此处未作空值兜底，若后续扩展调用点可能引入 `null`。 | 保持一致的防御性风格，建议改写为 `threadId: this.activeId ?? ""`。 |

## 非阻塞问题

| ID | 位置 | 问题 | 建议 |
| --- | ---- | ---- | ---- |
| N-01 | [apps/server/src/agentkit/playEnv.ts:90-93](apps/server/src/agentkit/playEnv.ts#L90-L93) | `denial` 方法中将根目录 `clean === ""` 判定为越界并拒绝。对于面向常规文件的 `read`/`write` 操作这是预期的，但若后续工具链中有直接查询根目录 `fileInfo` 或判断根路径存在的调用，需留意该路径的拒绝行为。 | 属于当前设计预期（面向文件白名单），备忘记录即可。 |
| N-02 | [apps/server/src/agentkit/piTools.ts:39](apps/server/src/agentkit/piTools.ts#L39) | 适配器透传了 `onUpdate ?? (() => {})`，目前宿主尚未订阅 pi 的 `tool_execution_update` 消息向前端广播长命令执行的实时 checkpoint（计划中已标为可选 P2）。 | 备忘记录：后续如需优化长时间 bash 执行时的用户体验，可在此处挂接输出流式更新。 |

## 准入结论

**结论**：`准入`

**说明**：本次重构成功将自研工具收敛为通用工具基座，大幅降低了系统的维护成本与暗规则复杂度；设计契约严密、测试覆盖详实、风险提示充分，符合交付标准，准予合入。
