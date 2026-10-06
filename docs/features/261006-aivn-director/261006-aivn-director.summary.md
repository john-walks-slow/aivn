# 小结：导演工具栏 / 进行中浮层 / 舞台重投影（2026-10-06）

## 交付了什么

| 需求 | 落点 |
| --- | --- |
| 导演栏的**提示 / 改写 / 重写** | 舞台右上角三格（生图那一格插件没有落点，用包的新开关 `showGenerate={false}` 关掉）；`POST /aivn/direct` + `src/director.ts` |
| 提示支持**引导（随下一轮）/ 打断** | 包的新 prop `promptAlt="interrupt"` 换掉「分岔」那一岔；引导 = `followup` 排队，打断 = `cancel` + `whenIdle` + 清 steering + `followup` |
| 重试支持**带指令** | `rewrite` 带 `from: 'beat' \| 'line'` 与一句要求；改写从最后一步起、重写从整拍头起 |
| 不做 AIVN 自管分支 | 导演栏里没有分岔；时间旅行走 DSH 原生的 rewind / 在新对话中分支 |
| 与 **rewind / 在新对话中分支** 一致 | `src/stage-log.ts`：会话面是舞台的真相源，替换事件（回退、重写）与新会话无帧时都把帧流整段重投影 |
| pending panel（重点：提示 + 语音） | `src/client/pending-panel.tsx` + `guide` 帧；语音行读 `VoiceDirector.voiceState === 'pending'`；出图 / 配乐不做（插件里是同步工具调用） |

配套：`GuideItem` 队列随 `reset` 帧补回、`InjectedMessages` 按会话分表且查过不销号（重建时还要能认出引擎投过的消息）、《演出契约》第 7 条交代「（导演…」是片场喊话、README 三节用户文档、`e2e/verify-director.mjs`（17 条判据）+ `e2e:director` 脚本、`@aivn/stage` 两处加法 + `.theater-director` 样式归位到包内。

## 验证

- `dsh-e2e run e2e/run.mjs stage`：**14/14**（S6 已改成断言导演栏三格、没有生图）+ `verify-opening` **5/5**。
- `dsh-e2e run e2e/run.mjs director`：**15/17**（D1–D14、D17 通过）。核心链：引导进队列 → 进会话 → **没有**变成玩家台词；改写追加 `surfaceOp.replace` 标记、旧助手消息从会话面消失、舞台收到 `reset` 帧并整段重投影、剧作家重写这一拍；重投影之后帧流继续。D15/D16 见下。
- 检视（reviewer）：**准入**，无阻塞问题。建议 S1（给队列监听加预设守卫）与 S3（面板空态淡出）**不采纳**——队列只由导演动作创建、而那条路由本身只认剧作家会话，加守卫是重复判断；淡出动画属于「没有点名的视觉」。N1（README 里 e2e 套件描述过时）**已采纳并修掉**；N2（长会话重建是同步 CPU）记在下面的「已知边界」里。
- 路由的四道闸与错误分支（`/aivn/direct`）：未知 action → 400 `unknown action: bogus`；`guide` 不给 text → 400 `text is required for this action`；会话不存在 → 404（实测）。
- 真机体验（e2e-tester，报告见 `261006-aivn-director.e2e.md`）：导演栏与台词条是一套视觉；「提示」弹窗两岔清楚；无排队/无语音时右上角**完全不渲染**徽标（没有空壳）；发出引导后徽标即时出现、送出后自动消失；改写重铺是「空一下 → 剧作家落笔 → 新内容」，不会全剧重播。

## 待用户定的那件事：轮尾的「在新对话中分支」是置灰的

需求第 4 条的后半（「在某个选项处分支出新对话」）**今天做不到**，而且**与本次改动无关**：

- 决定性实测（**没有做任何导演动作**，第一拍刚演完的轮尾）：分支键 `aria-disabled="true"`、
  `data-unavailable`，提示文案是「仅可从已完成轮次的最后一条消息分支」。
- 根因在 DSH 客户端的分支门槛：`branchUnavailable = closing === null || latestTranscriptSeq !== closing.finalNode.seq || hasLaterChatNode`，
  其中 `latestTranscriptSeq` 会被这一轮里的**任何 `tool/call`** 抬高。剧作家的每一拍都以
  `beat_done`（工具调用）收尾，于是「本轮最后一条」永远是那次工具调用，而不是模型写的正文 → 一律置灰。
- 顺带纠正 e2e-tester 报告里的归因：它认为是 `rewrite` 追加的导演标记把序号推高了；实测证明第一拍就置灰，与导演标记无关。

选项（这一步影响产品形态与每拍成本，等用户定）：

1. **接受**：轮尾分支在剧作家会话里恒不可用，时间旅行走 `dsh-rewind`。代价：玩家丢掉「在选项处分叉」这条路。
2. **每拍多写一句 `<comment>` 收尾**（提示词一行）：`<comment>` 不产生任何舞台内容，但它是模型正文，
   于是「本轮最后一条」重新变成助手消息 → DSH 原生分支恢复可用。代价：**每一拍多一次 LLM step**
   （只写一行注释，约 2–6 秒 + 少量 token；每拍的步数从 1 变 2）。
3. **把停止点从工具挪进 DSL**（`<stop …/>` 之类，由解析器交给引擎）：根治，但动 `@aivn/core` 与
   `beat_done` 的整个语义，属于另一次需求。
4. **给 DSH 上游提 issue**：请它把「轮尾是工具调用」也算作「已完成轮次的最后一条消息」。

## 已知边界（不是缺陷，写在这里免得后面当成疏漏）

- **改写 / 重写要花一轮 LLM**：AIVN 的改写是原地改脚本行（它有自己的脚本模型）；DSH 这边剧本就是
  剧作家的输出，只能让它重写这一拍——换来的是上下文不会和画面对不上。
- **回退（`dsh-rewind`）没有真跑那个插件**：e2e 实例的 profile 里只装了 dsh-aivn。验的是**同一处接缝**
  （`session/event` 上 `user/message` 的 `surfaceOp.replace` → 重投影），D11/D12 就是这条；`dsh-rewind` 的
  标记走的是同一个口。要真机复验，需要在装了 `dsh-rewind` 的剖面里手动走一次（`.validation.md` 场景 3）。
- **压缩不重投影**：`compact-checkpoint` 也是 `user/message` 替换，但它摘掉的是模型上下文里的中间那段，
  那些戏早就演过了——舞台是演出记录，不该跟着缩水（`isTimeTravel`）。
- **重建时的语音**：只补盘上已经合成过的（内容寻址），不触发新合成；流式那一遍若在行中途停过 700ms
  以上，分句与整段重算不同，那种行重建后就没有配音了。
- **长会话重建是同步的一次性解析**（reviewer N2）：帧数与台词数同阶，今天几十到几百行是毫秒级；
  真出现百轮以上的剧目再考虑分片。
- **进行中浮层的语音行**在 e2e 实例里看不到（实例没配 TTS key，`/aivn/play` 的 `voice` 是 false）——
  这是正确行为（没有语音帧就不显示）；要验它需要真 Fish key（`e2e/verify-voice.mjs` 那套环境）。
