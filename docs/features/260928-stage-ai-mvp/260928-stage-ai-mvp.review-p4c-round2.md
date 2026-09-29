# 检视报告（第二轮）

## 概要

本轮检视针对 Stage-AI MVP **P4c 工坊模块**第一轮检视发现的问题（2 阻塞 + 4 建议 + 4 非阻塞）的修复情况及整体代码变更进行深度复核。
经核查，第一轮的 2 项阻塞问题（B1：DELETE 误删保护与 runtime 联动、B2：工坊 busy 态提前解除）及关键体验项（S1：IME 组合键防误触、S2：撤销记录套娃拆分、S3：重载状态恢复 stoppedReplay、N2/N3/N4）均已完整且严谨地落地，测试用例与安全边界扎实。
但在 S4（`persist` 异步未落地等待）的落地中，编排器虽已完善了 `pendingPersist` 等待机制，但装配入口 `playhouse.ts` 仍保留了 `void` 关键字导致 Promise 被丢弃，使落盘等待机制在生产中未真正生效。整体评估给予**条件准入**。

## 需求对齐

第一轮提出的所有问题复核结果如下：

1. **B1（REST DELETE 拦截与重载联动）**：**已完全解决**。
   - `PlayFiles.remove` 硬编码拦截 `play.json`，且仅允许删除白名单范围内的文件（`memory/**` 下的 `.md`/`.json`/`.txt`）。
   - 新增 `WorkshopSession.removeFile(path)` 方法，在磁盘文件删除后触发 `onFilesChanged` 通知宿主。
   - `http.ts` 中 `DELETE /api/plays/:id/files` 改调 `runtime.workshop.removeFile(path)`，确保任何入口删除文件均能触发 runtime 重建。
2. **B2（工坊 busy 提前解除引发并发与报错）**：**已完全解决**。
   - `useWorkshop.ts` 中的 `workshop_history` 分支不再修改 `busy` 状态，只有收到 `workshop_done` 或 `workshop_error` 时才将 `busy` 置为 `false`，彻底消除了网络时延/首字生成期间用户重复点击导致 `running=true` 报错的风险。
3. **S1（中文输入法 IME 组合态 Enter 误发）**：**已完全解决**。
   - `WorkshopPanel.tsx` 的 `onKeyDown` 增加了 `!e.nativeEvent.isComposing` 判定。
4. **S2（REST 保存/撤销自增写盘记录形成套娃）**：**已完全解决**。
   - 拆解了写盘语义：`broadcastWrite` 仅由 Agent 的 `write_file`/`delete_file` 工具触发；人工在 `FileBrowser` 编辑保存或点击撤销按钮时调用 `WorkshopSession.writeFile`/`removeFile`，只落盘并通知重载，不再广播 `workshop_write`。
5. **S3（`reloadAfterWorkshopWrite` 漏发 `stoppedReplay`）**：**已完全解决**。
   - `playhouse.ts` 的 `reloadAfterWorkshopWrite` 广播中追加了 `fresh.orchestrator.stoppedReplay`，与常规 `PlayHouse.reload` 完全对齐。
6. **S4（`persist` 异步未落地与重建后 `loadSession` 竞态）**：**部分解决，存在调用端遗留问题**。
   - 编排器内部已支持 `persist: () => void | Promise<void>` 并以 `pendingPersist` 记账，`whenIdle()` 与 `flushIdleWaiters()` 均挂载了等待。
   - **遗留**：`playhouse.ts:265-266` 在向编排器注入选项时写了 `persist: () => void store.saveSession(...)`，`void` 导致该闭包返回 `undefined`，运行时的 Promise 未被正确透传给编排器。
7. **N2（`pruneOrphanThreads` 风险清理）**：**已解决**。代码已直接移除。
8. **N3（文件浏览器缺少文件删除入口）**：**已解决**。`FileBrowser.tsx` 已增加带 `window.confirm` 二次确认的删除操作按钮，并排除不可删除的 `play.json`。
9. **N4（工坊单轮缺乏超时与中断机制）**：**已解决**。`runWorkshopTurn` 增加了 180s 超时定时器触发 `agent.abort()`，超时或错误均正确广播 `workshop_error` 并复位 `running=false`。

---

## 阻塞问题

无。

---

## 建议修改

| ID | 位置 | 问题 | 建议 |
| --- | ---- | ---- | ---- |
| S1 | `apps/server/src/playhouse.ts:265-266` | **`playhouse.ts` 传入编排器的 `persist` 闭包前缀了 `void`，导致异步落盘 Promise 被丢弃，使 `pendingPersist` / `whenIdle` 等待机制在生产中未生效**：<br>第一轮 S4 在编排器中增加了 `pendingPersist` 机制，要求等待会话落盘落地以防止重建 runtime 读到半写文件。但当前在 `playhouse.ts` 的构造参数中仍然写着：<br>`persist: () => void store.saveSession(...)`<br>`void` 运算符使函数返回值恒为 `undefined`。运行时 `orchestrator.ts` 执行 `this.pendingPersist = Promise.resolve(this.opts.persist())` 拿到的是 `Promise.resolve(undefined)` 并立即兑现，并没有真正 await 底层 `store.saveSession` 的写入 Promise。 | 将 `apps/server/src/playhouse.ts:265-266` 中的 `void` 移除，直接返回 `store.saveSession(...)` 的 Promise：<br>```ts<br>persist: () => store.saveSession(tree, engine, orchestrator.currentScene, orchestrator.runtimeState),<br>``` |

---

## 非阻塞问题

| ID | 位置 | 问题 | 建议 |
| --- | ---- | ---- | ---- |
| N1 | `apps/web/src/app.css:1011` | **小屏移动端下工坊抽屉内的文件浏览器排版依然拥挤（沿袭第一轮）**：<br>抽屉宽度在小屏下虽为 `100vw`，但 `.workshop-file-tree` 仍固定宽度 210px，编辑器剩余区域较小。 | 维持第一轮建议：后续在 P6/P6.5 体验与多端打磨时集中优化（如媒体查询下支持树/编辑器 Tab 切换）。 |

---

## 准入结论

**结论**：`条件准入`

**说明**：第一轮发现的 2 处阻塞问题（B1、B2）已彻底解决，安全边界与并发状态机均已稳固；建议项与非阻塞体验项除 S4 外均已高质量落实。S4 仅因调用方 `playhouse.ts:266` 多写了一个 `void` 关键字导致 Promise 未透传，强烈建议在合并前单行移除该 `void` 即可交付。
