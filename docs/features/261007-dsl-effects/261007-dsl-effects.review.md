# DSL 动效 / 转场（Phase 1）检视报告

> 日期：2026-10-07 · 分支：`feature/stage-dsl-uaj`
>
> 修订（同日）：用户反馈后收敛了 DSL 面——目标由 7 个收到 `camera`/`screen` 两个（每个效果只挂一个
> 自然目标），`shot` 移出 `<fx>`（只作 actor 属性），`transition` 只作 scene 属性，持续效果改用
> `release` 停，不做组合打包词。下述结论基于修订后的实现。
> 说明：本应使用 `reviewer` 子代理检视，但**子代理通道不可用**（完整检视与最小探针两次均返回
> `User location is not supported for the API use`，属宿主侧地理/API 限制）。按既有约定，
> 本轮**以自查代替**，逐项核对状态机、解析降级、合成层与持久化。

## 准入结论

**准入（条件：实机验收通过）。** 静态检查（`pnpm -r build`、`pnpm typecheck`）干净；
core 205 / stage 46 / server 指定 167 用例全绿。候选阻塞项已在自查阶段修复。

## 变更概览

- core：`dsl/effects.ts`（新，注册表 + 转场枚举）、`dsl/spec.ts`、`dsl/parser.ts`、`dsl/events.ts`、
  `lineage/model.ts`、`lineage/replay.ts`、`index.ts`。
- server：`orchestrator.ts`（fx 落谱系、cg 带 transition）、`prompt.ts`（FORMAT_RULES）。
- stage：`script.ts`、`director.ts`、`StageTheater.tsx`、`stage.css`；测试 `directorFx.test.ts`（新）。
- core 测试：`test/effects.test.ts`（新）；`actorCue.test.ts` 适配新 `VisualState`。

## 自查发现与处置

### 已修复
1. **回看返回会补放一次性效果**（trigger）。回看把状态折回过去（fx seq 变小），若 `useOneShot`
   在回看期间跟进 seq，回到播放头时 seq 跳回原值 → 误触发一次闪光/抖动。
   处置：`useOneShot` 增加 `muted`（回看中跳过且不更新 `last`），回现场时 seq 与离开前一致，不误触发。
2. **抖动时长与激活窗口不一致**。CSS 原用 `--fx-ms`（360ms）而 JS 激活窗口按档位（340/560ms）。
   处置：行内下发 `--shake-ms`，动画时长与激活窗口对齐。
3. **`prefers-reduced-motion` 覆盖不了行内抖动量**。处置：媒体查询里直接 `animation: none`
   掐掉抖动与闪光（闪光落回基础 `opacity:0`，等于不闪）。
4. **dead 规则**：删掉不再命中的 `.theater-bg.cut`。

### 复核通过（重点）
- **解析降级**：`<fx>` target 非法 → 整条丢弃 + warning；effect 不适用 target → 丢弃；
  非法 value → 退化缺省（不丢效果好属性）；未知 transition → 丢属性留换景。均有测试。
- **状态机**：`applyVisualCue` 仅在背景 id 真变化时递增过渡 seq；只改 BGM 不播过渡；
  换景清 CG 过渡；`applyFxCue` 幂等改写 state、trigger seq 自增、`none` 按 target 清空。
- **合成层**：镜头推拉走 `transform: scale`；抖动走独立 `translate` 属性（不与 scale 抢通道）；
  flash/vignette/letterbox 为纯色/gradient 层（走合成器）；无新增 `backdrop-filter`/`mix-blend-mode`。
- **回看/重放**：`.rewinding` 扩展禁用新元素动画与过渡，并隐藏旧层（回到那一刻的终态）；
  `visualAt` 重算 state、trigger 不重放。
- **持久化**：`orchestrator` 落 fx、cg 加 transition；`lineage/replay` 重放 fx 与 cg transition。
  往返测试通过。
- **WCAG**：单次 flash 配方，不提供连发写法；reduced-motion 下不闪。

### 已知非阻塞项（记录，不阻塞准入）
- **从回看返现场时会重放一次换层过渡**：换层栈以 `transition.seq` 为 key，回看与现场的 seq 不同 →
  返回现场时组件重挂、过渡动画重播一次。属过渡观感的小瑕疵，不影响正确性；Phase 2 可改为
  nonce 重启动画而非重挂。
- **`<say mood>` 与视觉无关**：本次未动，视觉侧未引入 `mood`，命名冲突已消解。
- **`grade` / `kenburns` / slide-push 转场**：按计划留 Phase 2，未注册（写进剧本会被丢弃 + warning）。
- **actor 的 `shot`/`anchor` 未随谱系持久化**（既有历史行为，与本次无关）：刷新后运镜可能丢失。
  本次未扩大改动面去修；如需修另开任务。

## 覆盖缺口（建议后续补足）
- 缺浏览器内的真实渲染断言（转场交叉溶解、抖动、闪光、letterbox/暗角）。已在 validation 文档
  列为实机验证项；若后续要自动化，建议用 e2e-tester 走一遍。
