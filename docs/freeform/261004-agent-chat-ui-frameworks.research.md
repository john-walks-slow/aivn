# Agent / LLM 对话界面生态调研（可嵌入已有 React 19 + Vite 应用的框架与组件库）

- 调研时间：**2026-10-04**（所有版本号、发布日期、star 数均为该日快照）
- 调研问题：一个本地优先桌面应用（Electron/Tauri 式桌面壳 + 自建 Node 服务端 + React 19 + Vite + 自写 CSS + 自建 WebSocket 协议）中，两处「像聊天但不是聊天」的界面（工坊对话页、演出回顾页）的**前端呈现层**能否不自己维护。
- 检索范围：2024–2026 年活跃的 agent/LLM 对话界面框架、组件库、协议与整站型方案，共 40+ 个候选。

---

## 0. 阅读须知：事实来源与时效性

| 结论类型 | 来源 | 可信度与时效 |
| --- | --- | --- |
| 版本号 / 发布日期 / license / peerDependencies | npm registry API 直接抓取（`registry.npmjs.org/<pkg>`） | 一手、2026-10-04 精确 |
| star 数 / 最后 push / archived 状态 / 仓库 license | GitHub REST API（`/repos/{owner}/{repo}`）与 raw LICENSE 文件 | 一手、2026-10-04 精确 |
| 组件 API 与行为（是否处理 IME、组件清单） | 直接读取仓库源码 / registry JSON / 官方 docs | 一手；个别为读源码得出的推断，已标注 |
| 定价、商业条款 | 官方 docs / 官方 PDF / LICENSE 原文 | 一手，但**商业条款变动最快**，落地前应复核 |
| 「是否值得用」类判断 | 本报告基于上述事实的分析 | 非事实陈述，见 §7 |

**易变项（下次复核时优先看这几条）**：各库 peer 依赖对 React 版本的上界、AI SDK 主版本（v7 于 2026-06-25 发布）、CopilotKit 的免费/付费边界、shadcn 官方 chat 组件是否补齐输入框与会话列表、TanStack AI 是否转正 1.0。

---

## 1. 一句话结论（先给判断，证据见后文）

1. **「流式 markdown 增量 + 工具调用状态 + 多会话 + 无样式自定义」这套已经形成事实标准**，且有一个几乎为你这套技术栈量身定做的方案：**assistant-ui（MIT）**。它的 runtime 层（`ExternalStoreRuntime` / `AssistantTransport` / 自定义 adapter）允许你完全绕开 OpenAI SSE 与 AI SDK data stream，直接对接自建 WebSocket；它同时提供 `ThreadList`（含 `archive`/`delete`/`rename`/`generateTitle` 的持久化 adapter）、`ActionBar`、`BranchPicker` 等原语。**代价**：所有视觉都要自己写（这恰好符合你「自写 CSS、自有主题」的约束）。
2. **不想要 runtime 绑定、只想要「可复制的源码组件」**：用 **Vercel AI SDK v7 的 `UIMessage.parts` 数据模型 + shadcn 官方 chat 组件（MessageScroller / Message / Bubble / Marker / Attachment，2026-06 发布）或 AI Elements**。这两套都靠 shadcn registry 把源码拷进你的仓库，改样式不违背你的主题。**前提**：要接受 Tailwind CSS v4（AI Elements 与 shadcn chat 都是 Tailwind-only），或只取 `@shadcn/react/message-scroller` 这个 headless 包（`@shadcn/react` 0.3.1，MIT，peer `react>=19`）。
3. **如果坚持「传输层完全自主 + 结构化消息（非气泡）逐条挂按钮」**：**antd X 2.x**（MIT，`Bubble.List` + `Bubble.Divider` + `Bubble.System` + `Actions`）与 **TanStack AI**（MIT，`partsComponents` 自定义 part 渲染 + 官方 `webSocket()` 连接适配器 + `SubscribeConnectionAdapter` 自定义持久传输）分别是「组件表达力」与「传输自由度」的最优解；两者的缺点分别是「绑定 antd 设计系统」与「太新（RC）」。
4. **「每条记录挂一排自定义动词按钮的记录流」这个形态，2026 年仍然没有通用组件**——所有方案的终点都是「给你一个可插入任意 ReactNode 的 footer/parts 插槽」，动词按钮的语义（回到舞台/重听语音/就地改写/分叉生成）必须自己写。唯一接近的现成抽象是 **AI SDK 的 `UIMessage.parts` 类型化 part 列表**（`data-*` 自定义 part）与 **AG-UI 的 `ActivityMessage`**（`role:"activity"` + `activityType` + 任意 `content`，只在前端存在、不进模型上下文）——它们是「数据模型层的事实标准」，不是「现成组件」。
5. **整站型方案（Open WebUI / LobeHub / LibreChat / Chainlit / Streamlit / LangChain Agent Chat UI）都不能作为组件库嵌入你的应用**，见 §6 的一句话逐条点破；其中三个例外值得知道：LibreChat 发布了 `@librechat/client`、LobeHub 发布了 `@lobehub/ui`、Chainlit 提供了 `@chainlit/react-client`（WebSocket 头等 + 独立 widget），但它们都与各自应用的数据层/主题强耦合。

---

## 2. 候选分组总览

| 组 | 方案 | 定位 | 一句话 |
| --- | --- | --- | --- |
| A. 无样式原语 + Runtime | **assistant-ui** | React 聊天原语 + 可替换 runtime | 最完整的「自建后端 + 自建样式」路线；MIT，含多会话持久化 adapter |
| | **TanStack AI** | 类型化 AI SDK + UI 工厂 + 连接适配器 | 唯一把「WebSocket 传输」做成官方一等公民的 UI 方案；RC |
| | **shadcn 官方 chat 组件**（2026-06） | MessageScroller / Message / Bubble / Markers | 最权威的「滚动与转录容器」抽象；仅第一阶段，无输入框/会话列表 |
| B. shadcn registry（源码进仓） | **AI Elements**（Vercel） | 48 个 AI 专用组件 | 组件最全（tool/confirmation/commit/checkpoint/queue/plan…）；强绑 Tailwind v4 |
| | **prompt-kit** | 输入框等核心块 | 小、干净、活跃 |
| | **Kibo UI** | shadcn 扩展 registry | 含 ai-chatbot/ai-tool/ai-reasoning/ai-branch 等 |
| | **shadcn-chatbot-kit**（Blazity） | 早期 chatbot kit | 文档仍写在被移除的 AI SDK v3/v4 hooks 上，慎用 |
| | **createui.co / 21st.dev** | 第三方 registry | 有 ChatListView 等，但授权/计费需自查 |
| C. 设计系统绑定 | **Ant Design X 2.x** | antd 系 AI 组件 | 组件与你的两个页面需求几乎一一对应；绑 antd 6 + cssinjs |
| | **Lobe UI**（`@lobehub/ui`） | LobeHub 的组件库 | MIT，peer antd 6 + React 19；脱离 LobeHub 数据层可用但需自己接线 |
| D. 协议 / 框架绑定 | **CopilotKit**（+ AG-UI） | Agent 应用框架 | UI 免费且 MIT，但 headless/rich threads 落进付费档；runtime 走 HTTP+SSE |
| | **AG-UI 协议** | Agent↔UI 事件协议 | MIT、传输无关、事实上的跨厂商 wire 标准；有 `ActivityMessage` 结构化消息 |
| | **Hashbrown** | 浏览器内 agent + 生成式 UI | 全 headless、只关心生成式 UI，不做聊天转录 |
| | **Tambo** | 生成式 UI + 自建后端 | SDK/后端 MIT，但必须跑它的后端（Cloud 或自托管） |
| E. 组件即整块 | **deep-chat** | Web Component 聊天块 | 一条标签即用、完全自有样式；逐条自定义按钮要靠 HTML 字符串 + `htmlClassUtilities` |
| | **Loquix** | Lit Web Components | 2026 新出、53 个组件、CSS 变量主题；极小众 |
| | **OpenAI ChatKit** | OpenAI 官方聊天块 | Apache-2.0/MIT，但 UI 从 OpenAI CDN 加载、服务端驱动 widget，本地优先不友好 |
| | **nlux** | 老牌 React 聊天组件 | **MPL-2.0**（非 MIT），npm 最后发版 2024-08，已停滞 |
| | **chatscope** | 老牌 React 聊天 UI kit | MIT，2025-05 补 React 19 peer，此后无更新 |
| | **react-chatbotify** | 流程式聊天机器人 | MIT、React 16–19 CI；形态是「决策树机器人」不是 LLM 转录 |
| F. 整站型（不可嵌入） | Open WebUI / LobeHub / LibreChat / Chainlit / Streamlit / Gradio / LangChain Agent Chat UI / Vercel Chatbot 模板 | 独立应用或模板 | 见 §6 |

---

## 3. 逐条档案（按调研要求的六个轴）

每条的轴：**许可与商业条款 / 活跃度与版本 / 依赖体积与风格耦合 / 传输层假设 / 结构化消息与逐条自定义操作 / 多会话与持久化 / 无障碍·移动端·IME**。

---

### 3.1 assistant-ui —— 最贴合「自建后端 + 自写 CSS」的路线

**链接**：[官网](https://www.assistant-ui.com/) ・ [文档](https://www.assistant-ui.com/docs) ・ [GitHub](https://github.com/assistant-ui/assistant-ui) ・ [定价](https://www.assistant-ui.com/pricing) ・ [llms.txt（给 agent 用的文档索引）](https://www.assistant-ui.com/llms.txt)

**许可与商业条款**
- 库本身 **MIT**（`@assistant-ui/react` package license = MIT；仓库 LICENSE = MIT，Copyright (c) 2025 AgentbaseAI Inc.）。定价页原文：*"assistant-ui is a free, MIT-licensed TypeScript/React library for AI chat. The commercial pricing below is for assistant-cloud, an optional hosted backend for thread persistence, history, and auth."*
- 商业档（仅针对可选的 assistant-cloud，2026-10-04 读取）：
  - Free：**$0**，含 **200 MAU**，聊天历史 + thread 管理
  - Pro：**$50/月**，含 **500 MAU**，超出 **$0.10/MAU**
  - Enterprise：定制（自有后端集成、数据复制、99.99% SLA、私有化部署）
- **不用 Cloud 完全不花钱**：自建持久化走 `RemoteThreadListAdapter` / `ThreadHistoryAdapter`（见下）。

**活跃度与版本（2026-10-04）**
- `@assistant-ui/react` **0.15.23**（2026-10-02）；`@assistant-ui/react-ai-sdk` **1.4.14**（2026-10-02，peer `ai ^7.0.101`）；新包 `@assistant-ui/ai-sdk` **0.0.9**；`@assistant-ui/react-markdown` 0.14.18；`@assistant-ui/assistant-cloud` 0.1.43。
- 官方适配器包（全部 MIT，均当日/近日发版）：`react-ag-ui` 0.0.63、`react-langgraph` 0.14.31、`react-langchain` 0.0.33、`react-data-stream` 0.12.33、`react-a2a` 0.2.39、`react-google-adk` 0.0.33、`react-opencode` 0.2.26、`react-generative-ui`（作为依赖出现）。
- 仓库：**12,397 stars**，最后 push 2026-10-04（当天），373 open issues。
- 移动/终端同源原语：React / React Native / React Ink（同一套 primitives）。

**依赖体积与风格耦合**
- `@assistant-ui/react` 依赖：`zod`、`zustand`、`radix-ui`（Radix 合并包）、`react-textarea-autosize`、`assistant-stream`、`assistant-cloud`、`@assistant-ui/core|store|tap`、`safe-content-frame`。**没有 Tailwind 依赖**。
- 两层设计：**Primitives（无样式）** 与 **Elements（带样式，经 shadcn registry 拷进你的项目）**。文档原文：*"Primitives are the unstyled layer … leave every visual decision to you."*；*"Instead of a single monolithic chat component, you compose primitives and bring your own styles."*
- 带样式 Elements 走 shadcn CLI，且**风格随 shadcn style 解析**：`components.json` 里配 `"@assistant-ui": "https://r.assistant-ui.com/styles/{style}/{name}.json"`，**以 `base-` 开头的 style 得到 Base UI 版组件，其余得到 Radix 版**；新项目（`npx shadcn init` 默认 Base UI，如 `base-nova`）用風格感知 URL，老 Radix 项目可用 `https://r.assistant-ui.com/{name}.json`。
- **关键结论**：你可以只用 `@assistant-ui/react` 的 primitives + 自写 CSS，完全不引入 Tailwind/Radix 主题；代价是「所有像素自己做」。
- **注意**：历史上存在的预编译 CSS 包（`@assistant-ui/styles`、`@assistant-ui/react-ui`，class 前缀 `aui-`）已被官方标注过时（*"This package contains styled UI components that were previously part of the main package (prior to v0.8) … are not up to date. Use our registry components instead."*），不要再走这条路。
- **Vite 一等支持**：`@assistant-ui/vite` **0.0.19**（2026-09-24，peer `vite >=6`），官方 skill 里有 [Vite / TanStack Start 接入说明](https://github.com/assistant-ui/skills/blob/main/assistant-ui/skills/setup/references/tanstack.md)（原文承认「没有 Vite 模板，手工接线」）。

**传输层假设（对你的自建 WS 协议）**
- Runtime 是可替换的，官方列出两条路：
  1. **`ExternalStoreRuntime`**（[文档](https://www.assistant-ui.com/docs/runtimes/custom/external-store)）：「你拥有 state，adapter 做格式转换；UI 能力按你提供的回调开关（给 `setMessages` 就有分支、给 `onEdit` 就有编辑）」。`convertMessage` 支持 `data-*` 前缀 part（如 `{ type: "data-workflow", data: {...} }`）自动转成 `DataMessagePart`。→ **自建 WS 协议最省心的对接点**。
  2. **`AssistantTransport`**（[文档](https://www.assistant-ui.com/docs/runtimes/custom/assistant-transport)）：**基于 ExternalStoreRuntime 的「状态快照流」协议**——后端不是流式 part，而是反复推送「完整 agent state 快照」，前端用 `converter(state)` 映射成 UI 消息；支持 `resumeApi` 断线重连、`onCancel`、`onError`、`adapters.{attachments,history}`。注意其原话：*"Speech, dictation, feedback, and suggestions are not currently exposed by AssistantTransport. Drop down to ExternalStoreRuntime if you need them."* 并且 `useAssistantTransportRuntime` 标注为 `@alpha`。
  3. 若要复用 AI SDK 生态：`useChatRuntime`（AI SDK v7）；另有 `useDataStreamRuntime`、`useLangGraphRuntime` 等。
- **结论**：assistant-ui 不绑定 OpenAI SSE / AI SDK data stream；用 `ExternalStoreRuntime` 包你的 WS 事件是最直接的路径，只是「流式增量」需要你自己维护消息数组（它只负责渲染与交互状态机）。

**结构化消息与逐条自定义操作（回顾页的核心）**
- 有 `MessagePrimitive.Root` + `MessagePrimitive.Parts`（按 part 渲染，含 `MessagePartPrimitive`），可完全自定义消息体（不一定是气泡）。
- `ActionBarPrimitive.Root` + `Copy/Edit/Reload/Speak/FeedbackPositive/FeedbackNegative/StopSpeaking`（[文档](https://www.assistant-ui.com/docs/primitives/action-bar)）：**Root 内部可塞任意按钮**，内建按钮会按状态自动禁用（Copy 在流式中禁用、Reload 在非 assistant 消息禁用等），支持 `autohide`、`hideWhenRunning`、`data-[floating]` 悬浮。
- `BranchPicker` 原语：消息分支切换（对应「从这一轮重新生成分岔」的浏览）。
- 工具调用有专门的生成式 UI 通道：[`makeAssistantToolUI({ toolName, render({args, result, status}) })`](https://www.assistant-ui.com/docs/guides/tool-ui)，`status.type` ∈ `running | incomplete(...)/complete`，可直接渲染「正在联网检索…」并挂任意按钮（含人工审批）。
- **判断**：「每轮结束列出写入文件 + 撤销」「早期 N 条已压缩分隔条」这类**不是原语**，需要在 `MessagePrimitive.Parts` 的自定义 part 分支里自己渲染（可搜 shadcn 的 `Checkpoint`/`Marker` 作视觉参考）。

**多会话与持久化**
- `ThreadList` 原语：**列出、创建、切换、归档**会话。
- 持久化接口完备（[persistence adapters 文档](https://www.assistant-ui.com/docs/api-reference/adapters/persistence)）：
  - `RemoteThreadListAdapter`：`list / rename / updateCustom / archive / unarchive / delete / initialize / generateTitle / fetch`（+ `unstable_Provider`、`unstable_useAdapters`）
  - `ThreadHistoryAdapter`：`load / resume / append / update / delete`（`withFormat` 在配 AI SDK runtime 时必填）
  - 也有 `InMemoryThreadListAdapter`、`useExternalHistory`
  - → **「会话列表 / 归档 / 删除」四件事它直接给接口，你自己接后端即可**（正好你服务端本来就自建）。
- 官方也有用自有数据库接线的教程：[custom-adapter](https://www.assistant-ui.com/docs/integrations/persistence/custom-adapter)。

**无障碍 / 移动端 / 中文 IME**
- 文档宣传 production UX 自带：流式、自动滚动、重试、附件、markdown、代码高亮、语音听写、键盘快捷键、无障碍。
- **IME（中文输入法回车）做得最扎实**：源码 `packages/react/src/primitives/composer/ComposerInput.tsx` 里
  - 用 `isCompositionKey()` 忽略合成期的按键；
  - Enter 分支同时判断 `e.nativeEvent.isComposing === true` 与内部 `compositionRef`，并有「浏览器丢 `compositionend` 时恢复 `compositionRef`」的兜底；
  - 用 `flushTapSync` 同步受控 `value`，避免 react-dom 的 controlled-input restore 打断正在进行的合成；
  - 专门有 PR 修 React Native Web 上的同一问题（[PR #4513](https://github.com/assistant-ui/assistant-ui/pull/4513)，说明其内部对 `keyCode === 229` 也有处理）。
- 移动端：Web 之外另有 React Native / Ink 版本，共享同一套 primitives（[docs](https://www.assistant-ui.com/docs)）。

---

### 3.2 Vercel AI SDK v7（UIMessage 数据模型）+ AI Elements

**链接**：[AI SDK 文档](https://ai-sdk.dev/) ・ [Transport 文档](https://ai-sdk.dev/v6/docs/ai-sdk-ui/transport) ・ [AI Elements](https://elements.ai-sdk.dev/docs) ・ [AI Elements GitHub](https://github.com/vercel/ai-elements) ・ [AI SDK 7 发布公告](https://vercel.com/changelog/ai-sdk-7) ・ [streamdown](https://github.com/vercel/streamdown)

**AI SDK（不是 UI 库，但是事实上的消息数据模型）**
- 许可：**Apache-2.0**（仓库 LICENSE 为 Apache-2.0；`ai` 与 `@ai-sdk/react` 的 npm license 字段均为 Apache-2.0）。
- 版本（2026-10-04）：`ai` **7.0.127**（2026-10-01）；`@ai-sdk/react` **4.0.130**（2026-10-01，peer `react: ^18 || ~19.0.1 || ~19.1.2 || ^19.2.1`——注意它对 19.x 的区间写得很细，19.0.0/19.1.0/19.2.0 这类补丁位不在区间内，装 React 19.2.x 没问题）。
- **v7 是 2026-06-25 的破坏性大版本**：① **要求 Node.js 22+**；② **只支持 ESM import**（`require()` 不支持，需要 `"type": "module"` 或 `.mjs`）。迁移有 codemod 与 skill：`npx @ai-sdk/codemod v7`、`npx skills add vercel/ai --skill migrate-ai-sdk-v6-to-v7`。
- **传输层完全可换（关键）**：`useChat({ transport })`，`ChatTransport` 接口文档原文就写着 *"This enables alternative communication protocols like WebSockets, custom authentication patterns, or specialized backend integrations."* 具体有：
  - `DefaultChatTransport` / `HttpChatTransport`（HTTP 默认实现，可直接抄它的源码写自己的）
  - `DirectChatTransport`（在进程内直接调 agent 的 `stream()`，不走 HTTP）
  - `resume` / `prepareReconnectToStreamRequest`：断线重连到进行中的流
  - 你实现 `sendMessages(options) → ReadableStream<UIMessageChunk>` 即可对接自建 WS（chunk 类型：`text-start/delta/end`、`tool-input-start/delta/available`、`data-part-start/delta/available`、`error` 等）。
- **结构化消息 = `UIMessage.parts`（最接近「事实标准」的东西）**：
  - 内建 part：`text`、`reasoning`、`tool-*`（含 `state`: `input-streaming | input-available | output-available | output-error | approval-requested | approval-responded | output-denied`）、`source-url`、`file`、`step-start`
  - **自定义 part：`data-*`**（[Streaming Custom Data](https://ai-sdk.dev/docs/ai-sdk-ui/streaming-data)），`writer.write({ type: 'data-weather', id: 'weather-1', data: {...} })`，**同 id 重写即原地更新（reconciliation）**；`transient: true` 的 part 只经 `onData` 回调、不进历史。
  - → 这几乎就是为「每条记录一个结构化对象 + 状态更新」设计的（回顾页可直接把「角色台词/玩家选择/导演注」做成 `data-*` part）。
  - 上下文压缩有官方 helper：`pruneMessages`（[API 参考](https://ai-sdk.dev/docs/reference/ai-sdk-ui/pruneMessages)）——**但仍需你自己渲染「早期 N 条已压缩」那条分隔条**。

**AI Elements（组件层）**
- 许可：**Apache-2.0**（仓库 LICENSE 原文 "Copyright 2023 Vercel, Inc. … Apache License, Version 2.0"；npm `ai-elements` license = Apache-2.0）。注意 GitHub API 报 `NOASSERTION`（因为不是标准命名/多许可混排），实际以 LICENSE 文本为准。
- 版本/活跃度：`ai-elements` **1.9.0**（npm latest，2026-03-12 发布，2026-05-18 元数据更新）；仓库 **2,473 stars**，最后 push 2026-09-01，112 open issues。周下载约 6.5 万–15 万。
- 形态：**shadcn registry**，`npx ai-elements@latest add <component>`，源码拷进 `components/ai-elements/`，或 `npx shadcn@latest add https://elements.ai-sdk.dev/api/registry/all.json`。
- **组件清单（我从 registry JSON 抓取，`registry:component` 共 48 个，2026-10-04）**：
  `agent, artifact, attachments, audio-player, canvas, chain-of-thought, checkpoint, code-block, commit, confirmation, connection, context, controls, conversation, edge, environment-variables, file-tree, image, inline-citation, jsx-preview, message, mic-selector, model-selector, node, open-in-chat, package-info, panel, persona, plan, prompt-input, queue, reasoning, sandbox, schema-display, shimmer, snippet, sources, speech-input, stack-trace, suggestion, task, terminal, test-results, tool, toolbar, transcription, voice-selector, web-preview`
  - **与你需求直接对应的**：`tool`（工具调用可视化）、`confirmation`（工具审批流，含 approval 状态分支）、`commit`（git 提交式卡片：文件列表 +/− 行数 + copy 按钮）、`checkpoint`（图标 + 按钮的**分隔行**，可当压缩分隔条骨架）、`queue`（待发消息/待办队列）、`plan`/`task`、`image`、`attachments`、`sources`、`reasoning`、`chain-of-thought`、`context`（上下文用量环 + token 明细 + 成本）。
  - **没有**：会话/线程列表（没有 sidebar / thread-list 组件）、会话归档删除、输入法的 Enter 行为配置。
- 风格耦合：**强绑 Tailwind**。官方 setup 原文：*"React 19 … Next.js 14+ (App Router recommended) … Tailwind CSS 4 … AI Elements is built targeting React 19 (no `forwardRef` usage) and Tailwind CSS 4"*，且 *"AI Elements supports CSS Variables mode only"*。shadcn 组件本身能用 Vite（[shadcn Vite 指南](https://ui.shadcn.com/docs/installation/vite)），且我核对了 `message` 组件 registry JSON：源码只 import `@/registry/default/ui/*`（shadcn 基础件）、`streamdown`、`@streamdown/{cjk,code,math,mermaid}`、`lucide-react`、`ai` 类型，**没有任何 Next.js 专有 import**（只有无害的 `"use client"` 指令）→ 在 Vite 里可用（这是我从源码得出的推断，官方文档未承诺；如果你走这条路，建议先跑一个最小 Vite 验证）。
- **中文细节好消息**：`message` 组件默认就带 `@streamdown/cjk` 插件（CJK 断行/标点处理），markdown 由 **streamdown** 渲染（`streamdown` **2.7.0**，2026-09-30，Apache-2.0，peer react ^18||^19，支持 GFM/KaTeX/Mermaid/Shiki/未闭合 markdown 容错）。
- **IME（重要）**：我读取了 registry 里 `prompt-input` 的源码，Enter 分支为
  ```ts
  if (e.key === "Enter") { if (isComposing || e.nativeEvent.isComposing) return; if (e.shiftKey) return; e.preventDefault(); ... }
  ```
  **没有 `keyCode === 229` 兜底**。已知问题：
  - [issue #21](https://github.com/vercel/ai-elements/issues/21)（2025-08）：日文/中文 IME 合成期回车会提交；作者加了 `isComposing` 判断，但 **Safari 仍复现**（评论区给出了 `keyCode === 229` 的绕法）。
  - [issue #400](https://github.com/vercel/ai-elements/issues/400)（仍开着）：**合成结束后的那一次 Enter 仍会误提交**（日语所谓「誤爆」），提议加 `submitMode="mod-enter"`。
  - 同类 bug 在其它项目也反复出现（如 [deer-flow #1540](https://github.com/bytedance/deer-flow/issues/1540)、[agent-browser #1379](https://github.com/vercel-labs/agent-browser/issues/1379)），修法都是 `isComposing || keyCode === 229`。
- 无障碍：构建在 shadcn/Radix 之上（ARIA 有基本保障）；`conversation` 使用 `use-stick-to-bottom` 做自动滚动。

**判断**：AI Elements = **最丰富的「AI 语义组件」货架**，但①强制 Tailwind v4 + shadcn 约定；②没有会话列表；③输入框的中文 IME 需要你自己补 229 兜底与「合成后 Enter」策略。

---

### 3.3 shadcn/ui 官方 chat 组件 + `@shadcn/react`（2026-06 新发，最权威的「转录容器」）

**链接**：[changelog 2026-06 Components for Chat Interfaces](https://ui.shadcn.com/docs/changelog/2026-06-chat-components) ・ [MessageScroller 文档](https://ui.shadcn.com/docs/react/message-scroller) ・ [Message 组件](https://ui.shadcn.com/docs/components/aria/message) ・ [组件总表](https://ui.shadcn.com/docs/components) ・ [@shadcn/react README](https://github.com/shadcn-ui/ui/blob/main/packages/react/src/message-scroller/README.md)

- 许可：**MIT**（`@shadcn/react` npm license = MIT，版本 **0.3.1**，2026-08-31，peer `react >=19`、`@types/react >=19`）。
- 2026-06 发布的第一批 chat 组件：**MessageScroller、Message、Bubble、Attachment、Marker**；配套工具类 **`scroll-fade`（滚动边缘渐隐）** 与 **`shimmer`（"Thinking…" 文本微光）**，随 `shadcn/tailwind.css` 提供。官方原文：*"This is the first phase of the chat components work."*、*"This does not replace AI Elements."*、*"The MessageScroller is also available as an unstyled headless component in `@shadcn/react`."*、*"Available now for Radix and Base UI."*
- **`@shadcn/react/message-scroller`（headless，无样式）能力清单**（读 README 原文）：
  - `MessageScroller.Provider`：`autoScroll / defaultScrollPosition / scrollPreviousItemPeek / scrollMargin / scrollEdgeThreshold`
  - `MessageScroller.Root`：布局
  - `MessageScroller.Viewport`：`preserveScrollOnPrepend`（**向上 prepend 历史时保住滚动位置**）
  - `MessageScroller.Content`：**默认 `role="log"` + `aria-relevant="additions"`**
  - `MessageScroller.Item`：`messageId`、**`scrollAnchor`（把某一轮的开头锚定在视口）**
  - `MessageScroller.Button`：`direction`，滚回最新/最旧，自动隐藏
  - hooks：`useMessageScroller()`（`scrollToMessage / scrollToStart / scrollToEnd`）、`useMessageScrollerVisibility()`（`currentAnchorId / visibleMessageIds`）、`useMessageScrollerScrollable()`
  - 测试覆盖 jsdom 几何 + chromium 真实滚动行为 + 性能基准
- 官方描述它解决的问题：*"anchored turns, streamed replies, saved thread restore, prepended history, jump-to-message, scroll controls, and visibility tracking"*，且 **"owns that behavior without owning your messages, AI state, transport, persistence, or model state. You bring the content renderer."**
- 组件语义：
  - `Message`：行布局（`MessageAvatar` / `MessageContent` / `MessageHeader` / **`MessageFooter` = 放逐条操作按钮的位置** / `MessageGroup` / `align="start"|"end"`）
  - `Bubble`：消息表面（variants、alignment、reactions、links、**buttons**、collapsible content）
  - `Attachment`：媒体 + 元信息 + 上传态 + 操作 + 整卡触发（动作仍可单独点）
  - **`Marker`：状态更新、系统注、带框行、**带标签的分隔条**（原文举的例子里就有 "streaming state, tool activity, **date breaks**"）→ 这就是「早期 N 条已压缩」分隔条的官方形态**
- **不含**：官方没有独立的 PromptInput（仍推荐 AI Elements 或自写），也没有会话列表/侧栏组件（shadcn 的 `Sidebar` 可以承载，但要自己接线）。→ 现阶段最稳的组合是：**shadcn MessageScroller 管滚动 + 自己写消息行与输入框**，或 **AI Elements 管输入/工具 + shadcn 管滚动**。

---

### 3.4 TanStack AI（+ `@tanstack/ai-react`）—— 唯一把 WebSocket 做成官方适配器的 UI 方案

**链接**：[React Chat UI 文档](https://tanstack.com/ai/latest/docs/ui/react) ・ [Connection Adapters](https://tanstack.com/ai/latest/docs/chat/connection-adapters) ・ [AG-UI 合规迁移说明](https://tanstack.com/ai/latest/docs/migration/ag-ui-compliance) ・ [GitHub](https://github.com/TanStack/ai)

- 许可/版本（2026-10-04）：**MIT**；`@tanstack/ai` **0.64.0**、`@tanstack/ai-react` **0.29.4**、`@tanstack/ai-client` **0.36.1**（均 2026-10-02 发布）。→ **仍是 0.x / RC 阶段**。
- UI 形态：`createChatHook({ options, components })` 工厂（对标 `createFormHook`/`createTableHook`），在模块作用域注册一次，返回 `useAppChat` / `useChatContext`，渲染 `<chat.AppChat />`。可插槽：`layout({Messages, Interrupts, Queue, Input})`、`message({message, Parts})`、`input`、`queue`。
  - **`partsComponents`**：`text / thinking / structuredOutput / toolResult / fallback` → **按 part 类型挂自己的组件**（含 `fallback` 兜未知类型）。这是与「回顾页 = 结构化条目 + 逐条操作」最贴近的现成机制之一。
  - **`toolsComponents`**：每个工具名一个组件，`part.state` 走 `awaiting-input → input-streaming → input-complete → approval-requested → approval-responded → error`（正好覆盖「正在联网检索…」这类状态文案）。
  - **`interruptsComponents`**：中断（人工介入）组件，`interrupt.resolveInterrupt(value)`（正好对应「从这一轮重新生成分岔」的选择动作）。
- **传输层：这是它的最大亮点**
  | 你的场景 | 官方适配器 |
  | --- | --- |
  | 普通 HTTP + 默认 | `fetchServerSentEvents` |
  | SSE 被墙/被代理破坏 | `fetchHttpStream` |
  | RPC（tRPC/gRPC-Web/Cap'n Web） | `rpcStream` |
  | **一条长连接、可恢复的 WebSocket** | **`webSocket`（内建）**，服务端配 `toWebSocketStream` / `toWebSocketResponse`，掉线自动重连 durable run |
  | **BroadcastChannel / postMessage / 共享 worker / 完全自定义持久传输** | **自己实现 `SubscribeConnectionAdapter`（subscribe/send）** |
  | 其它（HTTP/3、异构 SSE） | 自定义 `connect` 适配器 |
  - 官方原文：*"A connection adapter is the only piece that decides how data travels … Everything else … message reassembly, tool calls, UI updates … is transport-agnostic."*
  - 甚至给了「自定义 WebSocket 协议」的完整示例（不同 wire format、不需要 resume、或服务端不归你管的场景）。
- **AG-UI 合规**：`@tanstack/ai-client` 现在 POST 的是 **AG-UI 0.0.52 `RunAgentInput`**，官方宣称 *"the first SDK to ship full bidirectional client-to-server and server-to-client compliance against the AG-UI 0.0.52 spec"*。→ 意味着你若采用 AG-UI 事件模型，前后端都有现成实现。
- 依赖体量：`@tanstack/ai-react` peer 含 `@mcp-ui/client`（MCP UI 渲染），`@tanstack/ai-client` 是 headless 的（可只用来做状态机，UI 完全自己写）。
- 风险：**太新、0.x、文档/API 仍在移动**（如 v0.x 的 wire 已经历一次破坏性变更）。

---

### 3.5 Ant Design X（`@ant-design/x` 2.x）—— 组件与你的两个页面几乎一一对应

**链接**：[官网](https://x.ant.design/docs/react/introduce/) ・ [组件总览](https://x.ant.design/components/overview/) ・ [Bubble](https://x.ant.design/components/bubble/) ・ [Actions](https://x.ant.design/components/actions/) ・ [XRequest](https://x.ant.design/x-sdks/x-request/) ・ [GitHub](https://github.com/ant-design/x)

- 许可：npm 上 `@ant-design/x` / `x-sdk` / `x-markdown` / `x-card` / `x-skill` **均为 MIT**（2026-10-04 抓取）。**注意**：GitHub API 对该仓库报 `license: None`，且我列过仓库根目录**没有 LICENSE 文件**；MIT 文本出现在 `packages/x-sdk/LICENSE`、`packages/x-markdown/LICENSE`（2025-08 由 [PR #1142](https://github.com/ant-design/x/pull/1142) 补入）。→ 结论：**MIT，但根目录缺 LICENSE 文件**，法务较真时以包内 LICENSE 为准。
- 版本/活跃度：`@ant-design/x` **2.9.0**（2026-07-28），周下载 **≈10.4 万**；仓库 **4,799 stars**，最后 push 2026-10-01；open issues 174。
- 依赖与风格耦合：
  - peer：**`antd ^6.1.1`**、`react >=18.0.0`。→ **必须把 antd 6 拉进来**（当前 antd **6.6.5**，2026-09-20，MIT）。
  - 自身依赖：`@ant-design/cssinjs`、`@ant-design/cssinjs-utils`、`@ant-design/icons`、`@ant-design/colors`、`@rc-component/*`、`clsx`、`lodash.throttle`、**`mermaid`**、**`react-syntax-highlighter`**（后两个是体积大头）。
  - 主题：antd 6 走 CSS 变量 + design token，`XProvider`/`ConfigProvider` 可整体改 token，但**你的自有 CSS 主题与 antd 的 token 体系会共存**——「保住自有主题」= 把颜色/圆角/字号映射到 antd token，不能像 headless 方案那样完全无关。antd 的 cssinjs 是运行期注入样式。
- **组件清单（RICH 范式，2.9.0）**：
  `Bubble`（含 `Bubble.List`、`Bubble.System`、`Bubble.Divider`、语义化 DOM 插槽 root/body/avatar/header/content/footer/extra）、`Conversations`（会话列表）、`Notification`、`Confirmation`、`Think`、`ThoughtChain`、`Wake`、`Welcome`、`Prompts`、`Express`、`Attachments`、`Sender`、`Suggestion`、`Feedback`、**`Actions`**、`CodeHighlighter`、`FileCard`、`FolderFileTree`、`Mermaid`、`Sources`、`XProvider`；另有 `@ant-design/x-markdown`（流式 markdown，含公式/代码高亮/mermaid）、`@ant-design/x-card`（**基于 A2UI 协议**的动态卡片渲染：agent 用结构化 JSON 流构建交互界面）、`@ant-design/x-skill`（给 agent 的技能库）。
  - **映射到工坊对话页**：流式 markdown → `x-markdown`；工具状态文案 → `ThoughtChain`/`Think`；**「本次写入了哪些文件」→ `FileCard` / `FolderFileTree`**；图片内联 → `Bubble` 自定义 content；**「早期 N 条已压缩」→ `Bubble.Divider` 或 `Bubble.System`**；多会话 → `Conversations`；输入框 → `Sender`（自动增高、发送/停止）。
  - **映射到回顾页**：**`Bubble.List` 的 `role` 机制 + `Bubble` 的 `footer` 插槽 + `Actions`（`items[]` 支持 `label/icon/danger/subItems` 下拉、`onItemClick`、`actionRender` 自定义渲染）** = 「每条记录下面挂一排动词按钮」最接近的现成实现；`Actions.Copy`、`Actions.Feedback`、**`Actions.Audio`（带 loading/running/error 状态，正是「重听语音」）**、`Actions.Item`（带 status 的项）也是现成的。
  - `Bubble` 支持 **editable + onEditConfirm**（就地改写）、`Bubble.List` 支持自定义 role 渲染（导演注/系统项可以做成非气泡条目）。
- **传输层假设**：`@ant-design/x-sdk` 的 `XRequest`（自 2.0.0 起）：
  - `fetch`（**可传自定义 fetch**）、`middlewares`、**`transformStream`（自定义流处理，可返回新的 TransformStream）**、`streamSeparator` / `partSeparator`（自定义分帧）、`manual` 模式、`timeout` / `streamTimeout`、`abort`。
  - 更底层可继承 **`AbstractXRequestClass`**（抽象方法：`asyncHandler`、`isTimeout`、`isStreamTimeout`、`isRequesting`、`manual`、`run`、`abort`）→ **完全可以实现一个走自建 WS 的 XRequestClass**；再配 `useXChat`/`ChatProvider` 接 UI。
  - 文档也给了 ndjson（`application/x-ndjson`）等非 SSE 格式的适配示例，以及「transformStream 复用导致流锁死」的坑与正确写法。
  - → **不绑定 OpenAI SSE**；代价是你要写一层 provider（官方 API 明确、样例充分）。
- **React 19 / antd 6**：peer `react >=18`，仓库自 2024-12 起开发环境与站点已升 React 19（[PR #432](https://github.com/ant-design/x/pull/432)）；peer 要求 antd 6，**若你已经在用 antd 5 就不是零成本**。
- **IME**：`Sender` 基于 antd 的 `Input.TextArea` → `rc-textarea`，其 Enter 判定为 `if (e.key === 'Enter' && onPressEnter && !e.nativeEvent.isComposing)`（我核对了 `react-component/textarea` 与 `react-component/input` 源码）→ **有基本保护，但没有 `keyCode === 229` 兜底**，与 AI Elements 属同一类残留风险。

---

### 3.6 CopilotKit（v2）+ AG-UI 协议

**链接**：[CopilotKit](https://www.copilotkit.ai/) ・ [产品/功能与套餐 PDF](https://www.copilotkit.ai/docs/copilotkit-products.pdf) ・ [CopilotChat 文档](https://docs.copilotkit.ai/prebuilt-components/chat) ・ [v1→v2 迁移](https://docs.copilotkit.ai/migrate/v2) ・ [runtime HTTP endpoints](https://docs.copilotkit.ai/teams/agno/backend/runtime-endpoints) ・ [GitHub](https://github.com/CopilotKit/CopilotKit) ・ [AG-UI](https://github.com/ag-ui-protocol/ag-ui)

**CopilotKit**
- 许可：核心 **MIT**（仓库 MIT；`@copilotkit/react-core|react-ui|runtime` 均 MIT，**1.77.0**，2026-10-02）。仓库 **37,730 stars**，当日 push。
- **收费档（引自官方 products PDF，落地务必复核）**：Core Framework 开源免费可自托管；Premium（订阅）覆盖「零强制 UI 结构 / 直接访问全部 state 与事件 / 自定义组件架构（即 headless）」；Developer 免费（1 seat / 50 MAU）、Team **$1,000/seat/月**（100 MAU/seat）、Enterprise 定制（**$5K/月起**，含 VPC/on-prem、离线 license key、SSO、SLA）。
- **v2 与代码上的实际门禁**（我读了 `CopilotKitProvider.tsx` 源码）：`publicApiKey` 与 `publicLicenseKey` 是两个不同东西；缺失时会 console.warn；**`selfManagedAgents`（自管 agent）被明确标注为 "part of CopilotKit's Enterprise Intelligence offering"**；`agents__unsafe_dev_only` 是**免费的本机开发逃生舱**且**故意不做门禁**。另外 Intelligence 自托管要求有 license key 的 Team 自托管档或 Enterprise 档，并提供 Helm chart（`oci://ghcr.io/copilotkit/charts/intelligence`）；未授权的自托管安装会有 `threadCuller` 定时清理旧线程。
- **付费边界（对我很关键的一点）**：runtime 的线程路由中，**`PATCH/DELETE /threads/:threadId`（改名/删除）、`POST /threads/:threadId/archive`、`POST /threads/subscribe` 明确标注 "Intelligence only"**；`GET /threads`、`GET /threads/:id/messages|events|state` 与 `POST /threads/clear` 在默认 `InMemoryAgentRunner` 上可用（SqliteAgentRunner 对四个读路由返回 422）。→ **「会话列表/归档/删除」在 CopilotKit 里属于付费能力**（或你自己实现）。
- 传输层：runtime 是**自建 Node handler**，多路由模式下一个 agent 两个关键路由——`POST {basePath}/agent/:agentId/run`（body 是 **AG-UI `RunAgentInput`**，响应是 **SSE 事件流**）与 `POST /agent/:agentId/connect`（重连恢复流）；也有 single-route 模式（`copilotRuntimeNextJSAppRouterEndpoint` 等一律 single-route，客户端用 `useSingleEndpoint`）。
  - **Direct Connection**（不跑 runtime，前端直连你的 agent）：官方明确列出代价——① 认证自己管；② *"Many features in the CopilotKit ecosystem depend on this server-side middleware. Without the runtime, these features — including threads and other capabilities — will not be available."*；③ agent 路由要手工。
  - → 对你的自建 WS：要么起它的 runtime 当 HTTP/SSE 桥（可行但多一层），要么走 self-managed agent（实现 `AbstractAgent`，把 WS 事件翻成 AG-UI 事件）+ Direct Connection，代价是丢掉 threads 等生态能力，且 selfManagedAgents 属付费档。
- 风格耦合：v2 用自己的一套 CSS 生成管线，并通过 **`extendTailwindMerge({ prefix: "cpk" })`** 加前缀以**避免污染宿主应用的 Tailwind 样式**（仓库 changelog 原文：*"CopilotKit styles no longer interfere with existing application styling, period."*）。peer 不含 tailwind，但你若不使用 Tailwind 需要单独确认它的样式引入方式。依赖里有 `lit`、`rxjs`、`streamdown`、`use-stick-to-bottom`、`@tanstack/react-virtual`、`@a2ui/web_core`、`@jetbrains/websandbox`、`@mcp-ui` 等（体积不小）。
- **IME**：v2 的 `CopilotChatInput` 曾**完全不处理合成事件**（中文/日文/韩文回车即发送）——[issue #3318](https://github.com/CopilotKit/CopilotKit/issues/3318) / [PR #3322](https://github.com/CopilotKit/CopilotKit/pull/3322)（2026）修复：加 `isComposingRef` + `onCompositionStart/End` + Firefox 时序兜底 + `e.nativeEvent.isComposing`，并**同时给斜杠命令的 Enter 加了守卫**；v1 的 React 输入框原本就处理正确。
- 无障碍/移动：React（`^18 || ^19`），AG-UI 侧另有 React Native 客户端；CopilotKit 自身文档宣传 full TypeScript、Next.js 集成为主。

**AG-UI 协议（跨厂商事实标准的候选）**
- **MIT**（仓库 MIT，"MIT © 2025 AG-UI Protocol Contributors"）；仓库 **16,295 stars**，2026-10-02 push；`@ag-ui/client` **1.0.1**（2026-09-29，周下载 **168 万+**）、`@ag-ui/core` 1.0.1（peer zod ^3.25||^4）。
- 事件模型：Lifecycle（`RUN_STARTED/STEP_STARTED/RUN_FINISHED/RUN_ERROR`）、Text（`TEXT_MESSAGE_START/CONTENT/END`）、Tool Call、State（`STATE_SNAPSHOT/DELTA`）、**Activity**（`ACTIVITY_SNAPSHOT/ACTIVITY_DELTA`）、Special（**`CUSTOM`**，带 `name`/`value`）。约 16 种标准事件。
- **`ActivityMessage` 值得单独看**（[messages 文档](https://github.com/ag-ui-protocol/ag-ui/blob/main/docs/concepts/messages.mdx)）：
  ```ts
  interface ActivityMessage { id: string; role: "activity"; activityType: string; content: Record<string, any> }
  ```
  官方定位：*"Structured UI messages that exist only on the frontend. Used for progress, status, or any custom visual element that shouldn't be sent to the model"*、*"Frontend-only: never forwarded to the agent"*、*"Customizable: define your own activityType and content and render a matching UI component"*、*"Streamable: can be updated over time"*。**这就是「回顾页那种结构化、非气泡、不进模型上下文」条目的协议级抽象。**
- 传输：**明确定义为传输无关**——*"AG-UI doesn't mandate how events are delivered, supporting various transport mechanisms including Server-Sent Events (SSE), webhooks, WebSockets, and more."*；中间件层允许事件格式「AG-UI 兼容」而非严格一致。
- 客户端抽象：`AbstractAgent.run(input: RunAgentInput) → Observable<BaseEvent>`（**对接自建 WS 的落点**）、`HttpAgent`（内建 HTTP SSE 与二进制协议）、`TransportCapabilities` 里有 `streaming / websocket / httpBinary / pushNotifications / resumable` 标志，`use()` 可挂中间件。
- 生态：`@ag-ui/vercel-ai-sdk`（把 AI SDK 的 streamText/tool 执行接成 AG-UI agent，[仓库路径](https://github.com/ag-ui-protocol/ag-ui/tree/main/integrations/vercel-ai-sdk/typescript)，已有 AI SDK v7 重写 PR #1626）、CopilotKit 为第一方客户端、assistant-ui 有 `react-ag-ui`、TanStack AI 宣称双向合规。

---

### 3.7 Hashbrown —— 浏览器内 agent + 生成式 UI（全 headless）

**链接**：[官网](https://hashbrown.dev/) ・ [React 文档](https://hashbrown.dev/docs/react/concept/components) ・ [GitHub](https://github.com/liveloveapp/hashbrown) ・ [LICENSE](https://github.com/liveloveapp/hashbrown/blob/main/LICENSE) ・ [v0.4 发布博文](https://hashbrown.dev/blog/2025-12-16-hashbrown-v-0-4-0)

- 许可：**MIT**（LICENSE 原文 "MIT License Copyright (c) 2025 LiveLoveApp, LLC"，并附第三方 MIT 声明：partial-json-parser-js、Zod、QuickJS、quickjs-emscripten、@ngrx/signals）。npm 上 `@hashbrownai/react|core|angular` 均 MIT。
- 版本/活跃度：**0.6.1**（2026-09-24）；仓库 **726 stars**（2026-10-03 push），11 open issues，周下载约 1.3k–2.3k。→ **活跃但小众；0.x**。
- React 兼容：peer **`react >=18 <20`**（**含 React 19**）。
- 形态：**全 headless**（无自带样式/无聊天 UI 组件），核心是「把你的 React 组件暴露给模型」（`exposeComponent(Component, { name, description, props: { x: s.string(), y: s.streaming.string() } })` + `useUiChat({ components, system, tools })`），用自研 schema DSL **Skillet**（支持 streaming 部分值，含 `s.node()` 表示「可能还在流」的节点）。另有 **Magic Text**（流式 Markdown 解析 + 内联引用）、**threads**（可选线程模式，恢复历史并发送增量）、**浏览器本地模型**（实验，Chrome/Edge）、适配器（OpenAI/Anthropic/Azure/Ollama/AWS Bedrock）。
- 对你：它**不做聊天转录 UI**（没有 Thread/Message/输入框组件），只解决「让模型生成你的组件」；`useUiChat` + 自写转录列表是一条路，但等于把转录层从零写。

---

### 3.8 Tambo —— 生成式 UI + 自带后端

**链接**：[文档](https://docs.tambo.co/) ・ [自托管](https://docs.tambo.co/guides/self-hosting) ・ [GitHub](https://github.com/tambo-ai/tambo) ・ [tambo.co](https://tambo.co/)

- 许可：**MIT**（`@tambo-ai/react` MIT；仓库 MIT；README 原文 *"MIT unless otherwise noted. Some workspaces (like `apps/api`) are Apache-2.0."*）。仓库 **11,181 stars**，2026-10-04 push。
- 版本/活跃度：`@tambo-ai/react` **1.3.0**（2026-06-15），peer `react ^18.0.0 || ^19.0.0`，依赖含 `@modelcontextprotocol/sdk`、`zod`、`zod-to-json-schema`。
- **形态是「框架」而不是「呈现层」**：注册组件（`TamboComponent[]`：name/description/component/propsSchema）→ 两种模式：**generative components**（一次性渲染图表/卡片）与 **interactable components**（按 ID 跨会话持续存在并更新状态，适合购物车/看板/表格）。hooks：`useTambo()`、`useTamboThreadInput()`、`useTamboInteractable()`、`useTamboCurrentMessage()`、`useTamboComponentState()`、`useTamboStreamStatus()`。
- **必须跑它的后端**：Tambo Cloud（免费额度）或**自托管（Docker，`git clone` 仓库 + `./scripts/tambo-start.sh`，端口 3030，`NEXT_PUBLIC_TAMBO_API_URL` 指向它）**。
  - **时效性提醒**：官方 self-hosting/CLI 文档里仍写 `git clone https://github.com/tambo-ai/tambo-core.git`，但 **`tambo-ai/tambo-core` 与 `tambo-ai/tambo-cloud` 在 2026-10-04 均已 404**（`tambo-cloud` 曾在 2025-11-25 最后一次推送并标记 archived）。现存活的是 `tambo-ai/tambo` 单仓（含 backend）。→ 自托管请以主仓 README 为准。
- 对你：会把 agent 编排、线程、状态都接管过去（你已有自建 Node 服务端与 WS 协议），**接入成本高于收益**，除非你想要它的「interactable components」范式。

---

### 3.9 deep-chat —— 「一条标签」的框架无关聊天块

**链接**：[GitHub](https://github.com/OvidijusParsiunas/deep-chat) ・ [文档](https://deepchat.dev/docs/messages/HTML/) ・ [customButtons](https://deepchat.dev/docs/styles/buttons#customButtons) ・ [llms.txt](https://github.com/OvidijusParsiunas/deep-chat/blob/main/llms.txt)

- 许可：**MIT**；仓库 **3,730 stars**，2026-10-01 push；npm `deep-chat` / `deep-chat-react` **2.5.1**（2026-08-27）；最新 release 说明为 **2.5.0（2026-07-19）**。
- 形态：**Lit 写的 Web Component**（`<deep-chat>`），React 走 `deep-chat-react`（内部用 `@lit/react`，peer react `>=16.8.0`）。**自成一体的样式体系**：全部通过 props（各种 `*Style` 对象）、`auxiliaryStyle`、CSS class 覆盖——**不依赖 Tailwind/antd，自有主题保得住**。
- 能力：markdown 与代码、附件上传/下载、摄像头拍照、麦克风录音、STT/TTS（speech-to-speech）、`directConnection` 直连 **20+ 家 AI API（含 OpenAI/Claude/OpenRouter/X/Dify/LiteLLM/Requesty 等）**、浏览器内跑模型（`webModel`）、focus 模式、`storage`（浏览器存储）、历史加载（`history`）、intro panel/modals、**customButtons（2.2.0 起，输入区自定义按钮，支持 default/active/disabled 三态与 dropup 菜单）**。
- **结构化消息与逐条按钮**：靠 `html` 属性塞任意 HTML 字符串进消息体；因为组件是 **shadow DOM**，你的 HTML 访问不到宿主 CSS/JS，官方给了 **`htmlClassUtilities`**（按 class 名绑定 `events`（任意事件名）与 `styles`（各交互态））——**「每条记录挂动词按钮」技术上可行**，但写法是「拼 HTML 字符串 + 按 class 绑事件」，而不是 React 组件（自研主题下也不自然）。内建 class：`deep-chat-button`、`deep-chat-suggestion-button`、`deep-chat-temporary-message`；`htmlWrappers` 可自定义包裹元素。
- 多会话：**没有会话列表**，只有 `history` 与 storage；多会话得自己在宿主应用里换 `history`。
- IME：**未查到明确处理**（源码层面我没能在 llms.txt/文档中找到 composition 相关说明）→ 视为**未验证/可能需自己兜底**。
- 定位总结：适合「一个浮窗客服/助手」而不是「一个自研主题的转录工作台」。

---

### 3.10 Loquix（2026 新出的 Web Components 方案）

**链接**：[loquix.dev](https://loquix.dev/) ・ [文档](https://loquix.dev/docs/) ・ [GitHub](https://github.com/loquix-dev/loquix)

- 许可/版本：**MIT**；`@loquix/core` **0.6.0**（2026-09-23，首个版本 2026-03-10）；peer `lit ^3`；仓库 **42 stars**，2026-09-23 push。周下载 ~438。→ **极新、极小众**。
- 形态：**Lit 3 + Shadow DOM 的 53 个 Web Components**（`<loquix-chat-container>` / `message-list` / `chat-composer` 等），另提供 `@loquix/react` 包装（含 hooks 与 context provider）。文档自称自带 streaming、reasoning、citations、tool calls、attachments、feedback、search；**主题方式**：CSS custom properties（tokens）+ `::part()`；**无障碍**：键盘行为、焦点管理、live status、语义控件均列为内建能力。
- **传输层**：提供 Provider 接口——`AgentProvider`（`stream(messages, options) => Promise<{stream: ReadableStream}>`）、`UploadProvider`，以及控制器（`AgentController` / `StreamingController` / `AutoScrollController` / `KeyboardController` / `ResizeController` / `UploadController`）→ **自定义金标（含 WS）可行**。
- 风险：单作者/小团队、0.6、生态几乎为零；Roadmap 里 Vue/Svelte 绑定与「provider 集成」尚未完成。

---

### 3.11 OpenAI ChatKit —— 官方但「不是你的代码」

**链接**：[chatkit-js](https://github.com/openai/chatkit-js/) ・ [官方指南](https://developers.openai.com/api/docs/guides/chatkit) ・ [文档站](https://openai.github.io/chatkit-js/)

- 许可：`openai/chatkit-js` **Apache-2.0**（仓库 LICENSE，1,960 stars，2026-07-31 push）；`@openai/chatkit-react` **1.6.1**（2026-07-31，**MIT**，peer react `>=18`）。
- 形态：`<ChatKit control={control} />` + `useChatKit({ api: { getClientSecret } })`，页面上还要加一行 **从 OpenAI CDN 加载的脚本**（`https://cdn.platform.openai.com/deployments/chatkit/chatkit.js`）。
- 关键限制（对本地优先桌面应用尤其致命）：
  - UI 是**外部 Web Component**，源码不在你的仓库里 → 视觉/行为不可控，**与自有主题共存基本上不可行**。
  - 需要 **client secret**（由你的服务端向 OpenAI 换取）或 **ChatKit Python SDK 自托管**（"Custom server integration. Run ChatKit on your own infrastructure."）——但 UI 仍是 CDN 脚本。
  - 结构与交互由**服务端驱动的 widget JSON** 决定（WidgetNode、Card/Button/ListView/Markdown/Form/Transition…），也就是「agent 生成 UI」那条路，而不是「渲染我已有的结构化记录」。
- 结论：本项目的形态与它的假设不匹配（离线/本地优先 + 自有视觉 + 自有协议）。

---

### 3.12 老牌与小众组件库（长尾）

| 库 | 许可/版本/活跃度（2026-10-04） | 形态与结论 |
| --- | --- | --- |
| **nlux**（`@nlux/react`） | **MPL-2.0**（注意：非 MIT）；**2.17.1，最后发版 2024-08-15**；仓库 push 2025-11-25，1,384 stars | `AiChat` + adapter 体系（`StandardChatAdapter` / `AdapterBuilder` / 自定义 `ChatAdapter`），`conversationOptions.layout: 'list' \| 'bubbles'`，`messageOptions.responseRenderer` / `promptRenderer` / `editableUserMessages`，`initialConversation` 可载入历史。**传输可自定义**（实现 `ChatAdapter`），**渲染可自定义**（自定义 renderer）。→ 但**两年无 npm 发版、MPL-2.0 的文件级 copyleft、peer 仍写 react ^18**，风险高于收益。 |
| **chatscope**（`@chatscope/chat-ui-kit-react`） | MIT；**2.1.1（2025-05-15）**，该版只是「add react 19 to peer dependencies」；3 万+ 周下载；1,779 stars；此后无 push | 经典聊天 UI kit（`MainContainer/ChatContainer/MessageList/Message/MessageInput`），自带 CSS 包 `@chatscope/chat-ui-kit-styles`（可换主题文件）。消息可放自定义 children。**纯聊天气泡形态，无工具调用/流式语义/会话列表**；历史上做过 IME 修复（CHANGELOG 里 1.5.2 有「last korean character entered twice」）。 |
| **react-chatbotify** | MIT；**2.5.0（2025-11-18）**，仓库 push 2026-04-08，454 stars | 面向「流程式机器人」（`flow` 定义 steps/options），**不是 LLM 转录**。**CI 明确覆盖 React 16/17/18/19**；样式通过**内联 style 对象**逐部件覆盖（`headerStyle` 等）+ class 覆盖（前缀 `rcb`）→ **自有主题容易保**；v2 新增 `ariaLabel`（无障碍）、`useChatHistory`（`showChatHistory/getHistoryMessages/setHistoryMessages`）、更少样式污染。有 custom components / custom hooks。 |
| **react-chat-elements** | MIT；**12.0.18（2025-03-18）**；peer 写死 `react ^18.2.0` / `react-dom 18.2.0` | 老式消息气泡件，**React 19 未声明支持**；不推荐。 |
| **Lobe UI**（`@lobehub/ui`） | **MIT**；**5.55.0（2026-10-03）**；peer `antd ^6.1.1`、`react ^19.0.0`、`motion ^12`、`@lobehub/icons` | LobeHub 的组件库（营销页面/聊天/表格/图表等）。是**整站型项目里少见的「真发布了可复用组件包」**，但它假设 antd 6 + LobeHub 的设计语言与图标体系，脱离 LobeHub 数据层要自己接线。 |
| **`@librechat/client`** | npm license 字段为空（仓库 LibreChat 是 **MIT**）；**0.4.82（2026-10-01）**；peer 一大堆（`jotai`、`i18next`、`dompurify`、`input-otp`、`lucide`、`clsx`…），并导出 `./tailwind-preset` 与 `./style.css` | LibreChat 的 React 组件包，**必须共建 Tailwind preset + jotai + i18next**，实质是「把 LibreChat 的前端搬进你的项目」。 |
| **`@sandbox-agent/react`** | Apache-2.0；**0.4.2（2026-03-26）**；peer react ^18.3.1 \|\| ^19 | 提供 **`AgentTranscript`**（无样式转录视图，含工具/推理/meta 条目）——最接近「转录流但无气泡」的现成 headless 组件，但生态极小、需配 `sandbox-agent` 后端。 |
| **Conversed**（`@conversed/react`） | MIT；**0.0.1（2026-07-31）** | 「内容块 AST + 动作协议」：把回复解析成 `paragraph/heading/list/table/stats/steps/timeline` 等块，表格行/卡片/CTA 可带 `data-action-id`，交互通过 `onAction({type, actionId, target, params})` 回传；CTA 按钮有 `idle → pending → done/failed` 生命周期。**形态上正是回顾页那类需求**，但**0.0.1、几乎无人使用**。 |
| **Kibo UI**（shadcnblocks/kibo） | **MIT**（仓库根有 `license.md`）；3,952 stars；最后 push **2026-05-04**；官网称 "Free and open source, forever" | shadcn 自定义 registry，含 `ai-chatbot` / `ai-conversation` / `ai-tool` / `ai-reasoning` / `ai-sources` / `ai-branch` / `ai-suggestions` 等 AI 组件（从 CHANGELOG 可见）。组件是拷贝进项目的源码，**风格随 shadcn 主题**。 |
| **prompt-kit**（ibelick） | **MIT**；3,105 stars；push **2026-09-28** | `PromptInput` 等 AI 输入组件（shadcn CLI 安装，`npx shadcn@latest add prompt-kit/[component]`）。注意 21st.dev 上的镜像安装路径需要 API key（免费账号有每日配额）。 |
| **shadcn-chatbot-kit**（Blazity） | MIT；804 stars；push **2026-02-26** | 文档与示例仍写 **`useChat` from `ai/react` + `input/handleInputChange/handleSubmit`**（**AI SDK v5 已移除的旧 API**），且仓库 devDeps 停在 Tailwind 3.4.6。→ **代码可抄，集成文档过时**。 |
| **createui.co / 21st.dev** | 第三方 registry，授权与计费需自查 | createui 有 `ChatListView`（会话列表行 + 逐行操作）等；21st.dev 走付费配额安装。 |
| **`@rainbow-oh/yee-x`** | 0.4.0（2026-06） | antd X 风格的克隆件（Bubble/Sender/Prompts/History/AIRenderer 等），**小众**。 |
| **`@openuidev/react-ui`** | MIT；0.16.3（2026-09-24） | 「生成式 UI SDK」的组件库（Thesys 系），面向 JSON→UI 渲染，不是聊天转录。 |

---

## 4. 你的两个页面 × 各方案逐项对照

### 4.1 工坊对话页（搭台助手）

| 需求 | assistant-ui | AI Elements + shadcn | Ant Design X | TanStack AI | deep-chat |
| --- | --- | --- | --- | --- | --- |
| 流式 markdown 增量 | 有（`@assistant-ui/react-markdown`） | 有（streamdown 2.7.0，含 `@streamdown/cjk` 中文插件，容错未闭合 markdown） | 有（`x-markdown`，公式/代码/mermaid） | 有（`partsComponents.text` 自渲染） | 有（markdown + remarkable 配置） |
| 工具调用进行中状态文案 | 有（`makeAssistantToolUI`，`status.type`） | 有（`tool` 组件；`part.state` 全状态机） | 有（`ThoughtChain` / `Think`） | 有（`toolsComponents`，`part.state` 全状态机） | 无内建工具语义，需自己拼 HTML/markdown |
| 本轮写入文件列表 + 撤销按钮 | 需自写（可在 part 渲染里做） | **`commit` 组件（文件列表 + −/+ 行 + copy）最接近**；`confirmation` 覆盖审批 | **`FileCard` / `FolderFileTree` 现成**，撤销按钮自己加 | 需自写（在 `partsComponents` 里） | 需自己拼 HTML + `htmlClassUtilities` 绑事件 |
| 生成图片就地插入消息流 | 有（Attachment / MessagePart image；`@assistant-ui/react` 有 file part） | 有（`image` 组件 + `attachments`） | 有（`Attachments` + Bubble 自定义 content） | 有（part 渲染 + `@mcp-ui/client`） | 有（图/文件上传与显示） |
| 「早期 N 条已压缩」分隔条 | 需自写（可用自定义 part；视觉参考 Checkpoint/Marker） | **`checkpoint`（图标+按钮的分隔行）** / `Marker`（带标签分隔条） | **`Bubble.Divider` / `Bubble.System`** | 需自写（layout/parts 插槽） | 需自己拼 HTML（有 `deep-chat-temporary-message` 等 class） |
| 多会话（列表/归档/删除） | **原语 + adapter 全套**（`ThreadList`，`archive/unarchive/delete/rename/generateTitle/fetch`） | **无**（需配合 shadcn Sidebar 自建） | **`Conversations` 组件**（数据自管） | 无内建（自己管 thread） | **无** |
| 中文输入法回车不误发送 | 处理最完整（`isComposing` + `keyCode 229` + `flushTapSync` + 合成期受控值同步） | 有 `isComposing`，**缺 229 兜底**；Safari 与「合成后 Enter」仍有 issue（#21 / #400） | 有 `isComposing`（经 rc-textarea），缺 229 兜底 | 取决于你自己写的 input 插槽 | **未验证** |
| 自定义主题保得住吗 | 保得住（primitives 无样式；registry 组件是源码） | **要引入 Tailwind v4 + shadcn token**，主题需映射到 CSS 变量 | 需映射到 antd 6 token（cssinjs） | 保得住（布局全自己写） | 保得住（props/CSS 变量） |
| 传输层 | `ExternalStoreRuntime` / `AssistantTransport`（HTTP 快照流）→ 自己包 WS | 无（AI SDK `ChatTransport` 可自定义，或干脆不用 AI SDK 的 hook） | `XRequest` 自定义 `fetch`/`transformStream`；`AbstractXRequestClass` 全自定义 | **`webSocket()` 官方适配器 / `SubscribeConnectionAdapter`** | `directConnection` 或用自定义 handler 回调 |

### 4.2 回顾页（结构化记录流 + 每条动词按钮）

| 需求 | 现成能力 | 结论 |
| --- | --- | --- |
| 渲染「一列可读记录」（非气泡） | **shadcn `MessageScroller`**（headless，`role="log"`、锚点滚动、prepend 保位、可见性追踪）；**antd X `Bubble.List` 自定义 role + `Bubble.System`/`Divider`**；**assistant-ui `MessagePrimitive.Parts`**；**TanStack AI `partsComponents` + `fallback`** | 四家都能承载；其中 MessageScroller 是唯一把「**滚动/锚定/历史 prepend/跳转**」抽象成独立可复用件的方案（这正是长记录流的真实难点） |
| 每条记录下面一排动词按钮（回到舞台/重听语音/就地改写/从这一轮重新生成分岔） | **antd X `Actions`（items/subItems/actionRender）+ `Actions.Audio`（重听，自带 loading/running/error）+ `Bubble` editable**；assistant-ui `ActionBarPrimitive.Root` 内可塞任意按钮；AI Elements `MessageActions/MessageAction/MessageToolbar`；shadcn `MessageFooter`；TanStack AI 在 part 渲染里放按钮 | **没有任何库提供「动词按钮」的语义**——它们只提供「可插入任意 ReactNode 的插槽」。你的四个动词全部自写。最省事的两个起点：antd X `Actions`（`Audio` 直接解决重听）与 assistant-ui `ActionBar`（自动禁用/悬浮逻辑现成） |
| 数据来源是服务端已解析好的结构化条目（非 token 流） | **assistant-ui `ExternalStoreRuntime.convertMessage`（支持 `data-*` part → DataMessagePart）**；**AI SDK `UIMessage.parts` 的 `data-*`（同 id 重写即原地更新，`transient` 可不入历史）**；**AG-UI `ActivityMessage`（`role:"activity"` + `activityType` + 任意 `content`，不进模型上下文）**；TanStack AI `partsComponents` | 这三者是**数据模型层的现成抽象**，但 UI 组件仍要自己写 |
| 「重听语音」 | antd X `Actions.Audio`；assistant-ui 有 speech adapter 与 `ActionBarPrimitive.Speak`；deep-chat 有 TTS/STT；其余靠自写 audio 元素 | antd X 与 assistant-ui 有现成语音按钮状态机 |
| 「就地改写」 | assistant-ui `ActionBarPrimitive.Edit` + Composer 编辑模式；antd X `Bubble` 的 editable；AI SDK 有 message 编辑的概念；shadcn `Bubble` 支持 collapsible/交互但无内建编辑 | 需要自己做编辑态与提交，但进入/退出编辑的状态机在 assistant-ui 里是现成的 |
| 「从这一轮重新生成分岔」 | assistant-ui **`BranchPicker`**（分支切换）+ Reload；AI Elements `branch`；AI SDK `regenerate` 带 `messageId`；TanStack AI `interruptsComponents` | 「分岔浏览」有现成组件，「分岔生成」是你后端的语义 |

---

## 5. 事实标准 vs 必然自研

### 5.1 已经形成事实标准、值得直接采用的部分

1. **「消息 = 类型化 part 数组」这个数据模型**：Vercel AI SDK 的 `UIMessage.parts`（`text` / `reasoning` / `tool-*` 带 `state` / `data-*` 自定义可协调更新 / `source-url` / `file` / `step-start`）已经渗入几乎所有 React 方案（AI Elements、assistant-ui 的 `data-*` 支持、TanStack AI 的 `partsComponents`、shadcn chatbot-template 的 `part.type` switch）。**即使你不用 AI SDK 的传输，也值得照抄这个 parts 形状**。
2. **「工具调用状态机」**：`input-streaming → input-available → output-available / output-error`（AI SDK）与 `running → complete/incomplete`（assistant-ui）以及 AG-UI 的 `TOOL_CALL_START/ARGS/END/RESULT` 基本等价。**直接采用其一即可**，不要自创第四套。
3. **「streaming markdown 容错渲染」**：**streamdown（Apache-2.0，2.7.0）** 已是 AI Elements 的底座，且有 **`@streamdown/cjk`** 这种中文/日文断行插件（还解决未闭合 markdown、公式、mermaid、Shiki 高亮、代码块交互）。→ **可以单独采用，不要求你换整套 UI**。
4. **「转录滚动容器」**：**shadcn `MessageScroller` / `@shadcn/react/message-scroller`**（headless、MIT、React ≥19、`role="log"` + `aria-relevant="additions"`、锚点、prepend 保位、跳转、可见性、性能基准测试）。这是 2026-06 才出现的、由 shadcn 亲自定义的标准件；**它明确不接管你的 messages/transport/persistence**，与你的架构最兼容。
5. **「Agent↔前端 wire 协议」**：**AG-UI**（MIT，`@ag-ui/client` 1.0.1，周下载 168 万）正在成为跨厂商标准（CopilotKit 联合创始、TanStack AI 宣称双向合规、assistant-ui 有适配器、`@ag-ui/vercel-ai-sdk` 存在）。**即使你不直接用它，也建议让自己的 WS 事件与它的 ~16 个事件类型保持同构**（生命周期 / 文本 / 工具 / 状态快照+delta / activity / custom），这样任何 AG-UI 生态客户端将来都能接。
6. **「结构化、不进模型上下文的 UI 条目」**：AG-UI `ActivityMessage`（`role:"activity"` + `activityType` + `content`）与 AI SDK 的 `data-*` part（可 `transient`）已经把「回顾页那种条目」在协议层表达清楚了。
7. **「输入框的中文 IME 兜底写法」**：`e.nativeEvent.isComposing || e.keyCode === 229`（跨项目反复踩坑后的共识），外加「合成刚结束后的那一次 Enter」需要产品决策（`mod-enter` 或时间窗）。**这些库大多只做了一半，你自己兜底反而更可靠**。
8. **「多会话的接口形状」**：assistant-ui 的 `RemoteThreadListAdapter`（`list / rename / archive / unarchive / delete / initialize / generateTitle / fetch`）与 `ThreadHistoryAdapter`（`load / resume / append / update / delete`）是目前最完整的「会话持久化接口契约」，**可以直接照抄成你自己的类型**，不必采用它的实现。

### 5.2 从来没人做成通用组件、必然要自己写的部分

1. **「每条记录挂一排领域动词按钮」的记录流**。所有库的终点都是「一个可以插入任意 ReactNode 的插槽」（assistant-ui `ActionBarPrimitive.Root` / AI Elements `MessageActions` / antd X `Actions.items` / shadcn `MessageFooter` / TanStack AI part 渲染）。动词的语义（回到舞台 / 重听语音 / 就地改写 / 从这一轮重新生成分岔）与数据绑定**只能自写**。最接近的两个现成抽象是 antd X `Actions`（含 `Audio`）与 assistant-ui `ActionBar`（含自动禁用/悬浮），但它们给的是按钮容器，不是行为。
2. **「本轮写入了哪些文件 + 撤销」这种带副作用的操作清单**。AI Elements `commit` 给的是 git 风格卡片（文件、±行数、复制），`confirmation` 给的是审批；**「撤销」这个动作在任何库里都不存在**（它意味着你后端有可回滚的写入事务）。
3. **「早期 N 条已压缩」这种带语义的上下文管理分隔条**。视觉骨架现成（shadcn `Marker`、AI Elements `checkpoint`、antd X `Bubble.Divider`），但**折叠/展开被压缩的历史、跳转、与 token 计数的关系**都要自己实现（AI SDK 只提供 `pruneMessages` 用于裁剪）。
4. **「一列可读记录 + 每条的编辑/重放/分岔状态机」的整体页面结构**（回顾页）。没有库把「记录流（非对话）+ 每条的多动词操作 + 重听 + 就地改写 + 分岔」当作一个可复用的产品形态；连最接近的两个尝试（`@sandbox-agent/react` 的 `AgentTranscript`、`Conversed` 的内容块 + action 协议）都还在 0.0.x/0.4.x，且生态近乎为零。
5. **「自建 WebSocket 协议 + 自定义事件 → UI」的胶水**。库们给的是「适配器接口」（assistant-ui `ExternalStoreRuntime`、AI SDK `ChatTransport`、TanStack AI `SubscribeConnectionAdapter`、antd X `AbstractXRequestClass`、AG-UI `AbstractAgent`），**把 WS 事件翻成这些接口的代码，每个项目都得写一遍**。

### 5.3 针对本项目的三条可选路线（供决策，不含倾向）

- **路线 A（呈现层自持、最省心）**：`@assistant-ui/react` primitives + 自写 CSS；runtime 用 `ExternalStoreRuntime` 包你的 WS 事件；多会话用它的 `RemoteThreadListAdapter` 契约接到你服务端。→ 唯一覆盖「工坊页六项 + 会话管理」的单一方案，但所有视觉自己写。
- **路线 B（数据模型 + 容器取标准件，其余自写）**：采用 AI SDK 的 `UIMessage.parts` 形状（不一定用它的 hook）+ `@shadcn/react/message-scroller` 管滚动 + 抄 AI Elements 的 `tool`/`confirmation`/`commit`/`checkpoint` 源码用作参考（若不愿引入 Tailwind 就重写其样式）+ streamdown 管 markdown。→ 最贴合「自由主题 + 自建协议」，但要自己拼装并维护胶水。
- **路线 C（设计系统换血，组件最贴需求）**：`@ant-design/x` 2.9（Bubble.List / Divider / FileCard / Actions.Audio / Conversations / Sender），传输用 `AbstractXRequestClass` 包 WS。→ 组件与两个页面的需求匹配度最高，代价是引入 antd 6 与它的主题体系（你的自有视觉需要映射到 antd token）。

---

## 6. 「整站型」方案能不能被嵌入：逐条一句话

| 方案 | 许可（2026-10-04） | 能否嵌入 | 一句话 |
| --- | --- | --- | --- |
| **Open WebUI** | Open WebUI License（BSD-3 式 + **第 4 条品牌条款**：禁止改动/移除 "Open WebUI" 品牌，除非滚动 30 天内终端用户 ≤ 50 人或另有书面/企业许可）；**非 OSI 开源** | ❌ | SvelteKit 整站应用，**没有对外发布的组件库**；且改品牌要授权。 |
| **LobeHub（原 LobeChat）** | **LobeHub Community License**（Apache-2.0 + 附加条件：不修改源码可商用；**开发并分发衍生作品需向作者取得商业许可**） | ❌（但衍生包可用） | 自身是 Next.js 整站；不过它**发布了 `@lobehub/ui`（MIT，5.55.0，peer antd 6 + React 19）**，这是唯一可直接复用的部分。 |
| **LibreChat** | **MIT** | ❌（但衍生包可用） | 自身是整站 React+Node 应用；**发布了 `@librechat/client` 0.4.82（组件）与 `librechat-data-provider`（ISC）**，但要求共建 Tailwind preset + jotai + i18next，实质是把它的前端搬进来。 |
| **Chainlit** | **Apache-2.0**（仓库 Apache-2.0） | ⚠️ 部分 | 后端是 Python；前端有两条可嵌入路径：**① `mountChainlitWidget()`（官方 Copilot 悬浮/侧栏 widget，走 iframe + 事件桥 `chainlit-call-fn`）**；**② `@chainlit/react-client` 0.5.0（Apache-2.0，2026-08-25）= 直连 Chainlit WebSocket 的 headless hooks，但强制 Recoil（已停止维护的库）**，且其 `@chainlit/components` 停留在 2023-11。 |
| **Streamlit / Gradio** | Apache-2.0 | ❌ | Python 运行时 + 自有前端，只能 iframe 嵌入，拿不到组件。 |
| **LangChain Agent Chat UI** | **MIT**（3,197 stars，push 2026-09-28） | ❌ | Next.js 独立应用，靠 LangGraph SDK 的 `useStream`，**不以库形式发布**；可当参考实现读源码。 |
| **Vercel Chatbot 模板**（`vercel/chatbot`，原 `vercel/ai-chatbot`） | **Apache-2.0**（20,711 stars） | ❌ | Next.js 模板，非组件库；依赖 Vercel AI Gateway/托管。**但 `shadcn-ui/chatbot-template`（MIT，1,114 stars，2026-08-11 新建）是更好的参考**：它把 assistant message 拆成类型化 part，`components/chat-message.tsx` 按 `part.type` 分发到 `components/parts/*`（`text` / `tool-web_search`（"Searching the web…" 状态 + 完成后的持久行）/ `tool-ask_user` / `source-url`），并用 `InferUITools` 做端到端类型推导——**这正是你工坊页想要的模式**。 |
| **assistant-ui / CopilotKit / Tambo 的官方示例与模板** | 各库许可 | ✅ | 这些是「例子」而非「整站」，可抄结构。 |

---

## 7. 关键事实清单（含时效标注）

**2026 年最近的变化（≤ 6 个月）**
- **AI SDK 7**（2026-06-25）：Node 22+、仅 ESM；`ai` 7.0.127（2026-10-01）。
- **shadcn 官方 chat 组件**（2026-06）：MessageScroller/Message/Bubble/Attachment/Marker + `@shadcn/react` 0.3.1（2026-08-31，headless message-scroller，peer react ≥19）；官方声明「不替代 AI Elements」。
- **TanStack AI 的 AG-UI 0.0.52 双向合规 + `webSocket()` 适配器**（2026 年内的 0.x 演进）。
- **CopilotKit v2**（v1 弃用）：UI 迁到 `@copilotkit/react-core/v2`，CSS 前缀 `cpk`；IME 修复（PR #3322）；rich threads 的改名/删除/归档仍是 **Intelligence only**。
- **AG-UI 1.0**：`@ag-ui/client` 1.0.1（2026-09-29）；`ActivityMessage` / `ACTIVITY_SNAPSHOT|DELTA` 已成正式事件。
- **OpenAI ChatKit**：2025-10-04 发布，chatkit-js 最后 push 2026-07-31。
- **Loquix**：2026-03 首发，0.6.0（2026-09-23）。
- **shadcn-chatbot-kit 停留在旧 AI SDK API**（`ai/react`），最后 push 2026-02-26。

**较老但仍在维护**
- assistant-ui（当日 push，0.15.23）、Ant Design X（2.9.0，2026-07-28）、deep-chat（2.5.1，2026-08-27）、Kibo UI（2026-05-04）、prompt-kit（2026-09-28）、react-chatbotify（2.5.0，2025-11-18）。

**已停滞 / 慎用**
- nlux（npm 2024-08 最后发版，MPL-2.0）、chatscope（2025-05 最后发版，仅补 peer）、react-chat-elements（2025-03，React 19 未声明）、`@chainlit/components`（2023-11）。

**商业条款原文要点**
- assistant-ui：库 MIT 免费；assistant-cloud 免费 200 MAU / Pro $50 月含 500 MAU + $0.10/MAU / Enterprise 定制。
- CopilotKit：核心 MIT；Premium 订阅；Developer 免费（1 seat/50 MAU）、Team $1,000/seat/月、Enterprise $5K/月起；自托管 Intelligence 需要 license key + Helm chart。
- Open WebUI：品牌条款第 4 条（≤50 终端用户例外）。
- LobeHub：修改源码后分发衍生作品需商业许可。
- Tambo：SDK 与后端 MIT（部分 workspace Apache-2.0），后端自托管免费。
- 其余本报告涉及的 UI 库（assistant-ui primitives、AI Elements、shadcn chat 组件、antd X、AG-UI、TanStack AI、Hashbrown、deep-chat、Loquix、Kibo、prompt-kit、react-chatbotify、chatscope、Lobe UI、Vercel/shadcn 模板）：**MIT 或 Apache-2.0，无额外商用限制**。

**不确定/需复核项（明确标注）**
1. **antd X 仓库根目录没有 LICENSE 文件**，MIT 仅在包级 LICENSE 与 npm 字段中体现（GitHub API 报 `license: None`）。
2. **AI Elements 官方要求 Next.js**（setup 页写 "Next.js 14+ (App Router recommended)"），但从 registry 源码看组件本身无 Next 专有依赖——**在 Vite 中可用属于我的推断，官方未背书**。
3. **deep-chat 的 IME 行为未能从源码/文档确认**，标为未验证。
4. **CopilotKit 各档价格**来自一份官方 PDF（可能已更新），且代码里 `publicApiKey` 的免费申领提示与文档中的「Premium 订阅」措辞存在张力（免费 key 用于本地/有限额度）。
5. **AI Elements npm 版本 1.9.0 的时间戳**（2026-03-12 发布 / 2026-05-18 元数据更新）与仓库 2026-09-01 的 push 之间的差异未查明（可能 registry 组件已更新但 npm CLI 版本未重发）。
6. **Tambo 自托管文档引用的 `tambo-core` 仓库已 404**，需以 `tambo-ai/tambo` 主仓为准。

---

## 8. 链接总表（可直接打开）

**A. 无样式原语 + Runtime**
- assistant-ui：<https://www.assistant-ui.com/> ・ <https://www.assistant-ui.com/docs> ・ <https://github.com/assistant-ui/assistant-ui> ・ <https://www.assistant-ui.com/pricing> ・ <https://www.assistant-ui.com/docs/primitives.md> ・ <https://www.assistant-ui.com/docs/runtimes/custom/external-store> ・ <https://www.assistant-ui.com/docs/runtimes/custom/assistant-transport> ・ <https://www.assistant-ui.com/docs/api-reference/adapters/persistence> ・ <https://www.assistant-ui.com/docs/primitives/action-bar> ・ <https://www.assistant-ui.com/docs/guides/tool-ui> ・ <https://www.assistant-ui.com/docs/base-ui> ・ <https://github.com/assistant-ui/skills/blob/main/assistant-ui/skills/setup/references/tanstack.md> ・ <https://github.com/assistant-ui/assistant-ui/pull/4513>（IME 修复）
- TanStack AI：<https://tanstack.com/ai/latest/docs/ui/react> ・ <https://tanstack.com/ai/latest/docs/chat/connection-adapters> ・ <https://tanstack.com/ai/latest/docs/chat/streaming> ・ <https://tanstack.com/ai/latest/docs/migration/ag-ui-compliance> ・ <https://github.com/TanStack/ai>

**B. shadcn 生态**
- shadcn chat 组件：<https://ui.shadcn.com/docs/changelog/2026-06-chat-components> ・ <https://ui.shadcn.com/docs/react/message-scroller> ・ <https://ui.shadcn.com/docs/components/aria/message> ・ <https://ui.shadcn.com/docs/components> ・ <https://github.com/shadcn-ui/ui/blob/main/packages/react/src/message-scroller/README.md> ・ <https://ui.shadcn.com/docs/installation/vite>
- AI Elements：<https://elements.ai-sdk.dev/docs> ・ <https://ai-sdk.dev/v6/docs/ai-sdk-ui/transport> ・ <https://ai-sdk.dev/docs/ai-sdk-ui/streaming-data> ・ <https://ai-sdk.dev/docs/reference/ai-sdk-ui/pruneMessages> ・ <https://github.com/vercel/ai-elements> ・ <https://elements.ai-sdk.dev/api/registry/registry.json> ・ <https://github.com/vercel/ai-elements/issues/21> ・ <https://github.com/vercel/ai-elements/issues/400>
- streamdown：<https://github.com/vercel/streamdown> ・ <https://streamdown.ai/docs>
- prompt-kit：<https://www.prompt-kit.com/docs/prompt-input> ・ <https://github.com/ibelick/prompt-kit>
- Kibo UI：<https://www.kibo-ui.com/> ・ <https://github.com/shadcnblocks/kibo>
- shadcn-chatbot-kit：<https://shadcn-chatbot-kit.vercel.app/docs/components/chat> ・ <https://github.com/Blazity/shadcn-chatbot-kit>
- shadcn chatbot template：<https://github.com/shadcn-ui/chatbot-template>

**C. 设计系统绑定**
- Ant Design X：<https://x.ant.design/docs/react/introduce/> ・ <https://x.ant.design/components/overview/> ・ <https://x.ant.design/components/bubble/> ・ <https://x.ant.design/components/actions/> ・ <https://x.ant.design/x-sdks/x-request/> ・ <https://github.com/ant-design/x> ・ <https://github.com/ant-design/x/pull/432>（React 19）
- Lobe UI：<https://www.npmjs.com/package/@lobehub/ui>

**D. 协议 / 框架**
- AG-UI：<https://github.com/ag-ui-protocol/ag-ui> ・ <https://docs.ag-ui.com/introduction> ・ <https://docs.ag-ui.com/concepts/events> ・ <https://docs.ag-ui.com/concepts/architecture> ・ <https://github.com/ag-ui-protocol/ag-ui/blob/main/docs/concepts/messages.mdx> ・ <https://docs.ag-ui.com/sdk/js/client/abstract-agent> ・ <https://github.com/ag-ui-protocol/ag-ui/tree/main/integrations/vercel-ai-sdk/typescript>
- CopilotKit：<https://www.copilotkit.ai/> ・ <https://www.copilotkit.ai/docs/copilotkit-products.pdf> ・ <https://docs.copilotkit.ai/prebuilt-components/chat> ・ <https://docs.copilotkit.ai/migrate/v2> ・ <https://docs.copilotkit.ai/teams/agno/backend/runtime-endpoints> ・ <https://docs.copilotkit.ai/ag2/premium/self-hosting> ・ <https://github.com/CopilotKit/CopilotKit> ・ <https://github.com/CopilotKit/CopilotKit/pull/3322>（IME 修复）
- Hashbrown：<https://hashbrown.dev/> ・ <https://hashbrown.dev/docs/react/concept/components> ・ <https://github.com/liveloveapp/hashbrown> ・ <https://hashbrown.dev/blog/2025-12-16-hashbrown-v-0-4-0>
- Tambo：<https://docs.tambo.co/> ・ <https://docs.tambo.co/guides/self-hosting> ・ <https://docs.tambo.co/reference/cli/commands/init> ・ <https://github.com/tambo-ai/tambo>

**E. 组件即整块**
- deep-chat：<https://github.com/OvidijusParsiunas/deep-chat> ・ <https://deepchat.dev/docs/messages/HTML/> ・ <https://deepchat.dev/docs/styles/buttons#customButtons> ・ <https://github.com/OvidijusParsiunas/deep-chat/blob/main/llms.txt>
- nlux：<https://docs.nlkit.com/nlux/reference/ui/ai-chat> ・ <https://github.com/nlkitai/nlux>
- chatscope：<https://chatscope.io/docs/> ・ <https://chatscope.io/storybook/react/> ・ <https://github.com/chatscope/chat-ui-kit-react>
- react-chatbotify：<https://react-chatbotify.com/> ・ <https://github.com/react-chatbotify/react-chatbotify>
- Loquix：<https://loquix.dev/docs/> ・ <https://github.com/loquix-dev/loquix>
- OpenAI ChatKit：<https://github.com/openai/chatkit-js/> ・ <https://openai.github.io/chatkit-js/> ・ <https://developers.openai.com/api/docs/guides/chatkit>
- 其它：<https://www.npmjs.com/package/@sandbox-agent/react> ・ <https://github.com/mayeedwin/conversed> ・ <https://www.npmjs.com/package/react-chat-elements> ・ <https://www.npmjs.com/package/@openuidev/react-ui>

**F. 整站型**
- Open WebUI：<https://github.com/open-webui/open-webui/blob/main/LICENSE> ・ <https://github.com/open-webui/open-webui/blob/main/LICENSE_HISTORY>
- LobeHub：<https://github.com/lobehub/lobehub/blob/main/LICENSE>
- LibreChat：<https://github.com/LibreChat-AI/LibreChat> ・ <https://www.npmjs.com/package/@librechat/client>
- Chainlit：<https://docs.chainlit.io/deploy/copilot> ・ <https://docs.chainlit.io/deploy/react/overview> ・ <https://github.com/Chainlit/chainlit> ・ <https://github.com/Chainlit/cookbook/tree/main/custom-frontend>
- LangChain Agent Chat UI：<https://github.com/langchain-ai/agent-chat-ui> ・ <https://docs.langchain.com/oss/javascript/langgraph/ui>
- Vercel Chatbot：<https://github.com/vercel/ai-chatbot>
- AI SDK 7 发布：<https://vercel.com/changelog/ai-sdk-7> ・ <https://ai-sdk.dev/docs/migration-guides/migration-guide-7-0> ・ <https://github.com/vercel/ai/releases/tag/ai@7.0.0>
