# DSL 动效 / 转场（Phase 1）小结

> 日期：2026-10-07 · 分支：`feature/stage-dsl-uaj`

## 做了什么

给 Stage DSL 落了一套**统一的 Effect 抽象**（舞台级全局效果），并修好了转场的半成品。

- **统一模型**：一个 effect = 支持的动词（`trigger` 演一次 / `on`·`off` 持续开关）+ 口味取值 + 固定配方；
  剧本只写效果词、动词与口味，效果落在哪一层（画面内容变换层 / 屏幕遮罩层）是引擎内部实现。
- **DSL 新面**：`<fx effect="…" trigger|on|off value="…"/>`，效果词 `flash`/`shake`/`letterbox`/`vignette`；
  flash/shake 三种动词都支持（含持续常亮色 / 持续抖），letterbox/vignette 只有 on/off。
- **转场只属 `<scene>`**：`transition="cut|dissolve|fade|fade-white"`（封闭枚举，缺省 `fade`）。
- **修好旧 bug**：`<scene transition="cut">` 原来只落在无图占位 div、真背景固定走 `bg-fade` 淡入；
  改为旧/新双层栈：`cut` 硬切、`dissolve` 交叉溶解、`fade`/`fade-white` 经色场。
- **actor 侧不动**：`action`（8 个行为词）、`shot`、`variant`、`anchor` 语法与实现不变。

## 关键决策（用户 2026-10-07 定）

1. **统一原语**：动效是舞台级全局效果（作用于整幅画面），与转场各自走 `<fx>` / `<scene transition>`。
2. **不用 `mood`**，也**不做组合打包词**；持续氛围显式拼装（vignette + letterbox）。
3. **不向写作者暴露 target**：每个效果只有一个自然层，让剧本写 `target` 是净负担；分层是引擎内部约定。
4. **`shot`/`action`/`variant`/`anchor` 只作 actor 属性**，不进 `<fx>`；**`transition` 只作 scene 属性**，不给 `<cg>`。
5. **动词独立于 value**：`trigger`/`on`/`off` 必填，`value` 只留口味；持续效果用 `off` 停，不设 `release`。
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

- `pnpm -r build`、`pnpm typecheck` 干净；core 228 / stage 51 用例全绿（server 全量仅 `voice.test.ts`
  4 例预存在失败，属别的改动范围，与 fx 无关）。
- 检视：`reviewer` 子代理通道不可用（`User location is not supported for the API use`，两次探测均失败），
  本轮以自查代替，结论**准入（条件：实机验收）**；自查修复了回看误触发、抖动时长、reduced-motion、dead CSS。
- 实机验证见 `261007-dsl-effects.validation.md`：**用户 2026-10-07 验收通过**。

## 交付后修复（用户实机验证发现）

- **差分交叉淡化此前是失效的**：旧图那层复用了 `.entering`（`sprite-in` 从透明起步）又带
  `.sprite-out{opacity:0}`，一挂上就全透明；且旧图没带定位变量。改为「新图在下、旧图在上，
  用 `sprite-fade-out` 关键帧淡出」并复用同一份 style。
- **根因是 CSS 变量漏单位**：`--fade-ms: 220`（无单位）让 `.theater-sprite` 的整条 `transition`
  简写**整体失效**（浏览器实测 `transitionDuration: 0s`），连带 `sprite-fade-out` 时长为 0。
  修成 `220ms`；`--hover-ms` 同样漏单位，一并修。**顺带恢复了运镜(transform)/压暗(filter)/退场
  的过渡**——它们共用同一条 transition 声明，之前都被判无效而瞬跳。
- 实机验证（headless Chromium）：旧图 opacity `1.00→0.64→0.35→0.11→0.00`，约 200ms，真交叉淡化。

## 复查后的表达面收敛（2026-10-07）

- 删除死代码与重复：`EffectTarget` 双份别名、0 引用的 `isEffectName`/`effectAppliesTo`、从未赋值的
  `EffectSpec.dual`、从未被读的 `label`；转场同义词 `fade-black`（dev 级别名 + 重复 CSS）一并删。
- **去掉 `<fx target>`**：效果全局面，分层实现内部化，剧本不再需要记忆「effect × target」搭配。
- **引入必填动词 `trigger` / `on` / `off`**：模式从 `value` 里拆出，`value` 只留口味；flash/shake 补了持续态
  （常亮色 / 持续抖），letterbox/vignette 只有 on/off。
- **去掉 `release`**：与 `off` 二义；持续效果一律用 `off`。
- 默认转场以代码为准（`fade`），修正 prompt 里「dissolve 默认」的错述。

## 已知非阻塞项

- 从回看返回现场时，换层过渡会重放一次（栈以 `seq` 为 key 导致重挂）；不影响正确性，Phase 2 可改 nonce 重启动画。
- actor `shot`/`anchor` 未随谱系持久化（历史行为，未在本次修）。
- Phase 2 候选：`kenburns`、`grade` preset、slide/push 转场。
