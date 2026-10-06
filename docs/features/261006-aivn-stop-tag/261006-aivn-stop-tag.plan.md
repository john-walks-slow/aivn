# 把停止点从工具挪回 DSL（`<stop …/>`）

日期：2026-10-06 ｜ 仓库：`stage-ai`（`packages/core`）、`dsh-aivn`

## 1. 为什么做

用户在 `261006-aivn-director` 验收里发现：**在某个选项处用 DSH 原生的「在新对话中分支」分不出去**——第一拍刚演完、没做任何导演动作，分支键就已经 `aria-disabled="true"`。

根因不在插件代码，在**轮尾节点的形态**：DSH 的分支判据是「本轮最后一条必须是助手消息」（`latestTranscriptSeq === closing.finalNode.seq`），而剧作家每拍以 `beat_done`（一次真正的工具调用）收束，轮尾落成的是**工具结果**节点，于是判据恒不成立。E2E 里 D15/D16 因此失败（director 17 条过 15）。

四个候选里用户选了**③ 停止点挪进 DSL**：剧作家在剧本正文的末尾写一个 `<stop …/>`，不再调工具。这一轮以助手消息自然结束，分支键随之可用，且**不给每一拍加税**（选项②要多一次 LLM step）。

顺带修掉一个既有缺口：`stage-log.ts` 的重投影只重放 assistant **文本**，工具交出的停止点在回退 / 重写 / 分支重建之后**会消失**。停止点回到文本，重建就自然带上它。

## 2. 语法（`@aivn/core`）

`stop` 回到 `DSL_TAGS`，从 `LEGACY_TAGS` 移出（`option` / `preload_asset` 留在里面）。自闭合，三种写法：

| 写法 | 语义 | IR |
|---|---|---|
| `<stop options="去天台 \| 回家"/>` | 停在选项面板；`\|` 分隔，两端空白去掉，空项丢弃 | `{kind:'stop', stopType:'choice', options:[{text}…]}` |
| `<stop placeholder="想对他说什么？"/>` | 停在自由输入框 | `{kind:'stop', stopType:'free', placeholder}` |
| `<stop/>` | 这一段自然演完，不设停止点 | **不产出事件** |

解析口径（与 `beat_done` 逐条对齐，见 §4）：

- 去掉空白后 `options` 不足两条 → 挂 `malformed_tag` 警告；此时若有 `placeholder` 走 free，否则**不产出事件**（等于自然演完）。
- `options` 与 `placeholder` 同给 → 按 `options` 走，挂警告说明 placeholder 本轮不生效。
- 未知属性忽略（与其它标签同）。

选属性 + `|` 而不是旧形态的 `<stop type="choice"><option>…</option></stop>`：后者要解析器再养一套「标签里套标签、正文要攒到 `</stop>`」的状态机——这正是 `260930-agent-kit` 当初把它挪进工具的理由。属性形态只多一个 `case`，且一轮一行写完，模型侧只有一种形状要记。

## 3. 轮收束：删掉 `beat_done` 与 `beat-guard`

- **`beat_done` 工具删除**。它存在的理由是「文本标签要养状态机」，现在标签只是剧本里的一行，工具没有别的职责了（`concludeTurn()` 也不必再有人调——模型写完就停，轮自然结束）。
- **`beat-guard` 删除**。它追的是「模型忘了把收束写成工具调用」——而历史上最常发生的正是「把 `beat_done` 写成了标签」。标签现在是**正确**写法，这条失败模式整体消失；剩下的「一个 stop 都没写」与「有意自然演完」在文本上不可区分，追它只会把自然收尾也追成一次多余 LLM step。代价是玩家看到一个普通的「继续」卡片——客户端本来就有这条路（`beat_end(no_stop)`）。
- `PlayContext.beatClosed`、`stage-tap` 里为 guard 记的 `hasLines`/`noteLines`、`index.ts` 的装配一并删掉。
- `InjectedMessages` **保留**：它现在只服务开局指令（`openPlay`）与导演指令（`director.ts`）。

## 4. 影响面

| 仓库 | 文件 | 动作 |
|---|---|---|
| stage-ai | `packages/core/src/dsl/spec.ts` | `stop` 进白名单、进 `VOID_TAGS`、退出 `LEGACY_TAGS`；改头部与 LEGACY 注释 |
| stage-ai | `packages/core/src/dsl/parser.ts` | `case "stop"` + `splitStopOptions()`；`option` 仍在 LEGACY |
| stage-ai | `packages/core/test/parser.golden.test.ts` | 旧的 legacy-drop 用例改成新语法 + 新增三种写法与坏载荷用例 |
| stage-ai | `packages/core/src/ws/protocol.ts`、`apps/server/AGENTS.md` | 停止点载荷的出处改成「`<stop>` 标签或 `beat_done` 工具」 |
| dsh-aivn | `src/playwriter/tools/beat-done.ts`、`src/beat-guard.ts` | 删除 |
| dsh-aivn | `src/playwriter/prompt.ts`、`src/craft.ts` | 《结束轮》章与《写作参数》的停止点措辞改成标签 |
| dsh-aivn | `src/index.ts`、`src/preset-tools.ts`、`src/stage-tap.ts`、`src/tools/context.ts`、`src/hub.ts` | 拆 guard / beat_done 的装配与注释 |
| dsh-aivn | `README.md` | 工具表去掉 `beat_done`；停止点的写法与「轮尾是助手消息」的事实对齐 |
| dsh-aivn | `e2e/verify-injection.mjs`、`e2e/verify-stagehand.mjs` | 工具面断言跟着改 |

客户端（`stage-view.tsx` / `@aivn/stage`）**一行不动**：`stop` IR 的两条来路本来就同构。

`@aivn/stage` 抽包分支不动——它不解析 DSL，`script.ts` 早有 `case "stop"`。

## 5. 验证

1. `packages/core` 单测（只跑 `parser.golden.test.ts`）+ `tsc -b` 构建（dsh-aivn 吃的是 `dist`）。
2. dsh-aivn：`npm run build` + `npm run typecheck`。
3. e2e：`dsh-e2e stop` → `start --wait-ready` → `run e2e/run.mjs stage`（真实 LLM 写 `<stop>`，S10 断言选项面板）→ `run e2e/run.mjs director`（**D15/D16 要翻绿**：轮尾是助手消息、分支键可用、子会话重建到同一点）→ `run e2e/run.mjs injection`（工具面断言）。
4. 委托 `e2e-tester` 独立验收分支复现；`reviewer` 检视。

## 6. 风险与边界

- **保证变弱**：原先 `concludeTurn()` 是硬边界，模型调完工具就被封轮；现在「写完就停笔」只是一条提示词约定。若模型在一轮里写两拍，舞台上会出现两个停止点（后一个生效）。
- **选项文本含 `|`** 会被拆成两条选项。选项是短句，实际概率极低；提示词里写「选项里不要出现 `|`」。
- `apps/server`（AIVN 本体）仍走 `beatTool`：这次改的是**解析器**，对它是纯增量（以前被丢弃的 `<stop>` 现在会产出事件，而它的剧本里本来就没有这个标签）。
