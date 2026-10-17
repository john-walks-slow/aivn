# 261017 限制级通道 v3（注入 + 模型自主切换的融合）

## 需求

把 v2（自定义注入）与旧版（模型自主切换）合成一条通道：

- v2 的优点要留：那组注入消息完全由作者写、同时作用于**工坊与剧作家**、可以手动随时开关。
- 旧版的优点要留：剧作家能**自己**切进 / 切出这条通道；能配一个**专用模型**。
- 用户确认的口径：① 专用模型只管剧作家（工坊照旧跑自己的）；② 开关放两处——Agent 页那一个 + **舞台右上角导演栏**加一个；③ 手动关掉时走全年龄摘要；④ 工坊不给 `enter_nsfw`。

## 现状（开工前）

通道的运行时一个没少：`orchestrator` 的 `nsfwActive` / `nsfwPendingEnter` / `nsfwPendingExit` / `closeNsfwBeat` / `switchBackToSfw` / `nsfwChannel` / `broadcastNsfw`、`NSFW_PRE_TURNS`、`memory.ts` 的 `always/nsfw.md`、`rebuild.ts` 的按读者折叠、谱系打标与快照、客户端那枚通道标识、`playhouse` 的模型解析（`play.agents.playwriter.nsfwModel || config.nsfwModelId`）都在。10-16 那次只摘了入口：能力行、两个工具、提示词章节、设置页与 Agent 页的四格表单。

也就是说 v3 不是重写通道，而是：**把入口装回来 + 把「载荷」从写死的 `NSFW_PRE_TURNS` / `nsfwPrompt` 换成作者写的那组注入 + 补一个手动开关**。

## 设计决策

| # | 决策 | 说明 |
|---|------|------|
| D1 | 通道的载荷 = 作者写的那组注入 | 关着不注入、开着才注入（剧作家与工坊两边都是）。旧的 `NSFW_PRE_TURNS`（写死的合规前置轮次）与 `nsfwPrompt`（全局 / 逐剧目那段追加到系统提示词的字符串）退役——前者由组里的 user/assistant 消息取代，后者由组里的 system 消息取代。 |
| D1b | 合规锚点改作出厂 preset | 那句成年人虚构声明 + 助手的既成确认是**内容不是机制**，搬进 `promptPresets.ts` 的 `DEFAULT_PRESETS`（文件从没写过时才露面，删了就删了）：作者挑进那组注入即可，想换写法就换。装配处保留 `stripNsfwPreTurns`，只为不把升级前就在跑的会话里那份当成「上一轮真的说过」。 |
| D2 | 专用模型只管剧作家 | 工坊是搭台、不该被成人模型接管；它只是**收到**那组注入（用户明确：注入两个 agent 都要）。`nsfwModel` / `nsfwThinking` 是剧作家卡上的字段。 |
| D3 | 开关两处，一条接口 | Agent 页那颗与舞台导演栏那枚都打 `PUT /api/plays/:id/nsfw`：写回 `play.json` 的 `agents.injection.enabled`，并把**正在跑的这一局**一起切过去。走 REST 而不是新增 WS 信令：Agent 页本来就是 REST 页，而舞台靠现成的 `nsfw` 广播回显，core 的信令因此一行不动。 |
| D4 | `enabled` 是「存下来的开关」，不是注入的门 | 开演时按它起手（有存档则以 `LineageSnapshot.nsfw` 为准）；这一轮注不注入由**通道状态**决定。理由：剧作家自己进通道时文件里那颗开关可能还是关的，那也得把作者写的这组注入进去。`withInjection(messages, injection, active)` 的 `active` 由调用方给。 |
| D5 | 摘旧的那一步与 `active` 无关 | 关掉通道时同样要把上一轮留在现场的那份注入拿走，否则它会以「真的说过」的身份留在对话体里。 |
| D6 | 边界语义照旧（轮边界） | 开=下一拍起兑现（当场那一拍已经用主模型写着了）；关=有拍在跑就收束时退出并生成摘要，空闲就立刻翻转 + **补一条带 `nsfwSummary` 的过渡节点**（这一段已封完、没有拍能承载摘要；不补的话全年龄读者按 `rebuild` 的规则会把这一段整段丢掉）。手动关与 `exit_nsfw` 走同一条路。 |
| D7 | 能力与工具装回来，只给剧作家 | `nsfw` 能力行（分组「演出」、默认开、授权 `enter_nsfw` / `exit_nsfw`）+ 契约矩阵那一行 + 两条副作用元数据。工坊不给（用户口径）。 |
| D8 | 提示词分两段、按能力位与状态收口 | 能力开着且不在通道里 = 进入指引（并说明进去会换模型 + 换上下文）；已经在通道里 = 只说清此刻在哪、怎么出来；能力关着时一个字都不提那两个工具（哪怕作者手动把通道开着）。 |
| D9 | 导演栏那枚是可选 prop | `StageTheater` 新增 `nsfwChannel?: { active, onToggle }`，宿主不传就不渲染（DSH 插件线没有这条通道，硬摆一个拨不动的键更糟）。图标用新登记的 `flame`。 |

## 改动面

**服务端**
- `agentkit/kit.ts`：`nsfw` 能力行 + 两个工具登记 + `createNsfwTools` 装回剧作家。
- `agentkit/contract.ts`：矩阵那行与两条副作用元数据装回（`check:agent-contract` 要求一一对应）。
- `prompt.ts`：`PromptContext.nsfwMode` 回归；新增 `nsfwChapter`（两段，见 D8）。
- `promptInjection.ts`：`injectionMessages` 只认「有没有消息」；`withInjection(…, active)` 与 `agentInitialMessages({…, active})` 把「注不注入」交给调用方，摘旧的那一步始终执行。
- `orchestrator.ts`：开演时按 `enabled` 起手（有存档以快照为准）；`buildAgent` 带上 `nsfwMode` 与 `active: isNsfw`；新增 `setNsfwChannel(active)`（手动开关，轮边界语义）与 `closeNsfwIdle()`（空闲时收尾 + 补过渡节点）。
- `workshop.ts` / `workshopSession.ts`：`injectionActive` 由每一轮现问的通道状态给；线程压缩计量同源。
- `playhouse.ts`：`nsfwChannelOf(playId)`（现场优先、没起过 runtime 就按文件）、`setNsfwChannel(playId, active)`；工坊的 `nsfwChannel` 接上。
- `store.ts`：`setNsfwEnabled(enabled)`——只改 play.json 里那颗开关，其余键原样保留（走原始对象，不 parse+序列化）。
- `http.ts`：`PUT /api/plays/:id/nsfw`。

**客户端**
- `api.ts`：`setNsfw(id, active)`；`Settings.model` 加回 `nsfwModelId`。
- `SettingsScreen.tsx`：加回「限制级专用模型」一格。
- `AgentPane.tsx`：剧作家卡加回「限制级专用模型 / 限制级思考档位」；那一节改叫「限制级通道」，开关走接口并同步草稿与盘上那份。
- `packages/stage`：`StageTheater` 的导演栏加一枚通道开关；`Icon` 登记 `flame`。
- `StageScreen.tsx`：把 `stage.nsfw` 与开关接给导演栏。

## 不做

- 不给工坊 `enter_nsfw`（用户口径）。
- 不恢复全局 `nsfwPrompt`（它的位置就是那组注入）。
- 不动 DSH 插件线的界面（导演栏那枚是可选 prop，插件宿主不传）。
