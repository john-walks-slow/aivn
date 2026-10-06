# Stage DSL 动效 / 转场体系：调研

> 日期：2026-10-07 · 状态：设计输入（配套 [计划](261007-dsl-effects.plan.md)）
> 上游底座（本次不重复造轮子，直接引用）：
> [引擎原语对照](../261002-dsl-v2/261002-vn-engine-presentation-primitives.research.md) ·
> [演出效果全集与浏览器可实现性](../261002-dsl-v2/261002-galgame-presentation-primitives.research.md) ·
> [v2 语法草案](../261002-dsl-v2/261002-dsl-v2-proposal.research.md) ·
> [spirte 动效与抽象层级](../261002-dsl-v2/261002-dsl-v2-sprite-motion-props.research.md)
>
> 本文只补 261002 那轮**没覆盖**的两块（WAAPI 状态语义、View Transitions API），
> 并把「动效/转场」这件事从三份既有调研里重新归纳成一套可落地的抽象。

---

## 0. 结论速览（三个核心问题的答案）

**Q1「动效」与「转场」是同一件事吗？**
不是「两件事」，也不是「一件事」，而是**同一个抽象（Effect）在两根轴上的不同取值**。
真正区分它们的不是「动效 vs 转场」这个二分，而是：

1. **作用目标（target）**：个体立绘 → 立绘层 → 背景层 → CG 层 → 舞台（画面区）→ 镜头容器 → 全屏遮罩。
2. **生命周期（lifecycle）**：`trigger`（一次性，播完即止）vs `state`（持续保持，直到被改写/复位）。

转场是 target = `bg`/`cg`/`stage`、lifecycle = `state` 的一个特例，外加第三个属性：
3. **是否需要出画快照（dual-source）**：cross-fade / slide / push 都必须拿到「旧画面」，
   而「让 lucy 点个头」不需要。只有转场需要旧画面。

所以：**收进同一个 Effect 抽象，用 `dual` 子类表达转场**，而不是维持 `action` / `shot` /
`transition` / `fx` / `camera` 各一套。

**Q2 一次性（trigger）与持续（hold）如何在同一抽象里表达？**
- **trigger**：一条携带单调 `seq` 的事件 → 渲染层挂一段瞬时 CSS 动画（nonce 重播），
  播完摘除，`animation-fill-mode: none`（回到基态）。这正是现在 `actor action` + `actionSeq` 的机制。
- **state**：`VisualState` 里的持久字段 → 渲染层派生 class / CSS 变量 → 用 CSS `transition` 平滑到达。
  **不是**一段一直挂着的动画。
- 硬规则：**禁止用 indefinite-filling 的 WAAPI 动画表达 hold**。规范明确劝阻
  （见 §3.2），它会让后续改样式失效；需要「动画到某个值然后停住」时用
  `commitStyles()` + `cancel()`。

**Q3 应用目标如何选择、如何避免组合爆炸？**
- 目标收敛为 **2 个**（用户 2026-10-07 定）：`camera`（画面内容变换层）与
  `screen`（屏幕遮罩层）。二者语义见 §4.1 上方。
- 每个效果词声明自己的**合法目标集**（`appliesTo`），且**只挂一个自然目标**；越界**丢弃 + warning**
  （与现有 `dropTag` 同一哲学：宁可少演一次，也不猜）。
- 真正的防爆手段不是砍目标，而是**封闭词表 + 固定配方**：不加自由参数
  （`shake="0.3"`、`blur="4px"` 一律不允许），没有的参数就不存在组合。
- 语法上**按目标锚定**：属于某个角色的效果写在 `<actor>` 上（`action`/`shot`），
  舞台级效果走统一的 `<fx target=…>`。这是刻意的可读性选择，见 §4.3。

---

## 1. 现状核实（务必对得上，别凭记忆）

| 事实 | 位置 | 结论 |
|---|---|---|
| `<scene transition>` 只识别 `fade`/`cut`，且 `cut` 只落在**无图占位** | `packages/stage/src/StageTheater.tsx:641`（真图 `<img className="theater-bg theater-bg-in">`）vs `:644-646`（占位 div 才拼 `visual.transition === "cut"`） | 真图那条永远走 `bg-fade` 淡入；`cut` 对真背景无效。**半成品坐实。** |
| `.theater-bg-in { animation: bg-fade 0.6s ease }` | `stage.css:1362` | 单 `<img>` remount + 淡入 = 变相 fade-in，不是 cross-fade，也没有 `cut` 分支。 |
| `.theater-bg.cut { animation: none }` | `stage.css:353` | 只对占位 div 生效。 |
| `VisualState.transition: string \| null`，`applyVisualCue` 默认写 `"fade"` | `director.ts:104` / `:263` | 转场状态只存了一个字符串，没有「旧 bg」快照。 |
| `actor action` → 8 个配方，配 `actionSeq` nonce 重播 | `packages/core/src/play/spriteAction.ts`、`director.ts:78-86`、`StageTheater.tsx:262-273`、`stage.css:548-719` | **已经是 trigger 原型的完整实现**，本次动效体系应沿用而非另起。 |
| `shot` 运镜（state）：`--scale` 表 | `StageTheater.tsx:193-198,290` | 已经是「state → CSS 变量 + transition」的原型。 |
| `dim` 说话者压暗（state） | `StageTheater.tsx:677`、`stage.css:428` | 同上，state 型。 |
| 三个 `.rewinding` 抑制规则 | `stage.css:494-503` | 回看时禁用动画/过渡——trigger 回看不重放的现成机制。 |
| 没有镜头容器 | `StageTheater.tsx:639-697`：`.theater-stage` 直接放 bg / `.theater-sprites` / `.theater-cg` | 做「整画面推拉、letterbox、vignette」需要一个 `.theater-camera` 包裹层 + 遮罩层。 |
| playwriter 契约文案 | `apps/server/src/prompt.ts`(FORMAT_RULES)，含 `<scene … transition="fade"/>`、`action`、`shot` 表 | 改 DSL 必须同步改这段；否则模型继续写旧语法。 |
| 谱系回放只 pick 白名单属性 | `packages/core/src/lineage/replay.ts:91-93`、`apps/server/src/orchestrator.ts:2351` | 新增属性必须同时加进这两处，否则刷新后状态丢失。 |
| Cue 类型 | `packages/stage/src/script.ts:24-56` | 新增字段的落点。 |

> 现状小结：**trigger 与 state 两套机制其实都已经存在**（`action` 是 trigger，`shot`/`dim` 是 state），
> 只是没有名字、没有统一抽象、也缺舞台级/镜头级的那一半。转场是唯一真正残缺的一块。

---

## 2. 领域事实：边界与生命周期（归纳自既有调研）

### 2.1 所有引擎都把「整屏转场」与「单对象动画」分成两个原语族
（引擎调研 §7.6）Ren'Py 用 `with` + Transition class vs ATL transform；KAG 用 `trans` vs `move`；
Tyrano 用 `[trans]` vs `[anim]`。**但从实现看两者收敛**：Ren'Py 的 `MoveTransition`、
Naninovel 的转场本质都是「状态 diff + 属性补间」，只是转场额外拿到 `old_widget/new_widget`。
→ 这印证 Q1：分化点是**要不要旧画面**（dual-source），不是「动效 vs 转场」。

### 2.2 生命周期轴被三家显式命名过
- **Naninovel**：显式二分 `@shake`/`@glitch`（one-off）vs `@rain`/`@blur`/`@bokeh`（continuous，
  需 `@despawn` 或 `power:0` 显式停）。
- **Tsuzuru**：插件按状态持续性分类——`plugin-std-effect`（一次性）vs `plugin-std-camera`（持久）。
- **Ren'Py**：ATL 属性值在动画被打断后**保留**（`show eileen happy: pass` 打断但保位置），
  即「进程」与「终态」分离——这正是 trigger 播完回基态、state 常驻的语义。
→ 公认的轴：**trigger vs state**。本次把它变成 DSL 的一等属性。

### 2.3 目标轴的粒度参照
- Ren'Py：`camera` 作用于整层且跨 `scene` 存活；`show layer` 则在下次 `scene` 时清除。
- KAGEX：专门加 `stage` 层做背景卷动。
- Naninovel：`@blur` 可挂 `MainBackground` 或任意 actor，`@shake ID=Camera` 震主相机。
→ 目标不是「有/无」而是**分层**：相机是持续、跨景的容器；层可各自加效果；actor 是层内实体。

### 2.4 缓动/时长从不出现在剧本里（本项目的既定取向得到印证）
引擎调研 §8.3：枚举封闭 + 固定配方是让 LLM「一次写对」的主要抓手（Pixi'VN 是唯一把它写进
产品定位的引擎）。本项目 `spriteAction.ts` 的注释也记录了同一结论。本次**维持**。

---

## 3. 浏览器侧可实现性（补 261002 未覆盖的两块 + 结论复用）

### 3.1 可直接复用的既有结论
- **只有 `transform` 与 `opacity` 走合成器**；`filter`/`backdrop-filter`/`mix-blend-mode`
  每加一层多一次离屏 pass（效果全集 §0、§13）。
- **`filter` 静态值便宜、动画值昂贵**：动画化 blur 半径「每台没有独显的设备帧率腰斩」
  （效果全集 §6.2）。→ **state 滤镜只允许静态值**；不提供逐帧动画滤镜。
- **不要用 `backdrop-filter` 做背景虚化**（Backdrop Root 会截断采样，效果全集 §10.2）——
  要糊背景就 `filter: blur()` 直接加在背景层。
- **scale 动画必须 `will-change: transform`**，否则 Chrome 逐帧重栅格大图（效果全集 §2.1）。
- **`clip-path` / `mask-image` / 纯色 `opacity` 层都走合成器** → iris / letterbox / vignette /
  flash / slide 全部零离屏。转场族里**只有逐像素几何形变（ripple/swirl/wave）必须 WebGL**，
  本次不做。

### 3.2 WAAPI 的状态语义（新增证据）
- Web Animations 规范 §4.6 原文：*"Authors are discouraged from using fill modes to produce
  animations whose effect is applied indefinitely… indefinitely filling animations can cause
  changes to specified style to be ineffective."*
  并把正确写法写成示例：`fill:'forwards'` → `await animation.finished` →
  `commitStyles()` → `cancel()`。
  （来源：https://www.w3.org/TR/web-animations/ · https://developer.mozilla.org/en-US/docs/Web/API/Animation/commitStyles ）
- `commitStyles()` 与 `fill:'forwards'` 在 Firefox 有已知缺陷（提交瞬间可能触发一次多余的
  CSS transition，bug 1917071）——又一个「hold 不该做成动画」的理由。
- **结论**：hold 一律走「真相源状态 → class/CSS 变量 → `transition`」，**不走** WAAPI 填充。
  trigger 走瞬时 CSS animation（甚至不用 WAAPI，保持与现状一致）。

### 3.3 View Transitions API（新增证据，2026 现状）
- 同文档（SPA）转场 `document.startViewTransition(update)`：默认 cross-fade，旧/新快照各自
  `opacity 1→0 / 0→1`，并用 `::view-transition-image-pair{isolation:isolate}` +
  `mix-blend-mode: plus-lighter` 保证正确交叉溶解。
- 支持面：View Transitions **Baseline since 2025-10-14**（Chrome 111 / Safari 18 / Firefox 144）；
  cross-document 仍无 Firefox（Chrome 126 / Safari 18.2）。
- 硬限制：**同一时刻只能有一个 view transition 在跑**，新的会令旧的跳到终点；它做的是
  「整文档快照」的伪元素动画，通过 `view-transition-name` 才能把某个元素切出独立快照组。
  （来源：https://developer.mozilla.org/en-US/docs/Web/API/View_Transition_API/Using ·
   https://developer.chrome.com/docs/web-platform/view-transitions/same-document ）
- **对本项目的判断**：舞台是长期存活的 SPA，演出要**持续进行**（立绘呼吸、后续台词），
  而 view transition 会把画面冻成快照。对「只换背景、人继续演」这种最常见的情况，
  双层 `<img>` cross-fade 更自然、且与正在跑的立绘动画天然共存。
  → **转场用双层 DOM + CSS opacity/transform 实现**（零额外 pass、走合成器）；
  View Transitions API 列为**将来可选的实现细节**（整舞台硬切/溶解），不进本次设计。

---

## 4. 设计推导：三轴模型

### 4.1 一个 Effect = (target, lifecycle, dual)

```
Effect {
  target:    camera | screen
  lifecycle: trigger | state
  recipe:    固定配方（时长/曲线/关键帧/终值），剧本不可见
  dual?:     bool —— 需要旧画面快照（仅转场）
}
```

**两个 target 的语义（2026-10-07 用户拍板）**：
- `camera` = **画面内容变换层**：作用在它上面，背景/立绘/CG **一起动**（抖动）。
- `screen` = **屏幕遮罩层**：效果叠加在画面之上、**画面内容不动**（闪光、黑边、暗角）。

- target 决定**挂在哪一层** → 渲染层在那一层上应用。
- lifecycle 决定**存在形态**（瞬时事件 vs 持久字段）与**回看行为**。
- dual 决定**实现形态**（单元素动画 vs 旧/新两份画面的交叉）。

### 4.2 生命周期语义对照（实现契约）

| 维度 | `trigger` | `state` |
|---|---|---|
| IR 形态 | 事件 `{effect, seq}`（seq 单调） | `VisualState` 持久字段 |
| 渲染 | 瞬时 CSS animation；nonce 重播；`fill: none` | class / CSS 变量 + `transition` |
| 重入（同词再写） | `seq+1` → 从 0% 重播 | 幂等改写，向新目标补间 |
| 回看（scrub） | 不重放（`.rewinding` 抑制，同现有） | `visualAt()` 重算，回到那一刻 |
| 刷新恢复 | 落到 `visualAt` 后的状态；不回放 | 同左 |
| `prefers-reduced-motion` | 时长→0（瞬时到终态） | 过渡时长→0（已在 `::reduce` 里统一） |
| 复位 | 播完自动回基态 | 需显式 `<fx target=… release/>` |
| 断点 | 一个 target 同时只放一个 trigger（叠加行为未定义，禁止） | 每个 channel 一个值（新替旧） |

> 「同时多个 trigger」的禁止沿用现有 `spriteAction.ts` 注释：两个行为词叠着演会互相打架。

### 4.3 语法锚定：为什么不是「一个通用 setter」
统一的是**引擎模型与配方表**，不是语法。剧本仍按可读性锚定：

- 属于某个角色的效果写在 `<actor>` 上（`action` / `shot` / `leave`）——「她在动」写在「她」身上。
- 镜头抖动、屏幕冲击走统一标签 `<fx target=… effect=…>`（target 只是作用面，不是某个角色）。
- 场景换底的方式仍是 `<scene transition=…>`（state + dual 效果，只在换层那一刻有意义）。

理由：v2 已定「面向 playwriter 而非代码编写员」。把 `nod` 写成 `<fx target="lucy" effect="nod"/>`
并不会更统一，只会更罗嗦、更容易把 id 写错。**真正的统一发生在 IR 与配方表**（见计划 §3）。

### 4.4 反组合爆炸的三条硬规则
1. **每个效果词声明合法目标集，且只挂一个自然目标**；越界即丢弃 + warning（模型下一轮自纠）。
2. **持续效果同 target 新值替旧值**，不无限堆叠；`<fx target=… release/>` 清空该 target。
3. **词表封闭、无自由参数**；加能力=加词，不加参数。

### 4.5 效果矩阵（Phase 1 起步词表）

| 效果 | target | lifecycle | 浏览器手段 | 成本 |
|---|---|---|---|---|
| 8 个 actor 行为词（nudge…sway） | actor（`action`） | trigger | 现有 `@keyframes` | 合成器 |
| actor `shot` | actor（`shot`） | state | `--scale`（现有） | 合成器 |
| `flash`（white/red/black） | screen | trigger | 纯色层 opacity 0→1→0 | 合成器 ⚠️ WCAG 闪烁阈值 |
| `shake`（light/heavy） | camera | trigger | `translate` 关键帧 | 合成器 |
| `letterbox`（on/off） | screen | state | 上下黑条 `::before/::after` | 合成器 |
| `vignette`（on/off） | screen | state | `radial-gradient` 覆盖层 | 合成器 |
| `transition`（cut/dissolve/fade/fade-white） | scene（dual） | state + dual | 双层 opacity / 纯色 veil | 合成器 |

> **不在 Phase 1**：`kenburns`/`grade`/slide-push 转场（模型支持，未注册）；
> `shot` 不做成 `<fx>`；不做组合打包词。

> `grade` 是「被否决的 `mood`」的显式替代：只做一件事（一个静态色彩滤镜），不打包暗角/转场。
> 只收少数 preset，不收自由参数。

---

## 5. 风险、反例与「不做」清单

### 5.1 风险
1. **转场的 dual-source 与既有单 `<img>` 结构冲突**：必须改成旧/新两层，否则 `cut`/`dissolve`
   无从谈起。改动点集中在 `StageTheater.tsx` 的 bg 与 cg 渲染 + `visual.transition` 结构。
2. **状态效果的「回看一致性」**：trigger 不重放、state 重算——两者规则不同，若实现时混用会
   出现「滚回去闪光还在放」或「滚回去暗角没了」。必须在 `VisualState` 里把 trigger 也存成
   `{effect, seq}`（沿用 `actionSeq` 思路），并让 `.rewinding` 统一抑制。
3. **`filter` 的过渡成本**：`grade` 切换若做 `transition: filter`，低端机每帧重绘。
   只允许短时长、静态终值；或干脆跳变。
4. **WCAG 2.3.1**：`flash` 连发（1 秒 3 次以上相反亮度跃迁）违规。DSL 层不提供连发写法，
   解析端可对「短时间内重复 flash」给 warning。
5. **回看水位线**：`visualAt` 从空场重折，trigger 的 `seq` 会从头累加——与现场 seq 不同号。
   渲染层只认「值变化」而非绝对 seq，避免滚回时误触发。

### 5.2 明确不做（避免过度设计）
- 粒子、视频、Live2D、序列帧（261002 已定不进 v2）。
- 逐像素几何形变转场（ripple/swirl/wave/glitch/chromatic aberration/bloom/真 DOF）——
  必须 WebGL，成本高，本次排除。
- 自由参数：毫秒、曲线名、坐标、opacity/blur 数值、z-index 一律不进剧本。
- `mood` 一词打包（用户 2026-10-07 明确否决）。
- 任意关键帧 / 时间轴（Ren'Py ATL 那种「给写代码的人」的能力）。
- 条件（`cond`）、并行块、`wait`/`async` 语法——属于另一条需求轴，本次不碰。

### 5.3 与既有任务的边界
- `title` 标签（进入即隐藏对话框、逐句点击）——另有任务，不碰。
- 结局记录 / 多周目——另有任务，不碰。
- `dsh-aivn` 插件（提示词 + A 区注入 + Client）——不在本任务；但 `apps/server/src/prompt.ts`
  的 FORMAT_RULES 是本仓库的剧本契约，需同步（见计划 §6）。
