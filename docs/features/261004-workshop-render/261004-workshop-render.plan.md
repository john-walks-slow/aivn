# 工坊对话页输出渲染：工具卡 + 思考展开

来源：2026-10-04「工坊会话和回顾页面能不能用 agent chat UI 框架来渲染」。生态调研见
[261004-agent-chat-ui-frameworks.research.md](../../freeform/261004-agent-chat-ui-frameworks.research.md)。

目标只有一件：**工坊对话页里 agent 那一轮不再是一坨纯文本 + 一行会消失的「读取文件…」**。
思考成块、可展开；每次工具调用成一张卡，能看见名字、关键参数、结果、成败。

前一轮的 [agent-run-contract 计划](../261004-agent-run-contract/261004-agent-run-contract.plan.md)（对齐 AG-UI 事件形状）
**作废**：它一个像素都不改，不解决这里的问题。本计划接管其中仍然成立的服务端部分（工具生命周期、toolCallId）。

## 1. 为什么不引框架

| 候选 | 卡在哪 |
| --- | --- |
| AI Elements（Vercel，含 `tool` / `reasoning` 组件） | 强绑 Tailwind v4 + shadcn CSS 变量 |
| shadcn 官方 chat 组件 / streamdown | 同上，README 原文明写要 Tailwind |
| Ant Design X（`ThoughtChain` / `Think` / `Bubble`） | peer 是 `antd ^6.1.1` + cssinjs，主题要整层映射到 antd token |
| assistant-ui | primitives 无样式——等于自己写卡片；带样式的 registry 组件又回到 Tailwind |
| `@shadcn/react/message-scroller` | 真 headless，但只管滚动、不管卡片 |

这些库里唯一「开箱就有工具卡和思考折叠」的是 AI Elements 和 antd X，而它们各自要求我们把整个样式层换掉。
本项目没有 Tailwind / shadcn / antd，`app.css` 是唯一手写样式层，5401 行。

更要紧的是：**换渲染库解决不了瓶颈**。pi 早就把工具的 `args` / `result` / `isError` 和思考增量给了我们，
是 `workshop.ts` 的 subscribe 里丢掉的。这段管道无论用谁的组件都得接。

结论：管道自己接（必须），两种行自己写（约 250 行 + 一段 CSS），不引样式框架。

## 2. 数据面：pi 已给，我们扔掉的部分

`apps/server/src/workshop.ts:455` 的 subscribe 现在只认三种：

```
message_update → 只看 text_delta
tool_execution_start → 只取 toolName
tool_execution_end → 只取 toolName
```

pi 实际给的是（`pi-ai/dist/types.d.ts:470`、`pi-agent-core/dist/types.d.ts:444`）：

- `thinking_start` / `thinking_delta{delta}` / `thinking_end{content}`
- `tool_execution_start{toolCallId, toolName, args}`
- `tool_execution_update{toolCallId, toolName, args, partialResult}`
- `tool_execution_end{toolCallId, toolName, result, isError}`

本轮接前三类（`tool_execution_update` 的增量结果不接，工具行先做「运行中 / 完成」两态）。
思考只在 `thinkingLevel` 非 off 时产生——AgentPane 已有思考档位开关，不改。

## 3. 消息模型：parts

一轮回复按发生顺序记成一串段落，这是渲染的唯一真相源：

```ts
type WorkshopPart =
  | { type: "text"; text: string }
  | { type: "thinking"; text: string }
  | {
      type: "tool"; id: string; name: string; args: unknown;
      result?: string; isError?: boolean; ms?: number;
      /** 这次调用产出的素材，就地挂在行上（不再另开一条预览带）。 */
      assets?: WorkshopAssetView[];
    };
```

段落怎么拼，写成 `packages/core/src/ws/workshopParts.ts` 里的四个纯函数
（`appendText` / `appendThinking` / `startTool` / `endTool`）。服务端与前端共用同一份，
不各写一遍——前端流式期间拼出来的东西必须和服务端落盘的一致。

`WorkshopChatMessage`（`packages/core/src/ws/protocol.ts:93` 与 `apps/server/src/workshop.ts:392` 同形）加一个可选字段：

```ts
parts?: WorkshopPart[];
```

`text` 保持原样不动，它有两个既有职责：回灌 agent 上下文的唯一内容（「工具历史不进上下文」这个决定不翻案）、
以及旧线程文件的形态。渲染侧在入口处归一化一次 `parts ?? [{ type: "text", text }]`，渲染路径只有一条。

顺带修一个既有的信息丢失：今天 `text = (last?.text ?? streamed)`，**调用工具之前那段叙述文字被丢掉了**。
有了 parts，中间的 text 段落照样看得见；`text` 字段仍取末条 assistant 消息（回灌上下文用）。

截断：单条 `result` 落盘前截到 8KB（超出加「…已截断 N 字」）。
`read` 一个几十 KB 文件的全文进线程文件没有意义，展开时看的是截断后的。
思考不截：它的长度由模型的输出上限决定（几千字量级），真截还会让前端流式拼出来的
与服务端落盘的（在 done 时替换过去）不一样，看着像「收束后少了一段」。

## 4. 协议（`packages/core/src/ws/protocol.ts` 工坊段）

| 消息 | 变化 |
| --- | --- |
| `workshop_chunk { threadId, delta }` | 不动（文本增量） |
| `workshop_thinking { threadId, delta }` | 新增 |
| `workshop_tool { threadId, name }` | 改为 `workshop_tool_start { threadId, id, name, args }` |
| `workshop_tool_end { threadId, id, result, isError, ms }` | 新增 |
| `workshop_done { threadId, text, images? }` | 加 `parts` |
| `workshop_error { threadId, message, images? }` | 加 `parts`（半路失败也要能看见它读了哪些文件） |
| `workshop_asset { threadId, kind, path, url, replaced }` | 加 `toolCallId?` |

`id` 就是 pi 的 `toolCallId`，前端用它把 start/end 配成一行、把素材挂到对应行上。
项目未发布，不做旧协议兼容，直接改名。

素材归属：工坊这一路只有工具会出素材，而工具的 `execute(toolCallId, params)` 本来就拿着调用号
（现在写成 `_toolCallId` 丢掉了）。把它一路带到 `onAsset`，素材就精确落到那次调用的行上；
带不到调用号的（`pushAsset` 这条外部路径）仍走消息级 `images`。

落盘：`workshopThreads` 每线程一个 JSON（`{ messages: [...] }`），多一个 `parts` 字段天然兼容旧文件。
出错路径（`workshopSession.ts:213`）今天只在「本轮出过图」时补一条消息，同样带上 parts。

## 5. 前端

### 状态（`apps/web/src/workshop/useWorkshop.ts`）

新增 `live: WorkshopPart[]` —— 本轮流式中正在长的段落。`workshop_chunk` / `workshop_thinking` /
`workshop_tool_start` / `workshop_tool_end` 都往上追加或就地改；`workshop_done` / `workshop_error`
用服务端权威 parts 整段替换并落进 `messages` / 清空 `live`。

`activity` 这行退役（工具状态归卡片），只留「还没出任何段落时」的等待态。

### 组件

两种都是**一行字，点开才铺开**，不做盒子、不画卡片边框：

- `ThinkingRow`：`思考 · 首行预览`，点开是正文。**流式中默认展开，收束后自动折叠**（再点开照旧能看）。
- `ToolRow`：`标签 · 参数摘要 ······ 状态`，沿用 `TOOL_LABEL` 的中文名；点开是参数、结果、以及这次调用产出的素材。
  状态的三种：运行中 / ✓ / ✗（失败时结果那段落红色）。
- `write` / `edit` 的 `content` / `oldText` / `newText` 单独走代码块，不塞进 JSON。
- 产出素材的那一行**默认展开**（不然图藏在折叠里反而看不见），用户手动折过就听用户的。
- `toolSummary(name, args)` 纯函数：`read`/`write`/`edit` → path，`bash` → 命令行首行，
  `generate_image` → prompt 前 40 字，`web_search` → query，其余取第一个短字符串字段，都没有就留空。

素材整体改挂工具行：带 `toolCallId` 的走对应行，前端不再为它们另画一条流式预览带
（`pendingAssets` 只留不带调用号的那条路径）。收束后它们随 parts 落进消息，翻历史仍在。

样式加在 `app.css` 现有的 `.workshop-chat` 段附近（`:2678`），沿用现有 token，不引新视觉语言、不重排周边。

## 6. 测试

- `toolSummary` 与 parts 归一化：纯函数单测。
- `apps/server/test/workshop.test.ts`：断言 thinking / tool_start / tool_end 下行，以及落盘 parts。
- `apps/web/test/useWorkshopNewThread.test.tsx`：断言流式拼装、工具配对、done 收敛。

改完不跑浏览器 e2e，交给用户在开着的 dev 上看。

## 7. 本轮不做

- 回顾页（`StageTheater.tsx` 的 `BacklogView`）——那里没有工具调用与思考，要改是另一件事。
- `tool_execution_update` 的实时增量结果。
- 工具行上的「撤销这次写盘」入口（现有撤销记录在别处，先不动）。
