# 261004-choice-echo —— 选肢回声（「（选择了：X）」）的通用性问题

## 现象与疑问

用户提问：选项处对刚做的选择有没有特殊处理（立刻展示）？实现是否不通用、是否引入了 bug？

结论：有——「回声」机制（commit 0873476，stage-ux-polish 第 3 条），且用户的两个感觉都对：实现是三层层叠的补丁，并存在一个可静态证明的交互 bug（回看被回声冻住）。

## 现状链路

- 客户端 `StageScreen.tsx:372-391`：点选项/交自由输入 → 本地 state `echo = { text: "（选择了：X）", afterKey: 当前行的 key }`。
- 显示条件 `echoText = echo && playback.current?.key === echo.afterKey`——播放头还停在选择那一刻的行上就显示，`dialogContent`（playbackState.ts:47）里它优先级最高，压过当前行与回看行。
- 撤销：播放头换行（新一轮首句进场）或玩家点舞台（`onStageClick` 的 playerEcho 分支）。
- 服务端 `orchestrator.ts:853-863`：choice 兑现成 `（选择了：${option.text}）`，在 `deliverPrompts`（:996-1015）里**发送时即刻**落谱系 prompt 节点——但**不广播为舞台事件**（`replay.ts:140-142`：player/ooc/beat_end 是元信息，`lineageToEvents` 丢弃）。
- 客户端事件缓冲里因此永远没有玩家输入；`transcript.ts` 靠「谱系 path ∪ 缓冲尾」双轨合并补齐。

## 根因

玩家输入不是舞台事件，只活在谱系里；谱系又是按需轮询（舞台视图生成中连轮询都停，StageScreen.tsx:400-404）。于是客户端需要三层补偿：

1. transcript 双源合并（谱系 + withFreshTail）；
2. 回声（本地乐观占位，桥谱系延迟）；
3. 撤销判据借用无关信号（播放头 key 相等）——正是 playbackState.ts 头注释自己警告过的「用间接状态反推」。

另有一处双写：「（选择了：X）」格式在客户端（StageScreen:379）与服务端（orchestrator:863）各拼一遍，靠人肉保持一致（谱系条目文本要与回声一致，回看接管时才不跳字）。

## 引入的 bug

- **A（可静态证明）回看被回声冻住**：回声窗口 = 从点选项到播放头换行（生成期间整段，手动模式可长达几十秒）。期间滚轮回看只改 `scrubIndex`，`playback.current.key` 不动 → `echoText` 仍非空 → `dialogContent` 回声优先级最高，对话框冻结在「（选择了：X）」，回看的行不进对话框（脚注「回看中」照常亮，StageScreen:608 也确实把选肢卡收了——作者考虑了回看 vs 选肢卡，漏了回看 vs 回声）。
- **B（理论态）被拒动作留下说谎的回声**：回声在服务端接受**之前**就设置。`case "error"`（useStageSocket.ts:306）只 setError 不清 echo；「演出进行中」竞态/停止点过期时，界面上留着一句没发出去的「（选择了：B）」。
- **C（瞬态）输入窗口期全屏消失**：播放头换行后、下一次谱系拉取前，输入在对话框（换行了）、回顾/日志（transcript 还没有 prompt 条目）都查无此人；生成中谱系不轮询，切到回顾视图才 ≤2.5s 内补上。刷新页面时本地回声直接丢，同样要等首次谱系拉取。
- 隐患：echo 状态隐藏后从不清除，可见性纯由「当前行 === 锚行」判等。今天 key 是 `l${++lineSeq}` 单调不回访所以不炸；任何让播放头复用 key 的改动（如 seek 实现复用行实例）都会让陈年回声复活。

## 修复路径

### 路径一：事件化重构（推荐）

把玩家输入升格为一等舞台事件，删掉整个回声层：

- core：`StageEvent` 加 `{ kind: "player_input"; text }`；`lineageToEvents` 把 prompt 节点转为该事件（替换 default 丢弃）；谱系 prompt 节点携带事件 seq（今天没有），让 transcript 的双轨合并退化成按 seq 单轨对齐。
- server：`deliverPrompts`/开场路径在 `appendLineage("prompt")` 同一处 `emitStageEvent`——与 beat_done 产出 stop 事件同一模式；「（选择了：X）」只剩服务端一处。
- web：ScriptBuilder 给 `player_input` 建行（type "input"，全文一次到位）；回看/回顾/重连/第二客户端全部复用现有行管线。唯一要保住的交互不变量：停止点上选择后**立刻看见**——头此刻必然 lineDone+exhausted，input 行入队即消费显示即可。
- 删除：echo/afterKey/dismissEcho/echoText、dialogContent 的 playerEcho 分支、StageTheater 的 playerEcho props、onStageClick 回声分支。

收益：A/B/C 全消（B 的关键是事件由服务端在**接受之后**发出）；格式单点化；transcript 合并简化。

### 路径二：定点补丁

- A：`echoText` 判等加 `&& !playback.scrubbed`。
- B：`stage.error` 变化时清 echo。
- C：发送成功后立刻 `reloadLineage()` 一次。

三行级修复，但每一条都在给间接机制再叠条件，双写格式仍在。

## 置信度

- 现状链路描述：高（全部读码核实）。
- Bug A：高（静态可证，未跑组件级复现——回声/回看均无既有组件测试）。
- Bug B/C：中（机制成立，触发窗口窄/瞬态）。

## 验收标准（走路径一时）

- 选完选项：对话框立刻显示「（选择了：X）」，新一轮首句进场后让位（与现状一致）。
- 回声等待期间滚轮回看：对话框跟随显示回看行（A 修复）。
- 回顾/日志视图：选择落下后 0 延迟可见，不等谱系轮询（C 修复）。
- 刷新页面/第二客户端开同一剧目：输入行经事件重放可见。
- 服务端拒绝动作：对话框不出现对应回声（B 修复）。
- 回归：`transcript.test.ts` / `beats.test.ts` / core replay 用例全绿；新增 player_input 事件的重放一致性用例。
