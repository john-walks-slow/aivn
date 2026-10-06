# DSL 动效 / 转场（Phase 1）小结

> 日期：2026-10-07 · 分支：`feature/stage-dsl-uaj`

## 做了什么

给 Stage DSL 落了一套**统一的 Effect 抽象 + 应用目标**，并修好了转场的半成品。

- **统一模型**：一个 effect = 目标（`camera` 画面内容变换层 / `screen` 屏幕遮罩层）+ 生命周期
  （trigger 一次性 / state 持续）+ 固定配方；剧本只写效果词。
- **DSL 新面**：`<fx target="camera|screen" effect="…" value="…"/>`，效果词 `flash`/`shake`/
  `letterbox`/`vignette`；持续效果用 `<fx target="…" release/>` 停。
- **转场只属 `<scene>`**：`transition="cut|dissolve|fade|fade-white"`（封闭枚举，缺省 `fade`）。
- **修好旧 bug**：`<scene transition="cut">` 原来只落在无图占位 div、真背景固定走 `bg-fade` 淡入；
  改为旧/新双层栈：`cut` 硬切、`dissolve` 交叉溶解、`fade`/`fade-white` 经色场。
- **actor 侧不动**：`action`（8 个行为词）、`shot`、`variant`、`anchor` 语法与实现不变。

## 关键决策（用户 2026-10-07 定）

1. **统一原语 + 应用目标**：动效与转场是同一抽象在不同轴上的取值；转场是 `dual`（需要旧画面快照）特例。
2. **不用 `mood`**，也**不做组合打包词**；持续氛围显式拼装（vignette + letterbox）。
3. **目标收敛为 `camera`/`screen` 两个**，每个效果只挂一个自然目标（不再多目标）。
4. **`shot` 只作 actor 属性**，不进 `<fx>`；**`transition` 只作 scene 属性**，不给 `<cg>`。
5. **持续效果用 `release` 停**（target 级全清）。
6. **trigger 用单调 seq 重播、state 走 CSS 变量 + transition**；明令禁止 indefinite-filling WAAPI 表达 hold。

## 落点

- core：`dsl/effects.ts`（新）、`dsl/spec.ts`、`dsl/parser.ts`、`dsl/events.ts`、
  `lineage/model.ts`、`lineage/replay.ts`、`index.ts`。
- server：`orchestrator.ts`（fx 落谱系）、`prompt.ts`（FORMAT_RULES）。
- stage：`script.ts`、`director.ts`（`VisualState.bgTransition` + `FxState` + `applyFxCue`）、
  `StageTheater.tsx`（`.theater-camera` / `.theater-overlay` / 背景双层栈）、`stage.css`。
- 测试：`packages/core/test/effects.test.ts`、`packages/stage/src/directorFx.test.ts`；
  `actorCue.test.ts` 适配。

## 验证

- `pnpm -r build`、`pnpm typecheck` 干净；core 206 / stage 43 / server 指定 157 用例全绿。
- 检视：`reviewer` 子代理通道不可用（`User location is not supported for the API use`，两次探测均失败），
  本轮以自查代替，结论**准入（条件：实机验收）**；自查修复了回看误触发、抖动时长、reduced-motion、dead CSS。
- 实机验证项见 `261007-dsl-effects.validation.md`（待用户填写）。

## 已知非阻塞项

- 从回看返回现场时，换层过渡会重放一次（栈以 `seq` 为 key 导致重挂）；不影响正确性，Phase 2 可改 nonce 重启动画。
- actor `shot`/`anchor` 未随谱系持久化（历史行为，未在本次修）。
- Phase 2 候选：`kenburns`、`grade` preset、slide/push 转场。
