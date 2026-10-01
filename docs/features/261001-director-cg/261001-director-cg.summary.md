# 导演生图 小结

需求：导演栏加「生图」按钮，按当前这一幕的剧情生成 CG（可带指令），图落在按下这一刻的位置、
显示在 CG 页、pending 区可见且完成后停一会儿。

## 状态

已完成，等用户验收。

## 做了什么

1. **导演栏「生图」**：`StageTheater` 多一个按钮与一个 Modal 分支，空树时禁用；
   提交后走 WS 的 `generate_cg`。
2. **提示词在服务端合成**：`playhouse.requestCg()` 把「这条世界线上最近 12 句 + 当前场景 +
   角色卡 + `craft.md` + 玩家指令」交给剧作家的模型做一次 `completeText`，出英文提示词。
3. **位置在点下那一刻定**：`cg` 节点先 append（`orchestrator.directorCg`），再发起生图，
   与剧作家的 `preload_asset` 同一条路。提示词失败就不落节点。
4. **pending 完成态**：`PendingJob` 加 `state`，`done()` 不再直接删行，留 4 秒再消失。
5. 顺带三个修：
   - **剧目不存在的 WS 连接不再带走整个 API 进程**（`transport.ts` 的 unhandled rejection）。
   - **刷新后停止点丢失**（`stoppedReplay` 的守卫 `beatNo === 0` → `!this.autostarted`）。
   - **`completeText` 不再收下被输出上限砍断的半句话**（见下）。

## 过程中发现并修掉的一个真问题

第一次实机跑出来的图完全跑偏：日式商店街、纸杯咖啡、招牌上全是假汉字。
查下来提示词本身是**半句**：

```
17-year-old girl with long straight pink hair tied with white ribbons, wearing
```

——停在 "wearing" 上。`completeText` 收下了一个撞 `maxTokens`（单发 2048）被截断的响应，
而 `done` 事件里明明白白写着 `reason: "length"`，没人看。

修法一句话：看 `reason`，`length` 就报错，不把半句话交出去。
这条对**润色**同样有效——玩家输入被截成半句再送上台 Previously 也是悄悄发生的。
（`apps/server/test/llm.test.ts` 5 例钉住。）

## 改动

- `packages/core/src/ws/protocol.ts`：`PendingJob.state`、`generate_cg` 客户端消息。
- `apps/server/src/pendingJobs.ts`：完成态 + 定时清除。
- `apps/server/src/orchestrator.ts`：`directorCg()` / `recentScript()`；停止点补发的守卫。
- `apps/server/src/playhouse.ts`：`requestCg()` / `composeCgPrompt()` / `CG_PROMPT_SYSTEM`。
- `apps/server/src/transport.ts`：`generate_cg` 路由；连接期剧目存在性校验。
- `apps/server/src/llm.ts`：`reason === "length"` 视为截断。
- `apps/web/src/stage/StageTheater.tsx` / `views/StageScreen.tsx` / `PromptQueuePanel.tsx` / `app.css`：按钮、Modal 分支、完成态样式。

## 测试

- `apps/server/test/llm.test.ts`（新，5 例）：增量拼接、终态兜底、截断报错、流错误、空文本。
- `apps/server/test/pendingJobs.test.ts`：完成态 3 例。
- `apps/server/test/transport.test.ts`：剧目打不开 1 例（含进程存活断言）。
- `apps/server/test/orchestrator.test.ts`：导演生图 3 例 + 停止点补发 2 例。
- `apps/server/test/playhouse.test.ts`：导演生图两道前置守卫 2 例。
- `apps/server/test/lineage-ops.test.ts`：修好 main 上遗留的红测夹具。
- `pnpm typecheck` 三包全过；apps/server 335 例、apps/web 64 例全过。

## 遗留 / 已知

- `MAX_TOKENS = 2048` 对「始终思考」的模型偏紧，截断现在会报错而不是静默出错，
  但如果频繁触发要把它调大（`apps/server/src/llm.ts`）。
- `media-cache` 里没有的图不进 git：导演生成的图只活在本机盘上，CG 页显示为「站内生成」。
  这是刻意的（见 `261001-director-cg.plan.md` 的「图存哪」）。