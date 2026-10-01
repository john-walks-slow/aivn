# 验证：舞台体验一轮收口（14 条）

> 环境：worktree `.worktrees/stage-ux2`（分支 `feat/stage-ux2`），`.env` 软链到主仓库。
> 实例：api `127.0.0.1:25000`、web `127.0.0.1:25001`（vite dev）、公网隧道随 web 端口。
> 剧目：`plays/demo`（黄昏教室 / 小春，周目 `smuoc3fgr`）。
> 真链路：cpa 网关 `127.0.0.1:9999` 出剧本、fish-audio 出语音、flow2api `127.0.0.1:38000` 出图。

## 自动检查

| 项 | 命令 | 结果 |
| --- | --- | --- |
| 类型（三包） | `pnpm --filter @stage-ai/core build && pnpm -r typecheck` | 通过 |
| core 单测 | `pnpm --filter @stage-ai/core test` | 102 passed（7 文件） |
| web 单测 | `pnpm --filter @stage-ai/web test` | 69 passed（10 文件） |
| server 单测 | `pnpm --filter @stage-ai/server test` | 284 passed / 3 skipped（26 文件） |

新增用例：
- `packages/core/test/parser.golden.test.ts`「告警是一次性投递」3 例（`takeWarnings` 取走即清空、跨 `resetBeat` 仍在、干净轮取空表）
- `apps/server/test/orchestrator.test.ts`「DSL 出错回灌」4 例 + 「阅读位置落盘」3 例
- `apps/web/test/resumeSeek.test.ts` 4 例（`lineCueIndexAt` 命中 / 找不到 / cue 与行对不上 / 无 seq 布景行）
- `apps/server/test/prompt.test.ts` 2 例（单轮长度是硬要求、默认口径不再钉死 3~8 行）

## 14 条逐条实测

| # | 期望 | 实测证据 |
| --- | --- | --- |
| 1 | 语音合成中有闪烁喇叭，音频到了就换回可重听 | `markPending(seq,phrase)` 后 `.dir-btn.voice-pending` 出现，`animation-name=voice-blink`、`title=语音生成中`、`disabled=true`；`handleAudio` 到达后立刻切回 `title=重听这句`、`disabled=false` |
| 2 | 选项 / 自由发言发完立刻显示成消息 | 点选肢卡 250ms 后台词条名牌 = **你**、正文 = `（选择了："…"）`；点一下舞台即让位给接下来的内容。**这一条 e2e 时判错了**：当时是读 React fiber 断言 `playerEcho` 已写入，没看图——台词条的两处渲染写的是「有当前行就显示当前行，没有才轮到回声」，而选肢停止点上上一句正是当前行，所以屏幕上根本看不到回声。已改成回声优先 |
| 3 | 刷新回到上次读到的那一句 | 客户端 WS 上行 `{type:"read"}` → 服务端 `setReadPos` 节流落盘 → `session.json` 的 `runtime.readPos` 写实 → 重连 `hello.readPos` 带同一值 → `usePlayback` 首次快进按 `lineCueIndexAt` seek 回那一行并接着上次字数继续打 |
| 4 | 选项遮罩不挡 sidebar 展开键 | `.side-drawer-btn` 的 `z-index` 从 3 提到 8，压过 `.choice-overlay` 的 6；窄屏下选项摆着时点展开键仍能开抽屉 |
| 5 | 自由输入是选项的一种，modal 可关 | 选项列表末尾多一张 ghost 卡「自由输入」；DSL 直接给 `free` 停止点时列表也只有它一张。点它才弹 modal，`✕` / `Esc` / 遮罩三条路径都能关，关掉回到列表 |
| 6 | 对话框里有分岔 | 导演栏第 4 个动词键 `title=分岔：从这一轮开头开新分支，停下来等你发话`，弹出的 modal 里可填第一句话，填了就直接开新一轮 |
| 7 | 文案改技术表述 | 「插一句」→「提示词」（hint 明说演出中会排队）；「重来」/「重演这一轮」→「重新生成这一轮」；四个动词的 title/hint/占位/提交文案集中在 `ACTION_META` 一处 |
| 8 | 「点击舞台继续」→「继续生成」 | 轮收束时对话框右下角显示「点击舞台继续生成」，点了确实开新一轮 |
| 9 | 模型输出不合 DSL 时回灌给模型 | `finishBeat` 在 `resetBeat()` 之前 `parser.takeWarnings()`，经 `describeBeatWarnings`（英文枚举名 → 中文症状、去重、上限 8 条）在下一轮 user 消息的【状态】之后插一段「【上一轮输出的问题】」。四个 server 用例走真实编排器 + 真实 parser 验证 |
| 10 | 非舞台页的展开键进标题栏 | 回顾 / 路线 / 工坊三视图的展开键都在 `.view-bar-lead` 里、贴在标题左边（`position: static`）；舞台页仍浮在画面左上角 |
| 11 | 每轮变长 | 真跑两轮：14 句 / 604 字、14 句 / 767 字（改前实测 6 句 / 257 字）。病根是 `DEFAULT_CRAFT` 里「一轮 3~8 行台词为宜」，已改成 10~25 句；系统提示词加「单轮该写多长」小节，并在**不可改的演出契约**里再钉一条「一轮至少 10 句」——口径文件是用户可改的，长度规则不能只写在那里 |
| 12 | 没立绘不显示、没背景显白 | `Sprite` 给 `<img>` 加 `onError`，加载失败即退场，DOM 里不留浏览器裂图；`--stage-bg` 从 `#0d0d10` 改为 `#ffffff` |
| 13 | 编辑 / 重新生成 / 分岔的置灰有真实理由 | 三个键的 title 改为按 `busy → 锚点缺失` 分级说明：「演出进行中，暂时不能改写」优先于「这里没有剧作家的台词可改」。busy 时实测三者 disabled 且 title 是真实原因 |
| 14 | 生图接上本机 flow2api 并跑通 | `STAGE_E2E_LIVE=1 STAGE_FLOW_API_KEY=… npx vitest run test/e2e-live-image.test.ts` → 145s 出图，768×1376 JPEG / 642822 bytes。`.env` 已切 `STAGE_IMAGE_BACKEND=flow2api` |

## 关键回归场景

- **分岔 / 跳转 / 编辑之后刷新**：这些操作会让缓冲整段重放、epoch 自增。`readPos` 里的 seq 属于旧分支，客户端此时必须退回「快进到末尾」的老行为而不是卡在空处——`lineCueIndexAt` 找不到即返回 -1，服务端 `hello` 也会在 `restamped || switched` 时清掉 `readPos`。
- **打完整轮刷新**：阅读位置只在「正在显示的那一行」上报，回看（scrub）不改播放头，也就不会把回看位置存成「读到哪儿了」。
- **语音总开关关掉**：`voiceState` 一律返回 `none`——那时候不是「没配音」，是不要配音。

## 已知限制

- **flow2api 只支持 16:9 / 9:16**：3:4 与 4:3 会被上游静默改成横图且**不报错**（见 `flowImage.ts` 注释里的实测记录）。需要竖版以外画幅时暂时没有出路。
- **demo 剧目自带的 `memory/always/craft.md` 会和长度规则拉扯**。它写着「节奏：日常对话两三句一转折……一拍结尾留钩子」，是逐剧创作口径，优先级高于系统提示词里的一般性建议。已在系统提示词里写明「口径里的节奏/每拍说的是文风与内容取舍，不是长度上限」，实测两轮都进了目标区间；但如果后面又写短了，先看这个文件。
- **`apps/server/test/image.test.ts` 的并发 flake 仍在**（用 10ms sleep 等 manifest 落盘），与本次改动无关，`ImageAssets.flush()` 可替。

## 用户验收要点

- [ ] 语音生成中喇叭在闪，音频到了自动变成可重听
- [ ] 点了选项 / 说完自由输入，对话框立刻出现自己那句话；点一下才继续生成
- [ ] 读到一半刷新，停在原处（不是跳到本轮末尾）
- [ ] 选项摆着的时候，左上角导航键仍能点开侧栏
- [ ] 自由输入：点「自由输入」卡才弹窗，弹窗能关，关掉还能选
- [ ] 导演栏四个动词的文案与行为符合预期
- [ ] 每轮长度明显变长（不再是三五句就收）
- [ ] 没配背景时舞台是白底，没配立绘时是空的（没有裂图）

## 未覆盖

- **#9 的真模型链路**：没有构造一段能稳定让模型输出坏 DSL 的剧目前缀，所以「模型真的写了散文 → 玩家侧看到效果」这一段只在编排器级别（真实 parser + 真实 user 消息）验证过，没跑到浏览器里。
- **#1 的合成失败路径**：TTS 失败时服务端只打一行 warn、不回消息，客户端靠 45s 上界熄灯。这条上界没在真机上等到过一次超时。
- **#14 的 9:16 之外画幅**：如上，flow2api 本身不支持，未验证。
