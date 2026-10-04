# 导演生图 小结

需求：导演栏加「生图」按钮，按当前这一幕的剧情生成 CG（可带指令），图落在按下这一刻的位置、
显示在 CG 页、pending 区可见且完成后停一会儿。

## 增量：回看中生图按「你正看的那一行」（2026-10-04）

原行为只有一个落点：**世界线末尾**。所以回看中（舞台往回滚）点生图，提示词写的是最新剧情、
图也落在最新处——眼睛在第二句，图却长在最后一句上。

### 落点分两种，靠锚点区分

- **世界线末尾**（没在回看）：不变。`orchestrator.directorCg(id)` 在点下那一刻 append 一个
  `cg` 节点。
- **回看中**（客户端 `scrubbed`，`generate_cg` 带上 `anchorNodeId` = 正看的那一行）：
  提示词按那一刻写（`recentScript(12, anchor)`：链取到锚点为止、场景取 `stateAt(anchor).scene`），
  图作为**行级旁注**挂在那一行上（`attachCg(anchor, id)` → `LineageTree.recordCg`）。

### 为什么回看这条走旁注而不是「插进链里」

链上每个节点只有一个孩子。要在某一行后面插一个节点，必须挪走它原来的下一个孩子——挪成兄弟
就是**分叉**（世界线被掰成两条），挪到图下面就是**改结构**（之后的剧情变成这张图的后代）。
两条都不是「只是加一张图」。

所以复用已有的旁注机制（`recordEdit` 那一套）：`kind="cg"` + `cgTargetId`，不入树、不动挂载点、
不占 seq；`LineageNodeView.cgs` 把它挂回那一行，客户端翻到那一行就把这张图盖在画面上
（`withAttachedCg`，图跟着行走、不往后漂）。改写与插图合并成一张统一旁注表 `notes`，
保证落盘顺序与 `flushLineageLog` 的游标语义稳定。

### 改动

- `packages/core/src/lineage/model.ts`：`recordCg` / `LineageNodeView.cgs` / 统一旁注表
  （`export` 排末尾、`load` 分流、`removeSubtree` 连旁注一起清）。
- `packages/core/src/ws/protocol.ts`：`generate_cg.anchorNodeId`、服务端帧 `cg_attached`。
- `apps/server/src/orchestrator.ts`：`attachCg` / `hasNode` / `recentScript(limit, from?)`。
- `apps/server/src/playhouse.ts`：`requestCg` 的锚点分支（锚点不存在就明确报错，不留半张图）。
- `apps/web/src/stage/director.ts`：`withAttachedCg`；`usePlayback` 收 `cgByNode`。
- `apps/web/src/views/StageScreen.tsx`：`cgs` → `cgByNode`；`cg_attached` 时重拉谱系。
- `apps/web/src/stage/StageTheater.tsx`：提交生图时带上「正看的那一行」。

### 测试

- core `lineage.test.ts` 4 例：挂载点不动 / 同一行两张 / 目标不存在报错 / 跨进程序列无损 +
  剪枝连带清理。
- server `orchestrator.test.ts` 3 例（锚点上下文、`attachCg` 不入树、剪枝后再挂仍落盘）、
  `playhouse.test.ts` 1 例端到端（提示词只写到那一行、树上没有 cg 节点、leaf 不变）。
- web `rewindVisual.test.ts` 3 例（`withAttachedCg`）。
- `pnpm typecheck` + `pnpm -r build` 全过；core 164、server 671、web 193 例全绿。

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
- `pnpm typecheck` 三包全过；apps/server 339 例、apps/web 64 例。
- `apps/server/test/playAssets.test.ts` 在本机全量并发跑时有 3 条 5s 超时（每次是哪几条在变），
  单跑该文件 14/14 全绿——机器只有 8GB，同期还开着 vite / API / chromium。不是本次改动引入。

## 真机验证（浏览器实跑）

服务端 29681 + vite 63801，Playwright 点完整个流程：

- 导演栏「生图」按钮出现在 `提示 / 改写 / 重来 / 生图` 一排里；空树时置灰，
  开演后解禁。
- 点开 Modal（标题「生成插图」）、填指令、提交，走通。
- 排队面板：`正在生成` → `CG cg_mupbe1a7  1 秒` → 图到后 `刚刚完成` / `已完成` / 行变淡
  → 约 4 秒后整块收起。
- CG 页：多出一张卡，角标「站内生成」，卡上摊着提示词原文。

**但那次出的图跑偏了**：内容是日式商店街、纸杯咖啡、招牌上全是假汉字。
查下来提示词本身停在 `…wearing`，是网关把流掐在半路——于是加了两道校验
（`MIN_CG_PROMPT_WORDS` + `completeText` 的 `reason === "length"`）。

加校验之后连跑几次都没能拿到好结果，**但原因全在本机环境，不在代码**（下面「查到的两处环境问题」）。

## 验收通过的一轮（换模型 + 重启生图 token 之后）

服务端 29681 + vite 63801，Playwright 全流程：

| 步骤 | 结果 |
| --- | --- |
| 点「生图」→ 填指令 → 提交 | 通过 |
| 排队面板 | `正在生成` / `CG cg_mupeqiv8  1 秒` → `刚刚完成` / `已完成` → 约 4 秒后收起 |
| 合成出的提示词 | 68 词，完整：「A classroom at sunset, warm golden light through windows, …, navy sailor uniform, crooked tie, flushed cheeks, …, backlit by sun」 |
| 出的图 | 黄昏教室、藏青水手服粉发少女、脸颊绯红、双手背后、逆光，窗边坐着一个人——与剧情对得上 |
| CG 页 | 多出一张卡，角标「站内生成」，卡上摊着提示词原文 |

## 查到的两处环境问题

1. **默认剧作家模型不能写短提示词**。`gemini-3.5-flash-lite` 在 cpa 上走 `antigravity` 这条路，
   让它写一句出图提示词时**吐 1~2 个 token 就自己停**（`finish_reason` 还报 `stop`），
   同一段提示词 8 次只合格 2 次、切到 `reasoning: off` 是 0/6。规律是模型一选 Danbooru
   标签体（`1girl, …`）就必挂，选自然语言就正常。换成 `nim/nvidia/nemotron-3-super-120b-a12b`
   是 6/6，已把 `.env` 的 `STAGE_MODEL_ID` 换过去。
2. **flow2api 的生图 token 被自动禁用**，`is_active=0` → 所有生图请求 503
   「没有可用的Token进行图片生成」。`token_stats.consecutive_error_count` 已经到 11，
   而它自己那个「429 自动解封 / 协议刷新」任务又坏了（`last_st_refresh_result` 是一句
   `curl: (35) TLS connect error`），所以 token 就一直禁着。
   手工 `UPDATE tokens SET is_active=1` + 把 `consecutive_error_count` 清零后立刻恢复。

第 2 条跟 stage-ai 无关，但它会让「生图失败」看起来像我们的 bug，排查时先看
`sqlite3 /opt/flow2api/data/flow.db "select email,is_active from tokens"`。