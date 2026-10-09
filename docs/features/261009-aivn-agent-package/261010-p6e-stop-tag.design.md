# P6-e 设计 · 停止点载体统一（`beat_done` 工具 → 剧本末行 `<stop …/>`）

日期：2026-10-10 · 状态：**设计稿**（用户点名必做，最高优先）
上游：`261009-aivn-agent-package.p6.plan.md` §6 的「停止点载体」有意差异；用户 2026-10-10 指示「5 必做」

---

## 0. 一句话

服务端删掉 `beat_done` 工具：停止点与轮收束都改由剧本末行 `<stop options="…"/>` / `<stop placeholder="…"/>` /
`<stop/>` 承载——与插件**同一句话、同一个 IR**。顺带把「因为有了这个工具才存在」的三处兜底一起删掉。

---

## 1. 现状（实读）

**轮边界今天有两个来源，且两条路在 IR / 谱系 / 客户端上完全同形：**

| 来源 | 路径 |
| --- | --- |
| 模型末行标签 | 解析器 `packages/core/src/dsl/parser.ts:417,425` 产出 `stop` IR → 服务端 `onStageEvent` 的 `case "stop"`（`orchestrator.ts:2460`）写 `pendingStop` + 落谱系 → `finishBeat` 第 2064 行 `const stop = this.pendingStop` |
| `beat_done` 工具 | `memoryTool` 之外的 `beatTool.ts` → `emitStop` → **同一条** `case "stop"`（`orchestrator.ts:2312`） |

也就是说：

- **标签这条路的服务端代码已经存在、且是完整闭环**（解析 → `pendingStop` → `finishBeat`/`closeBeat` → `lastStop` → `beat_end.stop`）；
- 停止点在客户端是**谱系节点**（`apps/web/src/stage/beats.ts:344` `node.kind === "stop"` 读 `attrs.stopType`），两条来源没有差别；
- 插件走的正是标签这条（`dsh-aivn` 的 persona《剧本格式》教三种标签形态，停止点是剧本末行）。

**工具比标签多带来三样东西**（全部可以随工具一起删）：

| # | 工具带来的 | 代码位置 |
| --- | --- | --- |
| 1 | `terminate`：让 pi 立刻结束这一轮 | `beatTool` 的 `terminate: true` |
| 2 | 漏调时的同轮追收束 | `orchestrator.ts:657-670`（`BEAT_DONE_NUDGE` + `beatDoneNudged`） |
| 3 | 与别的工具同批时 `terminate` 被吞的兜底 | `orchestrator.ts:649-656`（`agent.finishTurn`） |

注意 2 与 3 是**互相咬合**的：正因为有了 `beat_done`，「忘了调」才成为一种要兜的失败。
标签路径没有「忘调」这回事——写没写只决定 `reason: stop / no_stop`。

---

## 2. 目标形态：四件事的映射

**轮边界从「工具调用」变成「这一 run 结束」**（模型不再调工具 → pi 收 run → `agent_end` → `finishBeat()`）：

| # | 今天 `beat_done` 做的 | 标签路径怎么做 | 代码动作 |
| --- | --- | --- | --- |
| 1 | 轮收束（terminate） | run 自然结束就收束（今天 `no_stop` 走的就是这条） | `onAgentEvent` 只在 `agent_end` 收；删 `beatClosed`、删 `turn_end` 的收束分支 |
| 2 | 停止点载荷（options / placeholder / pause） | 解析器已经把标签变成 `stop` IR，`pendingStop` → `closeBeat` | **零改动**（已有代码） |
| 3 | 漏调同轮兜底 | 不存在「漏调」；没写标签就是 `no_stop`（合法出口，客户端给「继续」） | 删 `BEAT_DONE_NUDGE`、`beatDoneNudged`、整段 steer 逻辑 |
| 4 | 批内 terminate 被吞的兜底 | 没有 terminate，就不会被吞 | 删整个 `agent.finishTurn` 回调 |

**一拍 = 一个 run**：一 run 里可以拆多个 turn（模型先写正文、再同轮调 `write` 改状态文件），
`turn_start` 只在 `!busy` 时开新轮窗（`orchestrator.ts:2049`），一拍照旧只落一个 `beat_end`。

---

## 3. 附带简化（都是「删」）

- `orchestrator.ts`：`beatClosed` / `beatDoneNudged` / `BEAT_DONE_NUDGE` / `finishTurn` 回调 /
  `beatToolActivity` 里对 `beat_done` 的豁免（`orchestrator.ts:2037`）。
- 工具层：`beat_done` 的 TOOL_CATALOG 行、`TOOL_SIDE_EFFECT_CATALOG` 行、契约矩阵行；
  `emitStop` 依赖与 `ModelStop` 类型。
- **`stage` 能力（`locked: true`，`tools: ["beat_done"]`）随工具消失**：一个没有工具的常开能力没有意义。
  `enabledToolsFor` 里「常开的不看启用集」那段逻辑一起删。插件侧本来就没有这条能力（`dsh-aivn-shared/src/capabilities.ts`：
  shell / voice / search / image / music），删掉让两边的能力面更接近。
- 契约矩阵里「停止点载体不同」这条**有意差异**消失（P6 计划表第 1 行从「不做」改成「已统一」）。

---

## 4. 迁移面

| 面 | 改什么 |
| --- | --- |
| `orchestrator.ts` | 删 `agent.finishTurn`；`onAgentEvent` 的 `turn_end` 分支删除（只在 `agent_end` 收束）；删上面 §3 的字段与常量；`beatToolActivity` 去掉豁免 |
| `agentkit/` | 删 `beatTool.ts`（或它剩下的部分）；`kit.ts` 删工具目录行 + `stage` 能力；`contract.ts` 删副作用行与矩阵行；`deps.ts` 删 `emitStop` |
| 提示词 `prompt.ts` | 《结束轮（beat_done）》改写成《结束轮》：三种标签形态、**写在剧本最后一行**、之后不要再写收尾交代；删「beat_done 通常独占一次工具调用」那句；`FORMAT_RULES` 里补标签语法（正文可借 `packages/core/src/dsl/spec.ts:47-58`） |
| 测试 | `test/helpers.ts`：`beatDone` 字段从「合成一次 beat_done 工具调用」改成「把标签渲染进正文末尾」——**约 178 处调用点不用改**；`history.test.ts` 的 toolCall 断言改成「不再有 beat_done 记录」；`orchestrator.test.ts` 里「漏调追收束」「同批吞 terminate」两条用例删除或改写成「标签 + 工具同轮仍是一拍」「末行没有标签 = no_stop」 |
| 守卫/文档 | `scripts/check-agent-contract.mjs` 的「提示词点名的工具都在装配面上」自然过（提示词不再点名 beat_done）；`apps/server/AGENTS.md` 与 README 的 beat_done 说法；P6 计划表 |

---

## 5. 风险与对策

| # | 风险 | 对策 |
| --- | --- | --- |
| R1 | **漏写标签**导致 `no_stop` 变多（今天有 nudge 兜底） | 标签写进《格式》与《结束轮》两处（与插件同源，插件就是这么跑的）；`no_stop` 本来就是合法出口。先观察，**不预先加新机制** |
| R2 | 模型在标签之后继续调工具 → run 变长 | 提示词写明「标签是剧本最后一行，写完就不要再调工具，也不要写收尾交代」；run 仍有 240s 超时与 P0 判废兜底 |
| R3 | 停止点事件在流式途中就广播（今天工具是最后一刻才产出） | **现状已经如此**：解析器今天也认标签，`case "stop"` 一样即时广播；客户端面板由 `beat_end.stop` 与谱系节点驱动，没有新面 |
| R4 | 标签写在正文中间 | 解析器行为不变（遇到即产出 stop 事件），谱系上就是那一刻的停止点——与插件一致 |
| R5 | 旧档重放 / 冷启动 | 停止点在谱系里是节点，与新载体无关；`lastStop` 仍从链上读（`orchestrator.ts:1631-1646`） |

---

## 6. 什么结果下这条不做 / 要回退

1. run 无法可靠结束（模型持续调工具，每轮都撞 240s 超时）——说明「run 结束」撑不起轮边界，回退保留工具；
2. 提示词教不会标签：实机连续出现 `no_stop` 且玩家拿不到面板；
3. 出现「停止点面板在流式途中提前出现」的具体客户端缺陷（R3 的实证）。

---

## 7. 实施顺序（每步单独可验证）

1. **夹具先行**：`test/helpers.ts` 的 `beatDone` 改成渲染标签（此时工具还在、两条路并存，全量测试应仍绿）；
2. **编排器**：删 `finishTurn` / nudge / `beatClosed`，只在 `agent_end` 收束 → 跑 `orchestrator.test.ts`；
3. **工具与能力位**：删 `beat_done` + `stage` 能力 + 契约/矩阵/副作用行；
4. **提示词**：改写《结束轮》与 `FORMAT_RULES`，删独占批次那句；
5. **验证**：服务端 typecheck + 全量、契约守卫、包/web 单测、插件 `typecheck` + `build.mjs --check`（插件零改动，产物应逐字节不变）；
6. **检视**（reviewer）+ 落地 main。
