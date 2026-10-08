# 检视报告

## 概要

本次检视针对 commit `c1210283` 对上一轮检视不准入问题及建议项的收敛整改：
1. `useWorkshop.clearState` 重置 `activeId` 为 `null`，修复旧会话流式穿透新会话的阻断性缺陷（BLK-01）；
2. `WorkshopSession` 引入执行期独立的 `runningThreadId`，消除前台会话切换导致的广播串台与异常污染（SUG-01）；
3. 服务端配置现取合并为 `getRunConfig` 并在当轮复用 `turnPlay`，消除了单轮多次重复读盘的 I/O 坏味道（SUG-02）；
4. `attachMessageAssets` 增加素材类工具优先嗅探（ADV-01）；
5. 全局设置页 NSFW 默认模型文案润色清晰（ADV-02）。

整改针对性强，核心阻断问题与设计隐患均已闭环，整体代码结构清晰。

## 需求对齐

- **BLK-01 收敛（新会话流式穿透）**：`apps/web/src/workshop/useWorkshop.ts` 在 `clearState()` 中显式将 `activeId` 置为 `null`。当用户在旧会话运行中点击「新会话」时，旧会话到达的 `chunk`/`thinking`/`tool_*`/`done` 事件因 `msg.threadId !== prev.activeId` 均被正确过滤拦截，不再穿透进新会话现场，满足预期。
- **SUG-01 收敛（运行态线程归位）**：`apps/server/src/workshopSession.ts` 引入 `runningThreadId` 私有字段，在 `chat()` 执行期绑定当前运行线程 ID。`broadcastWrite`、`broadcastAsset` 以及 `catch` 块的异常历史落盘统一优先使用 `runningThreadId`，彻底解耦了运行态与前台浏览态 `activeId`，满足预期。
- **SUG-02 收敛（配置单轮只读一次）**：`playhouse.ts` 将 `getModel`/`getAgents` 合并为 `getRunConfig`，单轮启动时一次性获取 `model`、`agents` 及 `play`；`WorkshopSession` 将 `play` 缓存在当轮上下文并于 `systemPrompt()` 中直接复用，避免了单轮 3 次重复读取与解析 `play.json`，满足预期。
- **ADV-01 收敛（素材类工具优先嗅探）**：`packages/core/src/ws/workshopParts.ts` 的 `attachMessageAssets` 中定义了 `prefers` 列表（`generate_image`、`recut_sprite`、`import_asset`），优先将历史未带调用号的素材挂载至素材类工具段，只有未找到时才回退至最后一个通用工具段，满足预期。
- **ADV-02 收敛（全局设置文案润色）**：`apps/web/src/views/SettingsScreen.tsx` 将 NSFW 专用模型的 hint 说明调整为「剧目未单独指定时生效；此处也留空则跟随该剧目的主模型」，语境贴切无歧义，满足预期。

## 阻塞问题

无

## 建议修改

| ID | 位置 | 问题 | 建议 |
| --- | ---- | ---- | ---- |
| SUG-01 | `apps/server/src/workshopSession.ts:339-346, 567` | **单轮缓存字段 `this.turnPlay` 未在 `finally` 中清理重置**：<br>`freshTurnContext()` 将读取到的 `PlayConfig` 缓存在私有字段 `this.turnPlay`，供后续 `systemPrompt()` 复用。但在 `chat()` 的 `finally` 收束块中，仅重置了 `runningThreadId = null`，未清理 `this.turnPlay`。虽然下一轮对话会将其覆盖，但在轮次结束后该对象将长期驻留内存；若未来在轮次外存在间接访问 `systemPrompt` 的逻辑，容易读取到过期的旧配置。 | 在 `WorkshopSession.chat()` 的 `finally` 块中补齐 `this.turnPlay = undefined;`，确保单轮生命周期内的临时缓存及时闭环销毁。 |
| SUG-02 | `apps/server/test/workshop.test.ts`, `packages/core/test/workshopParts.test.ts` | **收敛逻辑缺乏直接回归测试覆盖**：<br>1. `packages/core/test/workshopParts.test.ts` 仅断言了单个 `generate_image` 的挂载，未增加「先 `generate_image` 后 `read` 混合调用时，图片精准挂回生图工具」的测试用例；<br>2. `apps/server/test/workshop.test.ts` 未对「单轮生成过程中前台收到 `workshop_activate` 切换 `activeId` 时，后台素材通知与异常落盘依然归属于原 `runningThreadId`」进行显式用例验证；<br>3. 前端缺少对 `clearState` 重置 `activeId: null` 后阻断旧线程 chunk 的单测。 | 补充针对 `attachMessageAssets` 的 `prefers` 优先查找行为的混合工具单测；并在服务端单测中补充运行中切换激活会话不发生串台与写偏的回归测试用例。 |

## 非阻塞问题

| ID | 位置 | 问题 | 建议 |
| --- | ---- | ---- | ---- |
| ADV-01 | `apps/web/src/workshop/WorkshopPane.tsx:297-313` | **JSX 列表映射内直接嵌套复杂 IIFE 影响阅读流畅度（上一轮遗留）**：<br>在 `state.messages.map` 中通过 `(() => { const merged = ...; return (...); })()` 内联计算段落合并，增加了组件的认知负荷。 | 建议在后续迭代中将单条助手消息的段落合并与渲染剥离为局部受控组件（如 `<AssistantTurnView msg={msg} ... />`），保持主视图 JSX 结构扁平。 |
| ADV-02 | `apps/server/src/workshopSession.ts:371` | **bash 破坏 `play.json` 的检查告警在轮次收束后仍发给前台浏览态 `this.activeId`**：<br>在 `finally` 执行完 `runningThreadId = null` 之后，`applyChanges()` 校验 bash 破坏配置时，若发现解析失败，发出的 `workshop_error` 事件使用的 `threadId` 为 `this.activeId`。如果用户在 bash 执行期间切换了前台会话，该告警将被推送到切换后的前台会话中，且若 `msg.threadId !== prev.activeId` 还会被前端静默过滤。 | 可考虑将 `applyChanges()` 调整为显式接收受影响的 `threadId`（或在 `applyChanges` 执行完毕后再清空 `runningThreadId`），确保配置破坏告警准确落位。 |

## 准入结论

**结论**：`条件准入`

**说明**：阻塞性缺陷 BLK-01 及主要设计隐患 SUG-01、SUG-02 已全面收敛整改，多会话流式穿透与服务端写偏风险已排除；建议在后续迭代中完善临时状态清理（`this.turnPlay`）并补齐相关回归测试用例。
