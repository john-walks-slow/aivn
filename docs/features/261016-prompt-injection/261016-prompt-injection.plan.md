# 261016 提示词注入（并下线动态切换型限制级通道）

## 需求

1. **下线动态切换型 NSFW 通道**：相关运行时代码可以保留，但不再给 Agent 暴露任何相关工具，设置界面也不再显示相关字段。
2. **新增提示词注入**：Agent 设置里加一个注入开关，启用后往**工坊与剧作家两个 agent 上下文的开头**注入同一组消息（用户 / 系统 / 工具 / 助手四种角色），并支持把这一组消息存成 preset、随时加载回来。

## 现状

限制级通道是一整套**动态切换**：剧作家调 `enter_nsfw` → 换模型 / 换思考档位 / 注入合规前置轮次（`NSFW_PRE_TURNS`）与专属提示词章节 → 退出时提炼 SFW 摘要并折回全年龄上下文。链路长、状态机多（通道状态进谱系快照、事件打标、分支折叠、压缩豁免），任何一环漂了都表现为「演出怪怪的」而很难定位。用户判断它不牢靠，要求下线。

「提示词注入」是同一诉求的静态替代：把「开场该让模型看到什么」交给用户自己写，一次注入、全程有效，没有中途切换。

## 设计决策

| # | 决策 | 说明 |
|---|------|------|
| D1 | NSFW 下线只摘**入口**，不删运行时代码 | 摘四处：能力目录 `CAPABILITY_CATALOG` 的 `nsfw` 行、`TOOL_CATALOG` 的两个 id、`playwriterTools` 的装配、`prompt.ts` 的限制级章节；再加上设置页两处表单。`orchestrator` / `rebuild` / `lineage` / `memory` 里的通道状态机原样保留——工具没了就永远进不去，它是死代码而不是坏代码。 |
| D2 | 注入内容落 `play.json` 的 `agents.injection` | `{ enabled, messages: [{ role, text }] }`。开关与内容都是**逐剧目**的（同一个模型换个剧目该看到什么开场白本来就不同）。放在 `agents` 段里：Agent 页编辑的就是这一段。 |
| D3 | 一份注入、两个 agent 共用 | 需求原话是「往工坊与剧作家的上下文开始都注入」。分成两份的话，同一个剧目的两个 agent 对世界的认知会分家。 |
| D4 | 注入在**消息列表最前面**，不进任何持久层 | 剧作家：`buildAgent` 组装初始 `messages` 时前置（与 `NSFW_PRE_TURNS` 同一个位置），不落谱系、不进历史账本。工坊：`runWorkshopTurn` 组装对话体时前置，不落线程消息文件——注入是「引擎给模型的底色」，不是「用户说过的话」。 |
| D5 | 四种角色映射到 pi 的真实消息类型 | `system` → `SystemMessage`；`user` → `UserMessage`；`assistant` → `AssistantMessage`；`tool` → 一条带 `toolCall` 的 assistant + 紧随其后的 `toolResult`（协议要求工具结果必须成对，裸 `toolResult` 会被 OpenAI 兼容层 400）。 |
| D6 | preset 存应用级 `prompt-presets.json` | `<数据目录>/prompt-presets.json`，按名字 upsert。preset 的用处就是跨剧目复用（同一套人设铺垫换个剧目照用），落在 play.json 里就只能跟着剧目走。REST：`GET/PUT/DELETE /api/prompt-presets`。 |
| D7 | 界面文案不强调机制 | 一节「提示词注入」+ 一句「两个 agent 都会在上下文开头看到这组消息」。不写「越狱」「前置轮次」这类实现词。 |

## 改动面

**core（`packages/core/src/play/config.ts`）**
- 新增 `INJECTION_ROLES` / `InjectionMessage` / `PromptInjection`，挂到 `AgentConfig.injection`。
- `parseAgentConfig` 归一化：角色走白名单、空文本丢弃、整段没剩东西就当没写。

**server**
- `agentkit/kit.ts`：删 `nsfw` 能力行、删两个 `TOOL_CATALOG` id、`playwriterTools` 不再装配 `createNsfwTools`。
- `agentkit/contract.ts`：删 `CAPABILITY_MATRIX` 的 `nsfw` 条（脚本要求矩阵与目录一一对应）。
- `prompt.ts`：删限制级章节；`PromptContext` 去掉 `nsfwMode` / `nsfwPrompt`（工具没了，这两个入参永远无意义）。
- 新增 `promptInjection.ts`：`injectionMessages(injection)` 把配置翻译成 pi 消息数组（两处共用唯一实现）。
- `orchestrator.ts`：`buildAgent` 前置注入（带去重，避免重建时叠两份）。
- `workshop.ts` / `workshopSession.ts`：`runWorkshopTurn` 前置注入，计量一并计入。
- 新增 `promptPresets.ts` + `http.ts` 三个路由 + `index.ts` 装配。
- `playhouse.ts`：`nsfwThinking` / `nsfwPrompt` 仍从 play.json 读（字段保留，dsh-aivn 还在用）。

**web**
- `AgentPane.tsx`：删限制级模型 / 思考档位两格；新增「提示词注入」一节（开关 + 消息编辑 + preset 存取）。
- `SettingsScreen.tsx` + `api.ts`：删全局的 `nsfwModelId` / `nsfwPrompt` 表单与类型字段（服务端字段保留，只是不上界面）。
- `api.ts` 新增 preset 客户端。

**文档**
- README：设置页字段总表删两行；play.json 示例去掉 `nsfw` 能力、加上 `injection`。
- `apps/server/AGENTS.md` / `apps/web/AGENTS.md`：限制级一节改写成「已下线」+ 提示词注入一节。

## 验证

- `pnpm typecheck`、`pnpm -r build`、`pnpm check:agent-contract`
- `pnpm --filter @aivn/server test` 里受影响的文件：`agentkit` / `prompt` / `config` / `workshopPrompt` / `orchestrator`
- 端到端：Agent 页开关 + 编辑 + preset 存取；舞台起一轮，确认剧作家上下文里带着注入（用一次真机 dev 实例肉眼验收）

## 基底迁移

第一版写在 10-16 从旧主线（`938938fe`，当时 main 被 reset 回 origin/main）切出的 worktree 上，已提交 `a356a25c`。恢复后的新主线是 `a09cb969`，与旧线共 659 个文件不同、`apps/web` 整体重写，硬解 rebase 冲突会把旧外壳带回来。所以本项工作在**基于新主线的新 worktree**（`feat/nsfw-off-prompt-inject-v2`）上按新界面重写：core / server 按语义重放，web 的注入一节与样式按新主线的令牌与窄屏规矩重写。旧 worktree 与其提交保留作对照，不再更新。
