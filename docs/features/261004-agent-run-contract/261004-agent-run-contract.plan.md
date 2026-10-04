# 工坊 agent 运行事件契约化（对齐 AG-UI 语义）

> **已作废（2026-10-04）**：这层映射不改任何界面，不是当时要的东西。
> 目标是优化工坊对话页渲染（工具卡 / 思考展开），见
> [261004-workshop-render.plan.md](../261004-workshop-render/261004-workshop-render.plan.md)。
> 本文仍然成立的是「工具生命周期与 toolCallId」那一节，已并入新计划。

来源：2026-10-04「工坊会话与回顾页能不能用 agent chat UI 框架来渲染」的调研结论。生态调研见 [261004-agent-chat-ui-frameworks.research.md](../../freeform/261004-agent-chat-ui-frameworks.research.md)（40+ 候选逐条档案）。

本轮**不引入任何 UI 框架**，也**不改任何界面**。做的事只有一件：把工坊 agent 运行这条通道的事件，从「够我们自己用」整理成「一份显式、可被外部消费者装配的契约」，并把它与 AG-UI 的对应关系固化成一份带测试的映射函数。

## 1. 判据：接入日到底省什么

判据不是「标准化好」，而是将来真要接 assistant-ui / TanStack AI / CopilotKit 时，手上有多少现成的。三个真实接入点没有一个直接吃我们的线上事件名：

- assistant-ui 的 `ExternalStoreRuntime` 吃的是**前端状态**（messages + isRunning + 工具状态），不是 wire；
- TanStack AI 的自定义传输走 `SubscribeConnectionAdapter`，翻译层照写；
- `@ag-ui/client` 的 `AbstractAgent.run()` 要一个 `Observable<BaseEvent>` —— 这正是本轮要产出的 `toAgUiEvents()`。

所以接入日省下的是三样：

1. **消息装配语义显式化**：runId / messageId / toolCallId / 起止边界齐备，一个中途接入的消费者能装出完整消息。今天装不出来——现在靠 `history → chunk → done` 的隐式状态机，且 `workshop_done` 还会用「服务端权威全文」覆盖 delta 累积的结果。
2. **工具生命周期成为完整状态机**：`running → complete | error`，能直接喂 tool part 状态；今天只有一个覆盖式字符串。
3. **映射函数本体就是接入日的适配器主体**，它的单测就是这扇门的回归测试。将来任何协议改动把这扇门弄坏，测试当场红，而不是接入日才发现。

**校准（不承诺的事）**：这扇门只覆盖**数据语义**。流式 markdown 容错、滚动容器与锚定、每条记录的动词按钮、写入撤销清单、中文输入法兜底——调研报告 §5.2 列的这些硬骨头，没有一件会因为本轮变容易。

## 2. 范围

| 通道 | 是否对齐 | 理由 |
| --- | --- | --- |
| 工坊 agent 运行（`workshop_run_started/chunk/tool/tool_end/write/asset/done/error`） | **是** | 易失（除末条消息外不落盘）、语义就是一次 agent run |
| 工坊线程管理（`workshop_open/activate/archive/delete`、`workshop_threads`、`workshop_history`） | 否，只做映射 | 它对应 assistant-ui 的 `RemoteThreadListAdapter` / `MessagesSnapshot`，不是 AG-UI 的事件类型 |
| 舞台演出（`beat_start` / `events` / `beat_end` / `rebase` / epoch / seq） | **否** | 它不是聊天流，是带持久化的复制状态机（回放缓冲、纪元、整树重放）。AG-UI 没有对应物，塞进 `CUSTOM` 只是把字段放进不透明的 value，零互操作增益。它的消费者是定制剧场渲染器，永远不会是 chat 框架。回顾页若将来真接框架，接的是 parts / ActivityMessage 的**数据模型**，由谱系数据投影，与舞台 WS 改名无关 |

**不做字面改名。** 曾考虑把 `ServerMessage` 里工坊那几条直接换成 AG-UI 的事件名（`RUN_STARTED` / `TEXT_MESSAGE_CONTENT` / `TOOL_CALL_START` …），否掉的理由：

- 它违背「零 UI 改动」的本意——`useWorkshop` 的整个 switch 必须跟着改名重写；
- AG-UI 生态正处在版本分裂期（TanStack 合规锚 0.0.52、`@ag-ui/client` 已 1.0.1、`ActivityMessage` 1.0 才转正），在 wire 级站队等于把它的演进债全额接过来；
- 结构上也不匹配：AG-UI 的内容级事件按「流」绑定 run、不自带 threadId，而我们的 WS 是 stage + workshop 混载的共享总线。任何 AG-UI 消费者都得先过一遍 demux，适配层省不掉——「直接就能接」是幻觉。

## 3. 目标协议：只做加法

既有事件名与既有字段**一个都不动**（前端因此零改动：`WorkshopInbound` 由 `Extract<ServerMessage, { type: \`workshop_${string}\` }>` 自动派生，新增变体自然落进 `useWorkshop` 的 `default` 分支被忽略，新增字段更是无感）。

新增与追加：

| 事件 | 变更 | 何时发 |
| --- | --- | --- |
| `workshop_run_started` | **新**：`{ threadId, runId, messageId }` | `chat()` 线程解析完、`maybeCompact` 之前（压缩窗口有秒级空档，首个事件可能是工具而不是文本，没有这个边界就推不出 run 的起点） |
| `workshop_chunk` | + `messageId` | 不变 |
| `workshop_tool` | + `toolCallId`、+ `detail?`（服务端投影的短摘要，截 ~80 字：写入路径 / 检索词） | 不变 |
| `workshop_tool_end` | **新**：`{ threadId, toolCallId, name, isError }` | pi 的 `tool_execution_end`（本来就带 `toolCallId` / `result` / `isError`，今天全丢了） |
| `workshop_done` | + `runId`、`messageId` | 不变 |
| `workshop_error` | + `runId?` | `chat()` 开头的 busy 拒绝**不带** runId——映射据此区分「传输层拒绝」与「运行失败」，前者不产 `RUN_*` |
| `workshop_write` / `workshop_asset` | + `runId`、+ `toolCallId?` | 不变 |

`detail` 是顺手补的一个真实缺口：今天 `activity` 在工具结束后**不清除**（`useWorkshop` 只有 `done` / `error` 清它），出图 60 秒后流式文本旁边还挂着「出图中…」。要不要让前端据此收起活动行，见 §7。

## 4. 映射层

新文件 `packages/core/src/ws/agui.ts`，一个纯函数：

```ts
export function toAgUiEvents(msg: WorkshopInbound): AgUiEvent[]
```

类型钉在 `@ag-ui/core` 的事件语法上（**type-only 依赖**，只进 `devDependencies`，不进运行期产物）。手抄一遍类型也能跑，但那样规范一漂就是静默漂；type-only 引用让漂移变成编译错误——这正是「门」该有的形态。

| 我们的 | AG-UI | 备注 |
| --- | --- | --- |
| `workshop_run_started` | `RUN_STARTED` | 带 `threadId` / `runId` |
| 首个 `workshop_chunk` 之前 | `TEXT_MESSAGE_START` | `role: "assistant"`，`messageId` 来自 run_started |
| `workshop_chunk` | `TEXT_MESSAGE_CONTENT` | `delta` 原样 |
| `workshop_tool` | `TOOL_CALL_START` | `toolCallId` / `toolCallName` |
| `workshop_tool_end` | `TOOL_CALL_END` + `TOOL_CALL_RESULT` | result 是**合成桩**：`content: []` + `isError` |
| `workshop_done` | `TEXT_MESSAGE_END` + `RUN_FINISHED` | result 带全文 |
| `workshop_error`（有 runId） | `RUN_ERROR` | |
| `workshop_error`（无 runId） | 不产事件 | 传输层拒绝 |
| `workshop_write` | `CUSTOM{ name: "workshop.write" }` | 见下 |
| `workshop_asset` | `CUSTOM{ name: "workshop.asset" }` | transient |
| `workshop_history` | `MESSAGES_SNAPSHOT` | 它本来就是 MessagesSnapshot：全量、权威、整段替换，`open` / `activate` / 开跑前各发一次，`finally` 里的 `snapshot()` 天然完成对账——`done.text` 的权威与 delta 的真相在这里调和，服务端一行不用改 |
| `workshop_threads` / `activate` / `archive` / `delete` | 不映射 | 对应 `RemoteThreadListAdapter` 的接口形状，属将来那段接入代码的事 |

**为什么 `write` / `asset` 走 `CUSTOM` 而不走 `ActivityMessage`**：判据是持久性。撤销记录不进线程历史（`before` 是会话级易失物，进历史等于把整篇文件塞进消息文件），而 `ActivityMessage` 是**消息模型**里的概念——重载 history 就消失的伪消息只会制造不一致。AG-UI 把「传输层的自定义事件」与「前端渲染层的 activity 消息」分两层，本意就是让 adapter 本地决定要不要把前者转成后者；将来想把写盘画成转录流里的一行，在 adapter 里转即可。两个 `name` 按规范写进文档。

**为什么工具只出现一次 `TOOL_CALL_START`、没有 `TOOL_CALL_ARGS`、结果只给桩**：

- `write` / `edit` 的参数里是**整篇文件内容**，发到前端等于同一份字节运两遍（args + `before`）；
- 工具结果常是整篇文件或检索正文（几十 KB），前端一概不展示；
- AG-UI 的语法允许零个 ARGS 增量；但 `TOOL_CALL_START` 之后缺 `TOOL_CALL_END` / `RESULT` 会让多数客户端把工具挂在 running 态直到 `RUN_FINISHED`，所以补一个 `content: []` 的桩保证语法闭合。真要 UI 看结果时按 `toolCallId` 走 REST 拉，不推流。

**不追输入方向的同构**：`RunAgentInput` 与本项目正面冲突——我们是服务端权威历史 + 快照同步 + **服务端切压缩窗口**，而 `RunAgentInput` 假设 client-owned messages（每轮全量回传、压缩切点无处安放）。AG-UI 自己用 `MESSAGES_SNAPSHOT` 支持服务器权威流，输入方向接入日只需一个「onNew → `workshop_chat`」的薄回调，不值得动协议。

## 5. 实现面

| 文件 | 改动 |
| --- | --- |
| `packages/core/src/ws/protocol.ts` | 新增 2 个变体、给 5 个变体追加字段（约 20 行） |
| `packages/core/src/ws/agui.ts`（新） | 映射函数 + 自定义事件名常量（约 200–250 行） |
| `packages/core/package.json` | devDependency `@ag-ui/core`（type-only） |
| `apps/server/src/workshop.ts` | `subscribe` 里透传 `toolCallId` / `isError`；`onTool` 拆成 start / end 两个回调 |
| `apps/server/src/workshopSession.ts` | 生成 `runId` / `messageId`、发 `workshop_run_started`、发 `workshop_tool_end`、`done` / `error` 盖戳 |
| `apps/web/**` | **0** |
| `packages/core/test/agui.test.ts`（新）、`apps/server/test/workshop.test.ts` | 见 §6 |

`WorkshopSession` 是**剧目级单活**（多客户端共享 `activeId`），与框架「按连接切线程」的假设不同；本地单用户场景无碍，在 `agui.ts` 的文件头记一笔。

## 6. 验证

**单测（core，`agui.test.ts`）**，不确定的是映射本身，所以用例按输入形状铺开：

- 纯文本轮：run_started → 若干 chunk → done，装配出一条约等于 `done.text` 的 assistant 消息；
- 工具先行轮：首个事件是 `workshop_tool`（没有 chunk）；
- 多工具交错：多条 `TOOL_CALL_START` / `END` 按 id 配对，其中一个 `isError: true`；
- 错误轮：`RUN_ERROR` 且没有 `RUN_FINISHED`；
- busy 拒绝（`workshop_error` 无 runId）：不产任何 `RUN_*`；
- `workshop_history` → `MESSAGES_SNAPSHOT`；
- delta 累积与 `done.text` 不一致时，快照胜出。

**单测（server，`workshop.test.ts` 追加）**：一轮里 `workshop_run_started` 恰发一次且在首个 chunk 之前；每个 `workshop_tool` 有配对的 `workshop_tool_end` 且 `toolCallId` 一致；`done` / `error` 带 `runId`；busy 拒绝不带。

**实测**：起 dev 服务跑一轮真对话（含一次工具调用与一次出图），用无头 WS 客户端抓帧，逐条对照 §4 的映射表。

## 7. 顺带的一个前端问题（请用户定夺）

`activity` 在工具结束后不清除，出图那 60 秒过了、正文都开始流式写了，「出图中…」还挂在旁边。`workshop_tool_end` 上来之后可以据此收起活动行（在 `useWorkshop` 里加一个 case）。**这算改现有行为，不属于「零 UI 改动」，需要点名才做。**

## 8. 风险与取舍

| 风险 | 处理 |
| --- | --- |
| 映射函数没有运行期消费者，可能烂 | 它本身就是接入日的适配器主体；单测即开门测试 |
| 手写 AG-UI 类型会漂 | type-only 依赖 `@ag-ui/core`，漂了是编译错误 |
| AG-UI 尚未收敛（0.0.52 / 1.0.1 并存） | 只承诺「文档化的语法子集」，不做任何 wire 级承诺；不引入它的运行期依赖 |
| 共享总线与「按流绑定 run」不匹配 | 接受：适配器仍需 demux，本轮不试图省掉它 |
| 成本 | core + server 约 0.5–1 天；web 零改动 |

## 9. 本轮明确不做

- 引入任何 UI 框架 / 组件库（含 headless 的滚动容器与 markdown 渲染器）；
- 工坊事件字面改名；
- 工具参数与结果正文上流；
- `RunAgentInput` 输入方向的双向对齐；
- 舞台演出通道的任何改动。
