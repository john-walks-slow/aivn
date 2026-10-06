# 漏调 beat_done 同轮追收束：实施小结

- `apps/server/src/orchestrator.ts`：`BEAT_DONE_NUDGE` 指令常量 + `beatDoneNudged` 轮内标志
  （`startBeatWindow` 复位）+ `finishTurn` 追收束分支。
- `apps/server/test/orchestrator.test.ts`：「闭环」下新增 2 例（追上 / 追完不交）。
- `docs/issues/261005-beat-done-nudge/261005-beat-done-nudge.troubleshoot.md`：现象 / 复现 / 根因 / 路径。

验证：`typecheck` 过；`orchestrator.test.ts` 全文件 88 例绿（含 2 例新增）。
判废路径不受影响的依据：追收束只认 `beatHasLines`，裸散文/空轮仍走原判废重演；
`beat_done` 参数校验那例（schema 拒单选项）同样不受影响，已在全文件回归里覆盖。

没做的：空 `beat_done`（有 stop 零台词）仍按正常轮收，未判异常——那是下一个口子，
本次只做「同轮追一次」。
