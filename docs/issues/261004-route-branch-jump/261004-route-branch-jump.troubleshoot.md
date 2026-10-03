# 路线视图跳转/分岔挂错位置 + 阅读位置记录机制 排查

**状态：已定位、已修（worktree `fix/route-branch-and-readpos`）。** 2026-10-04 用户报告，并附了一份「阅读位置记录机制」补充规格。

## 现象（用户原话）

1. 路线视图点卡片上的**「回到这里」**，预期是世界线跳到某个节点、回去重看那一拍（在那个选项处改选还会自然开新分叉）；实际是**剧作家直接开始续写**，新写的一拍接到**原来的叶子节点**上；开头还多出一张**「无台词」卡**。
2. 点**「由此分岔」**，新出现的 node **又接到了叶子节点**的位置，完全错误。
3. 刷新页面后经常**丢进度**或**粗暴快进到末尾**。

## 根因（三个，互相独立）

### 一、「回到这里」触发续写：`beat_end` 上被合成出自造的 `pause` 停止点

`BeatCard.id` 原本取「该轮**第一个**事件」，所以「回到这里」跳的是**轮首**而不是轮末——世界线被截在整轮的中间。`rebaseAt` 之后走 `restoreStopPoint(chain)`，链尾是轮中某个节点，于是走到最后那条兜底分支 `this.lastStop = { stopType: "pause" }`；客户端拿到 pause 就摆出「继续」，一点就呼叫剧作家，写出来的内容 append 到当时的叶子（也就是那条旧分支的末尾）上。

**判据**：`restoreStopPoint` 只在「停在轮中」时该给 pause。停在 `beat_end` 上时它本来就有一条正确的分支（在本轮内回找 `stop` 事件），只是没人走到那儿——因为落点根本不在 `beat_end` 上。

### 二、「由此分岔」挂到旧叶子：`buildBeats` 的线性启发式

旧的 `buildBeats` 按 `createdAt` 线性扫全部节点，用 `atFork = node.parentId !== prevInChain` 猜「这里分岔了」，猜不中时兜底 `parent = current`（当前这一轮）。

分岔产生的新节点 `parentId` 正好等于被分岔的那个节点，而那个节点就是 `prevInChain`——`atFork` 判为 false，于是新节点被当成旧轮的一部分挂到 `current` 上，卡片自然落到旧叶子位置。

**这条启发式没有救**：它拿「父节点变了」当分岔信号，而分岔恰恰是「父节点是历史里某个**非**当前节点」。树本身已经是一棵拓扑明确的树（`parentId` 完备），按时间顺序扫再加启发式猜，永远会漏。

### 三、开头多出的「无台词」卡

轮首的 `scene` / `actor` 节点被单独切出一张卡（这一轮的第一条输入节点与第一条台词节点之间有换景节点时尤其明显）。摘要是「本轮首句台词，控制指令不当摘要」——那张卡没有任何可当摘要的台词，就空着。

## 修法

### 一、轮边界与锚点进 `BeatCard`

`apps/web/src/stage/beats.ts` 的 `BeatCard` 增 `startNodeId` / `endNodeId` / `stopNodeId?` / `endSeq` / `forkFromId`：

- `endNodeId` = 该轮最后一个节点的 id（通常是 `beat_end`）——**跳转的唯一合法锚点**；
- `startNodeId` = 该轮第一条台词（`say`/`narrate`/`thought`）的 id；
- `forkFromId` = `card.nodes[0].parentId ?? card.nodes[0].id`——「重演本轮」真正的分岔源是**本轮之前那一点**。

`buildBeats` 整段重写成**按树拓扑行进**：建 `childrenOf` 父表，`traceBeat` 从轮首沿真实子节点走到 `beat_end` 收束，遇 fork 标记与多子分支点切开；fork 子节点以 fork 标记的父节点为 `forkedFrom` 递归。线性扫描与启发式一并删掉（**不要再回去打补丁**）。

### 二、跳转只挪世界线 + 播放头，解耦三件事

协议层（`packages/core/src/ws/protocol.ts`）：

- `ReadPos = { nodeId, offset, seq?, len? }`——**主键是稳定 nodeId**，`seq`/`len` 只作老档兼容；
- `ServerMessage.rebase` 增 `playFrom?: "start" | "end"` 与 `resumeAt?: ReadPos`；
- `ClientMessage.jump` → `{ nodeId, playFrom? }`；`ClientMessage.read` → `{ nodeId, offset, seq?, len? }`。

服务端（`apps/server/src/orchestrator.ts`）：

- `jumpTo(nodeId, { playFrom })` 把 `playFrom` 透传给 `rebaseAt`；
- `rebaseAt` 里：`playFrom: "start"` 取「本轮第一句」设 `readPos`（世界线仍锚在目标节点，链完整）；`playFrom: "end"` 把 `readPos` 放到目标节点；两者都**不生成任何内容**；
- rebase 广播带 `playFrom` + `resumeAt`，客户端据此 seek。

### 三、`nodeId` 从谱系一路带到前端

`packages/core/src/dsl/events.ts` 的 `say_start`/`narrate_start`/`thought_start` 增 `nodeId?`；`lineage/replay.ts` 重放时发 `nodeId: node.id`；服务端给缺 `nodeId` 的 start 事件补 `nextId()` 并作为谱系节点 id（`append(..., { id })`）；前端 `ScriptLine` 存 `nodeId`，播放层上报时带上。

### 四、阅读位置记录换成 `nodeId + offset`

- `director.ts` 的 `resolveResumeSeek(cues, lines, resumeAt)` 是「回到哪一个字」的**唯一解算点**：nodeId 优先、老档退回 seq、`offset` 超行长安到行尾、找不到返回 -1（调用方退回快进到末尾）；
- 刷新恢复只读持久化的 `readPos`，不再依赖 `seq` 反查；
- 上报：行首立即一次，行内按 ~1s 节流；`beforeunload`/`pagehide`/卸载各 flush 一次。

### 五、卡片动词（用户点名的三个诉求）

`RouteCanvas.tsx` 右下角三个带字样动词：

| 动词 | 图标 | 调用 | 语义 |
| --- | --- | --- | --- |
| 回到选项 | `return` | `jump(endNodeId, {playFrom:"end"})` | 落到这一段演完那一刻，选项就在眼前；改选自然开新分支 |
| 从头重读 | `rewrite` | `jump(endNodeId, {playFrom:"start"})` | 世界线仍含整轮，播放头回本轮第一句，从头再演一遍 |
| 重演本轮 | `fork` | `fork(forkFromId, {resume:true})` | 推倒本轮重来，呼叫剧作家重新创作 |

「从头重读」**必须锚 `endNodeId`**：锚轮首会让链只到本轮第一句，后面的台词不在事件缓冲里、读不到。

为容纳第三个带字样动词，`routeTree.ts` 的 `NODE_W` 由 208 改为 300，角色名从卡底移到卡片顶行（`.route-node-head`）。除此之外没有动视觉。

## 回归测试

| 文件 | 用例 | 钉住什么 |
| --- | --- | --- |
| `apps/web/src/stage/beats.test.ts` | 「在历史旧轮分岔时，新卡片严格认分岔源为父，绝不可认旧叶子为父」 | 根因二 |
| `apps/server/test/orchestrator.test.ts` | 「回到选项：playFrom=end … 不再合成 pause 去叫剧作家」 | 根因一 |
| 同上 | 「从头重读：playFrom=start 不产出一个字，播放头落在本轮第一句」 | 跳转不触发生成 |
| 同上 | 「回到旧轮末尾选另一个选项：新内容挂在那个轮末，旧分支整段留成兄弟」 | 用户点名的整条链路 |
| `apps/web/test/resumeSeek.test.ts` | 5 例（nodeId+offset、超长截到行尾、老档 seq、老档 len、找不到返回 -1） | 根因三 / 阅读位置 |

## 顺带发现（不在本次范围）

`apps/web/test/settingsPaneCards.test.tsx` 3 例失败：`api.voiceCatalog is not a function`（该测试的 api mock 缺 `voiceCatalog`）。在 `main` 的 `3ac575c` 上原样复现，与本次改动无关，未动。
