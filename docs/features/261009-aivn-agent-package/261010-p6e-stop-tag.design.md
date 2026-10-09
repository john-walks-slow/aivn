# P6-e 设计 · 停止点载体统一（`beat_done` 工具 → 剧本末行 `<stop …/>`）

日期：2026-10-10 · 状态：**已实施**（reviewer 条件准入 → 三条阻塞已并入 §2.1 / §5 R6 / §4）
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

### 2.1 原子性规约（检视 B-01 的修法）

**停止点事件不在解析那一刻下发，改到 `closeBeat` 统一下发。**

今天 `case "stop"`（`orchestrator.ts:2460`）一进就把 `stop` IR 事件广播给客户端并落谱系。
换成标签承载之后，模型完全可能**写完末行标签再调工具**（`write` / `search_archive`），
那时候这一拍还没结束——客户端会先看到停止点、后台还在跑，违背「一拍一结」。

做法：`case "stop"` 只写 `pendingStop`（不回广播、不落谱系），
`closeBeat` 在落 `beat_end` 之前把这条 `stop` 事件补发出去（`onStageEvent` → 落谱系 → 广播）。
好处不只是修掉提前下发：

- 停止点在谱系里**永远是这一拍的最后一条事件**（今天工具路径下，同批里排在 `beat_done` 之后的
  `preload_asset` 之类会落在它后面）；
- 两条载体（旧档重放 / 新写法）在谱系上的形状完全一致。

注意 `onStageEvent` 的 `case "stop"` 会被 `closeBeat` 再次进入：那里必须只写 `pendingStop`，
不能再递归回 `closeBeat`。

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
| **NSFW 通道文本**（检视 B-03） | `agentkit/nsfwTool.ts` 四处（进入/退出的描述与回执：「与 beat_done 同批发出」「调用后调 beat_done 收束」）与 `prompt.ts` 的两段限制级指引（`:445` 的退出句、`:447` 的进入句）全部改写成「末行写 `<stop …/>`」——不改的话模型会被教去调一个不存在的工具 |
| **写作参数** | `craftParams.ts` 的 5 条停止点措辞（`beat_done(options=[…])` / `beat_done(placeholder="…")`）→ 标签写法 |
| **纪元压缩**（检视 S-01） | `compaction.ts:233` 的 `renderBeatDone` **保留**：它服务的是**迁移前**的旧会话记录；新会话不再有这条工具调用。另在压缩里认一次「正文末行的 `<stop/>`」即可（可选） |
| `role.ts` 注释 | 「工坊要 emitStop 用不上」这类依赖面说明 |
| 守卫/文档 | `scripts/check-agent-contract.mjs` 的「提示词点名的工具都在装配面上」自然过（提示词不再点名 beat_done）；`apps/server/AGENTS.md` 与 README 的 beat_done 说法；P6 计划表第 1 行 |
| 插件侧（检视 S-02） | `dsh-aivn-shared/src/play/craft.ts` 等注释里「服务端那边是工具调用 beat_done——刻意差异」的说法作废；`packages/agent/src/prompt/stage-dsl.ts` 头注释里那句「服务端…停止点是工具调用，插件把停止点写在剧本最后一行」一并改掉 |

---

## 5. 风险与对策

| # | 风险 | 对策 |
| --- | --- | --- |
| R1 | **漏写标签**导致 `no_stop` 变多（今天有 nudge 兜底） | 标签写进《格式》与《结束轮》两处（与插件同源，插件就是这么跑的）；`no_stop` 本来就是合法出口。先观察，**不预先加新机制** |
| R2 | 模型在标签之后继续调工具 → run 变长 | 提示词写明「标签是剧本最后一行，写完就不要再调工具，也不要写收尾交代」；run 仍有 240s 超时与 P0 判废兜底 |
| R3 | 停止点事件在流式途中就广播（今天工具是最后一刻才产出） | **现状已经如此**：解析器今天也认标签，`case "stop"` 一样即时广播；客户端面板由 `beat_end.stop` 与谱系节点驱动，没有新面 |
| R4 | 标签写在正文中间 | 解析器行为不变（遇到即产出 stop 事件），谱系上就是那一刻的停止点——与插件一致 |
| R5 | 旧档重放 / 冷启动 | 停止点在谱系里是节点，与新载体无关；`lastStop` 仍从链上读（`orchestrator.ts:1631-1646`） |
| R6 | **夹具抹平掩盖真实回归**（检视 B-02） | `beatDone` 改成渲染标签是**有条件的**：标签是 void 标签、**不产生台词**（解析器只产出 stop 事件），所以「零台词轮」的判废语义不受影响；但 `text: ""` + 纯工具轮（`enter_nsfw` 单独成轮）与「同批调用」那几条用例的**意图**变了，必须逐条改写而不是靠夹具兜住。做法：夹具只负责「把 `beatDone` 渲染成标签」，改完跑全量，**逐条看红的用例是语义变了还是断言过时** |
| R7 | 停止点写在正文中间/开头（检视 N-01） | 与插件今天的行为一致（解析器遇到即产出 stop 事件，谱系上就是那一刻）；**不为它加新防御**，只在实机观察 |

---

## 6. 什么结果下这条不做 / 要回退

1. run 无法可靠结束（模型持续调工具，每轮都撞 240s 超时）——说明「run 结束」撑不起轮边界，回退保留工具；
2. 提示词教不会标签：实机连续出现 `no_stop` 且玩家拿不到面板；
3. 出现「停止点面板在流式途中提前出现」的具体客户端缺陷（R3 的实证）。

---

## 7. 共享正文（这条让「同一句话」落到字面）

服务端提示词里的 DSL 正文（`DIALOGUE_TAGS`、`ACTOR_RULES`、`AUDIO_RULES`、`CONTRACT_INTRO`…）来自共享包
`packages/agent/src/prompt/stage-dsl.ts`，那份文件的头注释今天写着一句**刻意差异**：

> 宿主各自的差异——服务端有 `<fx>` / 全屏标题卡 / 纯色场、**停止点是工具调用**，插件把停止点写在剧本最后一行——留在各自的模板里拼，不在这里做分支。

P6-e 之后这半句不成立：**停止点的教学正文搬进共享包**（如 `STOP_TAG_RULES`），两个宿主引同一份，
插件 `src/playwriter/prompt.ts:73-87` 那段内联说明改成引用它。这样「同一句话」不只是口号，是逐字同一份文本。

---

## 8. 实施顺序（每步单独可验证）

1. **共享正文**：`packages/agent/src/prompt/stage-dsl.ts` 加 `STOP_TAG_RULES`（三种形态、写在最后一行、
   之后不要再调工具/不要再写收尾交代），改掉头注释里那半句；包 typecheck + 单测；
2. **夹具先行**：`test/helpers.ts` 的 `beatDone` 改成渲染标签（此时工具还在、两条路并存，
   全量测试**预期会红几条**——逐条判语义还是断言）；
3. **原子性**：`case "stop"` 只缓存，`closeBeat` 补发（检视 B-01）→ 跑 `orchestrator.test.ts`；
4. **编排器**：删 `finishTurn` / nudge / `beatClosed`，只在 `agent_end` 收束；
5. **工具与能力位**：删 `beat_done` + `stage` 能力 + 契约/矩阵/副作用行；
6. **提示词**：服务端《结束轮》引用共享正文；nsfwTool / craftParams / 限制级指引改写；删独占批次那句；
   插件段落改引用共享正文；
7. **验证**：包单测、服务端 typecheck + 全量、契约守卫、web 单测、插件 `typecheck` + `build.mjs --check` + 必要 e2e；
8. **检视**（reviewer 复审这笔改动）+ 落地 main。
