# Stage DSL `title`：全屏文本卡（章节标题 / 诗歌 / 独白）

日期：2026-10-07 ｜ 仓库：`stage-ai`（`packages/core` / `packages/stage` / `apps/server`）、`dsh-aivn`（消费者）
研究输入：[`261007-dsl-title.research.md`](261007-dsl-title.research.md)

> 本阶段**只设计，不实施**。本文给出可直接据以实现的语法、IR、生命周期、交互、谱系与主题方案，并列出两个仓库的逐文件影响面。

---

## 1. 需求与目标

在舞台上显示一块**全屏文本卡**，用于章节标题、诗歌、独白等"整屏是文本、对话框让位"的段落。已对齐的方向：

- 进入 title **隐藏对话框**（台词条），离开时恢复；
- 文本对齐五档：左上 / 右上 / 左下 / 右下 / 居中（默认居中）；
- 多行文本两种出法：**整段一次出** 或 **逐句出**（逐句时每次点击出下一句）；
- 可与黑场 / 白场（纯色背景）配合。

**非目标**（明确排除）：定时自动淡出（本引擎没有时间轴时钟）；滚动字幕（crawl/roll）；标题卡专用背景图（用 `<scene>` 解决）；转场效果的参数（由独立任务提供词汇，本文只引用）。

---

## 2. 用户路径

### 2.1 剧作家怎么写

篇章开头，先切纯色场，再铺标题卡（`mode="block"` = 整段一次砸下来）：

```text
<scene bg="black" transition="fade"/>
<title mode="block" align="center">第一章
风起</title>
<say id="protagonist">……又是这里。</say>
```

诗歌（缺省即逐句、居中）：

```text
<scene bg="black"/>
<title align="center">床前明月光
疑是地上霜
举头望明月
低头思故乡</title>
<stop placeholder="……"/>
```

章节内独立小标题（右上、一次出）：

```text
<title align="top-right">三日后 · 黄昏</title>
```

### 2.2 玩家看到什么

1. 舞台切到黑场（或白场 / 已有场景图）；
2. 对话框整条消失，文本卡铺满画面，文本按 `align` 落在对应角落或居中；
3. `mode="lines"`（缺省）：每读一行点一下出下一行；打字中点击先"瞬显本行"，末行读完再点一下离开；
4. `mode="block"`：整卡是**一个揭示单位**，打字机把整段打完，点一下离开；
5. 点击离开后对话框恢复，继续演后面的台词；若 title 后就是停止点，则在恢复后的舞台上摆选项/输入框。

### 2.3 回看 / 重放 / 冷启动

回看或重建到 title 所在处时，**整卡一次性显示**（不重演逐句点击）——理由见 §7。玩家可以向回翻到标题卡重读。

---

## 3. 语法（`@aivn/core`）

### 3.1 形态

**包裹标签**，与 `<say>` / `<narrate>` / `<thought>` 同族：

```text
<title align="top-left|top-right|bottom-left|bottom-right|center" mode="block|lines">
正文（原生文本，可含换行）
</title>
```

| 属性 | 取值 | 缺省 | 语义 |
|---|---|---|---|
| `align` | `top-left` `top-right` `bottom-left` `bottom-right` `center` | `center` | 文本块在屏幕上的锚点 |
| `mode` | `block` `lines` | `lines` | `block`=整段一次出；`lines`=逐句出（每个物理非空行一个揭示单位） |

**答设计问题 1（语法形态）**：标签名 `title`；正文是多行块（原生文本、零转义，沿用 say 的正文规则）；两个属性 `align` 与 `mode`；模式取值 `block`/`lines`，**缺省 `lines`**。

缺省取 `lines`：本标签的主要动机就是诗歌/独白的逐句节奏；单行标题在 `lines` 下退化为"一个揭示单位"，与 `block` 完全等价，所以缺省 `lines` 对标题场景零损失，却让诗歌不必显式声明。要"整段一起砸下来"的震撼感才写 `mode="block"`。

### 3.2 逐句的句子边界：物理换行，不做标点切分

`lines` 模式的"一句" = **正文里的一个非空物理行**。理由：

- 诗歌的"句"就是换行——标点切分对无标点的诗行完全失效；
- 中文句号/逗号/省略号切分规则复杂且不可控，模型无法预测自己的一段文字会被切成几句；
- 换行是作者显式给出的结构，`<title>` 的正文本来就是块文本，换行天然可用。

空行（纯空白行）不计入揭示步，但**原样保留在渲染里**（作为诗歌的分节间距）。

### 3.3 校验与降级（与既有标签同口径）

- `align` 非法 → 取 `center`，挂 `malformed_tag` 警告（不丢整条，与 `actor` 的 `shot`/`anchor` 一致）；
- `mode` 非法 → 取 `lines`，挂警告；
- 未知属性忽略（同上）；
- 自闭合 `<title/>` → 包裹标签不能自闭合，`dropTag` + 警告（与 say 一致）；
- 正文为空（`<title></title>`，或全是空白）→ 不产出任何事件，挂警告（一张空卡没有意义，且会凭空制造一个需要点掉的空屏）。

### 3.4 spec 层新增（`packages/core/src/dsl/spec.ts`）

```ts
export const TITLE_ALIGNS = ["top-left","top-right","bottom-left","bottom-right","center"] as const;
export type TitleAlign = (typeof TITLE_ALIGNS)[number];
export const TITLE_MODES = ["block","lines"] as const;
export type TitleMode = (typeof TITLE_MODES)[number];
export const DEFAULT_TITLE_ALIGN: TitleAlign = "center";
export const DEFAULT_TITLE_MODE: TitleMode = "lines";
export function isTitleAlign(v: unknown): v is TitleAlign;
export function isTitleMode(v: unknown): v is TitleMode;
```

`DSL_TAGS` 增加 `"title"`；`VOID_TAGS` **不**含它。

---

## 4. IR、解析与谱系

### 4.1 事件（`packages/core/src/dsl/events.ts`）

沿用 say 的三段式，支撑流式与打字机：

```ts
| { kind: "title_start"; align: TitleAlign; mode: TitleMode; nodeId?: string }
| { kind: "title_text"; delta: string }
| { kind: "title_end" }
```

`onStageEvent` 里 `title_start` 与 say/narrate/thought 同样补 `nodeId`（行级锚点）。

### 4.2 解析器（`packages/core/src/dsl/parser.ts`）

- `OpenWrap.tag` 联合增加 `"title"`；`OpenWrap` 增记 `align`/`mode`。
- `handleTag` 的 `case "say"|"narrate"|"thought"` 拆出 `case "title"`：校验两属性后开 wrap，`emit title_start`。
- `emitText`：`openWrap.tag === "title"` → `title_text`。
- `closeWrap`：`title_end`。
- 消息边界 `endMessage` 自动闭合 title（沿用包裹标签规则，"收尾保留已流出的文本"）。
- **`</title>` 之前的流式切分不需要在解析器里做**：正文作为一个 `title_text` 流交给客户端，句子边界在渲染层按 §3.2 计算（见 §5.3）。这样 IR 形状与 say 完全同构，谱系重放更简单。

### 4.3 谱系（`packages/core/src/lineage/model.ts` + `replay.ts`）

- `LineageEventKind` 增加 `"title"`。
- `accumulateLineage`（`apps/server/src/orchestrator.ts`）：`title_start` 开一条 `OpenLine.kind:"title"`、attrs 存 `{align, mode}`；`title_text` 累积；`title_end` 落谱系节点 `title{text, attrs:{align,mode,seq}}`。`OpenLine.kind` 联合加 `"title"`。
- **title 算"有内容"**：`title_end` 时把正文推进 `beatLines`，于是"只有一张标题卡 + 一个停止点"的一拍不会被判废（"三无轮"判据不受影响：title 是内容，不是 scene/actor 那样的控制指令）。
- `lineageToEvents`（`replay.ts`）：`case "title"` → `pushLine(base, title_start, title_text, title_end, text)`（空文本走 2-seq 分支，与 say 同规格，保持 seq 尺子）。
- `toNodeView` 通吃 attrs，无需特殊分支。
- title **不配音**：`feedVoice` 默认分支已覆盖（只有 say 三段配音）。

---

## 5. 生命周期与交互语义

**答设计问题 2（生命周期）**：`</title>` 是 title 内容的**结束标记**（IR 的 `title_end`），但屏幕上的 title 由**玩家点击离开**——不自动收，必须点掉最后一句。恢复对话框的时机 = 播放头越过 title 这一"行"。

### 5.1 模型：title 是 cue 流里的一个"行"

title 进入 `ScriptBuilder` 后与 say 一样，是一条 `ScriptLine`（`type: "title"`，带 `align`/`mode`），并往 cue 流里压一条 `{kind:"line"}`。于是：

- **对话框的显隐 = 当前显示行是不是 title**：`view.type === "title"` 时隐藏 `.theater-dialog`，否则显示。不需要额外的"hide/show"状态机——“离开 title"就是播放头走到下一行。
- title 前后与普通台词无缝衔接：`<title>…</title><say>…</say>` 里，点掉 title 的同一击会立刻消费到 `say` 的 cue。

### 5.2 结束条件与"必须点掉最后一句"

- `mode="block"`：整段是一个揭示单位。打字机打完后**再点一下**离开。
- `mode="lines"`：每行一个揭示单位。打字中点击 → 瞬显本行；已显完点击 → 出下一行；末行已显完点击 → 离开。
- 流式未闭合时（`title_end` 未到）：若可揭示的文本已全部显示，点击**不做任何事**（还在落笔，等它写完），避免"点了一下没反应其实是没内容"的错乱。`title_end` 一到，允许离开。

### 5.3 客户端状态机（`packages/stage/src/director.ts` 的 `usePlayback`）

新增少量纯逻辑，复用现有两段式点击：

- 纯函数 `titleSteps(text)`：返回每个非空行结束处的字符偏移数组（供揭示目标用）。
- `revealTarget`：`current.type === "title" && mode === "lines"` 时为 `steps[titleStep]`，否则为 `current.text.length`。打字机与 `lineComplete`/`exhausted` 一律改用 `revealTarget`（这是为了逐句模式只把已揭示的前缀当作"该显示的字数"）。
- `advance()` 增加 title 分支：

  ```
  if 打字未满 revealTarget          → 瞬显到 revealTarget（原有第一段）
  else if current 是 title:
       if !titleClosed                → 什么都不做（等流式写完）
       else if titleStep < lastStep   → titleStep++（出下一句）
       else                           → dismissTitle() + consumeNext()
  else                               → consumeNext()（原样）
  ```

  `dismissTitle()`：把当前行清空（`setCurrentKey(null)`、`setShownLength(0)`），再 `consumeNext()`——有后续 cue 就立刻接上（对话框随之恢复），没有就停在空对话区（停止点面板/继续出口照常出现）。**不改动普通行的"末行停留"行为**。

### 5.4 与 `<stop>` 的点击语义区分

**答设计问题 3（交互语义）**：不需要客户端"判别这是哪一种点击"——两者本来就处于**不同的层**，沿用现状即可：

- **逐句揭示**属于播放层：由 `advance()` 处理，是"推进当前文本"这条单义动作的扩展；
- **`<stop>`（选项/自由输入）**属于交互层：StopPanel / 选项浮层用自己的按钮截获点击；此时舞台点击调用 `advance()`，而 cue 已消费到头，`consumeNext()` 空转，什么也不发生（`stopAffordance` 对真停止点本就返回 `none`）。

约束：**`<stop>` 不写在 `<title>` 正文里**——`stop` 是 void 标签，它要么在 `</title>` 之后，要么根本不该出现在块内。写进块内会被当正文文本演出来（因为 title 是包裹标签）。在提示词里写明"标题卡之后另起一行写停止点"。

---

## 6. 纯色背景（黑场 / 白场）

**答设计问题 4（纯色落地）**：**不新造机制，扩展 `bg` 的取值命名空间**——与 Ren'Py "把 Solid 当具名图"的惯例一致（research §6）。

### 6.1 规则

`<scene bg="…">` 的值分两类：

| 值 | 解析 |
|---|---|
| `black` / `white`（大小写不敏感） | 纯色场（`#000` / `#fff`） |
| `#rgb` / `#rrggbb` | 纯色场（任意色） |
| 其余 | 素材 id，走现有 `assets/backgrounds/<id>` 查表，行为不变 |

选择保留色名 + 色值字面量：

- 保留 `black`/`white` 是因为需求点名黑场/白场，且 Ren'Py 先例就是这么做的；
- 额外的十六进制字面量几乎零成本，覆盖"黄昏橙""血红"这类演出常用纯色场，避免将来再开一次语法；
- 不引入 `<scene solid="…">` 或 `field=` 新属性：同一种东西（一块底）不该有两个入口，`bg` 的语义就是"这一刻的底"。

### 6.2 落点

- 解析与谱系**不感知**纯色：`attrs.bg` 原样存 `"black"`/`"#1a1a2e"`，重放与回看自然带上。
- **core 新增纯函数**（`packages/core/src/dsl/sceneBg.ts`）：

  ```ts
  export type SceneBg = { kind: "color"; color: string } | { kind: "asset"; id: string } | null;
  export function resolveSceneBg(bg: string | undefined): SceneBg;
  ```

  客户端（`packages/stage/src/StageTheater.tsx`）先过它：`kind:"color"` 直接渲染 `background: <color>` 的底层 `div`（复用 `.theater-bg-fallback`），`kind:"asset"` 才进 `index.bg()` 查表。

### 6.3 与 title 的配合

title 本身**不设背景**，它是透明的前景文本层。要黑场/白场就前一行写 `<scene bg="black"/>`——保持"底"与"文"两件正交的事分开。这也让 `<scene>` 的转场（`transition`）直接作用于色场，无需 title 关心过渡。

---

## 7. 谱系 / 重建 / 回放：逐句模式重放显示全部

**答设计问题 5（重建 / 谱系）**：

- **落谱系**：title 是一个 `LineageEventKind: "title"` 节点（§4.3），带 `align`/`mode` 与正文，可被 `lineageToEvents` 重放、被 `rebuildStage` 从转写重投影。
- **重放是"显示全部"**：`lines` 模式只在**实时首次演出**时逐句揭示；一旦进入重建 / 回看 / 冷启动 / 续演快进，整卡**一次性显示**。理由：
  1. 重建是**状态的重新投影**，不是"重演一次需要玩家点击的交互"——让玩家为一首已经读过的诗重新点 N 次是错的；
  2 `.theater-stage.rewinding` 与 `resumeAfterReset` 的快进本就是"所见即上次位置"的语义；
  3. 与 `<stop>` 不同：停止点是**待玩家表态的未决状态**，重建时必须重新摆出来（所以谱系保留 options）；title 的"逐句"只是一次呈现动画，不是一个未决状态，重放无需重放动画。
- **实现**：`usePlayback` 在 reset/seek/快进路径上，对 title 行直接置 `titleStep = lastStep`、`shownLength = text.length`；回看（scrub）路径本就恒显示全文（`viewLength` 为全文），无需额外处理。

`rebuildStage`（dsh-aivn `src/stage-log.ts`）用同一个 `StageDslParser` 重喂助手文本，因此 title 帧与实时逐帧同构，天然被重投影。`verify-rebuild.mjs` 增加一条 title 夹具，断言重建后 title 帧完整（`title_start`/`title_text`/`title_end` 都在）。

**LLM 上下文重建**：`apps/server/src/rebuild.ts` 的 `lineageToBeats` 增加 `case "title"`，把标题卡写回助手脚本体（形如 `（标题）第一章 风起` / `（题记）…`），让剧作家在后续轮次里知道自己写过这张卡。限制级折叠逻辑不受影响（title 节点照常带 `nsfw` 标）。

---

## 8. 与 `theme.json`（舞台皮肤）的关系

**答设计问题 6（主题）**：字体、颜色、投影走**舞台皮肤令牌**；**对齐是逐实例属性，不进令牌**。

- 标题的两项属性 `align`/`mode` 是"这一刻要什么"，属剧本；字体/颜色/投影是"这部剧长什么样"，属皮肤——与 `--dialog-*`、`--font-ui` 的分工一致。
- `packages/stage/src/stage.css` 的 `.stage-root` 新增默认令牌：
  - `--title-ink`（字色，默认接近 `--dialog-ink`）
  - `--title-font`（字族，默认继承 `--font-ui`；独立令牌是为了标题能用衬线而对话用无衬线）
  - `--title-shadow`（投影，默认与 `--dialog-text-shadow` 同形，保证压在场景图上仍可读）
- `dsh-aivn/src/style-tokens.ts` 的 `STYLE_TOKENS` 新增分组 **「标题卡」**，收录这三个键（复用现有 `parseColor` / `parseFontStack` / `parseShadow` 校验器，不新增取值形状）、`sanitizeTheme` 与写闸自动覆盖。`verify-style.mjs` 的防漂移断言同步。
- 字号/行距/字距：**不进令牌**。标题字号用响应式 `clamp()` 按视口算（手机/桌面自适应），暴露出去只会让模型写出在小屏溢出的数值。

---

## 9. 影响面（逐文件）

### 9.1 `stage-ai` / `packages/core`

| 文件 | 动作 |
|---|---|
| `src/dsl/spec.ts` | `DSL_TAGS += "title"`；`TitleAlign`/`TitleMode`/`TITLE_ALIGNS`/`TITLE_MODES`/默认值/守卫 |
| `src/dsl/events.ts` | `title_start` / `title_text` / `title_end` 事件 |
| `src/dsl/parser.ts` | `OpenWrap` 收 title；`handleTag` 新增 case；`emitText`/`closeWrap` 分支 |
| `src/dsl/sceneBg.ts`（新） | `resolveSceneBg()` 纯函数 |
| `src/lineage/model.ts` | `LineageEventKind += "title"` |
| `src/lineage/replay.ts` | `lineageToEvents` 的 `case "title"` |
| `src/index.ts` | 导出新类型与 `resolveSceneBg` |
| `test/parser.golden.test.ts` | title 各写法 / 撕裂喂入 / 非法属性 / 空正文 / 嵌套 stop |
| `test/lineage*.test.ts` | title 落谱系 + 重放同规格 |

### 9.2 `stage-ai` / `packages/stage`

| 文件 | 动作 |
|---|---|
| `src/script.ts` | `ScriptLine.type += "title"`，带 `align`/`mode`/`titleClosed`；`ScriptBuilder` 三态处理 |
| `src/transcript.ts` | `SPOKEN`/`RECORDED` 收 `"title"`；`TranscriptEntry.type += "title"`（进回顾，但**不可改写**——`editableNodeId` 不含 title） |
| `src/director.ts` | `titleSteps()` 纯函数；`revealTarget`/`titleStep`/`dismissTitle`；`advance()` 分支；`lineEntry` 带上 align/mode |
| `src/StageTheater.tsx` | `view.type === "title"` 时渲染 `.theater-title`（全屏、五档对齐）、隐藏 `.theater-dialog`；`bgUrl` 前过 `resolveSceneBg` |
| `src/assets.ts` | 色值不进素材查表（`bg()` 遇色值返回 null，或由 StageTheater 提前分流） |
| `src/stage.css` | `.theater-title` + `.title-align-*` 五档；`.theater:has(.theater-title) .theater-dialog { display:none }`；三个令牌默认值 |

### 9.3 `stage-ai` / `apps/server`、`apps/web`

| 文件 | 动作 |
|---|---|
| `apps/server/src/orchestrator.ts` | `OpenLine.kind += "title"`；`onStageEvent` 补 nodeId；`accumulateLineage` 三态 + `beatLines` |
| `apps/server/src/rebuild.ts` | `lineageToBeats` 的 `case "title"` |
| `apps/server/AGENTS.md` | DSL 小节补 title 与纯色 bg |
| `apps/web/src/` | 无结构性改动（色场渲染落在 `@aivn/stage`）；设置页主题仍走既有 `theme.css` |
| `README.md` | DSL 语法表补 `<title>`；`<scene bg>` 保留色名/色值说明 |

### 9.4 `dsh-aivn`（消费者）

| 文件 | 动作 |
|---|---|
| `src/playwriter/prompt.ts` | `FORMAT_RULES` 新增《标题卡》章：`<title>` 两个属性、两种模式、黑/白场配合、`<stop>` 另起一行 |
| `src/style-tokens.ts` | `STYLE_TOKENS` 新增「标题卡」组（`--title-ink`/`--title-font`/`--title-shadow`）；默认值同步 `stage.css` |
| `src/play-files.ts` | 无需改（title 不引入文件） |
| `e2e/verify-rebuild.ts` | 夹具加一个 title，重投影后仍完整 |
| `e2e/verify-style.mjs` | 令牌防漂移表加三项 |
| `lib/`（构建产物） | `npm run build` 后一并提交 |
| `README.md` | DSL 与皮肤令牌文档同步 |

> `dsh-aivn` 吃的是 `@aivn/core` 的 `dist`：改 core 后必须重建 `packages/core`（`pnpm -r build`）并同步兄弟仓的构建产物。

---

## 10. 测试

**core**（`parser.golden.test.ts` / `lineage.test.ts`）：

- `<title>` 三属性组合事件序列；撕裂喂入（`feedTorn`）后事件同构；
- 非法 `align`/`mode` 降级到默认并挂警告；自闭合与空正文被丢弃；
- title 落谱系后 `lineageToEvents` 还原 `title_start/text/end`，seq 与现场一致；
- `resolveSceneBg`：`black`/`white`/大小写/`#rgb`/`#rrggbb`/普通 id/空值的分类。

**stage**（纯函数单测，不依赖 DOM）：

- `titleSteps()` 对空行、多行、尾随换行、无换行的边界；
- `advance()` 的 title 状态机（打字→瞬显 / 逐句推进 / 未闭合不响应 / 末句后 dismiss）——把判定抽成纯函数测。

**server**（`rebuild` / `lineage-ops`）：

- title 节点在 `lineageToBeats` 里写回脚本体；含 title 的一拍不被判废。

**dsh-aivn**：`node e2e/run.mjs rebuild` 的 title 夹具；如涉及页面展现，`stage` 套件补一条冒烟（可选）。

**范围**：只跑受影响的 core / stage / server 用例；不触发任何真实外部 API。

---

## 11. 边界与未决

- **title 不可改写**：v1 不进 `EDITABLE_KINDS`；回顾里可见但"改写"按钮置灰。若将来需要，再按 say 的 `recordEdit` 路径接。
- **转场**：title 的进入/退出当前是即时切换（随对话框显隐）。若动效任务定义了转场词汇（`fade`/`dissolve`…），可后续给 `<title>` 加可选 `transition` 属性——**本文不设计该词汇，只预留位置**。
- **自动模式**：`Auto` 打开时标题卡不自动推进（没有时间轴时钟）。这是刻意取舍；若将来需要，再在动效任务里一并设计"按字数估算的停留时长"。
- **超长文本**：不设滚动；正文过长由作者控制（提示词提醒标题卡适合短文本，长篇独白用 `<narrate>`/NVL 式排版另议）。
- **与停止点共存**：允许 `<title>` 之后即写 `<stop>`（诗歌接选择）；玩家离开 title 后选项摆出。禁止在 `<title>` 正文内写结构标签。

---

## 12. 关联任务

- **动效 / 转场**（独立任务）：title 的进入/退出过渡复用其转场词汇；本文只预留 `transition` 属性位置，不重复设计。
- **结局 / 多周目**（独立任务）：不在本任务；title 作为普通可重放节点，不与其耦合。
