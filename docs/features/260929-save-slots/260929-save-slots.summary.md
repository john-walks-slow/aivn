# 多周目存档 —— 实施总结

> 对应计划 `260929-save-slots.plan.md`，验证记录见 `260929-save-slots.validation.md`。
> 提交：`feat/save-slots`（worktree `.worktrees/save-slots`）。

## 做了什么

把「一个剧目一条线 + 点开始就删档」换成「一个剧目 N 棵树，一棵就是一个周目」。

- 新增 `apps/server/src/saves.ts`（`PlaySaves`）：`saves/<saveId>/{meta.json,session.json,lineage.jsonl}` + `active.json` 指针。档名与 `saveId` 解耦，删活动档时指针顺延。
- `PlayStore` 增加 `saveId` 作用域：会话面必须落在某棵树上，没有就抛错，不会悄悄退回剧目根目录。
- `PlayHouse` 删掉 `startFresh`，换成 `createSave / renameSave / deleteSave / switchSave`；`switchSave` 先等节拍边界再重建 runtime，活连接收到新 epoch 的 `hello` 后全量重放。
- WS 协议删掉 `ClientMessage.start`，`hello` 补 `saveId` / `saveName`。
- 前端新增周目页 `#/play/:id/saves`，Title 页改为「开始新周目 / 继续（档名） / 周目（n）」，舞台顶栏常驻当前周目名。
- `vite.config.ts` 的端口改为读 `STAGE_WEB_PORT` / `STAGE_PORT`，默认值不变——为了让 worktree 能和主线并行起 dev。

## 关键决策

- **不存在「清空重来」这条路径**。想重开就开新周目，旧树永远是只读的。这是从用户那句「点开始游戏是会把之前的历史给删掉吗」直接推出来的：删历史的按钮必须先消失，别的都可以商量。
- **新档是空树，开场由 `autostart()` 自己触发**，而不是客户端显式发「开始」。这样协议里就没有一个能被人拿来「重新开始」的按钮了。恢复出来的档靠编排器的 `autostarted` 标志不重开开场。
- **周目名不是 id**。改名是纯标签操作，可以随时改、可以改回原来，不影响任何数据——用户明确要求「改名和重新开始是单独的两种操作」。
- **列表卡上的拍数 / 最后一句与引擎同源**：`saveSession()` 落盘时顺手回写 `meta.json`，列表不必去解析会话文件。
- **改名不重排列表**。`rename` 只写 `meta.json` 的 name，不碰 `updatedAt`——否则改个名就把档顶到最前面，行为会很莫名其妙。

## 代价与边界

- 一个剧目一个 runtime，切档 = 销毁重建，所以切档要等当前这一拍演完。
- 不做旧版根目录数据的迁移（项目未上线，按既定原则不做）。
- 反剧透不需要额外工作：arcs 卡仍按 `arcIds` 过滤，archive 切片仍按 `tree.pathSet()` 过滤——每棵树各自一份谱系，天然隔离。

## 合回主线

worktree 提交里**带进了主线未提交的 assetNotes()/manifest 相关改动**（`store.ts` / `orchestrator.ts` / `prompt.ts` / `playFiles.ts` / `workshop.ts` / `imageAssets.ts` / 三个测试文件），目的是让分支自成一致状态。合回 main 时这些文件不会产生冲突；`AGENTS.md`、`README.md` 两份文档主线也在改，合并时按需取舍。
