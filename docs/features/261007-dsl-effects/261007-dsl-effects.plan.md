# Stage DSL 动效 / 转场体系：设计

> 日期：2026-10-07 · 状态：已实施 Phase 1（本阶段只做设计 + Phase 1 落地，不扩张）
> 输入：[调研](261007-dsl-effects.research.md)
> 上游取向：v2 草案「不考虑向后兼容」「面向 playwriter」「声明式」「无自由参数」。
> 用户 2026-10-07 追加并定稿：统一 effect 原语 + 应用目标；动效侧不用 `mood`；目标收敛为
> `camera`（画面内容变换层）/ `screen`（屏幕遮罩层）；`shot` 只作 actor 属性；`transition`
> 只作 scene 属性；持续效果用 `release` 停；不做组合打包词。

---

## 1. 目标与非目标

**目标**：给 Stage DSL 一套**通用、可扩展、不修修补补**的演出效果体系——把 actor 行为词、
镜头抖动、屏幕冲击、场景转场收进**同一个 Effect 抽象**，用「目标 + 生命周期」两根轴表达，
并落地一个**封闭的起步词表**。

**非目标**（见调研 §5.2）：粒子/视频/Live2D/逐像素形变转场；自由参数；关键帧/时间轴；
条件与并行语法；`mood`/组合打包词。

**边界**：`title`、结局/多周目、`dsh-aivn` 插件均不碰。

---

## 2. 使用路径（用户视角）

### 路径 A：一场常规戏（触发 + 状态混用）
```xml
<scene bg="rooftop_dusk" bgm="piano" transition="dissolve"/>
<actor id="lucy" variant="shock" action="stagger"/>   <!-- 一次性：被吓到 -->
<actor id="lucy" shot="close"/>                        <!-- 持续：特写（actor 属性） -->
<say id="lucy">你…你怎么在这？</say>
<fx target="screen" effect="flash" value="white"/>     <!-- 一次性：闪白 -->
<fx target="camera" effect="shake" value="heavy"/>     <!-- 一次性：画面震 -->
<actor id="lucy" shot="normal"/>                       <!-- 改回全身（state 补间） -->
```

### 路径 B：持续氛围（拼装而非打包）
```xml
<scene bg="classroom_night" transition="fade"/>
<fx target="screen" effect="vignette"/>                <!-- 暗角，保持 -->
<fx target="screen" effect="letterbox"/>               <!-- 电影宽画幅 -->
… 一场戏 …
<fx target="screen" release/>                          <!-- 黑边 + 暗角一起停 -->
```

### 路径 C：回看与刷新
- 滚轮回看：状态效果随 `visualAt()` 折回那一刻；trigger 效果不重放（`.rewinding` 抑制，
  且 `useOneShot` 在回看中不跟进 seq，返回现场不误触发）。
- 刷新恢复：状态效果由 `visualAt` 重建；trigger 不回放。

---

## 3. 抽象模型（core 的唯一真相源）

### 3.1 三轴
```
Effect {
  target:    "camera" | "screen"     // 作用面
  lifecycle: "trigger" | "state"
  value?:    string                  // 该效果的封闭取值（可选）
  dual?:     boolean                 // 需要旧画面快照（仅 transition）
}
```
- `camera` = **画面内容变换层**：效果让画面本身动（背景/立绘/CG 一起），如抖动。
- `screen` = **屏幕遮罩层**：效果叠加在画面之上、画面内容不动，如闪光/黑边/暗角。
- `lifecycle` 决定存在形态与回看行为（对照表见调研 §4.2）。
- `dual` 是 `transition` 的专属标记（只用在 `<scene>` 上，不在 `<fx>` 上暴露）。

### 3.2 配方表放哪：沿用既有分层
- **core 拥有词表与契约**：`packages/core/src/dsl/effects.ts` 承载 `EffectSpec` 注册表 +
  `TRANSITIONS` 枚举。actor 行为词仍由 `packages/core/src/play/spriteAction.ts` 承载。
- **stage 拥有视觉配方**：`packages/stage/src/stage.css` 的 `@keyframes` / CSS 变量。

### 3.3 起步词表（2026-10-07 定稿）

| effect | target | lifecycle | values | 备注 |
|---|---|---|---|---|
| `flash` | screen | trigger | white / red / black | WCAG：不提供连发 |
| `shake` | camera | trigger | light / heavy | |
| `letterbox` | screen | state | on / off | value 缺省 = on |
| `vignette` | screen | state | on / off | value 缺省 = on |

- **`shot` 不做成 `<fx>`**：继续是 `<actor shot>`（某个人的景别），不进 effect 注册表。
- **`transition` 只作 `<scene>` 属性**（不进 `<fx>`，也不给 `<cg>`）。
- **持续效果用 `release` 停**：`<fx target="screen" release/>` 清空该 target 上的全部持续效果。
- **不做组合版**：不提供 `impact`/`cinematic` 之类打包词。
- `nudge`…`sway`（8 个 actor 行为词）仍由 `spriteAction.ts` 承载，写在 `<actor action>`。
- Phase 2 候选（`kenburns`/`grade`/slide-push 转场）本次**未注册**（写进剧本会被丢弃 + warning）。

---

## 4. DSL 语法面（最终形态）

### 4.1 标签改动

| 标签 | 改动 |
|---|---|
| `<actor>` | 不变（`variant`/`shot`/`anchor`/`action`/`leave`/`pos`）。 |
| `<scene>` | `transition="…"` 取值改为封闭转场枚举。**转场只属于 scene。** |
| `<cg>` | 不变（**不新增** `transition`）。 |
| `<fx>` | **新增**：`<fx target="…" effect="…" value="…"/>`；target 只认 `camera`/`screen`。 |

### 4.2 `<fx>` 校验规则（解析端）
- `target` 不在 `camera`/`screen` 内 → 丢弃 + `malformed_tag` warning。
- `release`（裸属性或 `="true"`）→ 产出 release 事件，不需 effect/value。
- `effect` 不在注册表 / 不适用于该 target → 丢弃 + warning。
- 非法 `value` → 退化为该 effect 的缺省值 + warning（只丢 value，不丢效果）。

### 4.3 与 `mood` 的关系
`<say mood>` 保留（TTS 情绪，语义不变）。视觉侧**不引入** `mood`；持续氛围由
`vignette` + `letterbox` 显式拼装。

---

## 5. IR 与数据模型

### 5.1 `packages/core/src/dsl/events.ts`
新增：`| ({ kind: "fx" } & FxAttrs)`，`FxAttrs = { target; effect?; value?; release? }`。
`scene` 沿用 `transition?: Transition`。

### 5.2 `packages/core/src/dsl/spec.ts`
- `DSL_TAGS`/`VOID_TAGS` 加 `"fx"`。
- `SceneAttrs.transition?: Transition`（收窄）。

### 5.3 IR → 舞台状态（stage）
`packages/stage/src/director.ts` 的 `VisualState`：
```ts
interface VisualState {
  …既有 bg/bgm/ambient/volumes/cg/sprites/pending…
  /** 背景换图过渡（dual-source，仅 scene）。 */
  bgTransition: { name: Transition; seq: number; from: string | null } | null;
  /** 舞台级效果。trigger 用 {seq} 表达重播；state 为持久字段。 */
  fx: {
    camera: { shake?: { value: string; seq: number } };
    screen: { flash?: { value: string; seq: number }; letterbox?: boolean; vignette?: boolean };
  };
}
```
- `applyVisualCue`：scene 分支仅在背景 id 真变化时递增 `bgTransition.seq`（只改 BGM 不播过渡）；
  `fx` 分支走 `applyFxCue`。
- `applyFxCue`：`release` → 清空该 target 的持续效果；否则按 effect 写入（trigger 递增 seq）。
- `visualAt()`：从空场重折，`fx` 与 `bgTransition` 一并重算；渲染层只认值/序号变化。

### 5.4 谱系持久化
- `apps/server/src/orchestrator.ts`：`fx` 落谱系（`release` 记 `"true"`）。
- `packages/core/src/lineage/model.ts`：`LineageEventKind` 加 `fx`。
- `packages/core/src/lineage/replay.ts`：`case "fx"` 还原（含 release）。
- `packages/stage/src/script.ts`：`Cue` 联合加 `fx`；`ScriptBuilder` 映射。

---

## 6. 渲染层架构（`packages/stage`）

### 6.1 舞台 DOM 分层
```
.theater-stage
  ├─ .theater-camera        ← 画面内容变换层（抖动）
  │    ├─ .theater-bg-stack ← 旧/新两层 <img> 做 cross-fade，cut 直接换
  │    ├─ .theater-sprites  （不动）
  │    └─ .theater-cg
  └─ .theater-overlay       ← 屏幕遮罩层：flash / letterbox / vignette
```

### 6.2 各类效果的实现手法（除静态 grade 外全走合成器）

| 效果 | 实现 |
|---|---|
| actor `action` / `shot` | 现状不变（`@keyframes sprite-act-*` / `--scale`） |
| camera `shake` | `.theater-camera` 挂 `@keyframes fx-cam-shake-light/heavy`（走独立 `translate`），nonce 重播，`will-change: transform` |
| screen `flash` | `.theater-flash` 纯色层 `opacity 0→1→0`，nonce 重播 |
| screen `letterbox` | `.theater-letterbox` 上下两条黑条（`::before/::after`），显隐 |
| screen `vignette` | `.theater-vignette` `radial-gradient` 层，显隐 |
| `transition` | 见 §6.3 |

### 6.3 转场（修好半成品）
背景改为 **双层栈**：旧图 `.theater-stack-old` 在下、新图 `.theater-stack-new` 在上，
按 `trans-*` 类互相配合；`fade`/`fade-white` 额外一层 `.theater-stack-veil` 纯色。
- `cut`：旧层 `display:none`，新图直接顶替（修掉「cut 只落占位」的 bug）。
- `dissolve`：新图 `opacity 0→1` 交叉溶解。
- `fade` / `fade-white`：旧图保持到 50%（`steps` 硬切让位），
  veil 纯色升到全遮挡再落下，揭开已就位的新图。
- 时长/曲线全来自配方表（`stage.css`），剧本不见。
- 实现选择：**双层 DOM + CSS**（走合成器）；不采用 View Transitions API（会冻快照，见调研 §3.3）。

### 6.4 回看与 reduced-motion
- `.rewinding` 扩展规则禁用新元素动画/过渡，并隐藏旧层（回到那一刻的终态）。
- `useOneShot` 在回看中 `muted`：不跟进 seq，返回现场不误放一次闪光/抖动。
- `prefers-reduced-motion`：`--trans-ms`/`--fx-ms` 归零，并直接掐掉抖动与闪光动画。

---

## 7. 落地清单（Phase 1，已实施）

| # | 文件 | 动作 |
|---|---|---|
| 1 | `packages/core/src/dsl/effects.ts`（新） | `EffectSpec` 注册表 + `TRANSITIONS` + `transitionVeilColor` |
| 2 | `packages/core/src/dsl/spec.ts` | `DSL_TAGS`/`VOID_TAGS` 加 `fx`；`SceneAttrs.transition` 收窄 |
| 3 | `packages/core/src/dsl/parser.ts` | `case "fx"`（release/effect/value 校验）；scene 转场校验 |
| 4 | `packages/core/src/dsl/events.ts` | `{kind:"fx"} & FxAttrs` |
| 5 | `packages/core/src/lineage/model.ts` | `LineageEventKind` 加 `fx` |
| 6 | `packages/core/src/lineage/replay.ts` | 还原 fx（含 release） |
| 7 | `apps/server/src/orchestrator.ts` | fx 落谱系 |
| 8 | `packages/stage/src/script.ts` | `Cue` 加 fx；event→cue |
| 9 | `packages/stage/src/director.ts` | `VisualState.bgTransition` + `FxState`；`applyFxCue`/`applyVisualCue` |
| 10 | `packages/stage/src/StageTheater.tsx` | `.theater-camera` + `.theater-overlay`；背景双层栈；各效果渲染 |
| 11 | `packages/stage/src/stage.css` | 新 `@keyframes`、遮罩层、双层栈、reduced-motion |
| 12 | `apps/server/src/prompt.ts` | FORMAT_RULES 增 `<fx>` 与转场枚举、actor `shot` 说明 |

Phase 2（可选，模型已支持）：`kenburns`、`grade` preset、slide/push 转场。

---

## 8. 测试与验证

- 单元：`packages/core/test/effects.test.ts`（注册表、解析降级、replay）、
  `packages/stage/src/directorFx.test.ts`（fx 状态机、release、背景过渡捕获）。
- 端到端（实机，见 validation 文档）：cut vs dissolve 观感、抖动不位移布局、回看不重放/不误触发、
  刷新还原、reduced-motion。
- 命令：`pnpm --filter @aivn/<pkg> test <file>`（文件名直接跟，不加 `--`）。

---

## 9. 迁移（不考虑向后兼容）
- `transition="fade"` 旧值保留为合法值（`fade` = 经黑场）。
- 现有 `action`/`shot`/`anchor`/`variant` 语法不变。
- 旧 `VisualState.transition: string` 换成结构化 `bgTransition`。

---

## 10. 已定事项（原开放问题）
1. `<fx>` 取值用 `value=` 单属性（不把变体折进词）。
2. `shot` 保留为 `<actor>` 属性，不迁到 `<fx>`。
3. 无组合打包词。
4. 持续效果用 `release` 停（target 级全清）。
5. 目标收敛为 `camera`/`screen` 两个，每个效果只挂一个自然目标。
