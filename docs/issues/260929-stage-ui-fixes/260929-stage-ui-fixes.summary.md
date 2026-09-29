# 舞台 UI 五处修复 总结

## 改了什么

| 位置 | 改动 |
| --- | --- |
| `apps/web/src/stage/StageTheater.tsx` | 删掉 `idleChrome` 与 4 秒自动隐藏定时器，工具条常驻；保留 H 键 / 上下滑手动开关 |
| `apps/web/src/app.css` | `.stage-screen` 左右 padding 归零；`.theater-dialog` 改 `position: absolute` 浮层；输入行与台词条的高度用 `--stop-h` 协调；新增 `.act-curtain` / `.act-next`；删掉死掉的 `.continue-box` 与移动端 `.stop-panel{max-height:55dvh}` |
| `apps/web/src/stage/StopPanel.tsx` | 删掉「继续」按钮；幕末分支改为黑场 + 「下一幕」 |
| `apps/web/src/stage/beats.ts`、`RouteCanvas.tsx`、`LineagePanel.tsx` | 去掉 pause 停止点的分支与标记，幕末回退文案改「◇ 幕末（下一幕）」 |
| `packages/core/src/dsl/spec.ts`、`src/ws/protocol.ts` | 停止点只剩 `choice` / `free` |
| `apps/server/src/rebuild.ts` | `stopFromEvent` 只认两种类型，历史 pause 一律落空 |
| `apps/server/src/orchestrator.ts` | 空拍不再伪造 pause 停止点（只发可恢复的错误条）；`restoreStopPoint` 只在当前拍内找停止点 |
| `apps/server/src/prompt.ts` | 删 pause 教学；「结束节拍」改为禁止写幕末交代；演出准则禁止引擎状态行 |
| 计划文档 / `AGENTS.md` | 同步「stop 两类型、幕末 = 黑场 + 下一幕」 |

## 自验

- `pnpm --filter @stage-ai/server test` 107 通过（新增 1 条幕末恢复回归）
- `packages/core` 66 通过（golden 用例含「pause 不再被接受」）
- web 类型检查与 vite build 通过
- 程序化布局测量（412×915）与修复前逐项对比：白边 16px→0、舞台高度 777→639 变为恒定 873、工具条 5 秒起隐藏变为恒显

## 遗留风险

- `apps/server` 的 `tsc -b` 在 HEAD 上就有两条既存报错（`transport.ts` 调 `removeBookmark` / `bookmarkId`），属他人未提交的工作，本分支没碰；`noEmitOnError` 未开所以产物照常发出。
- 台词条给输入行让位用了 `:has()`（Chrome 105+ / Safari 15.4+）。本项目只面向现代移动浏览器，未做降级。
- `--stop-h: 67px` 是输入行的实际高度（输入框 45 + 上下 padding）。以后改输入行高度要同步这个值。
- HEAD 的 `playhouse.ts` 调用 `store.assetNotes()`，而 HEAD 的 `store.ts` 尚无此方法——仓库 HEAD 本身起不来服务器（主工作区那份是别人未提交的改动带来的）。本次验证用运行时 shim 绕过，没改仓库源码。
