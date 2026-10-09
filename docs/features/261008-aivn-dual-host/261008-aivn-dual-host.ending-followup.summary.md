# dsh-aivn 结局接线跟进 · 小结

> 前置：stage-ai 的 `261008-ending-archive/`（`<ending>` 退化为纯归档标签那一半）。
> 本文件记的是**交出给 dsh-aivn 的那一半**如何落地。
> 提交：`dsh-aivn` 的 `e7e9868`。

## 这是什么问题

2026-10-08，stage-ai 的 `c5b32fce` 把 `<ending>` 从「自带画面的结局卡」改成**纯归档标签**：
删了 `<epilogue>` 标签、三个 `epilogue_*` IR 事件、`packages/stage` 的 `EndingCard` 组件与 CSS；
`EndingAttrs` 的 `title` 改名 `name`、新增 `summary`，四个字段**全部只用于归档、一条都不上屏**。

那次提交把 dsh-aivn 侧的跟进交了出去（`261008-ending-archive.summary.md` 的「遗留 / 交接到
dsh-aivn 任务」、`review.md` 的 A1 条都写明了），但**那个任务没启动**。后果在本次工作里撞出来：

- `src/client/stage-view.tsx` 仍 import 已不存在的 `EndingCard` / `EndingCardData`；
- **`lib/client.js` 构建不出来**（esbuild 报 `No matching export "EndingCard"`），
  于是本仓源码与已提交产物不一致、`node build.mjs --check` 跑不过、`npm run typecheck` 14 个错误。

这也是为什么同期那笔媒体重构只能 `--no-verify` 提交——**不是它引入的，但它被卡住了**。

## 做了什么

| 面 | 改动 |
| --- | --- |
| 客户端 | 删 `EndingCard` 接线；终幕画面交由剧本用 `<scene>` / `<title>` / `<narrate>` 自己搭；结局标签不上屏 |
| **终局态闸** | 把 `ended` 传进 `StageTheater`：不给「点舞台继续」、点画面也不推进。**这正是 A1 指出没人接住的死闸** |
| 服务端 | `stage-tap` 删 `epilogue_*` 投影、按新四字段维护 `ended` 集合与落账；路由在 `hasEnded` 时拒绝玩家输入（闸在服务端也拦一道） |
| 提示词 | `ENDING_RULES` 改 `<ending id name summary/>` |
| 账本 | 老账本的 `title` 键**回落成 `name`**——存量剧本不改也读得出来 |

落账是**一次到位**的（四字段都在事件自己的属性上），没有旧口径那种「结局之后再用 `<epilogue>`
跑一轮回填 summary」的失败模式——这也是 stage 侧删 `<epilogue>` 的理由之一。

## 验证

| 项 | 结果 |
| --- | --- |
| `npx tsc --noEmit` | **0**（修复前 14 个错误） |
| `node e2e/run.mjs ending` | **9/9**（含 E9：老账本 `title` 从容回落到 `name`） |
| `node e2e/run.mjs rebuild` | **13/13**（R10 重建后恰好一帧 ending、四字段完整；R13 结局取代 stop） |
| `npm run e2e:media` | **48/48** |
| `node build.mjs --check` | **两个 lib 均一致**（`lib/client.js` 恢复可构建） |

提交时的 `.githooks` 钩子自动跑了 `build.mjs --check` 并通过——`lib/` 一致性契约恢复。

实例级套件（`injection` / `stage`）本次未跑：改动不触提示词注入锚点与演出闭环，
而 `stage` 需要起实例（本机 ARM 上成本高）。离线的 `rebuild` 覆盖了舞台重建语义，
`ending` 覆盖了账本与终局态——这两处才是本次改动的实质。

## 值得记的一条

**跨线契约的「交接」必须真的有人接。** 这次断裂不是谁写错了代码，而是一次重构把一半
交出去、另一半的接收方没启动，中间隔了一天多没人发现——直到本次工作撞上 `lib/` 构建失败。

防线已经补上：`docs/references/261009-cross-host-verification.md` 的对照表里，
「`packages/core` / `packages/stage` 改动」一行明确要求跑 DSH 侧的 `build` + `build.mjs --check`。
`lib/client.js` 构建不出来是**这一行会立刻暴露**的症状——它不再是「某天打开才炸」。
