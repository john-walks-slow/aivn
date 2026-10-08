# 检视报告

## 概要

本次检视针对 commit `ec48b4f7` 对工坊（workshop）会话的四项缺陷修复：(1) 多会话并行时流式文本串台；(2) 生成结果小图显示在消息气泡下方而非工具卡内；(3) NSFW 模型默认语义的 UI 文案；(4) 工坊会话不读取 Agent 页新设置的模型。
整体设计思路清晰，纯函数提取规范（`attachMessageAssets`），并补齐了 core 层单测；但在「新会话」交互场景存在漏判 `activeId` 导致的串台阻断问题，且服务端在切换前台会话时存在将后台运行会话的错误与素材写偏的隐患。

## 需求对齐

- **需求 ①（多会话并行流式串台）**：`useWorkshop.ts` 对 `chunk`、`thinking`、`tool_*`、`asset`、`done`、`error` 均补充了 `threadId !== prev.activeId` 的过滤拦截。但由于 `clearState` 未清空 `activeId`，在「旧会话运行中点击新会话」时仍会完全穿透并发生串台（见 BLK-01）。
- **需求 ②（生成结果小图归位）**：`packages/core` 增加了 `attachMessageAssets` 纯函数，`WorkshopPane.tsx` 将消息级 `images` 归并入最后一个工具段，无工具段时保底保留在下方，满足预期。
- **需求 ③（NSFW 默认语义文案）**：`AgentPane.tsx` 与 `SettingsScreen.tsx` 补齐了三级降级链路「剧目覆盖 → 全局设置（nsfwModelId）→ 剧作家主模型」，文案与服务端 `playhouse.ts` 的解析顺序一致，满足预期。
- **需求 ④（工坊会话模型热更）**：服务端在 `WorkshopSession` 中将静态注入改为 `getModel` / `getAgents` 函数现取，每轮开跑前在 `freshTurnContext` 重新装配 `AgentKit`（更新思考档位与能力集），并在 `maybeCompact` 中实时带入新模型的 `contextWindow`，满足预期。

## 阻塞问题

| ID | 位置 | 问题 | 建议 |
| --- | ---- | ---- | ---- |
| BLK-01 | `apps/web/src/workshop/useWorkshop.ts:187-198`, `apps/web/src/workshop/WorkshopPane.tsx:204-213` | **点击「新会话」未重置 `activeId`，导致后台会话的流式文本直接串入新会话现场**：<br>当上一会话（Thread A）仍在流式生成时，用户点击「新会话」按钮，`WorkshopPane` 调用 `workshop.clearState()` 与 `workshop.newThread()`。但在 `clearState` 中仅清空了 `messages`、`live`、`pendingAssets` 等，**保留了 `prev.activeId`（仍为 Thread A）**。此时 Thread A 后续到达的 `workshop_chunk`、`workshop_thinking`、`workshop_tool_*`、`workshop_done` 等事件，因 `msg.threadId !== prev.activeId` 条件为假（均为 Thread A），将全部绕过拦截直接灌入刚清空的新会话视图，且收束后会将 Thread A 的回复直接追加进新会话界面。 | 在 `clearState()` 中将 `activeId` 显式重置为 `null`（`return { ...prev, activeId: null, messages: [], ... }`）；同时在 `useWorkshop` 的流式接收逻辑中增加校验：若 `freshThread` 为 `true`，一律不接收任何旧会话的流式增量。 |

## 建议修改

| ID | 位置 | 问题 | 建议 |
| --- | ---- | ---- | ---- |
| SUG-01 | `apps/server/src/workshopSession.ts:313, 404, 433` | **服务端切换会话时 `this.activeId` 漂移，后台运行会话的素材通知与异常将错误扣给前台会话**：<br>服务端 `this.activeId` 代表面板当前浏览的会话。若 Thread A 正在运行 `chat()`，用户在前端点击 Thread B，服务端收到 `workshop_activate` 并将 `this.activeId` 置为 Thread B。<br>1. 若 Thread A 产出素材或触发工具写盘，`broadcastAsset`（433 行）与 `broadcastWrite`（404 行）发出的 `threadId` 为 `this.activeId`（即 Thread B），导致前端 Thread B 错误接收了属于 Thread A 的素材；<br>2. 若 Thread A 在执行中抛错进入 `catch`（313 行），`const activeId = this.activeId ?? threadId ?? ""`，会把 Thread A 的中断信息与素材持久化追加至 Thread B（`this.threads.append(activeId, ...)`），造成跨会话历史污染。 | 在 `WorkshopSession` 中显式维护单轮对话的运行态线程 ID（例如 `private runningThreadId: string | null = null;`，在 `chat` 入口置为 `active.id`，并在 `finally` 中清空）。在 `broadcastAsset`、`broadcastWrite` 以及 `catch` 异常落盘中，优先使用 `this.runningThreadId ?? active.id`，绝不在轮次执行期间回退到可变的浏览态 `this.activeId`。 |
| SUG-02 | `apps/server/src/workshopSession.ts:140-162, 558-563`, `apps/server/src/playhouse.ts:1372-1376` | **每轮对话存在三次并发/连续重复读盘解析 `play.json` 的 I/O 坏味道**：<br>单轮对话开跑时：`freshTurnContext` 内部 `Promise.all([getModel(), getAgents()])` 同时触发两次 `store.loadPlay()`；紧接着在 `systemPrompt`（559 行）又触发第三次 `this.opts.store.loadPlay()`。这在短时间内对同一个文件连续执行了 3 次文件读取与 `parsePlayConfig` 校验。 | 建议在 `WorkshopSessionOptions` 中将 `getModel` 与 `getAgents` 合并为一个配置获取器（或直接传入 `getFreshPlayConfig`），单轮只读一次磁盘配置并在 `freshTurnContext` 和 `systemPrompt` 间复用，减少冗余文件 I/O。 |

## 非阻塞问题

| ID | 位置 | 问题 | 建议 |
| --- | ---- | ---- | ---- |
| ADV-01 | `packages/core/src/ws/workshopParts.ts:76` | **历史素材归位盲目匹配最后一个工具调用缺乏工具类型嗅探**：<br>`attachMessageAssets` 目前直接通过 `lastIndexOf("tool")` 将未带 `toolCallId` 的图片挂到最后一个工具段上。若单轮中先调用了 `generate_image`，后调用了 `read` 或 `bash`，图片会被错误挂在 `read` 或 `bash` 的卡片内部展开。 | 建议在查找挂载目标时优先向前寻找名称为生图类或素材导入类的工具（如 `generate_image`、`recut_sprite`、`import_asset`）；若无此类工具，再回退至 `lastIndexOf("tool")`。 |
| ADV-02 | `apps/web/src/views/SettingsScreen.tsx:200` | **全局设置页面的提示文案在自身语境下逻辑略显重复**：<br>`SettingsScreen` 作为全局设置页，字段 hint 说明为：“留空时：剧目自己的 nsfwModel → 本全局设置 → 剧作家主模型”。在用户正在配置“本全局设置”的语境下，表述“留空时回退到本全局设置”容易引起阅读困惑。 | 建议在全局设置页调整为更自然的说明：“全局默认限制级模型。当剧目未单独指定时生效；此处若也留空，则跟随对应剧目的主模型。” |
| ADV-03 | `apps/web/src/workshop/WorkshopPane.tsx:297-313` | **JSX 列表映射内直接嵌套复杂 IIFE 影响阅读流畅度**：<br>在 `state.messages.map` 中通过 `(() => { const merged = ...; return (...); })()` 内联计算段落合并，增加了组件的认知负荷。 | 建议将单条助手消息的段落合并与渲染剥离为局部受控组件（如 `<AssistantTurnView msg={msg} ... />`），保持 `WorkshopPane` 的 JSX 树扁平清晰。 |

## 准入结论

**结论**：`不准入`

**说明**：存在阻塞性缺陷 BLK-01，在用户后台正在生成时长、点击「新会话」准备发起新对话的常见场景下，旧会话的流式增量与收束消息会直接穿透并污染新会话界面，破坏了本次缺陷修复的核心目标；同时存在 SUG-01 的服务端跨会话历史污染隐患。须修复 BLK-01 并建议一并收敛 SUG-01 后重新检视。
