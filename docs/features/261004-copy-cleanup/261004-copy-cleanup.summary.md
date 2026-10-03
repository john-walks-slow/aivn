# copy-cleanup 实施小结（2026-10-04）

## 做了什么

用户先要求盘点「UI 上多余的 description / hint」，追加两轮全应用复查后，又问了两件事：有没有文风油滑值得重写的、两份 agent 系统提示词值不值得大范围重写。结论是**不做大范围重写**，只做语气与结构整理。两部分合在一处记录。

### 一、UI 文案（`apps/web/src`，12 个文件）

- 删掉一批自解释、科普、剧透式的 description/hint：舞台侧栏五个视图的 title、Agent 页两张卡的介绍段与各开关下方说明、设置页的「支持的模型 / 元数据基座 / 网关地址 / 上下文窗口 / 启用生图 / 界面主题 / 主色 / 舞台主题」等。
- 保留承载非显然行为、单位、约束、空态与数据的短提示（清单与理由见 plan 第一、二节）。
- 修一处事实错误：craft.md 占位符声称「留空就用引擎内置的通用准则」，而 `CRAFT_RULES` 已于 10-03 从引擎删除。
- 重写 7 处偏文艺/套近乎的空态与提示（空态、标题画面的缺失提示、工坊对话空态、premise 占位符排比句等），改直白但不丢信息（见 plan 第四节）。

### 二、两份系统提示词（`apps/server/src/prompt.ts` / `workshop.ts`）

按 plan 第五节的三条真问题做结构整理，**正文一条规则都没删**：

1. 正文按章抽成模块常量，装配模板只留顺序与能力位开关。剧作家：`ROLE_INTRO` / `HOW_I_WORK` / `FORMAT_RULES` / `NEW_CHARACTER_RULES` / `CONTRACT_RULES`；搭台：`RESPONSIBILITY_RULES` / `TALK_RULES` / `IMAGE_BASICS` / `NO_IMAGE_GUIDE` / `LINEAGE_GUIDE`，带能力位的两章抽成 `setupFlow(canBrowseLibrary)` 与 `writingPoints(ctx)`。
2. `beat_done` 三种停法从三处降到两处：删掉「你怎么工作」里与他处逐字同义的复述，保留「结束轮」的硬契约（三种调用的写法）与 `beatTool.ts` 的工具说明（调用现场的参数解释）。
3. 搭台提示词里那条硬编码的「玩家能真正打字的地方只有这几处」五条 UI 清单删掉，改成不依赖界面形态的说法；保留同段真正防错的「路线视图里没有输入框」。

顺带修掉一处长期存在的字符串转义 bug：`writingPoints` 的 `canBrowseLibrary` 分支渲染出的是 `` \`import_asset\` ``（多余反斜杠），已改为 `` `import_asset` ``。

## 验证

- **渲染等价性**：抽章节前后对剧作家 6 组、工坊 3 组场景渲染结果逐字符比对，除上述有意改动外完全一致（能力位开与关都覆盖）。
- 测试：`prompt.test.ts` 25 条、`workshopPrompt.test.ts` 6 条、`agentkit.test.ts` 17 条全绿。
- 类型/构建：本次改动的服务端文件无类型错误；`apps/web` 的 `vite build` 通过。`tsc --noEmit` 目前被同一工作区另一处在途开发（NSFW 通道：`SettingsScreen` 的 `nsfwModelId`、`orchestrator.ts` 的 nsfw 字段）挡住，与本轮改动无关。
- 检视：`261004-copy-cleanup.review.md`，结论 **准入**（首轮条件准入，S-01/S-02 修复后复查准入）。
- 用户验证：见 `261004-copy-cleanup.validation.md`（3 项，待确认）。

## 留下的

- `apps/server/src/agentkit/role.ts` 的 `ROLE_META.blurb` 全仓无读点，是死代码；因多 worktree 并行未动（plan 第三节）。
- 工坊提示词里的工具知识仍按「工具描述承担细则、提示词只说工作方法」的老口径，本轮没有改变这条边界。
