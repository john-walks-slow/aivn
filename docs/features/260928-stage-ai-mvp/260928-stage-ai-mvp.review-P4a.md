# 检视报告

## 概要

本次检视覆盖 Stage-AI P4a 阶段交付（commit c388c00 之后的未提交改动），涵盖三层记忆系统（always/index/archive 加载、MiniSearch 全文检索与祖先链防剧透）、四项记忆工具（update_state/write_memory/read_memory_detail/search_archive）、三区装配改造、常驻原地 OOC（busy 态 steer 注入 + 停止点立即开拍）及前端「🎬 导演」浮层交互。整体架构与设计意图契合度极高，核心设计原则落地扎实；但发现编排器在处理多轮工具调用时过早收束节拍，导致多轮查询被严重撕裂甚至判定为空拍报错，判定为阻塞问题，须修复后重新检视。

## 需求对齐

本轮交付与计划文档（§5 D7、D9、D10 及 §9 实施阶段表）对齐情况如下：
- **三层记忆契约**：`memory/always/`（craft/premise）与 `memory/index/{locations,lore,arcs}` 实现了随 runtime 构建加载并在纪元内冻结；`memory/archive/` 实现了 JSONL 切片追加与 MiniSearch 全文检索；通过 `tree.pathSet()` 实现了基于祖先链的防剧透过滤。
- **引擎拥有状态**：`update_state` 对好感度增量（|Δ|≤5，值域 0~100）及角色合法性进行了严格的引擎侧校验与拦截。
- **三区装配稳定**：A 区固定提示词前部保持逐字节冻结；B 区对话体 append-only；C 区轮尾携带【状态】+【导演注】+【玩家表态】。
- **原地 OOC 交互**：演出进行中通过 `agent.steer()` 注入导演注，服务端回发 `ooc_ack`，前端 StageTheater 顶栏常驻「🎬 导演」按钮并展示注入状态，StopPanel 移除了原展开盒。
- **与计划偏离点**：计划文档定义节拍（beat）可跨越多次 assistant 消息与工具调用轮次，但当前实现将单个 LLM turn 的结束等同于了 beat 的结束，破坏了该定义。

## 阻塞问题

| ID | 位置 | 问题 | 建议 |
| --- | ---- | ---- | ---- |
| BLK-01 | `apps/server/src/orchestrator.ts:480-482` | **`turn_end` 无条件调用 `finishBeat`，导致中间工具调用轮次被误判为节拍收束甚至触发「空拍报错」**。<br>在 pi-agent-core 中，模型每次发起工具调用并获得结果时均会产生一个 `turn_end` 事件（随后进入下一个 turn 继续生成）。编排器在 `turn_end` 时无条件调用 `this.finishBeat()`，导致：<br>1. 若模型在输出剧本前先调用 `read_memory_detail` 或 `search_archive`，此时 `beatEvents === 0` 且无 stop 标签，直接被空拍护栏拦截，向客户端推送 `error`（“本节拍生成失败：模型未产出任何剧本内容”）并强行插入 pause 停止点；<br>2. 若模型在输出部分台词后调用工具，本拍被过早截断下发 `beat_end`，工具返回后模型续写内容又被当成全新的一拍（新 `beat_start`），使单个节拍被撕裂成两拍，破坏了计划中“节拍可跨多条 assistant 消息与工具调用轮”的核心契约。 | 移除 `turn_end` 中的无条件 `this.finishBeat()`。节拍收束应遵循真实终点条件：仅在批次中显式包含 `beat_done`、整个 agent run 结束（`agent_end`），或在 steer 续写拍启动（`turn_start` 且已收到收束信号）时才调用 `finishBeat()`。普通工具调用（如查记忆）应允许当前 beat 继续流转，不得收束。 |

## 建议修改

| ID | 位置 | 问题 | 建议 |
| --- | ---- | ---- | ---- |
| SUG-01 | `apps/server/src/memory.ts:75-76` | **`searchArchive` 丢弃了 MiniSearch 相关性打分排序，且存在高相关结果被截断丢失风险**。<br>`this.index.search()` 返回的是按相关性降序排列的结果列表，但代码将其转为 `hitIds = new Set(...)` 后直接对时间顺序的 `this.slices` 做 filter。这导致：1) 返回结果按时间而非相关性排序；2) 若命中数超过 limit，排在后面但相关性更高的结果会在 `slice(0, limit)` 时被直接丢弃。 | 遍历 `this.index.search` 返回的有序结果列表，配合 `Map<id, ArchiveSlice>` 进行查找和 `allowed.has(s.entryId)` 祖先链过滤，按相关性顺序收集前 `limit` 条结果。 |
| SUG-02 | `apps/server/src/orchestrator.ts:366-372`, `427-430` | **`this.lastStop` 在进入新拍后未重置，导致演出进行中（busy 态）发送 OOC 时错误附加「玩家本轮未作回应」声明**。<br>当上一拍以 `choice` 或 `free` 停止点停下，玩家做出选择开始下一拍后，`this.lastStop` 仍残留旧值。若玩家在当前拍播放中途（busy 态）通过「🎬 导演」发送 OOC，`renderDirectorNote` 检测到 `this.lastStop` 依然存在且非 pause，便会给 steer 消息追加 `【玩家表态】\n（玩家本轮未作回应...）`，导致模型在后续续写时误以为玩家跳过了上一轮交互。 | 在玩家动作触发新拍时（`beginBeat` 或 `playerAction` 消费了上一停止点后）将 `this.lastStop` 置为 `null`；或在 busy 状态下执行 steer 组装导演注时显式不读取 `lastStop`（演出中途尚未到达停止点，不属于玩家跳过表态）。 |
| SUG-03 | `apps/server/src/orchestrator.ts:513-514` | **`saveSnapshot` 保存状态对象引用，未做浅拷贝，存在跨节拍原地污染风险**。<br>`this.opts.tree.saveSnapshot` 直接保存了 `this.stateFiles` 与 `this.opts.engine` 的对象引用。后续节拍中如果通过 `write_memory` 或 `update_state` 修改这些对象属性，之前所有历史快照持有的同一对象引用都会被原地修改，导致路线树分岔回退时无法正确复原历史记忆状态。 | 在保存快照时对 `stateFiles` 和 `engine` 浅克隆隔离，如 `{ state: { ...this.stateFiles }, arcs: [] }` 与克隆 `engine`（`{ ...engine, affinity: { ...engine.affinity }, flags: { ...engine.flags } }`）。 |

## 非阻塞问题

| ID | 位置 | 问题 | 建议 |
| --- | ---- | ---- | ---- |
| MIN-01 | `apps/server/src/memory.ts:155-162` | **`cjkBigrams` 未保留单字 unigram，导致单字中文关键词检索零命中**。<br>对于长度大于 1 的汉字串只提取 2-gram（如“旧校舍拆除”生成“旧校”、“校舍”、“舍拆”、“拆除”）。如果检索 query 是单字（如“校”或角色名单字），因索引中无对应 token，将出现零命中。 | 建议对中文串在生成 bigram 的同时保留 1-gram（unigram），或在查询词为单字时使用 prefix / 通配匹配。 |
| MIN-02 | `apps/server/src/memory.ts:127-128` | **`loadCards` 标题解析对 markdown 标题层级容错较弱**。<br>`lines.findIndex(l => l.startsWith("#"))` 会匹配到 `## 二级标题` 或 `### 三级标题`，且 `slice(1)` 处理后仍会残留 `#`。 | 建议使用精确正则 `/^#\s+(.+)$/` 匹配标准 markdown 一级标题。 |
| MIN-03 | `apps/web/src/stage/StageTheater.tsx:148-167` | **移动端超小屏下软键盘弹起时的视口遮挡备忘**。<br>导演注浮层使用绝对定位 `top: 52px`，在移动端小屏输入且软键盘弹出时可能会与对话框区域产生重叠。 | 在 P6 移动端专项适配中，建议补充移动端软键盘弹起时的视口自适应或沉底抽屉形态。 |

## 准入结论

**结论**：`不准入`

**说明**：核心三层记忆装配与常驻 OOC 的设计方向非常优秀，但由于编排器直接在 `turn_end` 收束节拍，导致大模型在输出台词前或中途调用记忆查询工具（`read_memory_detail` / `search_archive`）时会被误判为空拍生成失败并强行中断（BLK-01）。须修复节拍与 LLM turn 的生命周期绑定逻辑后重新检视。
