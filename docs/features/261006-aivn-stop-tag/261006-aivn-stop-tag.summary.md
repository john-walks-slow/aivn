# 停止点回到 DSL（`<stop …/>`）

日期：2026-10-06 ｜ 仓库：`stage-ai`（`packages/core`）、`dsh-aivn`

## 一句话

剧作家的「这一拍停在哪儿」从一次 `beat_done` 工具调用改回**剧本正文最后一行的一个标签**。
轮尾因此重新是助手消息——DSH 的「在新对话中分支」恢复可用，舞台重建（只重放助手文本）也带得上停止点。

## 为什么

`261006-aivn-director` 验收时发现：**在一个选项处用 DSH 原生的「在新对话中分支」分不出去**。
第一拍刚演完、没做任何导演动作，分支键就已经 `aria-disabled="true"`（提示「仅可从已完成轮次的
最后一条消息分支」）。根因不在插件：DSH 的分支判据要求「本轮最后一条是助手消息」
（`latestTranscriptSeq === closing.finalNode.seq`），而每拍以 `beat_done` 收尾时，轮尾是**工具结果**节点。

四个候选里用户选了「停止点挪进 DSL」：它根治问题且**不给每一拍加税**（选项「每拍多写一句收尾」
要多一次 LLM step）。附带修掉一个既有缺口：重建只重放助手文本，工具交出的停止点在
回退 / 重写 / 分支之后**会消失**。

## 语法与语义

| 写法 | 语义 | IR |
|---|---|---|
| `<stop options="去天台 \| 回家"/>` | 停在选项面板 | `{kind:'stop', stopType:'choice', options:[{text}…]}` |
| `<stop placeholder="想对他说什么？"/>` | 停在自由输入框 | `{kind:'stop', stopType:'free', placeholder}` |
| `<stop/>` | 这一段自然演完，不设停止点 | 不产出事件 |

- 解析口径与旧的 `beat_done` 逐条对齐：去掉空白后 `options` 不足两条 → 挂 `malformed_tag` 告警，
  此时有 `placeholder` 走 free、否则不产出事件；两者同给按 `options` 走并挂告警。
- `stop` 进 `DSL_TAGS` 与 `VOID_TAGS`，退出 `LEGACY_TAGS`；`option`（旧形态的子标签）留在
  `LEGACY_TAGS`，照旧整条吞掉（免得模型把 `<option>回家</option>` 念到舞台上）。
- 客户端（`stage-view.tsx` / `@aivn/stage`）**一行没动**：停止点 IR 的两条来路本来就同构。

## 改了什么

| 仓库 | 文件 | 动作 |
|---|---|---|
| stage-ai | `packages/core/src/dsl/spec.ts`、`parser.ts` | `stop` 回白名单 + `case "stop"` + `splitStopOptions()` |
| stage-ai | `packages/core/test/parser.golden.test.ts` | 旧 legacy 用例改写，新增停止点 8 条（含撕裂喂入、坏载荷） |
| stage-ai | `packages/core/src/ws/protocol.ts`、`apps/server/AGENTS.md`、`apps/server/src/agentkit/beatTool.ts`、`apps/server/src/orchestrator.ts`、`apps/server/test/helpers.ts` | 注释口径：标签与工具两条来路产出同一帧 IR |
| dsh-aivn | `src/playwriter/tools/beat-done.ts`、`src/beat-guard.ts` | **删除**（连同 `PlayContext.beatClosed`、`stage-tap` 的 `hasLines`/`noteLines`、`index.ts`/`preset-tools.ts` 的装配） |
| dsh-aivn | `src/playwriter/prompt.ts`、`src/craft.ts` | 《结束轮》章与《写作参数》改成标签，附「写完就停笔」 |
| dsh-aivn | `README.md` / `README.en.md` / `AGENTS.md`、`src/hub.ts`、`src/stage-log.ts`、`src/injected.ts`、`src/director.ts`、`src/tools/context.ts` | 工具表、停止点说明与注释口径 |
| dsh-aivn | `e2e/verify-injection.mjs`、`e2e/verify-stagehand.mjs` | 工具面断言（不再有 `beat_done`） |
| dsh-aivn | `lib/` | 跟踪的构建产物，已重建 |

净减约 290 行（删 181 行、改 109 行）。

### 为什么连带删掉 `beat-guard`

它追的是「模型忘了把收束写成工具调用」——而历史上最常发生的恰恰是**把 `beat_done` 写成了正文里的
一行标签**。标签现在是正确写法，这条失败模式整体消失；剩下的「一个停止点都没写」与「有意自然演完」
在文本上不可区分，追它只会把自然收尾也追成一次多余 LLM step。代价是玩家看到一个普通的「继续」卡
（客户端本来就有 `no_stop` 这条路）。用户的 AIVN 本体仍保留 `beatTool` + 自己的追收束，两者互不影响。

## 检视结论

`reviewer` 子代理独立检视：**准入**，0 阻塞、0 建议。三个专项（删掉 `beat-guard` 的退化风险、
坏载荷容错取舍、`options` 的 `|` 分隔与引号协议风险）逐条评估为设计自洽。两条非阻塞：
N1（`packages/core/src/dsl/events.ts` 的注释仍说 `stop` 由工具产出）**已修**；N2（`options` 与
`placeholder` 同给且选项不足两条时降级到 free）记在边界里，无需改。

## 验证

| 项 | 结果 |
|---|---|
| `@aivn/core` 单测 | **191/191**（`parser.golden.test.ts` 43 条，含停止点新用例） |
| `@aivn/server` 受影响单测 | **150/150**（`orchestrator` / `agentkit` / `prompt`） |
| `dsh-aivn npm run typecheck` | 通过 |
| e2e `injection` | **16/16**（A13 改为断言没有 `beat_done` 工具） |
| e2e `stage` | **14/14** + `verify-opening` **5/5**：真实 LLM 写出 `<stop options="… \| …"/>`，S10 拿到 4 个选项，S13 第二轮同样交出停止点 |
| e2e `director` | **17/17**（原 15/17）。`分支键：{"found":3,"usable":3,"clicked":true}`，分出 `session-316dd236`，子会话探针 107 帧整段重投影 |
| e2e `stagehand` | **20/20** + `verify-handmade-play` **4/4** |

### 现场证据：模型确实把停止点写在最后一行并停笔

从 e2e 会话日志里取出助手消息原文（`.dsh-e2e-home/sessions/…`），三拍的结尾分别是：

```
…<narrate>她把伞举过头顶。</narrate>
<stop options="站到伞底下 | 问林这把伞是谁的 | 去走廊尽头看那扇门"/>
```

```
…<say id="lin" mood="平静">今天不敲那扇门。你再想一遍，伞是从谁那儿借的。</say>
<stop options="说一个名字 | 说不记得了 | 走过去看那滩水"/>
```

标签之后**没有任何内容**——「写完就停笔」这条提示词约定在真模型上成立，`concludeTurn()` 的硬边界
撤掉之后没有出现续写下一拍的情况。分支出来的子会话（`session-316dd236`）与父会话尾部逐字一致，
证明重建走的是同一份文本。

## 已知边界

- **硬边界变成软约定**：原先 `beat_done` 的 `concludeTurn()` 由工具强制封轮；现在「写完停止点就停笔」
  只是一条提示词约定。真模型实测没越界，但如果模型在一轮里写两拍，舞台上会出现两个停止点（后者生效）。
- **选项文本里不能有 `|` 与英文双引号**：`|` 会被拆成两条选项，双引号会让属性解析失败（整条标签丢弃、
  这一拍没有停止点）。提示词里已明写这一条，并用「」代替引号。
- **坏载荷拿不到回执**：工具时代 `options` 不足两条会拿到报错回执、模型当轮就能改；现在只挂一条
  `malformed_tag` 告警（dsh-aivn 目前不把解析告警回灌给模型）。玩家侧的表现是退回普通「继续」卡。
- **模型可能补一个多余的 `</stop>`**：实测出现过 `<stop …/>` 之后另起一行写 `</stop>`。它被当
  `mismatched_close` 告警丢掉，不影响任何行为（标签自闭合时停止点已经交出）。
- **`apps/server`（AIVN 本体）仍走 `beatTool`**：本次改的是解析器，对它是纯增量——以前被丢弃的
  `<stop>` 现在会产出事件，而它的剧本与提示词里本来就没有这个标签。
