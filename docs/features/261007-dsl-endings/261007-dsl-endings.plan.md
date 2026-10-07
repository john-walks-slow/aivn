# 结局与多周目（Stage DSL + dsh-aivn）设计

日期：2026-10-07 ｜ 仓库：`stage-ai`（`packages/core` 定语法/IR、`packages/stage` 渲染）、`dsh-aivn`（消费者：注入、终局态、提示词）
状态：**已实施**（见文末「实施记录」）。调研见同目录 `261007-dsl-endings.research.md`。

---

## 0. 摘要

给 Stage DSL 增加一个**结局**语法 `<ending …/>`，放在剧本正文最后一行、取代那一轮的 `<stop>`；到达结局后
舞台进入**终局态**——不给按钮、不可继续，出口交给 DSH 的分支 / 新会话。结局由**引擎自动落账**到工作区级的
`endings.json`（独立于剧内状态 `memory/always/state/*`），并在结局后**单开一轮**生成 `<epilogue>` 收束散文，
填进结局卡。`play.json` 增加可选开关 `newGamePlus`：开启后，新周目开头把「此前已达成的结局」注入提示词，
由剧作家决定怎么体现多周目。

设计的三条主线：

1. **结局是标签，不是按钮**——保住「轮尾是助手消息」这条 DSH 分支 / 舞台重建的硬约束（沿用 `<stop>` 的教训）。
2. **账本是引擎独占的工作区级持久数据**——以 `id` 去重、跨周目累加，与剧内状态解耦。
3. **终局态从谱系重推**——冷会话首开 / 分支 / 回看 / `rebuildStage` 都只能靠「助手文本里有 `<ending>`」这一事实，
   不引入任何只活在内存里的终局标记。

---

## 1. 现状锚点

| 关注点 | 现状 | 位置 |
|---|---|---|
| 停止点 DSL | `<stop options=… \| placeholder=… \| 空/>`，自闭合、在 `VOID_TAGS`；**剧本末行**，保住轮尾是助手消息 | `packages/core/src/dsl/spec.ts:38`、`parser.ts:285` |
| IR 管线 | 剧作家文本流 → `StageDslParser` → `StageEvent` → `StageHub` 帧 → SSE → 客户端 | `dsh-aivn/src/stage-tap.ts:98`、`hub.ts:65` |
| 引擎注入 | 按 `message.id` 在 `InjectedMessages` 摘除（不是按正文）；`agent.inject`（同轮）/ `agent.followup`（下一轮） | `dsh-aivn/src/injected.ts`、`session.ts:72` |
| A 区注入 | `systemPrompt.section/context`，动态、每轮求值；段序见 `ORDER` | `dsh-aivn/src/play-context.ts:44` |
| 会话工作区=剧目根 | `play.json` 是身份证；`memory/`、`assets/` 在它下面 | `dsh-aivn/src/play.ts` |
| 剧内状态 | `memory/always/state/{scene.md,threads.md,state.json}`，**剧作家自己写** | `play-context.ts:344`、`playwriter/prompt.ts:143` |
| 舞台出口判定 | `stopAffordance()`：`ready && isNoStop && !stop` 时给「点舞台继续」 | `packages/stage/src/playbackState.ts:112` |
| 客户端出口渲染 | `StageTheater` 的 `overlay` 放 `StopPanel`；`canContinue` 控点舞台 | `dsh-aivn/src/client/stage-view.tsx:508` |
| 重投影 | `rebuildStage()` 只重放**助手文本**、逐条重新解析 → 与实时同构；结构性变更（回退/重写/分支/冷开）都走它 | `dsh-aivn/src/stage-log.ts:80` |
| 剧目配置 | `PlayConfig`（`id`/`title` 必填，camelCase 可选项如 `scriptLanguage`） | `packages/core/src/play/config.ts:192` |
| AIVN 本体 | `apps/server` 仍走 `beatTool`；`packages/stage` 与 IR 是两边共用 | `apps/server/src/orchestrator.ts` |

**关键约束**：`<stop>` 当初从工具改回标签，就是为了让轮尾是「助手消息」（DSH 的「在新对话中分支」与舞台重建
都只认这种轮尾）。结局必须延续这条路线。

---

## 2. 心智模型与术语

- **周目（playthrough）**：一个剧作家会话，从**空会话面**开始走到结局（或中途弃坑）。周目 = 会话。
- **分支（branch）**：DSH 原生的「在新对话中分支」产生的子会话，继承父会话前缀。**分支不是新周目**。
- **结局（ending）**：一个周目的终点。由剧本末行的 `<ending id title subtitle/>` 表达。
- **账本（ledger）**：工作区级 `endings.json`，记录「这座剧目达成过哪些结局、在第几周目达成」。跨周目继承。
- **剧内状态（play state）**：`memory/always/state/*`，属于**单个周目**；新周目开始即重置。
- **收束散文（epilogue）**：结局后单独一轮生成的整段回顾 + 主题收束，展示在结局卡上。

一句话区分两者：**账本记「这座剧目发生过什么」，剧内状态记「这一周目此刻在哪里」。** 重置后者不该动前者。

---

## 3. 六个设计问题的正面回答

### Q1 语法：`<ending id title subtitle/>` 的字段；是否复用「幕间/卡」渲染

**表单**

```
<ending id="true_sunrise" title="晨光" subtitle="这一次，她没有回头"/>
```

| 属性 | 必填 | 说明 |
|---|---|---|
| `id` | 是 | 结局身份（账本键、NG+ 引用）。命名规则同剧目/主体 id：字母或数字开头，不含空白与路径分隔符。**不能是纯机器序号**，要能被剧作家在不同周目里稳定复用 |
| `title` | 否（强烈建议） | 结局卡主标题。缺省回落到 `id` |
| `subtitle` | 否 | 结局卡副标题：一句氛围 / 主题短句 |

- 自闭合、进 `VOID_TAGS`、与 `<stop>` 同位（**剧本正文最后一行**）。`id` 缺失或非法 → 整条丢弃 + `malformed_tag` 告警
  （与 `actor`/`cg` 一致）。
- **不在本期加 `type`（good/bad/true）**：本需求只要 id/title/subtitle；类型是画廊排序 / 配色的未来需要，届时
  以可缺省枚举增量加入即可（白名单外静默按缺省，是既有约定）。
- **结局之后的内容一律丢弃**：解析器见到 `<ending>` 后，同一条消息后续产出的事件（台词 / 场景 / 又一个 `<stop>`）
  全部丢弃并挂 `content_after_ending` 告警。终局必须是确定的，不能靠模型自觉停笔。

**不复用 `StopPanel`，复用它的视觉**：`StopPanel` 是**交互**停止点（选肢/自由输入/继续），语义与终局相反。
新增一个**非交互**的 `EndingCard` 组件，复用舞台上既有的卡片视觉语言（`.choice-overlay` 遮罩 + `.choice` 卡片基样式），
另加 `.ending-*` 修饰类。这样「结局卡看起来像一张卡」，但没有任何按钮。

### Q2 账本落点、写入者、记什么

**落点**：工作区根 `<playRoot>/endings.json`（与 `play.json` 同级，引擎独占）。

- 为什么在根、不在 `memory/`：`memory/` 是**剧作家的剧内域**（`premise`/`craft`/`index`/`state` 都由它写），
  新周目会重置其中一部分；账本必须**独立于剧内状态**、由引擎独占，放在根上语义最清楚、也不会被任何 reset 波及。
- 为什么不进 DSH 会话存储：账本要跨**会话**（跨周目）继承，会话存储天然按会话分片；工作区文件是唯一跨周目稳定的载体。

**写入者**：**引擎**。在 `stage-tap` 的**实时**解析回调里，见到 `ending` IR 即落账——

```ts
// stage-tap.ts：实时 parser 回调
parser = new StageDslParser((event) => {
  const frame = hub.append(sessionId, event);
  feedVoice(sessionId, event, frame.seq);
  trackTerminal(sessionId, event);          // 维护 per-session 终局标记 + 收集 epilogue（实时与重建都要）
  if (event.kind === 'ending') ledger.recordEnding(playDir, event, sessionState.playthrough);
});
```

- **不靠剧作家记得写**：模型可能漏，而引擎在 IR 到手的**那一刻**就能落账，位置与内容都确定。
- **重建绝不落账**：`rebuildStage()` 会重新解析助手消息、重放 ending IR；它只调 `trackTerminal`（终局标记），
  **不调** `ledger.recordEnding`。这样「回看 / 冷开 / 分支」不会把同一结局重复记账。
- 账本写入**原子**（临时文件 + rename），避免半截 JSON。

**记什么**（详见 §6）：`id`、`title`、`subtitle`、首次/末次达成时间、**在哪些周目达成**（`reachedIn`，天然去重）、
以及收束散文 `summary`（`epilogue` 落地时回填）。另有顶层 `playthroughs`（已开始过多少周目）。

### Q3 整体总结怎么触发

**触发**：结局是**当前轮**的末行；收束总结必然是**结局之后的额外一轮**。机制沿用既有注入：

1. 实时解析见到 `ending` IR → 引擎调 `agent.followup(summaryInstruction)`（**下一轮**、不是 `inject` 同轮），
   并用 `injected.remember(sessionId, message.id)` 登记摘除——**按 `message.id`，不按正文比对**。
2. `summaryInstruction` 正文（括号舞台指示，剧本契约里给剧作家的口径）：

   > （结局已到达：`<title>`。请为这一周目写一段收束全文的散文总结，作为 `\\<epilogue>…</epilogue>` 输出：
   > 回顾这段旅程、点出主题与代价，不要写新对白、不要推进剧情、不要再给停止点。写完就停笔。）

3. 剧作家在**新的一轮**里输出 `<epilogue>正文</epilogue>`；解析器产出 `epilogue` IR；客户端把它填进结局卡。

**呈现**：**展示在结局卡上**（卡片内的收束区），而不是当成舞台上又一段普通台词。理由：收束散文属于这个结局、
属于终局界面；把它当普通行会让「剧终」与「还有台词」语义打架。同时把它回填进账本 `summary`，供 NG+ / 未来画廊使用。

- 收束散文必须**单独一轮**：结局那一轮正在收笔，且必须保持「结局是最后一行」；把散文塞进同一轮会破坏这条约束。
- `epilogue` 是**新标签**（形如 `<narrate>` 的包裹标签），不复用 `<narrate>`：复用会让「哪一轮的 narrate 算收束」
  变成隐式状态，且重建时无法稳定还原成终局卡的一部分。独立标签让解析、渲染、重建三处口径一致。

### Q4 终局态如何从谱系推导

**唯一真相源仍是会话面（`session.surface`）里的助手文本**；终局态就是「重放后出现过 `ending` IR」。四处路径自然覆盖：

| 路径 | 机制 | 结果 |
|---|---|---|
| 冷会话首开 | `stage-log.ensure()` → `rebuild()` → `rebuildStage()` 重解析助手文本 | 重放含 ending IR → 终局 |
| 分支（DSH 原生） | 子会话带父会话前缀 → `rebuildStage()` 重放 | 前缀含 ending → 终局 |
| 回看 / 跳转 | `rebuildStage()` 重放当前分支 | 该分支含 ending → 终局；回退到结局之前 → 无 ending → 恢复可继续 |
| 回退 / 重写 | 替换标记触发 `stage-log` 重投影 | 结局消息被作废 → 退出终局（正确） |

引擎侧维护一个 **per-session `ended` 标记**，在**实时**与**重建**两条解析回调里都更新（`trackTerminal`）。
它只服务两件事：拦截终局后的玩家输入（见下）、给 `routes` 提供判断；**界面渲染不依赖它**——界面只认重放出来的 IR，
所以刷新 / 重建后终局态不会丢。

**客户端**：`stage-view.tsx` 在 SSE 处理器里像今天捕获 `stop` 那样捕获 `ending` / `epilogue`：

```ts
if (frame.event.kind === 'ending') { setEnding({...}); }
if (frame.event.kind === 'epilogue_text') { appendEpilogue(delta); }
```

`stopAffordance` 增加 `ended`：终局时返回 `{ showContinueCard: false, clickToContinue: false }`（**这是必须的**——
终局的 `sawStop=false` 会让 `isNoStop=true`，不改就会摆出「点舞台继续」）。`StageTheater` 增加可选 `ended` 属性，
终局时 `onStageClick` 直接返回、不显示「点击舞台继续生成」提示；`EndingCard` 经 `overlay` 挂进画面区并就地吃掉点击。

**「无法继续」的兜底**：终局会话**拒绝玩家输入**。`stage-tap.onInput` 在 `injected.claim` 之后、`isPlaywriter` 之后
加一道 `hasEnded` 判断：命中即丢弃（不投给剧作家）；`routes.ts` 的 `/aivn/input` 同时返回 409 + 一句可读的话。
引擎自己发的收束指令走 `followup`、已在 `injected` 登记，不受这道闸影响。出口是 DSH 的「在新对话中分支」（回到结局
之前）或新会话开始新周目。

### Q5 周目边界

**定义：一个新周目 = 一个「会话面为空」的剧作家会话里，玩家说出的第一句话。** 这正是 `openPlay` 今天用来补开局
指令的判据（`agent.session.surface.nodes.length === 0`）：

- 新建会话（同工作区）→ 会话面为空 → **新周目**；
- 分支出的子会话 → 带前缀 → **不是新周目**；
- 宿主重启后恢复的会话 → 带历史 → **不是新周目**。

在 `openPlay` 判定「空会话面」之后、注入开局指令之前，新增一次 `beginPlaythrough`（按 `sessionId` 幂等，内存
`Set` 去重）：

1. **账本**：`playthroughs += 1`，记下本会话对应的周目号（供后续 `recordEnding` 填 `reachedIn`）。
2. **重置剧内状态**：把 `memory/always/state/` 三个文件写回**新周目起点**——
   `scene.md = play.config.initialScene`、`threads.md = ""`、`state.json = { affinity: initialState.affinity, flags: initialState.flags }`。
   只动 `state/`，**不碰** `memory/always/premise.md`、`memory/always/craft.md`、`memory/index/*`、`characters/*`、`assets/*`。
  3. **账本不受这次重置影响**：账本文件在**工作区根**（`endings.json`，与 `play.json` 并排），不在 `memory/` 下；
     上面第 2 步只写 `memory/always/state/` 三个文件，碰不到它——上一周目及更早已达成的结局原样保留。

- **谁重置**：**引擎**。理由：边界只有引擎知道（空会话面）；交给剧作家的「开场时请重置」是不可靠的软约定，而且
  A 区【状态】快照会在第一轮就把**上周目的残留状态**读给剧作家看，模型很容易顺着旧状态续写。引擎重置是确定性的、
  且与「账本独立」的动机直接呼应。代价：上一周目的终局状态不保留（本期接受；未来若要「NG+ 继承部分状态」，可改为
  归档 `state/` 到 `memory/always/state.prev/` 再由剧作家按口径取用）。
- **重置只在空会话面发生**：因此「同一周目内分支 / 回退」不会误触重置。
- 已知小边界：若引擎在 `beginPlaythrough` 落盘后、模型产出任何内容前被强杀，恢复后会话面仍为空可能再记一次周目号；
  仅影响 `playthroughs` 计数（info 级），不影响结局集合。

**账本如何在多周目间继承**：账本是工作区文件，天然跨会话；`reachedIn` 记录在第几周目达成、取并集去重；
`playthroughs` 给出「这是第几周目」。新周目**只重置剧内状态**，账本原样保留。

### Q6 提示词契约

**NG+ 是提示词级约定，引擎只保证账本可见，不强制解锁。**

- `play.json` 新增可选布尔 `newGamePlus`（缺省 `false`）。
- 在 A 区注册一个新段 `aivn:play-endings`（`ORDER` 取 160，紧跟 `memory`(150) 之后、`tail`(200) 之前）：

  ```ts
  // play-context.ts
  section('aivn:play-endings', ORDER.endings, (s) => s.endings)
  ```

  `renderEndings(dir, config)` 只在 **`newGamePlus === true` 且账本里已有 ≥1 个结局**时产出文本，形如：

  > \# 此前已达成的结局
  >
  > 这是第 2 周目。此前达成的结局：晨光（这一次，她没有回头）、雨夜（……）。
  > 请让这一周目体现多周目要素——角色可以隐约记得、某些路线 / 选项可以因此不同——但**不要直接复述这段说明**，
  > 也不要把它当成戏里某个角色的话。

- 第一次游玩（账本为空）时该段为空 → 与今天完全一致，零噪声。
- 关闭开关时不注入（账本文件仍在磁盘上，剧作家需要时可直接 `read`）——这就是「账本可见、不强制解锁」。
- 引擎**不做任何 gate**：不解锁路线、不改写剧本、不拦截玩家选择和分支。多周目的意义完全由提示词 + 剧作家的自由创作实现。

---

## 4. 用户路径

### 4.1 第一周目：到达结局

1. 玩家照常玩，每轮以 `<stop …/>` 交出出口。
2. 故事走到终点，剧作家把末行写成 `<ending id="…" title="…" subtitle="…"/>` 并停笔。轮尾仍是助手消息。
3. 引擎：`hub` 广播 ending IR → 实时回调落账 `endings.json` → `agent.followup(收束指令)`（登记为注入）。
4. 客户端：捕获 ending → 摆出**结局卡**（标题/副标题），收束区显示「剧作家正在写下结局…」。
5. 引擎开新的一轮；剧作家输出 `<epilogue>…</epilogue>`；收束散文流式填进结局卡，回填账本 `summary`。
6. 终局态：**没有选项卡、没有「点舞台继续」、点画面无反应**；想再玩只能走 DSH 分支（回到结局之前）或新会话。

### 4.2 开启 `newGamePlus` 的第二周目

1. 玩家在**同一工作区**新建会话，选剧作家预设，说第一句话。
2. 引擎判定空会话面 → `beginPlaythrough`：`playthroughs → 2`，重置 `memory/always/state/*` 到起点。
3. A 区出现 `aivn:play-endings` 段：剧作家知道「这是第 2 周目，之前达成过晨光 / 雨夜」。
4. 剧作家按剧目口径开场（角色既视感、解锁路线……）；账本原样保留，本周目的新结局继续累加。

### 4.3 分支、回看、重建

- **分支**：子会话带 ending 前缀 → 重放后仍是终局（可分支回结局之前）。
- **回看 / 跳转**：重放当前分支；含 ending → 终局，不含 → 正常可继续。
- **回退 / 重写掉结局那一拍**：重投影后 ending 消失 → 退出终局，可以继续。

---

## 5. 逐仓实现方案

### 5.1 `stage-ai` / `packages/core`（语法与 IR）

| 文件 | 改动 |
|---|---|
| `src/dsl/spec.ts` | `DSL_TAGS` += `"ending"`、`"epilogue"`；`VOID_TAGS` += `"ending"`；新增 `ENDING_TAG` / `EPILOGUE_TAG` 常量与 `EndingAttrs { id; title?; subtitle? }`；注释更新（结局取代末行 `<stop>` 的口径） |
| `src/dsl/events.ts` | `StageEvent` += `{ kind: "ending" } & EndingAttrs`，以及与 narrate 同形的 `epilogue_start`（`nodeId?`）/ `epilogue_text`/`epilogue_end` |
| `src/dsl/parser.ts` | `ParserWarningType` += `"content_after_ending"`；`case "ending"`（校验 id 正则、缺失/非法丢弃、emit）；置 `endedInMessage` 后后续事件一律丢弃 + 告警；`case "epilogue"` 并入包裹标签处理（`OpenWrap.tag` 加 `"epilogue"`、`emitText`/`closeWrap` 分支）；`resetBeat()`/`endMessage()` 复位 `endedInMessage` |
| `src/play/config.ts` | `PlayConfig.newGamePlus?: boolean`；`parsePlayConfig` 收 `data.newGamePlus === true` |
| `test/parser.golden.test.ts` | 新增 `<ending>` 用例：正常字段、缺 id 丢弃、ending 后内容被丢、撕裂喂入、`<epilogue>` 包裹与自动闭合 |
| `test/config.test.ts` | `newGamePlus` 真/假/缺省 |

### 5.2 `stage-ai` / `packages/stage`（渲染）

| 文件 | 改动 |
|---|---|
| `src/playbackState.ts` | `StopAffordanceInput` += `ended?: boolean`（缺省 false，**向后兼容**）；`ended` 为真时直接返回 `{ showContinueCard:false, clickToContinue:false }` |
| `src/EndingCard.tsx`（新） | 非交互结局卡：标题 / 副标题 / 收束散文区（可滚动）。复用 `.choice-overlay` 遮罩与 `.choice` 卡片基样式，加 `.ending-*` 修饰类；就地吃掉点击，不放任何按钮 |
| `src/script.ts` | `apply()` 里忽略 `ending` 与 `epilogue_*`（与忽略 `stop` 同理；结局由结局卡渲染，不进台词时间线） |
| `src/StageTheater.tsx` | 新增可选 `ended?: boolean`；`onStageClick` 在 `ended` 时直接返回；不渲染「点击舞台继续生成」提示（`canContinue` 由宿主置 false 已够，`ended` 是显式的终局意图） |
| `src/index.ts` | 导出 `EndingCard` 及相关类型 |
| `src/stage.css` | 新增 `.ending-card` / `.ending-title` / `.ending-subtitle` / `.ending-summary` 样式 |
| `test/playbackState.test.ts` | `ended` 时无继续（含 `ready + isNoStop` 的最危险组合） |
| `test/`（新增） | `EndingCard` 渲染冒烟（标题/副标题/流式收束） |

### 5.3 `stage-ai` / `apps/server`（AIVN 本体）

解析器改动对它是**纯增量**：它的提示词与剧本里没有 `<ending>`，`beatTool` 原样保留。新增的 `StageTheater.ended` 是可选属性，
`StageScreen.tsx:398` 不传 → 行为不变。**本期不动 `apps/server`**，只在回归测试里确认「无 ending 的剧本行为逐字不变」。
（若将来本体也要结局，复用同一套 core+stage 即可。）

### 5.4 `dsh-aivn`

| 文件 | 改动 |
|---|---|
| `src/ledger.ts`（新） | `EndingsLedger`：`read(playDir)` / `beginPlaythrough(playDir)` / `recordEnding(playDir, attrs, playthrough)` / `recordSummary(playDir, id, text)` / `snapshot(playDir)`。原子写（tmp+rename）；以 id 去重、`reachedIn` 取并集；坏文件不解构、报错并保持原样 |
| `src/stage-tap.ts` | ① 实时解析回调：`trackTerminal` + `ledger.recordEnding`；`epilogue_end` 时 `recordSummary`。② per-session `ended` 标记与 `ended(sessionId)` 查询。③ 见到 ending → `agent.followup(收束指令)` + `injected.remember`。④ `onInput` 加 `hasEnded` 闸（在 `injected.claim` 与 `isPlaywriter` 之后）。⑤ `openPlay` 里空会话面时调 `beginPlaythrough`（重置 `memory/always/state/*` + 账本周目 +1，按 sessionId 幂等） |
| `src/stage-log.ts` | `RebuildDeps` += `onEvent?: (sessionId, event) => void`；`rebuildStage` 的解析回调转发给它 → 让重建也能重推终局标记（**不落账**） |
| `src/index.ts` | 装配 `EndingsLedger`；把 `stage-log` 的 `onEvent` 接到 `stage-tap.trackTerminal`；导出必要类型 |
| `src/play-context.ts` | 新增 `renderEndings(dir, config)` 与 `PlaySnapshot.endings`；注册 `aivn:play-endings` 段（`ORDER.endings = 160`） |
| `src/playwriter/prompt.ts` | 新增《结局与多周目》章（`playwriterTail`）：`<ending>` 只在**故事真正收尾**时用、末行、写法与字段；`<epilogue>` 只在收到收束指令时用；NG+ 契约。修订《结束轮》措辞，明确 `<stop>` 是「这一轮的出口」、`<ending>` 是「整部故事的终点」 |
| `src/play-files.ts` | `play.json` 字段表加一行 `newGamePlus`；文件清单里提一句引擎会维护根目录的 `endings.json`（只读，不手改） |
| `src/client/stage-view.tsx` | 捕获 `ending` / `epilogue_*`；`ended` 状态；`stopAffordance({... , ended})`；`ended` 时 `overlay` 换成 `EndingCard`、`canContinue=false`、`StageTheater` 传 `ended` |
| `src/routes.ts` | `/aivn/input` 在会话已终局时返回 409 + 一句可读的话 |
| `lib/` | `node build.mjs` 重建（该仓跟踪构建产物，pre-commit 会逐字节核对） |
| `README.md` / `README.en.md` / `AGENTS.md` | 说明结局 DSL、`endings.json`、`newGamePlus` |
| `e2e/verify-ending.mjs`（新） | 真 LLM 写出 `<ending>` + `<epilogue>`；舞台终局无按钮；第二会话账本可见 + `newGamePlus` 生效 |

---

## 6. 数据结构

### 6.1 IR（`@aivn/core`）

```ts
export type StageEvent =
  | …
  | ({ kind: "ending" } & EndingAttrs)          // { id: string; title?: string; subtitle?: string }
  | { kind: "epilogue_start"; nodeId?: string }
  | { kind: "epilogue_text"; delta: string }
  | { kind: "epilogue_end" };
```

与 `stop` 的关系：`stop` 仍然存在（普通轮出口）；`ending` 只在该轮是终点时出现，**取代** `<stop>`。二者不会同轮共存
（若同给，ending 赢、后续丢弃）。

### 6.2 账本 `endings.json`（工作区根，引擎独占）

```json
{
  "version": 1,
  "playthroughs": 2,
  "endings": {
    "true_sunrise": {
      "title": "晨光",
      "subtitle": "这一次，她没有回头",
      "firstAt": "2026-10-07T12:00:00.000Z",
      "lastAt": "2026-10-09T03:00:00.000Z",
      "reachedIn": [1, 2],
      "summary": "……（收束散文，epilogue 落地时回填）"
    }
  }
}
```

- `reachedIn` 是**周目号集合**：`recordEnding` 取并集，天然解决 rebuild / 重复达成的去重。
- `summary` 取该结局**最后一次**收束散文（`recordSummary` 覆盖）。
- 读不动 / JSON 坏：记一条告警、**不覆盖**，本次不记账（留给用户手工修）。

### 6.3 `play.json` 字段

```json
{ "id": "phantom", "title": "旧校舍", "newGamePlus": true }
```

---

## 7. 边界与异常

| 情形 | 处理 |
|---|---|
| 模型把 `<ending/>` 写在中途又继续写 | 解析器在 ending 后丢弃同消息后续事件 + `content_after_ending` 告警；终局确定性不靠模型自觉 |
| 模型在一轮里写两拍 / 两个结局 | 第一个 ending 生效，后续丢弃（同上） |
| 缺 `id` / id 非法 | 整条丢弃 + `malformed_tag`；该轮退化为普通 `<stop>` 行为（若也没 stop 就是 no_stop 的「继续」） |
| 模型没写 `<epilogue>`（忽略收束指令） | 结局卡显示标题/副标题，收束区留空或一句「（这一段没有写下收束）」；不阻塞终局 |
| rebuild 重放 ending | 只重推终局标记，**不落账**；`reachedIn` 幂等 |
| 回退/重写掉结局 | 重投影后 ending 消失 → 退出终局；账本里**保留**已达成记录（历史不可抹） |
| 终局后玩家在 DSH 原生输入框打字 | `stage-tap.onInput` 拦截丢弃；`/aivn/input` 返回 409。收束指令走 `followup` 且已登记，不受影响 |
| 收束指令与玩家输入的竞态 | 终局闸只拦**非注入**的 user 消息；`injected.claim` 先于闸执行 |
| 账本文件被手改坏 | 读失败记告警、不覆盖；本次不记账 |
| `newGamePlus` 首周目（账本空） | 段为空，行为与今天一致 |
| 同一工作区并发开两个会话 | 各自独立周目；账本以 id/`reachedIn` 归并。本期不做跨进程锁（单机单进程） |

---

## 8. 测试计划（只跑受影响范围）

- `packages/core`：`parser.golden.test.ts`（ending/epilogue）、`config.test.ts`（newGamePlus）→ `pnpm --filter @aivn/core test …`
- `packages/stage`：`playbackState.test.ts`（ended 无继续）、`EndingCard` 渲染 → `pnpm --filter @aivn/stage test …`
- `apps/server`：受影响回归（无 ending 的剧本逐字不变）→ `pnpm --filter @aivn/server test …`
- `dsh-aivn`：`npm run typecheck`；`npm run build`（产物核对）；e2e `verify-ending`（真 LLM：ending + epilogue + 终局无按钮 + 第二周目账本/NG+）；`verify-rebuild` 加「ending 经重建仍在」的断言。
- 真实 LLM 的 e2e 单点跑一次，不批量重跑。

---

## 9. 取舍与备选

| 决策 | 选择 | 备选与理由 |
|---|---|---|
| 结局表达 | 剧本末行标签 `<ending/>` | 工具 / 按钮：会让轮尾变成工具结果，破坏 DSH 分支与重建（`<stop>` 的教训） |
| 收束散文 | 新标签 `<epilogue>` | 复用 `<narrate>`：要靠「哪一轮」隐式判断，重建不稳；纯正文：解析器会当孤儿文本丢弃 |
| 账本位置 | 工作区根 `endings.json` | 放 `memory/`：会被新周目重置波及，违背「独立于剧内状态」；放 DSH 会话存储：无法跨周目继承 |
| 记账者 | 引擎（实时 IR） | 剧作家写文件：不可靠；且回看/重建时难保证幂等 |
| 周目重置 | 引擎重置 `memory/always/state/*` | 纯提示词让剧作家重置：软约定、且 A 区会先把旧状态给模型看，易续写旧周目 |
| 终局渲染 | 新增非交互 `EndingCard` | 塞进 `StopPanel`：语义相反（交互 vs 终止），会带出假 stopType |
| NG+ | 提示词级、`newGamePlus` 开关 | 引擎级解锁 / gate：本需求明确不做，引擎只保证账本可见 |

---

## 10. 实施阶段（体量 < 3500 locs，单计划）

1. **core + stage**：语法、IR、渲染、单测（可独立合并，不破坏任何现有行为）。
2. **dsh-aivn 引擎**：`ledger`、`beginPlaythrough` 重置、终局标记、收束注入、输入闸、A 区段。
3. **dsh-aivn 客户端 + 提示词 + 文档 + e2e**：`EndingCard` 接线、`playwriter` 章、README/AGENTS、`lib` 重建、`verify-ending`。

每阶段跑对应单测；结项跑 e2e 一次。

---

## 11. 未决 / 待用户确认

1. **账本文件名**：`endings.json`（与 `play.json` 并列）是否可接受？还是要一个隐藏命名空间（如 `.aivn/endings.json`）。
2. **周目重置的边界**：确认「新周目重置 `memory/always/state/*`」是否符合预期（本期不归档旧状态）；若希望保留上一周目终局状态，改为归档方案。
3. **结局卡的信息层级**：只放 标题/副标题/收束散文，是否需要展示「第几周目 / 已达成第几个结局」等元信息。
4. 是否需要 `<ending>` 的 `type`（good/bad/true）——本期不加，确认是否可留待画廊任务。

## 12. 实施记录

按本计划落地。四个未决项**全部取计划默认值**（账本文件名 `endings.json`、新周目重置不归档、结局卡只放三段文字、
不加 `type`），待用户复核；若需要调整，改动点都对得上。

### stage-ai
- `packages/core`：`dsl/spec.ts`（`ending`/`epilogue` 入 `DSL_TAGS`、`ending` 入 `VOID_TAGS`、`EndingAttrs`）、
  `dsl/events.ts`（`ending` + `epilogue_start/text/end`）、`dsl/parser.ts`（`content_after_ending` 告警、
  ending 校验与「其后丢弃」、epilogue 包裹标签）、`play/config.ts`（`newGamePlus`）。
- `packages/stage`：`playbackState.ts`（`ended`）、`EndingCard.tsx`（非交互卡）、`script.ts`（忽略结局帧）、
  `StageTheater.tsx`（`ended`）、`stage.css`（`.ending-*`）、`index.ts` 导出。
- `apps/server`：仅 `orchestrator.ts` 的 `WARNING_LABELS` 补一条（`ParserWarningType` 新增成员的穷举要求），
  行为不变。**单测**：core `parser.golden` / `config`、web `playbackState` / `endingCard` 全绿；
  `apps/server` 回归 725 通过（4 条 `voice.test.ts` 失败经 `git archive HEAD` + 重建 HEAD `dist` 复核为**改动前既有**，
  与本次无关）。

### dsh-aivn
- `src/ledger.ts`（新，账本：原子写、id 去重、`reachedIn` 并集、坏文件不覆盖）、`src/play-state.ts`（新，重置 `state/*`）。
- `src/stage-tap.ts`：实时落账 + 收束指令（`followup` + `remember` 摘除）、per-session `ended`、`onInput` 终局闸、
  `openPlay` 里 `beginPlaythrough`。
- `src/stage-log.ts`：`RebuildDeps` += `onEvent` / `onRebuildStart`，`StageLog.rebuild` 转发两者；
  重建**只重推终局标记、不落账**；重建开始前 `resetTerminal` 清标记（回退掉结局即退出终局）。
- `src/index.ts` 装配；`src/routes.ts`（`/aivn/input` 终局 409）；`src/play-context.ts`
  （`renderEndings` + `aivn:play-endings` 段 order 160）；`src/playwriter/prompt.ts`（《结局与多周目》章 +
  《结束轮》交叉引用）；`src/play-files.ts`（`newGamePlus` 字段 + `endings.json`）；`src/client/stage-view.tsx`
  （捕获 ending/epilogue、`EndingCard`、`ended`）。
- `lib/` 重建且 `node build.mjs --check` 一致；README / README.en / AGENTS 三处同步。
- **e2e**：`e2e/verify-ending.ts`（+ `.mjs` 包装，模块 `ending`）——账本落账/去重/跨周目、`newGamePlus` A 区注入、
  新周目重置、坏账本不覆盖，**不需要实例**，8/8 通过；`e2e/verify-rebuild.ts` 增 4 条结局重建断言（R10–R13），13/13 通过。
- **未做**：真 LLM 的「模型自己写出 ending + epilogue、舞台无按钮、第二会话账本可见」单点验收——需要带 provider 的
  `dsh-e2e` 实例，本环境不具备，留待用户实机跑一次（口径见本计划 §8）。
