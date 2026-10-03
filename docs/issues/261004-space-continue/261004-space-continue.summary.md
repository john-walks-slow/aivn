# 空格键 = 点舞台

## 现象

舞台停在停止点上时，台词条提示「点击舞台继续生成」——只能用鼠标点画面。
键盘玩家按空格没有反应：空格那时只走 `scrub(1)`（回看游标往前追一句），
不在回看态时 `scrub` 把游标设回 `null`，等于空按。

## 根因

键盘表把空格归在「回看往回追」那一组（与 ↓/→/滚轮下 同一档），
而点击舞台走的是另一套出口：`canContinue` 时 `onContinue()`，否则 `advance()`。
两者从来没接上。

## 修改

- `apps/web/src/stage/StageTheater.tsx`：把点击舞台那套出口提成 `onStageClick`（useCallback），
  键盘表里空格改为直接调它；↓/→/滚轮保持只做回看。导演输入面板（`action !== null`）开着时
  空格不越层触发。回看态、回声态、净画面态的行为都由同一个函数给出，不会两处各说各话。
- `apps/web/src/stage/director.ts`：`scrub` 的文档注释去掉空格（它已不是回看键）。

## 测试

`apps/web/test/stageKeyboard.test.tsx`（新增）：

- 停在停止点时按空格 → 触发 `onContinue`（此前为 0 次）。
- 不在停止点时按空格 → 播放头照旧往前消费一句。
- 导演输入面板开着时按空格 → 不触发继续生成。

`pnpm typecheck` 通过；`test/stageKeyboard.test.tsx`、`test/directorRewind.test.tsx`、
`test/rewindVisual.test.ts`、`test/stageFresh.test.tsx`、`src/stage/*` 共 46 例通过。
