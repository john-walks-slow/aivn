# 开局指令跟着第一条消息走（2026-10-06）

## 背景：`opening` 曾经是个死字段

`play.json` 的 `opening` 是「开局那条 user 消息的正文」（`@aivn/core` 缺省「（游戏开始，请演出第一轮）」）。
AIVN 里玩家点舞台上的「开演」把它发出去；插件这边这条路整条走不通，四条实测证据：

- 会话空着时 DSH 不渲染 tab 列（新建会话、选上「剧作家」、不发消息，`listTabs` 为空），
  AIVN tab 进不去，舞台与「开演」按钮都够不着；
- 离开 Hero 屏只能靠发一条消息，而这条消息立刻被宿主落成舞台上的 `player_input` 行
  （`stage-tap.ts` 的 inbox 监听 → `@aivn/stage` 的 `script.ts` 给它建一行），
  而「开演」浮层的判据是 `lines.length === 0`（`stage-view.tsx:497`）——实测发完消息 0.5 秒切到 AIVN，
  `.choice-overlay` 数量就是 0，台词条上是 `fresh=false` 那一支的「剧作家正在落笔…」；
- AIVN tab 里输入框被 `host.css` 藏掉（实测 `[data-composer-seat]` 为 `display: none`），
  玩家要打字只能切回 Chat；
- 读 `opening` 的地方只有那一处按钮点击，写它的只有 `create_play`。

口径（用户 2026-10-06 拍板）：「类似于 C」——DSH 里玩家说一句就是开演，**「开演」按钮留着不删**，
`opening` 改成**第一条消息时自动注入**。

## 做法

`src/stage-tap.ts` 的 inbox 监听里加 `openPlay`：玩家的第一条消息到达时，把剧目的 `opening`
补进同一轮，并登记 `InjectedMessages`（与「继续」「追收束」同一口径：它不是玩家说的话，
摆上时间线就是替玩家编了一句台词）。

三条约束，两条是踩出来的：

1. **判据是「这条会话还没有任何模型可见的历史」**（`session.surface.nodes.length === 0`），
   不是进程内状态：重启后恢复的会话带着整份日志，不会因为内存丢了就再补一次。
   玩家自己逐字说了 `opening` 那句也不补——同一轮里同一句话出现两次，剧作家会把第一轮演两遍。
2. **必须投进 `next-step`（`agent.inject`），不能 `followup`**：一轮开始时宿主只从 `next-turn`
   认领**一条**消息（`claim` 里那一格的 deleteCount 就是 1）。第一版用 `followup`，e2e 当场抓到
   开局指令没进第一个请求——它会落到第二轮，正是「演完第一轮又无端演一遍」。`next-step` 整批认领、
   且排在下一轮那条之前，于是它与玩家的第一句落在**同一个请求**里，开局指令还在前面
   （实测 seq：开局指令 11 < 玩家消息 12 < 首轮 `request/header` 15）。
3. **同一条同步链上投**：宿主是在 `inbox.splice()` 里发 `agent/inbox/inserted`、之后才唤醒驱动器，
   所以此刻补进去的这条赶得上同一轮的第一步。读剧目也因此用同步版 `loadPlaySync`——
   异步读一趟回来，驱动器已经起了。

「开演」按钮原样保留：它仍然发 `opening`，只是 DSH 的会话形状让它够不着（不删是用户的决定）。

## 验证

新增 `e2e/verify-opening.mjs`，挂在 `stage` 模块下（`dsh-e2e run e2e/run.mjs stage` 会带上它）：

| 用例 | 断言 | 结果 |
| --- | --- | --- |
| T0 | 会话建起来了 | ✓ |
| T1 | 第一轮 `request/header` 落进日志那一刻，日志里已有一条正文等于 `opening` 的 `user/message`，且 seq 在 header 之前 | ✓（seq 11 < 15） |
| T2 | 中枢里 `player_input` 恰好一条（玩家自己那句），补送的那条没落成台词 | ✓ |
| T3a | 第二个会话（引擎自己投第一条）建起来了 | ✓ |
| T3 | 引擎自己投的第一条（`silent`，舞台的「继续」走这条）不触发补送 | ✓ |

同一次改动后 `stage` 模块两个套件全绿：`verify-stage` 14 项 + `verify-opening` 5 项，模块 2/2。
`verify-stage` 的第一句用的就是 `PLAY.opening`，正好命中「玩家自己说了那句」的分支，
行为与改动前一致——这也是这条改动没有波及演出闭环的原因。

## 文档

README 的中英文 `opening` 行与「怎么开始」那一步都改了。顺带改掉一处早就写错的：
原文说「舞台上的开演**和继续**发给剧作家的就是它」——继续发的是引擎的固定舞台指示
（`stage-view.tsx` 的 `CONTINUE`），不是 `opening`。
