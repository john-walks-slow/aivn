# 检视报告

## 概要

本次检视覆盖 Stage-AI MVP 的 **P4c 工坊模块**，包括协议扩展（`protocol.ts`）、剧目文件白名单层（`playFiles.ts`）、工坊 Agent 执行与工具集（`workshop.ts`）、meta-chat 多会话持久化（`workshopThreads.ts`）、工坊 Runtime 与生命周期编排（`workshopSession.ts`、`playhouse.ts`、`transport.ts`、`http.ts`）以及 Web 前端抽屉/全屏工坊交互界面（`useWorkshop.ts`、`useWorkshopSocket.ts`、`WorkshopPanel.tsx`、`FileBrowser.tsx`、`WorkshopScreen.tsx` 等）。
整体架构设计清晰，工坊与演出 Agent 严格双实例解耦，白名单文件安全边界扎实，节拍边界等待机制（`whenIdle`）有力保障了演出连续性。但代码在文件删除保护、状态机并发控制（busy 提前释放）等方面存在 2 处阻塞问题，须修复后准入。

## 需求对齐

变更完整满足了计划中 §3.4、D9、D13 对 P4c 工坊的各项核心要求：
1. **工坊 Agent 独立性**：工坊 Agent 与 playwriter 彻底解耦为两个独立 pi Agent 实例，系统提示词聚焦"搭台不唱戏"，提供 5 个剧目文件与就绪检查工具。
2. **meta-chat 多会话**：支持一个剧目多个工坊线程，数据落盘于 `plays/<id>/workshop/`，支持新建、切换、归档与删除，且通过 `.gitignore` 排除在版本库外。
3. **文件浏览与编辑**：通过 `PlayFiles` 白名单安全层暴露 `play.json`、`memory/**` 可写面及 `assets/**` 只读面，`session.json`、`lineage.jsonl` 等严格不可见。
4. **双形态切换与直达**：舞台常驻「🛠 工坊」抽屉入口，支持抽屉 ↔ 全屏切换；Title Screen 具备「工坊」按钮，带 `?workshop=1` 独立直达全屏页且跳过演出 autostart。

### 针对已知设计取舍的专项评估

1. **写盘不做阻塞式确认，改为推写事件 + 内联一键撤销**：
   - **评估**：**合理**。工坊作为连续对话创作环境，阻塞式确认会极大打断多工具链调用与流式体验。通过 `workshop_write` 下发带 `before` 的快照让用户可随时一键回退，兼顾了灵活性与安全性。
   - **实现偏差**：当前底层通过 REST `api.saveFile` 撤销新建或修改时，服务端无差别调用 `broadcastWrite`，导致撤销操作反向产生一条新的"写盘记录"（形成套娃）；且 REST `DELETE` 绕过了 `WorkshopSession`，未触发 runtime 重载。
2. **每轮对话重建 Agent（systemPrompt 动态注入文件与就绪状态，纯文本回灌历史）**：
   - **评估**：**合理**。工坊以文件系统作为单一真相源（File System as State），工具调用中间历史的序列化收益低。动态注入文件清单与就绪门状态，让短对话保持轻量且状态最新，模型需要时直接 `read_file` 查阅。
3. **工坊写盘后延到节拍边界重建 runtime（`orchestrator.whenIdle()`）**：
   - **评估**：**合理**。保证了演出进行中热改设定不会腰斩正在进行的当前节拍。
   - **实现偏差**：`finishBeat` 中的 `persist()` 异步未等待完成，与拍收束后的 `whenIdle` 唤醒存在微小 I/O 读写竞态；且写盘重建广播漏发了 `stoppedReplay`。
4. **工坊单独连接带 `?workshop=1` 时跳过 autostart**：
   - **评估**：**完全合理且实现精准**。
5. **工坊拿不到会话日志**：
   - **评估**：**完全合理且实现扎实**。路径白名单与遍历下钻均被严格限制。

---

## 阻塞问题

| ID | 位置 | 问题 | 建议 |
| --- | ---- | ---- | ---- |
| B1 | `apps/server/src/http.ts:173-177`<br>`apps/server/src/playFiles.ts:125-127` | **REST DELETE 接口绕过 WorkshopSession 且缺乏保护，可误删 play.json 且删除文件不触发 runtime 重载**：<br>1. `DELETE /api/plays/:id/files?path=...` 直接调用 `runtime.workshop.files.remove(path)`，未经过 `WorkshopSession`，导致文件被删除后不会触发 `onFilesChanged()`（即不触发 runtime 重建）。当用户在撤销新建文件或外部调用删除记忆卡时，演出 runtime 的 `PlayMemory` 无法刷新。<br>2. `PlayFiles.remove` 没有限制 `play.json`（虽然 agent 工具 `delete_file` 有防，但底层和 REST 没防），客户端调用 `DELETE ?path=play.json` 可以直接删掉 `play.json`，导致整个剧目损坏。 | 1. 在 `PlayFiles.remove` 中硬编码拦截 `play.json`（仅允许删除 `memory/**` 下的文件）。<br>2. 在 `WorkshopSession` 中暴露 `removeFile(path)` 方法（内部调用 `files.remove` 并触发 `onFilesChanged` 和广播），让 `http.ts` 的 `DELETE` 统一调用该方法。 |
| B2 | `apps/web/src/workshop/useWorkshop.ts:60` | **工坊对话发送后被 `workshop_history` 提前解除 busy 态，引发中文/首字时延期间的并发重发与错误提示**：<br>用户在输入框发送消息后，`useWorkshop` 将 `busy` 设为 `true`。服务端收到 `workshop_chat` 后追加用户消息并执行 `snapshot()` 广播 `workshop_history`。前端收到 `workshop_history` 时执行了 `busy: false`。<br>而此时服务端才刚刚开始调用 `runWorkshopTurn`（首字生成通常需要 1~3 秒）。在此期间，前端发送按钮变亮且思考指示消失，若用户再次点击发送或按回车，客户端允许再次发送，服务端检测到 `running=true` 立即判定冲突并下发 `workshop_error`（"工坊正在回复，稍后再发"），导致前端弹出红色错误横幅并打断流程。 | 在 `useWorkshop.ts` 的 `workshop_history` 分支中，不应强制将 `busy` 置为 `false`（应保持 `prev.busy`）。只有收到明确的 `workshop_done` 或 `workshop_error` 时才将 `busy` 置为 `false`。 |

---

## 建议修改

| ID | 位置 | 问题 | 建议 |
| --- | ---- | ---- | ---- |
| S1 | `apps/web/src/workshop/WorkshopPanel.tsx:171-176` | **输入框未处理中文输入法（IME）Composing 状态，拼音确认时敲 Enter 误触提交**：<br>`textarea` 的 `onKeyDown` 仅检查了 `e.key === "Enter" && !e.shiftKey`，未检查 `e.nativeEvent.isComposing`。在中文输入法输入拼音并敲 Enter 确认字母上屏时，会直接误触发消息提交，将残缺拼音发出。 | 在 `onKeyDown` 触发处增加 `if (e.nativeEvent.isComposing) return;` 保护。 |
| S2 | `apps/server/src/workshopSession.ts:145`<br>`apps/web/src/workshop/WorkshopPanel.tsx:191-207` | **REST 保存与撤销动作触发 `broadcastWrite` 导致撤销记录自增（套娃）**：<br>用户点击「撤销」调用 `api.saveFile`（或在 `FileBrowser` 手动保存）时，服务端 `writeFile` 会无条件调用 `broadcastWrite`。这导致撤销动作本身又被当作一条"新的写盘记录"推回前端 `writes` 列表，使得撤销面板不断生成新的撤销项。 | 区分 Agent 工具写盘与人工/REST 写盘：`broadcastWrite` 应仅在 Agent 的 `write_file`/`delete_file` 工具调用时触发，或者在 `writeFile` 时提供 `broadcast?: boolean` 开关，避免手动保存和撤销操作反向污染写盘记录队列。 |
| S3 | `apps/server/src/playhouse.ts:157` | **`reloadAfterWorkshopWrite` 漏发 `stoppedReplay`**：<br>`PlayHouse.reload` 在广播 `helloPayload` 后会检查并重发 `fresh.orchestrator.stoppedReplay`；而 `reloadAfterWorkshopWrite` 仅广播了 `helloPayload`。若工坊热改发生在停止点状态（等待玩家选择），重载后客户端未收到停止点状态同步。 | 对齐 `PlayHouse.reload`，在 `reloadAfterWorkshopWrite` 发送 `helloPayload` 之后追加 `stoppedReplay` 广播：`const replay = runtime.orchestrator.stoppedReplay; if (replay) for (const send of clients) send(replay);`。 |
| S4 | `apps/server/src/orchestrator.ts:565`<br>`apps/server/src/playhouse.ts:148-151` | **节拍收束时 `saveSession` 未等待落盘可能与 `reloadAfterWorkshopWrite` 产生异步 I/O 竞态**：<br>`finishBeat` 中调用的 `this.opts.persist()` 实际上是异步非阻塞的（`void store.saveSession(...)`），随后 `finally` 块中立即 `flushIdleWaiters()` 唤醒 `reloadAfterWorkshopWrite`。后者立即调用 `buildRuntime` -> `loadSession`。若磁盘写入微任务存在延迟，可能读到旧快照或写入中截断的 JSON（导致降级为空进度）。 | 建议让 `persist()` 返回 Promise，或在 `whenIdle()` 兑现前确保当前的会话落盘任务已落地。 |

---

## 非阻塞问题

| ID | 位置 | 问题 | 建议 |
| --- | ---- | ---- | ---- |
| N1 | `apps/web/src/app.css:1011` | **小屏移动端下工坊抽屉内的文件浏览器排版拥挤**：<br>抽屉在移动端占满屏幕宽度（~375px），但 `.workshop-file-tree` 宽度硬编码为 210px，导致右侧编辑器宽度仅剩不足 170px，按钮与路径极易被挤压遮挡。 | 后续在 P6/P6.5 打磨时，针对小屏媒体查询将文件树与编辑器改为上下折叠或标签切换。 |
| N2 | `apps/server/src/workshopThreads.ts:130-137` | **未使用的 `pruneOrphanThreads` 存在潜在的索引误判全删风险**：<br>`pruneOrphanThreads` 若在 `threads.json` 临时损坏/解析异常导致 `threads.list()` 返回空数组时执行，会将全部历史消息文件当作孤儿文件删除。目前无任何接口调用此函数。 | 后续若接入该功能，应确保在索引解析异常时直接抛错终止，而非视为无线程。 |
| N3 | `apps/web/src/workshop/FileBrowser.tsx` | **文件浏览器缺少文件删除交互**：<br>`FileBrowser` 仅支持新建和编辑，缺少删除条目按钮（底层 `deleteFile` 接口已具备）。 | 后续可在文件树节点悬浮操作区增加删除确认按钮。 |
| N4 | `apps/server/src/workshop.ts:238-239` | **工坊 Agent 执行缺乏超时与中断机制**：<br>`runWorkshopTurn` 未对 `agent.prompt` 与 `waitForIdle` 设置超时。若外部模型网关长时间挂起，会使工坊处于 `running=true` 状态无法解除。 | 后续可引入超时机制或允许前端发送 abort 信号。 |

---

## 准入结论

**结论**：`不准入`

**说明**：核心设计与职责边界清晰，但在文件删除安全性（B1：可误删 `play.json` 且删文件未触发 runtime 重载）以及前端状态机并发控制（B2：`workshop_history` 提前清除 `busy` 导致时延期间并发重发与报错）存在 2 处阻塞问题，须修复后重新检视。
