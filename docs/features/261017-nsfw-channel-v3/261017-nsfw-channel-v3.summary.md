# 261017 限制级通道 v3 · 实施记录

## 落地形态

一条通道，三件事一起动：**开关**（作者手动 / 剧作家自己调工具）、**模型**（换到专用模型）、**上下文**（注入作者写的那组消息）。

- 开关两处一条接口：Agent 页那颗 + 舞台导演栏那一枚，都打 `PUT /api/plays/:id/nsfw {active}` → 写回 `play.json` 的 `agents.injection.enabled`，并把正在跑的这一局一起切过去（走 REST 而不是新 WS 信令：Agent 页本就是 REST 页，舞台靠现成的 `nsfw` 广播回显，core 一行不动）。剧作家自己调 `enter_nsfw` / `exit_nsfw` 仍走同一套轮边界语义。
- 模型：剧作家卡上的 `nsfwModel` / `nsfwThinking` → 设置页的 `nsfwModelId` → 主模型，逐级兜底；工坊不换模型（只是收到那组注入）。
- 上下文：`play.json` 的 `agents.injection.messages`，开着才注入、关掉时把上一轮留在现场的那份摘掉。注不注入由**通道状态**决定，`enabled` 只是「存下来的那颗开关」（开演起点 + 手动开关的落点）——剧作家自己进通道时文件里那颗可能还是关的。
- 关掉的边界：有拍在跑 = 那一拍是这一段最后一拍（收束时生成全年龄摘要、折回日常）；空闲 = 立刻翻转 + 补一条带 `nsfwSummary` 的过渡节点落到谱系末尾（这一段已经封完，没有拍能承载摘要，不补的话全年龄读者会把整段丢掉）。
- 合规锚点（20 周岁声明 + 助手确认）从装配代码搬进出厂 preset「限制级通道·合规锚点」：写死的 `NSFW_PRE_TURNS` 退役。

## 两处与计划不同的地方

1. `withInjection` 多了个 `active` 参数：原设计只靠「传不传 injection」表达开关，但**摘掉旧的**那一步必须与开关无关——通道关掉时也得把现场那份拿走。所以「有没有消息」与「注不注入」拆成两件事，注不注入由调用方给。
2. 「空闲时关掉」补了一层 `busy`/`pendingSfwSwitch` 保护（与 `closeNsfwBeat` 同一套）：摘要落地期间不许开新拍，否则新拍会带着已经关掉的通道语义落进这一段。

## 文件

**服务端**：`agentkit/kit.ts`（能力行 + 两个工具 + 装配）、`agentkit/contract.ts`（矩阵 + 两条副作用）、`prompt.ts`（`nsfwMode` + 两段章节）、`promptInjection.ts`（`active` 语义）、`orchestrator.ts`（起手播种、`setNsfwChannel`、`closeNsfwIdle`、注入按通道给、`NSFW_PRE_TURNS` 退役）、`workshop.ts` + `workshopSession.ts`（按通道状态注入）、`playhouse.ts`（`nsfwChannelOf` / `setNsfwChannel`）、`store.ts`（`setNsfwEnabled`）、`promptPresets.ts`（出厂 preset）、`http.ts`（REST）。

**客户端**：`api.ts`、`SettingsScreen.tsx`（限制级专用模型）、`AgentPane.tsx`（剧作家卡两个字段 + 限制级通道一节）、`packages/stage`（`StageTheater` 导演栏那一枚 + `flame` 图标）、`StageScreen.tsx`。

**文档**：`README.md`（设置页总表、Agent 页字段表、能力表、play.json 说明）、`apps/server/AGENTS.md`（两节合并为「限制级通道」）、`apps/web/AGENTS.md`。
