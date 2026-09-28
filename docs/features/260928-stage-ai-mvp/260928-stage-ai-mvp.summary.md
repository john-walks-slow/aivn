# stage-ai MVP 实施摘要（P0：语言与契约层）

> 状态：P0 完成（45/45 测试绿，两轮检视通过）。P1（核心闭环：pi 编排器 + 最小舞台）待开工。

## 背景

计划 v4 定稿（`260928-stage-ai-mvp.plan.md`）后进入实施。P0 交付语言与契约层：DSL v1 冻结、流式解析器、IR/WS 协议、谱系数据模型——后续所有阶段（server 编排器、web 渲染层、四原语交互）的共同地基。

## 交付内容

**脚手架**：pnpm workspace（`packages/*` + `apps/*`）、TS project references（strict + noUncheckedIndexedAccess）、vitest。Node ≥ 22.19（pi-agent-core 前置要求）。

**`@stage-ai/core` 包**：

| 模块 | 内容 |
| --- | --- |
| `dsl/spec.ts` | DSL v1 冻结规范：9 标签白名单、stop 三类型（choice/free/pause）、属性结构；已知限制（属性值含 `>` 截断）注释在案 |
| `dsl/events.ts` | `StageEvent` 判别联合——say/narrate/thought 拆 start/text/end 三段支撑流式打字机与语音预取；`SequencedEvent`（WS 线上格式，重连凭 seq 重放） |
| `dsl/parser.ts` | 流式解析器：增量 feed（chunk 任意位置撕裂容错）、endMessage 边界自动闭合（保留已流出台词）、stop 闸门（闭合后丢弃其后本节拍一切，resetBeat 重置）、未知标签字面输出、残缺标签丢弃 + 结构化 warning（供护栏回喂） |
| `ws/protocol.ts` | ServerMessage/ClientMessage：含四原语（ooc/fork/edit/rewrite）正交消息、beat_end 双语义（stop / act_end 幕完收束）、resume 重连 |
| `lineage/model.ts` | 谱系树：行级事件 append-only 日志（唯一真相源）、四原语 API（forkAt/editInPlace/recordRewrite——编辑以追加事件表达，物化时覆盖）、快照随分支走（latestSnapshotOnPath）、书签、`export()/load()` 完整会话状态持久化（leaf 显式恢复 + 快照/书签存活 + id 计数器播种） |

## 实施过程中的设计修正

1. **recordRewrite 语义**：初版挂载到目标节点（保留目标行），与用户"回退这句重新生成"语义不符——修正为挂载到目标**父节点**（目标行作废留废弃分支）。
2. **测试断言语义**：撕裂等价性应比较**聚合后**的语义事件序列（delta 切分粒度天然随 chunk 变），而非原始事件流。

## 检视与修复

- 第一轮（review.md）：有条件通过。修复 2 阻塞：B1 exportAll/load 只往返事件流（裸分岔 leaf 丢失、快照书签不持久化）→ 升级 `LineageStore` 完整结构；B2 option 生命周期（漏 `</option>` 静默丢文本、自闭合 option 丢失）→ emitStop 入口收束 + 自闭合立即收束。另修 choice 零选项警告（护栏回喂）、beat 粒度契约注释钉死（边界解析归编排器）、pathSet、id 播种等。
- 第二轮（review-round2.md）：**通过**。B1/B2 实证修复确认，无新阻塞。
- 修复自身引入的仓库卫生问题：write 覆盖了仓库既有 .gitignore（丢了 plays/media-cache/.mnemon 忽略项），已合并恢复。

## 测试

45/45：解析器 golden 29（含撕裂等价 5 种 chunk、边界自动闭合、stop 闸门跨消息、option 生命周期 3 形态、字面文本、容错丢弃）+ 谱系 16（四原语、跨分支隔离、快照路径、持久化往返、pathSet）。

## 下一步（P1）

核心闭环：pi-agent-core playwriter 编排器（三区装配 append-only 稳态 + 纪元压缩）、最小舞台文字直播（WS + 客户端事件消费）、角色卡 voice 样例。依赖：cpa 网关端点配置。
