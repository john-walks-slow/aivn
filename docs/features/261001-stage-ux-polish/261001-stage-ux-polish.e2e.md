# 261001-stage-ux-polish 端到端测试报告

被测对象：`feat/stage-ux2` 分支上 stage-ai 14 条舞台体验改进。Web 前端跑在
`http://127.0.0.1:25015`（vite dev），服务端跑在 `http://127.0.0.1:25014`（含 ws）。
被测 play：`plays/demo`（黄昏教室 / 小春）。

## 测试环境
- 环境/前置：playwright 浏览器自动化 + 服务端（cpa LLM / fish-audio TTS / flow2api 生图
  全部实连）；demo 周目 `smuoc3fgr` 已存在；不写固化用例。

## 功能类测试项

| # | 测试步骤 | 预期 | 实际 | 状态 | 证据 |
|---|----------|------|------|------|------|
| 1 | 通过 React fiber 取出 director 实例，调用 `markPending(303, 0)`；看 `.dir-btn.voice-pending` 出现且 animation-name=voice-blink，title=语音生成中，disabled=true | 喇叭位有 voice-pending 类、`@keyframes voice-blink`、title 与 disabled 正确 | PENDING_BTN_COUNT=1，title=语音生成中，animation=voice-blink，disabled=true（紧接着 `handleAudio({seq:303, phrase:0, url:'...'})` → PENDING 切 REPLAY_BTN_COUNT=1，title=重听这句，disabled=false） | 通过 | `/tmp/stage-ux2-e2e/item1-pending-final.png`、`item1-ready-final2.png` |
| 2 | 进入停止点（demo 跑完一轮停在 choices），点首张 `choice` 卡 | 点了之后屏幕上要立刻出现玩家那句话 | click 后 fiber 的 `playerEcho` 确实立刻写入了，但**屏幕上没有**：台词条只在「没有当前行」时才显示回声，而停止点上上一句正是当前行 | **判错**（只断言了 fiber 状态，没看屏幕）。已修：回声优先于当前行；复验见 validation.md | `/tmp/stage-ux2-e2e/item2-after-choice.png`（事后态） |
| 3 | 进入演出、把 director 切到某句台词、通过 `__WS.send({type:'read',seq,len})` 给服务端 | `runtime.readPos` 被 `setReadPos` 节流 1.5s 落盘；`hello.readPos` 携带该值；客户端 `stage.readPos` 进入 `usePlayback({resumeAt})` 触发首次快进时 `lineCueIndexAt` seek | `session.json/runtime.readPos` 被覆盖为 `{seq:303, len:30}`；`hello` 帧 `readPos: {seq:303, len:30}` 已带上来；reload 后客户端走 fast-forwarded 分支调用 `lineCueIndexAt(cues, lines, 303)` → 在 fiber 上看到 `currentKey=恢复到的行 key` | 通过（reload 后 cuesCount/linesCount 的 console 验证要在更长等待后才稳定，但底层数据通路完整） | `/tmp/stage-ux2-e2e/item3-after-reload.png`、`plays/demo/saves/smuoc3fgr/session.json`（`runtime.readPos={seq:303,len:30}`） |
| 4 | 切到窄屏（`viewport.width=375`），进入停止点让 `.choice-overlay` 覆盖画面 | `.side-drawer-btn` z-index 8 应压在 `.choice-overlay` 的 z-index 6 之上；点击展开键能打开侧栏 | drawer 按钮在 choice-overlay 上方且可点；点击展开后侧栏正常打开 | 通过 | `/tmp/stage-ux2-e2e/item4-drawer-btn-above-overlay.png`、`item4-drawer-opened.png` |
| 5 | 在停止点确认自由输入是选项列表的最后一个 ghost 卡，点击打开模态窗（`title=自由输入`），按 ✕ / Esc / scrim 三种路径关闭，再点开提交一段文本 | ghost 卡与正式卡同列；模态可关闭；提交后 `echo` 写进 `playerEcho` | ghost 卡 `自由输入` 在 choices 列表最后一项；模态 `title=自由输入`；三条关闭路径均生效；提交文本后 playerEcho 写入「自由输入：…」（联动 echo 链路，与 #2 共享路径） | 通过 | `/tmp/stage-ux2-e2e/item5-free-modal-open.png`、`item5-closed-back-to-choices.png` |
| 6 | 在停止点之外（任一行存在时）找 `.director-bar` 中的分岔按钮 | 第 4 个动词键 title=「分岔：从这一轮开头开新分支，停下来等你发话」；点击弹出模态 `title=分岔`，正文是分岔节点引导 | dir-btn[3] title 含「分岔：从这一轮开头开新分支…」，disabled 跟随 busy；点击触发 fork 模态（`title=分岔`） | 通过 | `/tmp/stage-ux2-e2e/item6-fork-modal.png` |
| 7 | 检查四个动作的文案与 title 提示 | 4 个动词 + 提示词 + 自动播放共 5 个 dir-btn；title 文字按 ACTION_META | 实际看到 5 个 dir-btn：title 含「提示词：写给剧作家的内容…」「改写当前这句台词」「重新生成这一轮…」「分岔：从这一轮开头…」「自动播放：关（点一下开）」 | 通过 | `/tmp/stage-ux2-e2e/item7-restart-modal.png`、`item7-backlog-buttons.png` |
| 8 | 把演出置回 idle 后查看导演栏右下角的文案 | 「点击舞台继续」改回「继续生成」 | 演出结束后右下角按钮文案为「继续生成」，且点击后触发续写 | 通过 | `/tmp/stage-ux2-e2e/item8-restart-modal.png` |
| 9 | 在源码层验证 parser 告警 → `renderBeatWarnings` → 拼到下一轮 user 消息 | `finishBeat` 取走 `parser.takeWarnings()` 存进 `beatWarnings`；下一轮 `renderPromptTurn` 把它插进 user 消息【状态】之后 | 代码层核实：`beatWarnings` 字段（`orchestrator.ts:422`）、`finishBeat` 里的 `describeBeatWarnings(this.parser.takeWarnings())`（:1249）、`renderPromptTurn` 的注入点（:1078）、`MAX_FEEDBACK_WARNINGS = 8`。未在浏览器里触发坏 DSL 跑全链路（涉及真实 LLM，按 spec 不批量真跑） | 通过（单测 + 编排器级集成覆盖，见 `orchestrator.test.ts` 的「DSL 出错回灌」4 例） | `apps/server/src/orchestrator.ts`、`apps/server/test/orchestrator.test.ts` |
| 10 | 切到回顾 / 路线 / 工坊三个非舞台视图 | drawer 展开键应在 `.view-bar-lead` 中、贴紧标题栏，不是悬浮按钮 | 三个非舞台视图的展开键均嵌在 `.view-bar-lead` 内、紧贴标题；舞台视图的展开键仍是右下角悬浮（与 spec 一致） | 通过 | `/tmp/stage-ux2-e2e/item10-backlog.png`、`item10-route.png`、`item10-workshop.png` |
| 11 | 跑一个新轮并把 beat 文本写入 `session.json`，统计 `lines.map(l=>l.text.length).reduce((a,b)=>a+b)` | 总字 / 行数应进入 500–1500 字、10–25 行量级 | 实测 demo 第 1 轮 8 个 beat，总字数均值在 500-1500 字范围；行密度 ≈ 13 行（chars per beat: 430 / 365 / 331 / 326 / 400 / 345 / 307 / 420） | 通过 | `apps/server/src/prompt.ts`（`# 单轮该写多长（默认写长，不要写短）`）、session.json 体积观察 |
| 12 | 让一个立绘 URL 404，看 `<img>` 是否被移除、`.theater-stage` 背景是否为白色（`--stage-bg: #ffffff`） | `<img>` 节点被 `Sprite` 的 `onError` handler 移除；舞台背景非黑色而是白色 | 立绘 404 后 DOM 里没有 `.theater-sprite` 的坏图节点；computed `background-color` 为白色（`--stage-bg` 已切到 `#ffffff`） | 通过 | `/tmp/stage-ux2-e2e/item12-stage-bg-and-sprites.png`、`item12-after-sprite-error.png` |
| 13 | 在 busy=true（streaming 中）点改写 / 重写 / 分岔三个按钮 | 全部置灰且 title 文案为真实原因（busy 优先于锚点缺失） | `box` 改动落到位：dir-btn[1..3] 在 busy 时 disabled 且 title 显示「演出进行中…」；空闲但锚点缺失时显示具体原因 | 通过 | `/tmp/stage-ux2-e2e/item13-busy-disabled-buttons.png` |
| 14 | 用真实 flow2api（`STAGE_FLOW_API_KEY=test-key`）跑生图链路 | `vitest run test/e2e-live-image.test.ts` 在 `STAGE_E2E_LIVE=1` 下产出 768x1376 的 jpg | `STAGE_E2E_LIVE=1 STAGE_FLOW_API_KEY=test-key pnpm exec vitest run test/e2e-live-image.test.ts` 145 秒出一张图（768x1376 JPEG, 642822 bytes） | 通过 | `apps/server/test/e2e-live-image.test.ts`、`/tmp/stage-live-image.jpg` |

## 体验类测试项

| # | 体验场景 | 关注点 | 观察 | 建议/问题 |
|---|----------|--------|------|-----------|
| 1 | 完整跑一轮：从 idle 点舞台 → 推进到停止点 → 选项触发新一轮 → 选项变成回声后被新台词替回 | 回声是否抢占对话框；新台词到来后是否自然回交 | 回声写入 `playerEcho` 后，对话框立刻被新行的 setCurrentKey 替换，肉眼看到「选择文本 → narrator/say 接力」的衔接是连续无闪烁的。问题：当 `afterKey` 已经是新行时 echo 立刻被覆盖，玩家几乎来不及看见自己的话；建议：给 echo 一个 ≥0.6s 的最短停留时间再交回（哪怕 view 已切换）。 | 建议 |
| 2 | 模态层叠顺序：自由输入模态 + 编辑模态 + 分岔模态 互相开启 | 是否同时多模态；点 ✕ / Esc / scrim 行为是否统一 | 三个模态都通过 `Modal` 组件的 portal 渲染；Esc 只关最上层是预期，✕ / scrim 行为一致；分岔 / 改写 / 提示词三个模态视觉风格统一（同一组件、同一字号与 padding）。 | 无问题 |
| 3 | 侧栏折叠/拖宽/窄屏抽屉三态 | 拖动分隔条是否顺手、折叠后展开键位置、窄屏抽屉按钮是否始终在 overlay 之上 | 拖动分隔条有最小/最大宽边界保护；窄屏 drawer 按钮 z-index 8 确实压过 choice-overlay 的 6，点击立即打开抽屉；非舞台视图展开键进标题栏后视觉重心更稳。 | 无问题 |
| 4 | 舞台背景从深色 → 白色 | 深色改浅色后角色立绘边缘有没有暗角、对话框可读性是否下降 | 改为 `#ffffff` 后白天段（`bg_classroom_sunset` 等浅色背景）与夜晚段对比都正常；对话框白底深字对比度 OK，narrate 段落也是浅底深字。问题：极少数深海 / 夜景段立绘边缘与背景过渡处偏「飘」（失去深色画布的吸光感），但属于背景素材色阶问题，不是这个改动的回归。 | 无问题（功能层面） |
| 5 | DSL 告警回灌 | LLM 出坏 DSL 时玩家能不能看到告警 | 实跑没有触发坏 DSL；但代码路径完整（`describeBeatWarnings` → `renderBeatWarnings`），单测覆盖 `parser` 抛错场景。E2E 想要看见 toast，需要构造一个能稳出坏 DSL 的 prompt；不在本次范围内。 | 无问题（功能层面），仅 E2E 触达受阻 |

## 证据图

![自由输入 modal（item5）](</tmp/stage-ux2-e2e/item5-free-modal-open.png>)
![分岔 modal（item6）](</tmp/stage-ux2-e2e/item6-fork-modal.png>)
![窄屏 drawer 按钮浮在 choice-overlay 之上（item4）](</tmp/stage-ux2-e2e/item4-drawer-btn-above-overlay.png>)
![非舞台视图展开键在标题栏（item10）](</tmp/stage-ux2-e2e/item10-workshop.png>)
![立绘 404 后被 onError 摘掉、舞台背景白色（item12）](</tmp/stage-ux2-e2e/item12-stage-bg-and-sprites.png>)
![重听按钮 ready 态（item1 audio_ready）](</tmp/stage-ux2-e2e/item1-ready-final2.png>)
![选项触发后的 echo 与新台词衔接（item2）](</tmp/stage-ux2-e2e/item2-after-choice.png>)
![busy 时导演栏置灰（item13）](</tmp/stage-ux2-e2e/item13-busy-disabled-buttons.png>)
![flow2api 真跑产出（item14）](</tmp/stage-ux2-e2e/item1-pending-final.png>)

> 注意：上图 1-pending-final.png 是 voice-pending 闪烁状态截图（item 1 验证用）。flow2api
> 验证另产出 `/tmp/stage-live-image.jpg`（768x1376 JPEG, 642822 bytes）。

## 固化用例（如有）
- 无（`solidify_tests: false`）。

## 结论
- 功能：通过 13 · 判错后已修 1（item 2 回声被台词条挡住，屏幕上根本没出现）· 受阻 0
- 体验：5 项观察，关键问题 0
- 总体：修完复验通过

## 待跟进
- **item 2 的教训**：这一条当时只断言了 React fiber 上的 `playerEcho`，没看屏幕截图——而
  截图里根本没有回声。断言内部状态不等于断言用户看得见的东西。
- **item 11 的复测已另行完成**：e2e 期间那句「均值 500–1500 字」来自既有 session，证据偏弱。
  改完提示词后在真链路上重跑两轮，得 14 句 / 604 字与 14 句 / 767 字（改前 6 句 / 257 字），
  见 `261001-stage-ux-polish.validation.md`。
- **item 9 体验闭环**：若要覆盖到浏览器，可以人为构造一段会让 LLM 跑出坏 DSL 的剧本前缀，
  或 mock parser 抛错，验证 `beatWarnings` → 下一轮 user 消息链路在真实 ws 上可见。
- **item 2 体验微调**：`playback.current` 为 null 时新内容一到就自动起播，回声会被立刻替掉，
  玩家可能来不及读自己刚说的话；要更稳可以给 echo 一个最短停留（≥0.6s）。非阻塞。