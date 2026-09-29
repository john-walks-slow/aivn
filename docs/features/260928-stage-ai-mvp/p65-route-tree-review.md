# 检视报告

## 概要

本轮检视针对 P6.5「路线树 + 导演操作」实现，涵盖核心契约（`packages/core/src/lineage/model.ts`）、编排与上下文重放（`apps/server/src/orchestrator.ts`、`rebuild.ts`）以及前端视图（`apps/web/src/stage/beats.ts`、`LineagePanel.tsx`、`StageScreen.tsx`）。整体架构思路清晰，纯函数聚合一拍一卡与 seq 锚点沿用能有效稳定路线树视图，但目前存在阻断核心交互与拓扑正确性的关键缺陷，需修复后准入。

## 需求对齐

基本符合已锁定的 P6.5 产品语义（砍掉书签与单句重写；保留跳转、分岔、重生成、编辑、导演注 5 个动词；一拍一张卡；seq 锚点跨分岔沿用）。但存在两处明显偏离与缺陷：
1. 废弃分支在路线树卡片上虽然被标记，但由于主按钮被禁用且操作条被彻底屏蔽，用户无法对其执行“分岔进入”，与设计规格书及卡片文案“先分岔才能进去”产生冲突。
2. 重生成（rewrite）操作后，由于切拍逻辑跳过了 rewrite 节点的拓扑继承，导致新重生的拍卡片丢失父拍信息，拓扑树断裂。

## 阻塞问题

| ID | 位置 | 问题 | 建议 |
| --- | ---- | ---- | ---- |
| BLK-01 | [LineagePanel.tsx:138-144, 153](apps/web/src/stage/LineagePanel.tsx#L138-L144) | **废弃分支交互逻辑死锁，无法“先分岔才能进去”**。<br>1. `BeatTile` 主按钮设置了 `disabled={busy \|\| !lineKey}`，废弃分支的行不在当前世界线缓冲（`lines`）中，因此 `lineKey` 为 `undefined`，导致卡片按钮原生禁用，无法被点击选中（`onSelect` 无法触发）。<br>2. 即使选中，第 153 行 `{active && !card.isAbandoned && <BeatActions ... />}` 明确禁止废弃分支渲染任何动作。<br>3. 卡片提示用户“已作废的分支，先分岔才能进去”，但分岔按钮位于 `BeatActions` 中，形成逻辑死锁，导致废弃分支彻底变成不可进入的死数据。 | 1. 主按钮禁用条件移除 `!lineKey`；当 `!lineKey`（废弃分支）时，点击仅触发 `onSelect()` 展开操作面板，不触发 `onRewind`。<br>2. 允许废弃分支渲染 `BeatActions`，但在其中仅显示“🌿 从这里岔出去”，隐藏跳转与重生成，用户点击后调用 `ops.fork(card.id)`，通过服务端 `rebaseAt` 重新激活该世界线。 |
| BLK-02 | [beats.ts:45-48, 51-54](apps/web/src/stage/beats.ts#L45-L48) | **`rewrite` 节点被忽略导致重生成出来的拍丢失父节点，路线树拓扑断裂**。<br>在 `buildBeats` 遍历中，遇到 `node.kind === "rewrite"` 时执行 `closed = true; continue;`，未在 `cardOfNode` 中记录映射，也未更新 `prevInChain`。<br>随后，新拍的第一个剧情事件 `E1` 到来（其 `parentId` 为 `rewrite` 节点 ID），判定 `atFork = true`，并计算 `parent = cardOfNode.get(node.parentId)`。由于 `cardOfNode` 中没有 `rewrite` 记录，`parent` 变成 `null`，导致新卡片的 `parentId` 为 `null`、`depth` 为 0，重生成出来的卡片从路线树中断裂为孤立根节点。 | 在扫描到 `node.kind === "rewrite"` 时，记录其映射关系（例如将 `node.id` 映射为其父节点所属的卡片 `cardOfNode.set(node.id, cardOfNode.get(node.parentId ?? "") ?? null)`），或者在卡片寻找父级时若命中 rewrite 节点则沿 `parentId` 继续向上追溯到其所属卡片。 |
| BLK-03 | [orchestrator.ts:1185-1191](apps/server/src/orchestrator.ts#L1185-L1191)<br>[rebuild.ts:106-115](apps/server/src/rebuild.ts#L106-L115)<br>[beats.ts:109](apps/web/src/stage/beats.ts#L109)<br>[LineagePanel.tsx:420-422](apps/web/src/stage/LineagePanel.tsx#L420-L422) | **`stop` 事件载荷结构在写入、还原与卡片解析时命名严重错位，导致停止点降级**。<br>1. 编排器写入谱系时，将停止点类型放入 `payload.attrs.type`，并丢失了 `placeholder`：`payload: { seq, attrs: { type: event.stopType }, ... }`。<br>2. 服务端重放与对话历史还原时，`rebuild.ts` 的 `stopFromEvent` 却从 `payload.stopType` 读取，导致所有历史 stop 全部退回为 `"pause"`！这使得选择题（choice）和自由输入（free）在重放与 LLM 历史中均失效丢失。<br>3. 前端 `beats.ts` 读取 `node.attrs.stopType`，`LineagePanel.tsx` 的 `stopLabel` 也读取 `attrs.stopType`，导致卡片与剧本行将全部停止点误标为 `"continue"` / `"◇ 等待继续"`。 | 统一契约字段命名：<br>1. 编排器写入 `stop` 时，在 `payload` 顶层写入 `stopType: event.stopType`、`options` 及 `placeholder`，并在 `attrs` 中规范镜像；<br>2. `rebuild.ts`、`beats.ts` 及 `LineagePanel.tsx` 做容错兼容读取（`payload.stopType ?? payload.attrs?.stopType ?? payload.attrs?.type ?? "pause"`）。 |

## 建议修改

| ID | 位置 | 问题 | 建议 |
| --- | ---- | ---- | ---- |
| SUG-01 | [rebuild.ts:43-47, 69-74](apps/server/src/rebuild.ts#L43-L47)<br>[parser.ts:313](packages/core/src/dsl/parser.ts#L313) | **空台词场景下 `lineageToEvents` 产生 seq 挤压与漂移风险**。<br>代码假设“一行台词现场至少占 3 个 seq”。但若模型输出空台词（`<say id="mio"></say>`），解析器仅产出 `say_start` 与 `say_end`，现场仅消耗 2 个 seq。重放时 `lineageToEvents` 固定推送 3 个事件，导致 `seq` 被推进 3 位。紧随其后的下一事件（现场 seq 为 base=N+2）在重放时会因 `base > seq` 不成立而被动触发 `seq + 1`，导致事件 seq 偏离原谱系记录。 | 当台词文本为空时，重放逻辑应跳过 `say_text`，仅下发 `say_start` 与 `say_end`；或在现场分配 seq 时确保即使空台词也预留至少 3 个 seq。 |
| SUG-02 | [beats.ts:82-86](apps/web/src/stage/beats.ts#L82-L86) | **`firstLineOf` 在无台词拍中可能越界匹配到后续拍的台词行**。<br>查找条件为 `lines.find((l) => l.seq !== undefined && l.seq >= from)`。若某一拍内仅包含场景或音效切换，无台词行，该卡片会错误匹配到下一拍中 `seq >= from` 的台词行，导致该卡片的文本预览与跳转回看目标指向了下一拍的内容。 | 为卡片查找设置 seq 上界约束（截至下一张卡片的 `startSeq` 或本拍 `beat_end` 的 seq）：`l.seq >= from && (!nextCardStartSeq || l.seq < nextCardStartSeq)`。 |
| SUG-03 | [LineagePanel.tsx:405](apps/web/src/stage/LineagePanel.tsx#L405)<br>[model.ts:307](packages/core/src/lineage/model.ts#L307) | **`describeRow` 中的 `rewrite` 节点无法展示导演指示（instruction）**。<br>`describeRow` 尝试通过 `node.attrs.instruction` 展示重写指示，但 `recordRewrite` 将 instruction 存放在 `event.payload.instruction`，且 `LineageTree.describe()` 未将其映射到 `LineageNodeView` 顶层或 `attrs`，导致剧本视图中的重写标注永远无法展示用户填写的意图。 | 在 `LineageNodeView` 中扩充 `instruction?: string` 字段，并在 `describe()` 中正确映射 `instruction: event.payload?.instruction`。 |

## 非阻塞问题

| ID | 位置 | 问题 | 建议 |
| --- | ---- | ---- | ---- |
| NBL-01 | [useStageSocket.ts:168-189](apps/web/src/stage/useStageSocket.ts#L168-L189) | **`rebase` 消息处理未显式同步 `state` 与 `settled` 状态**。<br>虽然结构操作前服务端处于 idle，客户端处于 stopped，但在接收到 `rebase` 重放缓冲后，显式声明 `setState("stopped")` 与 `setSettled(true)` 更加稳健自洽。 | 在 `case "rebase"` 中显式设置 `setState("stopped")` 与 `setSettled(true)`，防御非标准时序下的状态卡顿。 |
| NBL-02 | [LineagePanel.tsx:33](apps/web/src/stage/LineagePanel.tsx#L33) | **代码注释中残留已下线功能的表述**。<br>部分注释（如“跳转 / 分岔 / 编辑 / 重写 / 分岔后 OOC / 书签”）仍残留已砍掉的“书签”字样。 | 清理代码中残留的书签相关注释，保持与当前产品语义完全一致。 |

## 准入结论

**结论**：`不准入`

**说明**：本次实现整体结构清晰，纯函数切拍与 seq 锚点跨分岔沿用的机制设计良好；但存在 3 个阻塞性问题（废弃分支交互闭环死锁无法分岔、重生成卡片断裂为孤立树、`stop` 字段错位导致重放停止点类型降级为 pause），需修复后重新检视。
