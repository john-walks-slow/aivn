# rewrite-instruction 小结

## 问题

第一轮卡片上点「重写」并填一句交代：重写发生了，但交代没跟着重演的这一轮走——它躺在待注入队列里，等玩家下一次开口才并进**再下一轮**。

## 改了什么

| 位置 | 改动 |
| --- | --- |
| `packages/core/src/ws/protocol.ts` | `fork` 消息加 `instruction?: string`（随这一岔交代的一句） |
| `apps/server/src/transport.ts` | `case "fork"` 把 `instruction` 透传给 `forkTo` |
| `apps/server/src/orchestrator.ts` | `forkTo` 收 `instruction` / `replaced`；新增 `deliverForkInputs`（交代走 `deliverPrompts` 同一条入账路径）与 `replacedInput`（`replaced` 是输入节点时取回那句原话、一起带进新枝）；`resume` 与非 `resume`（分岔）两条路都在 `rebaseAt` 之后兑现 |
| `apps/web/src/stage/useStageSocket.ts` | `sendFork` 的 opts 加 `instruction`，seq / nodeId 两个分支都序列化 |
| `apps/web/src/views/StageScreen.tsx` | 路线卡片的「重写」不再调 `queuePrompt`，交代随 `fork(..., {resume:true, instruction})` 一起发 |
| `apps/web/src/stage/StageTheater.tsx` | 导演栏「重写」与「分岔」两处：`onFork` 带 `instruction`，删掉后面的 `onPrompt(text)` |
| `apps/web/src/stage/LineagePanel.tsx`、两份 `AGENTS.md` | 注释与指引同步（旧的写着「排进队列、生效于下一次开口」） |
| `apps/server/test/orchestrator.test.ts` | 新增四条：「重写带着交代」（resume）、「分岔带的交代」（不 resume）、「点名 replaced 时原话带进新枝」、「交代与原话同时在场」，外加一条来源标签回归 |
| `apps/web/src/stage/beats.ts` | `BeatCard.forkFromId` 恒为「本轮之前的那一点」；只有一句话的卡（分岔点正好落在那句输入上）拿那句话当正文 |
| `apps/web/src/stage/StageScreen.tsx`、`StageTheater.tsx`、`RouteCanvas.tsx`、`LineagePanel.tsx` | 两个入口统一送 anchor(`forkFromId`) + `replaced`；回顾里的「重新生成」也带上 `replaced` |
| `apps/server/src/rebuild.ts`、`orchestrator.ts` | 重建提示词里【用户输入】不再套两层（标签只在成拍 user 侧与链尾那批各拼一次） |

## 为什么是这么修

`fork` 协议原来只带锚点与分支元数据，客户端只能拿两个独立动词拼一个动作：`fork` + `prompt`。而 `prompt` 的既定语义是「排队等下一次开口」（引导不吞掉玩家的选择权），于是「重写 + 交代」必然错位一格。交代升格为 `fork` 的一部分之后，它是新枝**这一轮**的第一条输入：落一个 prompt 节点、广播一条 `player_input`、作为 `【用户输入】` 发下去——与「插一句」同一条入账路径，只是不入 `pending`。

对照 `407364b` 最初收敛动词时的设计「填了字则意图紧跟着落进重演的那一拍」，本次是恢复该语义。判废退回时它由既有的 `returnBeatSteers` 回到队列，玩家写的句子不丢。

## 测试

- server 受影响面五文件（orchestrator / lineage-ops / transport / history / compaction）144 例全绿。
- web 五文件（directorTargets / routeVerbs / routeControls / stageKeyboard / playerReceipt）25 例全绿；`pnpm typecheck` 干净。
- 变异验证：改回「忽略 instruction」（resume 与非 resume 各一次）、把【用户输入】标签改回在 `rebuild.ts` 里先拼一遍——对应用例都当场红。

## 检视响应

检视报告见 [261004-rewrite-instruction.review.md](261004-rewrite-instruction.review.md)，结论「条件准入」，无阻塞项。

- **S-01（补分岔带交代的用例）——已采纳**：`fork.resume: false` 是我这次新加的一行，原先零覆盖，补了「分岔（不 resume）带的交代：新枝开出来就照这句开演」并做了变异验证。
- **S-02（导演栏重写的锚点比路线卡片深一个节点）——已收口（用户授权「按最佳做法」）**：`StageScreen` 的 `targets.beatId` 取 `beatAtLine(...).id`（本拍首节点），路线卡片取 `card.forkFromId`（本拍首节点的父）。当某一拍是玩家的一次表态开出来的时候，首节点就是这个 prompt 节点，于是两边语义不同——导演栏「保留我那句输入、重写你的回应」，路线卡片「连输入一起重来」。收口方式见下节。
- **N-01（判废退回的用例）——未做**：逻辑是隐式继承 `deliverPrompts` / `returnBeatSteers` 的既有机制，不是本次新写的分支；先不加用例。
- **N-02（`onFork` 与 `sendFork` 的 `replaced` 不对称）——已补**：`StageTheaterProps.onFork` 与 `BacklogView` 的 `onFork` 都补上 `replaced?: string`；舞台那两处（导演栏重写、回顾的重新生成）现在都把「被顶掉那一拍的首节点」一起发出去，来源标签不再靠猜。


## 收口：两个重写入口统一锚点

上一轮把交代送进了重演的那一轮，但两条入口的**锚点**口径不同，实测（临时探针，已删）：

| 入口 | 原锚点 | 新枝上有没有玩家那句输入 | fork 来源标签 |
| --- | --- | --- | --- |
| 路线卡片 `RouteCanvas` | `card.forkFromId`（本轮首节点的父＝上一轮末尾） | 没有，剧作家只收到【状态】 | `input:（选择了：道歉）`（对） |
| 舞台导演栏 `StageScreen` | `beatAtLine(...).id`（本轮首节点，本轮由玩家一句话开头时就是那个 prompt 节点） | 有（那句输入留在新枝上） | `continue`（错） |

标签错的那一边尤其致命：玩家回到同一锚点重选同一选项时，认不出刚重写出来的这条枝。

统一成一条规则：

- **锚点恒为「本轮之前的那一点」**（`apps/web/src/stage/beats.ts` 的 `BeatCard.forkFromId`＝首节点的父；第一轮没有前驱就退回首节点自身），两个入口都送它——整轮连内容一起重来；
- 同时把「被顶掉那一拍的首节点」作为 `replaced` 一起发（舞台那两处原来没发）：来源标签按它算，稳定得到 `input:…`；
- 服务端 `replacedInput` 见 `replaced` 是 prompt 节点且 ≠ 锚点时取回那句原话，与随岔的交代一起构成新枝**这一轮**的输入（`deliverForkInputs`）：原话落一个 prompt 节点、进 `trailingInputs`（**不当引导**——旧枝上那句话本来就在，再排一次等于同一句进两次谱系）；交代仍走 `deliverPrompts` 当引导，判废时由 `returnBeatSteers` 还回队列。

**为什么没选「本轮由玩家的一句话开头就锚那句话本身」**：实测回归——`jumpTo(第一拍末尾) + 重选同一选项`时 `命中重写枝=false`、世界线落在那个输入节点上。原因是 `LineageTree.beatEndFrom` 见分叉点（输入节点有 2 个孩子）就返回它自己（`packages/core/src/lineage/model.ts`）。同时那句输入在路线视图里会单独成一张卡。整条路已回退。

连带两处（保留）：

- **只有一句话的卡显示那句话**（`beats.ts` 的 `collect`）：分叉点正好落在那句输入上时它会单独成卡，原先掉进「（无台词）」兜底，等于把玩家说过的话从路线树上抹掉；现在卡面就是那句输入（`toNodeView` 早把 `payload.input` 落到 `node.text`）。
- **修掉重建提示词里套两层的【用户输入】**（`rebuild.ts` 不再先拼标签：成拍的 user 侧在 `flush` 里拼、链尾悬空那批交给 `renderPromptTurn` 拼一次）：上一轮实测撞见的旧瑕疵，两条重写路都会走到，顺手收掉；成拍那份文本一个字节没变。

`pnpm typecheck` 干净；server 受影响五文件 146 例、web 受影响七文件 32 例全绿；变异验证：把 `replacedInput` 强制返回 null →「点名 replaced 时原话带进新枝」「交代与原话同时在场」当场红，去掉标签改动 → 两条用例红，去掉 instruction 兑现 → 对应用例红。
