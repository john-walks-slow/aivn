# 261016 提示词注入（并下线动态切换型限制级通道）实施小结

> 这一版是**在新主线上重做**的：第一版写在 10-16 从旧主线切出的 worktree 上（当时 main 被 reset 回 origin/main），新主线的 `apps/web` 是整体重写的，所以 web 部分是照着新界面重写、服务端与 core 按语义重放。详见 [validation 文档](261016-prompt-injection.validation.md) 的基底说明。

## 交付

**1. 动态切换型限制级通道下线**（相关运行时代码按「未删」处理）

| 摘掉的入口 | 位置 |
| --- | --- |
| `nsfw` 能力行 | `apps/server/src/agentkit/kit.ts` 的 `CAPABILITY_CATALOG` |
| `enter_nsfw` / `exit_nsfw` | `TOOL_CATALOG`、`playwriterTools` 的装配、`prompt.ts` 的限制级章节 |
| `nsfw` 能力契约 | `agentkit/contract.ts` 的 `CAPABILITY_MATRIX`（`check:agent-contract` 要求矩阵与目录一一对应） |
| 设置页两格 | `SettingsScreen.tsx` 的限制级专用模型 / 专属提示词（`api.ts` 的类型同步收掉） |
| Agent 页两格 | `AgentPane.tsx` 的限制级模型 / 思考档位 |

保留：`orchestrator` / `rebuild` / `lineage` / `memory` 的通道状态机、`nsfwTool.ts`、`ServerConfig.nsfwModelId` / `nsfwPrompt`、core 的 `AgentSettings.nsfw*`（dsh-aivn 仍在读）。工具没了 → 没有口能激活 → 状态机恒为日常。

**2. 上下文注入（Agent 页的「提示词注入」）**

- 数据：`play.json` 的 `agents.injection = { enabled, messages: [{ role, text }] }`（core 的 `PromptInjection`，`INJECTION_ROLES` = system / user / assistant / tool）。
- 注入点：`apps/server/src/promptInjection.ts` 一处翻译。
  - `agentInitialMessages()` 装配初始消息：**首条恒为引擎系统提示词**（自己用 `createInitialSystemMessage` 落，否则打头的 system 注入会把引擎提示词整段挤掉），注入紧随其后。
  - 剧作家 `orchestrator.buildAgent`、工坊 `workshop.runWorkshopTurn` 两边都走它；工坊的线程压缩计量也把这组消息算进去。
  - `withInjection()` 只做「摘旧的、前置新的」，精确比对角色 + 正文，重建时不叠第二份。
- preset：`apps/server/src/promptPresets.ts` → `<数据目录>/prompt-presets.json`（整表读改写 + tmp+rename 原子落盘），REST `GET/PUT/DELETE /api/prompt-presets`。
- 界面：`AgentPane.tsx` 末尾新增 `InjectionSection`——启用开关、消息行（角色下拉 + 正文 + 删除）、preset 的存 / 取 / 删。样式只补了 `.injection-row` / `.injection-preset` 两条布局规则，窄屏那条折行规则写进 `app.css` 末尾的手机节。

## 验证

- `pnpm -r build`、`pnpm typecheck`、`pnpm check:agent-contract`（9 项）全绿。
- `pnpm --filter @aivn/core test`（271 条）全绿。
- 受影响的 server 用例：`agentkit` / `prompt` / `promptInjection`（新）/ `promptPresets`（新）/ `workshop` / `orchestrator` —— 232 条全绿。
- web：`agentModelOptions.test.tsx`（因新增 preset 下拉调整了 mock 与索引）通过；`playPane.test.tsx` 的 1 条失败是主线上就有的既有问题。
- 前端实跑（Playwright，示例剧目 `inject-probe-v2`）：新界面（左轨 + 竖排 7 页签 + 已连接）→ 注入一节读回两条 → 删一条 / 补一条 → 保存 → play.json 落盘 → 存 preset → 刷新 → 载入 → 复原；390 宽无横向溢出；设置页与 Agent 页均不再出现「限制级 / NSFW」。
- 真模型一轮：注入里带一条 `tool` 角色，工坊对话正常返回（上游收得下成对的消息），模型思考里逐字复述了注入内容、正文引用了注入的「前情」。截图见 `.shots/v2-*.png`。

## 相关文件

- 计划：[261016-prompt-injection.plan.md](261016-prompt-injection.plan.md)
- 延迟决策与验证项：[261016-prompt-injection.validation.md](261016-prompt-injection.validation.md)
- 模块指引：`apps/server/AGENTS.md`（新增「上下文注入」一节、限制级一节改写为「已下线」）、`apps/web/AGENTS.md`（AgentPane 一条）
- 用户文档：`README.md`（设置页字段总表删两行、Agent 页字段表加一行、play.json 示例加 `agents.injection`、能力表删「限制级通道」）

## 未做的事

- 未合入主分支（worktree-dev 规矩：需用户显式同意）。
- DSH 侧（`dsh-aivn`）的 `lib/` 未重建——共享包改动是纯增量可选字段，按跨线矩阵在合并后补跑。
- 舞台上的限制级通道角标与 `TurnParts` 的工具名表没动（通道已不可达，它们自然不出现）。
