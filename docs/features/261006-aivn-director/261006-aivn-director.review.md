# 检视报告

## 概要

检视范围涵盖 AIVN 导演工具栏（提示/改写/重写）、进行中浮层（pending panel）、基于会话面的舞台重建（重投影支持 rewind/分支）以及配套 E2E 验证代码。改动横跨 `dsh-aivn` 与 `stage-ai`（`@aivn/stage` 抽包分支）。
整体实现设计巧妙，深度契合 DSH 的会话与 Agent 架构原语（巧妙利用 `surfaceOp.replace`、`isTimeTravel` 过滤与 `session.deriveEventMessage`），很好地解决了跨会话分支与回退导致的舞台脱节问题，代码结构清晰、职责分离得当。

## 需求对齐

检视代码与用户需求及计划设计完全对齐：
1. **导演工具栏（全量支持）**：提示支持引导（排入下一轮队列）与打断（cancel + whenIdle + 清 steering + followup）；重写支持整拍重来与最后一步改写（带指令重写），均正常生效。
2. **分支与回退架构一致性**：未引入 AIVN 自管谱系分支，通过 `StageLog.rebuildStage` 机制让舞台纯粹作为会话 surface 的重投影流，完美与 DSH 原生 rewind 和 session fork 对齐。
3. **Pending panel**：支持了提示队列（排队中/已送出）与正在合成的语音行，出图与配乐等同步作业明确不列出并记录于文档，符合预期。
4. **与计划/实施纪要一致性**：实际实现收敛为 `guide`/`interrupt`/`rewrite` 三个底层动作，设计合理，差异理由在实施纪要中记录清晰完整。

## 阻塞问题

无。

## 建议修改

| ID  | 位置 | 问题 | 建议 |
| --- | ---- | ---- | ---- |
| S1  | `dsh-aivn/src/director.ts:67-76` | `Director.install()` 中监听 `session/event` 过滤为 `event.type !== 'user/message'`，但当 `event.data.id` 匹配到 pending 的 guide 项更新为 `sent` 并推送时，未核验当前 session 是否是 `PLAYWRITER_PRESET` 或该 session 的合法范围（虽然 `queues` 按 `sessionId` 隔离，但仍可能受跨 session 偶发事件干扰）。 | 建议在 `install` 监听回调中增加类似 `sessionPreset(ctx, sessionId) === PLAYWRITER_PRESET` 的前置检查，保持全局事件守卫的一致性。 |
| S2  | `dsh-aivn/src/director.ts:183-199` | `anchorOf` 在反向遍历 `session.surface.nodes` 寻找重写起点时，遇到任意 `user/message` 即返回已记录的 `first`。若当前拍中模型调用了工具（产生的 assistant 消息随后紧跟 tool_result），其逻辑没有问题；但若连续两轮之间存在特殊 system/developer 节点或合成事件，`event.type === 'user/message'` 能正确截断拍。然而若 `from === 'line'` 且最近的 assistant 消息正好处在 `nodes` 末尾往前扫描的第一条，会立刻返回该 seq。如果在某种异常情况下该拍尚无任何 assistant 消息（例如刚发送了 user 消息，agent 还没吐字就被快速连续触发了 rewrite），`anchorOf` 返回 `undefined` 抛出 `DirectorError`，这是正确的；但建议在错误提示中对 `from === 'line'` 与 `from === 'beat'` 的无锚点场景做更统一的日志提示。 | 建议在 `anchorOf` 顶部或返回处添加对 `nodes.length === 0` 或首节点异常的防御性说明，并在单元测试或集成测试覆盖此极值边界。 |
| S3  | `dsh-aivn/src/client/pending-panel.tsx:34-41` | 当 `items.length` 发生变化时，如果用户展开了 pending 列表，列表项内容会实时增减；但当最后一条 pending item 离开（变成 0）时，组件直接 `return null`，这会导致展开状态瞬间卸载，若之后又有 item 进来会恢复成折叠态。虽然符合「有东西时才出现」的逻辑，但在快速合成切换中体验偶有跳变。 | 体验良好，但可考虑当 items 为空时保留极短淡出动画或确保状态重置逻辑清晰无副作用。 |

## 非阻塞问题

| ID  | 位置 | 问题 | 建议 |
| --- | ---- | ---- | ---- |
| N1  | `dsh-aivn/README.md:612` | README 中对旧 E2E 的用例描述写着「断言导演工作栏不渲染」，但在新的 E2E 实现中已更新为断言「导演工作栏已渲染且包含三格」。README 中文档描述有一处未同步更新。 | 建议在后续文档梳理时，将 `README.md` 第 612 行的套件说明由「导演工作栏不渲染」更新为「导演工作栏已渲染（提示/改写/重写）」。 |
| N2  | `dsh-aivn/src/stage-log.ts:98` | `rebuildStage` 中循环 `session.surface.nodes` 时构建了新的 `StageDslParser`，对于超长会话（数万字演出），同步一次性 `feed` 并重建可能会占用数十毫秒的 CPU 密集解析。 | 当前会话规模完全在可控范围内，如未来存在百轮以上长剧目重投影需求，可考虑分片微任务或流式批量 yield。 |

## 准入结论

**结论**：`准入`

**说明**：全部核心需求与约束均高质量达成。架构设计上以会话 surface 作为单一真相源使得 rewind、分支与重写天然统一，代码整洁无坏味道，测试与文档同步完备，准予合并交付。
