# choice-echo：玩家输入升格为一等舞台事件

## 问题

停止点上玩家选完选项/交完自由输入后，客户端用本地「回声」state（`（选择了：X）` + afterKey 播放头判等）乐观顶在对话框里，等服务端谱系轮询追上。三层补丁叠仓（core 重放丢 prompt、transcript 双源合并、回声乐观占位）带来三个 bug：

- **A（可静态证明）**：回声窗口内滚轮回看被冻住——dialogContent 回声优先级最高，scrub 只动 scrubIndex 不动 playback.current.key。
- **B（理论态）**：被拒动作留下说谎回声。
- **C（瞬态）**：首句进场后到谱系拉取前，输入全屏消失。

诊断全文见 [261004-choice-echo.troubleshoot.md](261004-choice-echo.troubleshoot.md)。

## 方案（用户确认：事件化重构）

player_input 成为一等舞台事件，删掉整个回声层：

- **core**：`StageEvent` 加 `{ kind: "player_input"; text }`；`lineageToEvents` 把 prompt 节点重放成 player_input 事件；prompt 节点视图暴露 seq（老档没有）。
- **server**：`playerAction` 三条 prompt 落谱系路径改走 `onStageEvent`——与 stop/preload_asset 同一条事件管道（加 seq → 广播 → 落谱系带 seq）。**player_input 先于 beat_start 广播**，这是客户端回执即时性的时序基础。NSFW 打标不变（noteBeatInputs 先于事件发出）。
- **web**：player_input 落进缓冲就是普通一行（type `"input"`、整行显示不走打字机）；transcript 按 seq 认回谱系 prompt 节点（老档无 seq 按路径顺序+同文本对回）；`shouldAutoStart` 的回执例外保证「选完立刻看见」——不等 `live`/`auto`（player_input 到达时 state 还停在 stopped、Auto 模式的读速节奏都不拦自己的话），只让语音 hold 与「当前行已读完」把关。删除 StageScreen/StageTheater 的 echo/afterKey/dismissEcho/sendChoice/sendFree 整层。

## 检视与修正

首轮检视（[261004-choice-echo.review.md](261004-choice-echo.review.md)）不准入，修复：

- **BLK-01**：shouldAutoStart 原把 `!live || auto` 放在回执例外之前，服务端「player_input 先于 beat_start」的时序优化在客户端完全失效（停止态回执不起播、Auto 模式吃 2~3 秒读速延迟）；首版 playerReceipt 测试人为传 `live={true}` 掩盖了真实时序。已重排门禁并按真实时序重写测试。
- **SUG-01**：fromView 里 seq 命中的缓冲行未移出老档兜底池，后续同文本无 seq 节点会二次认领（同 key 双条）。已在命中时 splice 移出。
- **NT-01/NT-02**：陈旧注释两处；lineEntry 兜底缺 nameOverride。已修。
- **复核补充**：`beatAtLine` 原靠「输入无 seq」碰巧置灰；新管线 input 行带 seq 且排在两轮之间，会错锚前一轮（回顾工具栏重写按钮误亮）。已加 kind 守卫恒 null。

## 测试

core 159 过；server 668 过（e2e-live 门控跳过）；web 200 过（30 文件）；三包 typecheck 过。新增/重写用例覆盖：重放含 player_input 与老档顺序编号、闭环广播序（player_input 先于 beat_start）、缓冲即时可见、seq 认回不重复、老档位置去重、seq 认走后兜底池不再二次认领、回执门禁（live=false / auto=true / hold / 空对话区）、回执真实时序起播与 Auto 模式即时性、input 行不锚轮。

## 验证

用户实机验证项见 [261004-choice-echo.validation.md](261004-choice-echo.validation.md)，核心场景：选完立刻见回执、生成等待期滚轮回看不冻、被拒动作无回声、刷新/第二客户端重放一致、老档继续演出不重复。
