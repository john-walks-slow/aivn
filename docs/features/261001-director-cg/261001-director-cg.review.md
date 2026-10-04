# 检视报告

## 概要

本次复检针对上轮阻塞与建议的处置情况。`orchestrator` 已将「按条数推断日志落盘」替换为「按事件 id 去重」（`loggedIds: Set<string>`），从根本上消除了根因；`anchorNodeId` 已升级为三态（`undefined` / string / `null`），前端在回看中锚点未入谱时不再静默退化；三处非阻塞/建议均经复核为当前一致设计的一部分。本次改动可准入。

## 需求对齐

- **需求达成度**：三项核心诉求全部满足，且无偏离计划。
  1. 提示词仅参考锚点时刻之前的剧情与场景（`recentScript(12, anchor)` + `stateAt(anchor).scene`）；
  2. 插图作为行级旁注挂在目标节点上（`recordCg` + `LineageNodeView.cgs`），世界线与叶子节点完全不动；
  3. 现场演出状态维持原逻辑（`anchor` 缺失走 `directorCg`）。
- **差异**：无新增偏离。

## 阻塞问题

无。

| ID | 位置 | 问题 | 建议 |
| --- | --- | --- | --- |
| — | — | — | — |

## 建议修改

| ID | 位置 | 问题 | 建议 |
| --- | --- | --- | --- |
| SUG-3 | `apps/web/src/views/StageScreen.tsx:583-585`<br>`packages/core/src/ws/protocol.ts:349-359` | **`anchorNodeId: null` 的语义完全靠 `!== undefined` 这一个边界来保护**<br>协议 `anchorNodeId?: string \| null` 现在区分「现场」「回看锚点」「回看但未入谱」三种语义，但传输层仅靠一处 `!== undefined` 做区分（`StageScreen:583` 与 `transport.ts:198` 的 opts 透传同理）。任何后续对 `null` 的「便利性合并」（如 `?? defaults`、对象解构默认值）会立刻把这一语义压平，与「明确拒绝，不静默换落点」的设计意图冲突。 | 建议在 `ws/protocol.ts` 的注释里把三态语义与「任何默认值替换都可能破坏语义」写成硬约束；并考虑封装一个 `encodeAnchorForWs(anchor)` 的纯函数（接收 `string \| null \| undefined`，输出协议层字段），把序列化集中到一处。 |

## 非阻塞问题

| ID | 位置 | 问题 | 建议 |
| --- | --- | --- | --- |
| NON-1 | `apps/server/src/orchestrator.ts:2089-2110` | **`loggedIds` 集合只增不减**<br>对于长会话而言，已经落盘的事件 id 会无限累积（每次 `flushLineageLog` 全量遍历 + set.has 检查），内存开销线性增长。该字段没有对应清理路径（`restored` 时会整批加入，但运行时不会移除）。 | 当 `loggedIds.size` 超过某个阈值（例如 `[...this.loggedIds]` 长度 > 上一次同步时全量事件数的 2 倍）时，主动修剪到「最近一次 flush 时的全量集合」。属于「长会话跑久了才显现」的性能备忘，不影响功能正确性。 |

## 准入结论

**结论**：`准入`

**说明**：上轮阻塞（BLK-1）已通过将游标机制替换为「事件 id 去重」根治，且有新增的「挂了旁注之后开新分支」用例钉住回归路径；SUG-1 已通过三态 `anchorNodeId` 显式拒绝未入谱场景，新用例覆盖 null / 已删除节点两条拒收路径；SUG-2 / NON-1 / NON-2 经复核为当前一致设计。本次变更可合并并进入交付环节。后续如出现 SUG-3 提及的序列化集中化，可在清理窗口一并处理。
