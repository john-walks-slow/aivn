# 修复总结：消除跳转与新开局 Warning Toast 泛滥、退场转场动效迟滞及刷新抢跑

## 1. 任务背景

用户反馈：
1. 各种跳转，甚至刚开始的时候，都会有过多的 warning toast 弹出；
2. 新的开始/跳转时，会先播放上一段剧情残留的退场动画与过渡，导致视觉动效迟滞；
3. 页面刷新时，在事件流尚未同步完成的窗口里，对话框曾短暂闪现「（点击开始）」或先露出本轮末尾选项再跳回真实阅读位置，且加载期间缺少 spinner 与按钮禁用保护。

## 2. 根因追踪

1. **Warning Toast 泛滥**：
   - 服务端在结构操作（跳回旧轮、`jumpTo`、`forkTo`、`restartFromRoot`、`rewrite`、剪枝等）时广播 `rebase` 附带操作说明 `note`（如「顺着原路继续」、「已跳到这里」、「重写这一段」、「已从此处开新分支」等）。其中「开始新周目」（`restartFromRoot`）内部调用 `forkTo(ROOT_ID, { resume: true })`，也会广播 `"重写这一段"`。
   - 前端 `apps/web/src/views/StageScreen.tsx` 的 `onRebase` 中无差别执行 `if (note) pushToast(note, "warn");`，导致连开新周目和常规跳转都弹出黄色警告 Toast。
2. **新开局（`?new=1`）时先拉取并渲染旧周目全量事件再清空**：
   - 从标题页点击「开始新周目」（`?new=1`）进入舞台时，`useStageSocket` 在 `ws.onopen` 无条件先发 `{ type: "resume", lastSeq: 0 }`，把上一周目的全部历史事件拉下来塞进 `ScriptBuilder` 渲染出上一周目的背景、立绘与转场，等到 `StageScreen` 的 `useEffect` 触发 `sendRestart()` 后才收到 `rebase` 清空画面——导致新开局第一帧先闪现上一周目的退场与转场动画。
3. **退场立绘（`.leaving`）与换景转场（`bgTransition`）播完后未从状态与 DOM 中摘除**：
   - `packages/stage/src/director.ts` 注释承诺「退场淡出播完才真正摘掉」、`stage.css` 注释承诺「转场纯色场平时不入 DOM」，但 `usePlayback` 中既未在快进终态清理 `leaving` 和 `bgTransition`，也未在实时演出淡出（220ms）/转场（420ms）结束后将它们从 `visual` 状态中摘除，导致已退场角色与黑幕遮罩永久驻留 DOM，在回看松手（`.rewinding` 切换）、视图切换重挂载或快进时反复重播。
4. **服务端谱系落盘与重放遗漏 `actor` 的 `leave` / `shot` / `anchor` / `keep_visible` 属性**：
   - `apps/server/src/orchestrator.ts` 在 `appendLineage("actor", ...)` 时只 `pick(event, ["pos", "variant", "action"])`，漏掉了 `leave`、`shot`、`anchor`、`keepVisible`；
   - `packages/core/src/lineage/replay.ts` 在 `lineageToEvents` 重放 `actor` 节点时 `pickDefined` 也漏掉了 `leave`；导致历史中的 `<actor leave="fade"/>` 落盘重放后丢失退场标记，退场角色在重放/跳转时残留在舞台上。
5. **页面刷新时 `hello` + `beat_end` 早于 `events` 一个 RTT 导致选项抢跑与缺少加载态**：
   - 刷新时 `hello` 与 `beat_end` 先到，而 `events` 要等客户端 `resume` 往返后才到达；在这段空档里 `cues.length === 0`，`exhausted` 误判为 `true` 且 `hello.idle` 已将 `settled` 置为 `true`，导致本轮末尾的 `<StopPanel>` 选项先闪现出来，等 `events` 到达 seek 回阅读位置后才消失。

## 3. 实施改动

1. **前端 Toast 规则精简**（`apps/web/src/views/StageScreen.tsx`）：
   - 普通结构性跳转不弹警告 Toast；仅在真正异常/判废退回（如含「没有写出」、「退回」、「失败」）时弹出警告提示。
2. **新开局（`restartOnOpen`）连接直发 `restart` + 初始同步态 `syncing`**（`apps/web/src/stage/useStageSocket.ts`、`apps/web/src/views/StageScreen.tsx`）：
   - 当以 `?new=1` 进入舞台时，`ws.onopen` 不发 `resume` 拉取旧周目历史，而是在 `hello` 到达后直接发送 `{ type: "restart" }` 并忽略旧周目残留帧；
   - 新增 `syncing` 状态，在首次历史 `events` 尚未追平 `hello.lastSeq` 前保持 `loading = true`，展示 `"正在加载…"` 与 `.dialog-spinner`，并禁用舞台全部按钮与停止点。
3. **净化快进终态 + 退场/转场播完自动摘除 + 快进前 `exhausted` 守卫**（`packages/stage/src/director.ts`、`packages/stage/src/StageTheater.tsx`）：
   - 新增并导出 `settleVisual(visual: VisualState)`：剔除 `slot.leaving` 立绘槽位、将 `bgTransition` 置 `null`、重置一次性 `action`；
   - 在 `usePlayback` 的快进/seek 终态、`consumeNext` 跨句推进前、以及退场/转场触发 450ms 后自动调用 `settleVisual`，确保退场立绘与转场黑幕播完即从 DOM 卸载；
   - `exhausted` 增加 `fastForwardedRef.current &&` 守卫，换代复位与首次快进改用 `useLayoutEffect` 同步完成。
4. **补齐谱系 `actor` 退场与运镜属性的落盘、重放与回顾展示**（`apps/server/src/orchestrator.ts`、`packages/core/src/lineage/replay.ts`、`apps/server/src/rebuild.ts`、`packages/stage/src/scriptFeed.ts`）：
   - `orchestrator.ts` 与 `replay.ts` 完整保留并还原 `leave`、`shot`、`anchor`、`keep_visible`；
   - `rebuild.ts` 与 `scriptFeed.ts` 将带 `leave` 的节点展示为「退场」。

## 4. 验证结果

- `@aivn/core` 全部 268 项测试通过（含新增 `lineageToEvents` 退场与运镜还原单测）；
- `@aivn/stage` 全部 86 项测试通过（含新增 `settleVisual` 与 `visualAt` 净化单测）；
- `pnpm -r build` 与 `pnpm typecheck` 全量通过；
- 实机验证剧目《圣玛利亚庭园 · 倒影慢半拍》（`plays/testtest`）通过用户验收。
