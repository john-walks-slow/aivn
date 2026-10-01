# main 上遗留红测 排查

**状态：已修复（2026-10-01，分支 `feat/cg-director`）。** 与当轮需求无关，是跑新测试时撞见的基线问题。

## 现象

`apps/server/test/lineage-ops.test.ts` 里 6 条用例在 main 上就红：
`playedTwoBeats` / `setupWithExtraBeat` / `busyStage` 三个场景各自相关的那几条。

## 根因

夹具写的是 `{ text: BEAT_1, beatDone: true }`——`beatDone` 传的是**布尔**，
而它实际收的是**停止点载荷**（`pause` / `choice`）。`true` 被当成
「暂停但没有载荷」，于是那一拍**不产生停止点**，第二轮根本没开，
后面每一步的时序都往前挪了一拍。

对照正确写法（同文件里另一处一直是对的）：`beatDone: BEAT_1_STOP`。

## 修法

三处夹具改传 `BEAT_1_STOP`，并把它加进 import。该文件 20 条全绿。

## 另一条：`image.test.ts` 的定时抖动

同批发现 `apps/server/test/image.test.ts` 用 `await new Promise(r => setTimeout(r, 10))`
等图落盘——这是拿墙钟赌 IO，必然抖。已由 `cfde0c2` 换成 `await assets.flush()`，本次未再改动。

## 验证

`apps/server` 全量 335 例通过（本次改动前 main 上有 6 条红）。