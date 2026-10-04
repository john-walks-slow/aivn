# rewrite-instruction 小结

## 问题

第一轮卡片上点「重写」并填一句交代：重写发生了，但交代没跟着重演的这一轮走——它躺在待注入队列里，等玩家下一次开口才并进**再下一轮**。

## 改了什么

| 位置 | 改动 |
| --- | --- |
| `packages/core/src/ws/protocol.ts` | `fork` 消息加 `instruction?: string`（随这一岔交代的一句） |
| `apps/server/src/transport.ts` | `case "fork"` 把 `instruction` 透传给 `forkTo` |
| `apps/server/src/orchestrator.ts` | `forkTo` 收 `instruction`；新增 `deliverForkInstruction` 走 `deliverPrompts` 同一条入账路径；`resume` 与非 `resume`（分岔）两条路都在 `rebaseAt` 之后兑现 |
| `apps/web/src/stage/useStageSocket.ts` | `sendFork` 的 opts 加 `instruction`，seq / nodeId 两个分支都序列化 |
| `apps/web/src/views/StageScreen.tsx` | 路线卡片的「重写」不再调 `queuePrompt`，交代随 `fork(..., {resume:true, instruction})` 一起发 |
| `apps/web/src/stage/StageTheater.tsx` | 导演栏「重写」与「分岔」两处：`onFork` 带 `instruction`，删掉后面的 `onPrompt(text)` |
| `apps/web/src/stage/LineagePanel.tsx`、两份 `AGENTS.md` | 注释与指引同步（旧的写着「排进队列、生效于下一次开口」） |
| `apps/server/test/orchestrator.test.ts` | 新增两条：「重写带着交代」（resume）与「分岔带的交代」（不 resume） |

## 为什么是这么修

`fork` 协议原来只带锚点与分支元数据，客户端只能拿两个独立动词拼一个动作：`fork` + `prompt`。而 `prompt` 的既定语义是「排队等下一次开口」（引导不吞掉玩家的选择权），于是「重写 + 交代」必然错位一格。交代升格为 `fork` 的一部分之后，它是新枝**这一轮**的第一条输入：落一个 prompt 节点、广播一条 `player_input`、作为 `【用户输入】` 发下去——与「插一句」同一条入账路径，只是不入 `pending`。

对照 `407364b` 最初收敛动词时的设计「填了字则意图紧跟着落进重演的那一拍」，本次是恢复该语义。判废退回时它由既有的 `returnBeatSteers` 回到队列，玩家写的句子不丢。

## 测试

- `apps/server/test/orchestrator.test.ts` 83 例过（含新增两条）；受影响面 `lineage-ops` / `transport` 一并复跑，3 文件 115 例全绿。
- web：`routeVerbs` / `routeControls` / `stageKeyboard` / `playerReceipt` 共 16 例过。
- `pnpm typecheck` 干净。
- 变异验证：把服务端改回「忽略 instruction」（两种路数各一次），对应用例当场红。

## 检视响应

检视报告见 [261004-rewrite-instruction.review.md](261004-rewrite-instruction.review.md)，结论「条件准入」，无阻塞项。

- **S-01（补分岔带交代的用例）——已采纳**：`fork.resume: false` 是我这次新加的一行，原先零覆盖，补了「分岔（不 resume）带的交代：新枝开出来就照这句开演」并做了变异验证。
- **S-02（导演栏重写的锚点比路线卡片深一个节点）——本次不动，留待用户裁决**：`StageScreen` 的 `targets.beatId` 取 `beatAtLine(...).id`（本拍首节点），路线卡片取 `card.forkFromId`（本拍首节点的父）。当某一拍是玩家的一次表态开出来的时候，首节点就是这个 prompt 节点，于是两边语义不同——导演栏「保留我那句输入、重写你的回应」，路线卡片「连输入一起重来」。两者各自自洽（`rebuildBranchAt` 对「分岔落在一句输入上」有专门的 `trailingInputs` 通道），且这处差异在本次改动之前就在，不是本次引入的。但有一个实际后果：导演栏那条路算不出准确来源标签（`replacedOrigin` 取到的孩子是内容节点，得 `"continue"`），回到同一锚点重选同一选项时认不出刚重写的那条枝。要统一成 `card.forkFromId` 是一行的事，但那会改掉导演栏现有的「保留输入」手感，不属于本次 bug 的范围。
- **N-01（判废退回的用例）——未做**：逻辑是隐式继承 `deliverPrompts` / `returnBeatSteers` 的既有机制，不是本次新写的分支；先不加用例。
- **N-02（`onFork` 与 `sendFork` 的 `replaced` 不对称）——不改**：舞台那一路本来就不点名 `replaced`（它靠世界线位置推来源），类型收窄是有意的，注释里已写明 `instruction` 的含义。

## 遗留

- S-02 的锚点口径待用户定夺（统一 / 保持现状）。
