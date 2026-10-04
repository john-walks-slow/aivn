# 261004-rewrite-instruction —— 带交代重写时，交代被排到了下一轮

## 现象

在第一轮卡片上点「重写」并填一句交代：重写确实发生了（退到这一轮之前重新生成），但那句交代没有跟着重演的这一轮走——它躺在待注入队列里，直到玩家下一次开口（点选项 / 敲输入 / 按继续）才并进**再下一轮**。

舞台导演栏的「重写」同病，「分岔 · 带着这句」也一样：提交按钮写着「带着这句」，实际是分岔完之后把这句话排进队列。

## 现状链路（修前）

客户端两个入口都把「重写 + 交代」拆成两条 WS 消息：

- `StageScreen.routeOps.rewrite`（路线卡片）：`fork(forkFromId, {resume:true})` 之后紧跟 `queuePrompt(instruction)`。
- `StageTheater.submitAction`：`onFork(beatId, {resume:true})` / `onFork(lineSeq)` 之后 `onPrompt(text)`（sendPrompt → `playerAction({kind:"prompt"})`）。

服务端：

- `forkTo(nodeId, {resume:true})` → `rebaseAt`（落 fork 标记）→ `beginBeat(renderPromptTurn([]))`：重演这一轮的 `【用户输入】` 是**空的**，只有状态区。
- 随后到达的 `prompt` 消息走 `playerAction` 的 prompt 分支：只 `push` 进 `pending` 队列并广播，**从不自己开新一轮**（这是「引导」的既定语义：停止点上排队不吞掉玩家的选择权）。
- 于是那句交代要等下一次 `playerAction`（选项/自由输入/继续）才由 `deliverPrompts` 合成进那一轮。

所以「下一个动作」= 队列的兑现时机，而这个时机天然在重写这一轮之后——交代落进的是下一轮，且被停止点挡住时还可能更晚。

## 根因

`fork` 协议只带锚点与分支元数据，**没有表达「这次分岔带一句交代」的字段**；客户端只能拿两个独立动词拼一个动作，而 `prompt` 的语义是「排队等下一次开口」。两边都对，拼起来就错位。

对照最初的动词收敛（commit `407364b`）：fork 当时是 prompt 的一个修饰参数，「填了字则意图紧跟着落进重演的那一拍」——本次修复恢复的是这个语义。

## 修复

把交代升格为 `fork` 的一部分，由服务端把它当作**新枝这一轮的第一条输入**入账：

- core：`ClientMessage` 的 fork 加 `instruction?: string`。
- server：`forkTo` 收 `instruction`，经新增的 `deliverForkInstruction` 走 `deliverPrompts` 同一条入账路径——落一个 prompt 节点、广播一条 `player_input` 事件、作为 `【用户输入】` 发下去；`resume` 与不 `resume`（分岔）两条路都生效。判废退回时它照常由 `returnBeatSteers` 回到队列。
- web：`sendFork` 透传 `instruction`；舞台导演栏的「重写」「分岔」与路线卡片的「重写」都不再调 `queuePrompt`/`onPrompt`，那句交代随 fork 一起发。

## 影响面

- 重写这一轮的下发正文多一段 `【用户输入】`，谱系里多一个 prompt 节点（挂在 fork 标记之下、重演出的台词之前）——回看、回顾、重放都按既有的 `player_input` 管线消费，客户端零改动。
- 「引导」（排队等下一轮）语义不变，`prompt` 协议不变。
- 判废重演（`rewindFailedBeat(retry=true)`）用的是同一条 `userText`，交代在重演里不会丢。

## 验证

- 新增 `apps/server/test/orchestrator.test.ts` 的「重写带着交代」两条：`resume`（重写）与不 `resume`（分岔）各一条，断言新枝那一轮下发给剧作家的正文含交代、谱系里 prompt 节点在 fork 标记之下、队列里没有这一句。变异验证过：把服务端两处改回「忽略 instruction」时对应用例当场红。
- `pnpm typecheck` 干净；受影响的 server 三文件（orchestrator / lineage-ops / transport，114 例）与 web 四个文件全绿。
