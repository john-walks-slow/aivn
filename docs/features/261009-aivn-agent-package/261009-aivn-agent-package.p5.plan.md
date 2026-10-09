# P5 · 把两个宿主的工具面收成同一个形态 —— 计划

日期：2026-10-09 · 输入：`261009-aivn-agent-package.p5-brief.md`（任务书）、
`261009-aivn-agent-package.plan.md`（P0~P4 权威计划及其「设计规约」R1~R8、「验证矩阵」）、
`261009-tool-surface-map.md`（并集判定表，**其 HEAD 是 P4 前的 `c8595bb9`/`e832b35`，§4.1 与 #8/#10 两行已被 P4 修正**）。

本文件是**只读分析 + 计划**：本次没有修改任何源码或既有文档。所有判定都基于两个 worktree 的实读
（`/root/projects/stage-ai-shared` @ `2df04ffb`、`/root/projects/dsh-aivn-shared` @ `923e48b`，均在
`feat/shared-aivn-core`）。**§7 记：本次实测的基线数字与实跑命令。**

---

## 0. 一句话

P0~P4 把**能力**（参数真相源 + 描述正文 + 请求归一化）抽进了 `packages/agent`；P5 收**face 层**：
让两个宿主的同名工具同义、让复合动词全部显式化、把「生成 / 落成 / 图像处理 / 元数据」四件事拆成原子面，
把生命周期与角色分叉收回宿主策略。方向是**服务端向插件的形态靠**（用户已定），插件则补它缺的两件：
素材元数据口（`annotate_asset`）——插件今天没有它，BGM 元数据一格都进不了素材表。
（`view_image` 曾列为「插件该补的第十个工具」，经复核**作废**：DSH 宿主自带 `read_image`，见 P5-f。）

---

## 1. 形态目标

### 1.1 六条 canonical 不变式（每阶段结束时都必须成立）

| # | 不变式 | 现状违反 |
| --- | --- | --- |
| C1 | **一个动作 = 一条包内能力；一个工具 = 一个 face**。face 的字段只能来自 `pick(能力.fields)`，宿主不得新增字段 | 插件 `generate_asset` 自己加了一格 `description`（`src/tools/generate-asset.ts:59-62`） |
| C2 | **同名 ⇒ 同义**。工具名 ↔ 能力 id 的映射唯一，写在 `contract.ts` 的矩阵里 | 今天的 `generate_image` 在两边指两个动作（服务端 target-aware、插件 target-free），`261009-tool-surface-map.md:15-19` 记为「同名不同义 2 个」 |
| C3 | **复合动词必须是显式宏**：描述第一句就写「= A + B + C 的组合」，宏由包内组合、宿主只给 IO | 服务端 `generate_image` 一个 id 扛两种语义（`imageTool.ts:79` SYNC / `:95` QUEUED），`commitTool.ts` / `recutTool.ts` 是另一种编排 |
| C4 | **生命周期不进 schema**（R3）：同步 / 排产、直落 / 草稿都是 face 的投递策略 | 已合规（`musicTool.ts:77-84` 的 `deps.kick` vs 插件 `generate-bgm.ts:39` 的 await 是 deps 注入） |
| C5 | **元数据不是生成参数**：生成工具只收「生成要什么」 | 服务端 `generate_bgm` 10 格里有 8 格是元数据（`musicTool.ts:20-43`） |
| C6 | **寻址**：对已入库素材的操作一律给 `AssetTarget`，文件路径只出现在「源」的位置 | 插件的重抠要模型自己记住 `media-cache/sprite-sources/…`（`src/tools/cut.ts:52-55`） |

### 1.2 目标工具面（同名即同义）

**共享原子面（两条宿主都有，同名、同能力、同描述正文）——9 个**

| 工具 | 能力 | 干什么 | 参数面 | 返回 |
| --- | --- | --- | --- | --- |
| `generate_image` | `image.generate`（produce 面） | 出一张**候选图**；给 `kind` 就走剧目感知（画风/色键/取景后缀、垫图基准），不给就是通用候选 | `prompt, style, references, aspectRatio,` + 目标四件套 `kind, name, spriteId, variant, framing, stature, title, keyColor` | 候选的剧目内相对路径 + 预览（**不写 `assets/`、不记台账**） |
| `cut` | `image.cutout` | 抠底 / 原地重抠 | `source`（剧目内路径**或**素材引用）、`output?`、5 个旋钮 | 输出路径 + 抠底体检 |
| `import_asset` | `asset.register`（**新增**） | 把一张图**登记**成素材 | `source, kind, name, spriteId, variant, framing, stature, title, description?, prompt?, original?, meta?` | 落成后的 `assets/` 路径 |
| `annotate_asset` | `asset.annotate`（**新增**） | 事后补/改素材表元数据 | `target`（kind + name / spriteId+variant）、`meta` | 改完的元数据 |
| `generate_asset` | `asset.generate`（**宏**，包内组合） | **显式宏** = `generate_image`(target) +（立绘）`cut` + `import_asset` | 上面两块的全并集 + `meta?` | 最终素材路径 |
| `generate_bgm` | `music.generate` | 生成一首 BGM 落库 | `name, prompt, model?, overwrite?`（**4 格，两边一致**） | 回执 |
| `list_voices` | `voice.list` | 查音色库 | 5 格（`query/language/gender/tags/page`） | 文本清单 |
| `web_search` | `web.search` | 联网检索 | `query, numResults` | 结果 + 正文 |
| `validate_play` | `play.readiness`（**新增能力**） | 剧目自查（agent 面完整报告） | 无 | 文本报告 |

**宿主专有面（只在契约矩阵里登记，不进能力表）**

| 宿主 | 工具 | 判定 |
| --- | --- | --- |
| 服务端 | `beat_done` `update_state` `enter_nsfw` `exit_nsfw` `read_memory_detail` `search_archive` `list_saves` `read_lineage` `list_library` `library_import` `read_skill` `set_craft` | 宿主机制（见 §3） |
| 插件 | `set_stage_style` | 插件独有产品面（`contract.ts:227-238` 已登记 `hostOnly`） |
| 两侧 | 看图（`read` / `read_image`） | **宿主自带**，不共享、不自建（见 P5-f） |
| 两侧基座 | 服务端 `read/write/edit/bash`（pi 内建 + `PlayEnv`）；插件预设行 `tool-fs` / `tool-fs-search` / `tool-bash` | 宿主机制（见 §3） |

### 1.3 「服务端改什么 / 插件改什么」

| 动作 | 服务端 | 插件 |
| --- | --- | --- |
| `generate_image`（一个 id 两种语义） | **拆**：`generate_image` 降为 produce（只出候选，**不再自动抠底、不再自动入库**）；剧作家的排产路径改用 `generate_asset` 宏 | **升**：`generate_image` 从宿主手写 schema 改成 `image.generate` 的 face（拿到剧目感知能力，与宏共一份描述） |
| `commit_asset` | **删**：采用 = `import_asset(source=候选路径, kind=…, …)` | —（本来就没有） |
| `recut_sprite` | **删**：重扣 = `cut(source="sprite:<id>/<variant>")` | `cut` 加素材引用寻址（`source` 可给 ref） |
| `import_asset` | **新增**（`asset.register` 的第一个 face） | 迁到能力（参数面不再手写） |
| `annotate_asset` | **新增** | **新增**（补上插件今天缺的元数据接线口） |
| `generate_bgm` | 10 → 4 格（元数据搬去 `annotate_asset`） | 4 格不变，但元数据有了出口 |
| `get_readiness` | 改名 `validate_play`，报告换成 agent 面那份完整报告（**决策门 D3**） | 已是 `validate_play`（迁到 `play.readiness` 能力） |
| `view_image` | **收窄**成只收 http(s) 的抓取（本地图交给 pi `read`）；不新增共享能力 | **不动**（宿主 `read_image` 已覆盖，见 P5-f） |
| `set_craft` / `set_stage_style` | 形状统一成「一个 patch 对象 + 数据白名单」（**决策门 D4**） | 同左（17 条 `oneOf` 收成一个对象） |

**不做**：不为「两边对称」而新增工具面（服务端**不**加它不需要的 target-free 通用出图）；
不把宿主流程（回合收束 / 状态 / 周目 / 技能通道 / 资源库）搬进包；不为「跨实例」设计（R8）。

---

## 2. 五处差别的复核（实读，含推翻）

| # | 任务书的说法 | 复核结论 | 证据 |
| --- | --- | --- | --- |
| 1 | 服务端 24 工具 + 两角色；插件 9 + 配置禁用集 | **成立**。另补两条任务书没说的：服务端把**宿主流程**编进了工具集（`beat_done` / `commit_asset` / `library_import`），且 `generate_image` 一个 id 扛两种语义 | `apps/server/src/agentkit/kit.ts:275-303`（24 行，其中 playwriter-only 6 / workshop-only 12 / 两者 6）；`src/tool-catalog.ts:53-118`（9 项）；`imageTool.ts:79` vs `:95` |
| 2 | 生命周期等 vs 不等，「插件没有回合外注入通道」这条理由今天不成立 | **理由确已不成立**（插件有 `agent.inject` 与 `agent.followup`），但**可行性不等于合适性**：`inject` 落 `next-step` 且整批认领、`followup` 落 `next-turn` 且一轮只认领一条，到货播报只能落在轮边界 | `src/stage/stage-tap.ts:212`（inject 开局指令）、`src/stage/director.ts:87/94/139`、`src/routes.ts:272`、`src/tools/generate-bgm.ts:6-8`（自陈的旧理由） |
| 3 | 服务端 `generate_bgm` 10 参，插件 4 参且元数据没接线口 | **成立，且插件那边是「缺功能」不是「少参数」**：它的 BGM 落库只写一条来源标记，`title/description/tags/mood/scene/loop/volume` 一格都不进素材表 | 服务端 `musicTool.ts:20-43` + `playMusic.ts:162-170`（真的写进 manifest）；插件 `generate-bgm.ts:20`（4 格）+ `media/bgm.ts:37`（只 `declareBgmSource`）+ `media/catalog.ts:64-67` |
| 4 | 服务端按已入库对象寻址；插件按文件路径寻址 | **成立**。服务端的重抠由引擎去取留底原片（模型不需要知道任何路径），插件要模型自己记住 `media-cache/sprite-sources/<主体id>/…`；这是一条**安全/健壮性**边界，不只是审美 | `playAssets.ts:385-408`（`recut` + `spriteSourcePath`）、`recutTool.ts:37-47`（`spriteId/variant/cutout`）vs `src/tools/cut.ts:52-55`（教模型拼路径） |
| 5 | `set_craft` 嵌套 + 三态；`set_stage_style` 17 个平铺 `oneOf` | **成立**。但要分清：`set_stage_style` 是**插件独有**（服务端没有改皮的口），所以这一条不是「同一个动作的两种写法」，而是**两种配置工具的形状不一致**；统一的是形状约定，不是共享实现 | `craftTool.ts:22-96`（嵌套 + `Type.Literal` 联合 + `Type.Null`）；`set-stage-style.ts:48-60`（17 × `oneOf[string,null]`，白名单来自 `style-tokens.ts:193` 的 `STYLE_TOKENS`，实为 17 条） |

**推翻 / 补正任务书的四处**：

1. `261009-tool-surface-map.md` 的 #8（`list_voices`）与 #10（`generate_image` 缺 `keyColor`）**已过时**：
   P4 之后两边都 pick 同一套 5 格（服务端只是多一层 `tighten`），服务端也已经有 `keyColor`。
   复核证据：`apps/server/src/agentkit/voiceTool.ts:21`、`imageTool.ts:37-50`（12 格含 `keyColor`），
   插件 `src/tools/list-voices.ts:22`、`generate-asset.ts:28-40`。
2. 任务书 §2.3 说插件「补 view_image 只是接线」——**错**，见 P5-f 的修订（宿主自带 `read_image`；
   服务端那个 `view_image` 对本地图也被 pi 的 `read` 覆盖）。包内 `media/web-image.ts` 的 SSRF 防护与
   缓存键，插件 `src/media/web-image.ts` 也已在用），但**插件侧还差一样**：DSH 工具的回执要能带 image 内容块。
   现有 9 个工具全部是纯文本 `textOutput`（`src/tools/list-voices.ts:13-16`），要新增一个带 image 的 render。
3. 任务书 §3.3 说「插件那边元数据还没接线口（等于缺功能）」——**确认为缺功能**，见上表 #3。
4. 任务书 §4 的「`validate_play` 是产品流程差异」——我判为**历史惯性为主**，见 §3.5。

---

## 3. 「不该统一」清单的复核结论（每条给判定与证据）

> 判定口径：**宿主机制** = 差异来自宿主运行时的既有事实（会话/权限/存储/引擎状态），统一必须要在一边
> 造第二套宿主功能；**历史惯性** = 差异来自过去的实现路径或产品口径，统一只需改口径与文案。

### 3.1 文件读写（`read`/`write`/`edit`/`bash`）——**宿主机制**

- 服务端：`PlayEnv` 白名单 + **按能力推的写面**（`characters` / `memory` / `config` 三档），
  `writeScopesFor` 从能力目录派生（`kit.ts:366-375`），`PlayEnv.absolutePath`/`writeFile` 两道闸
  （`playEnv.ts:55-80`），`read` 必须常装的理由是 A 区只给不在场角色一行摘要（`kit.ts:305-312`）。
- 插件：文件工具**不由插件注册**，来自预设行集（`playwriter/preset.ts:50-58`），权限是 DSH 的
  workspace 权限模型；插件那 9 个工具里没有一个是 fs 工具。
- 结论：**真宿主机制**。统一会破坏服务端的角色/能力级写面，或让插件去复刻 DSH 的权限模型。
  P5 不动这一块；唯一相关的是 C6——共享能力**不得**让模型自己拼宿主路径（这正是 `cut` 要收素材引用的原因）。

### 3.2 技能库（DSH `available_skills` + realm 隔离 vs 服务端 `read_skill`）——**宿主机制**

- 插件：技能库是预设行集里一个 `isolate: { skills: true }` 的 realm（`preset.ts:63-94`），
  理由写得很硬——不隔离就会把宿主全局层与第三方 `registerProvider` 的技能漏进清单（`preset.ts:65-76`）。
- 服务端：`read_skill` 只读 `apps/server/skills/`，另有两条守卫盯着「技能放错目录 = 静默不生效」
  （`scripts/check-agent-contract.mjs:297-343`）。
- 结论：**真宿主机制**（通道与加载时机都归宿主）。
  但**正文层已经统一**（`packages/agent/skills/aivn-audio.md` + `sync-skills.mjs`，两侧守卫盯着），
  P5 不再往前推（`play-setup` / `visual-craft` 是同题重写，261008 已判定合并会造出第三种说法）。

### 3.3 故事树 / 周目（服务端 `list_saves`/`read_lineage`）——**宿主机制**

- 服务端：依赖 `PlaySaves` / `saveStore` / `LineageTree`，只读是硬边界（`lineageTool.ts:9-14`、`:48-71`）。
- 插件：**仓库内零命中**——`grep -rln "LineageTree|saveStore|list_saves|read_lineage" src/` 为空；
  它的跨周目概念是结局账本 `endings.json`（`src/play/ledger.ts:2-20`），且**不暴露工具**；
  历史由 DSH 会话与 fork 提供。
- 结论：**真宿主机制**。把 LineageTree 搬进插件 = 在 DSH 里造第二套会话存储。

### 3.4 服务端 `beat_done` / `update_state` / `enter_nsfw`——**宿主机制（三条各有各的机制）**

- `beat_done`：服务端靠它收束 turn 并交出停止点，编排器有同轮追收束与批内 terminate 兜底
  （`orchestrator.ts:74-80`、`:403-407`、`:651-661`）；插件 2026-10-06 **故意**把停止点改回剧本末行
  `<stop …/>`，理由是轮尾必须是助手消息，DSH 的「在新对话中分支」与舞台重建只认这种轮尾
  （`preset-tools.ts:36-38`、`beatTool.ts:13-16`）。两边 IR 同构，载体必须不同。
- `update_state`：服务端引擎持有状态真值并随谱系快照回滚，好感度还有成员校验与增量上限
  （`memoryTool.ts:6-8`、`:34-40`、`:62-74`）；插件没有引擎状态（`play-context.ts:303-327` 只是**读**
  `memory/always/state.json` 渲染 A 区），状态由文件工具维护。
- `enter_nsfw`：服务端是双模型通道 + SFW 摘要 + 谱系标记（`nsfwTool.ts:31-34`、`orchestrator.ts:144`、
  `:447-452`）；插件没有这条通道。
- 同族的 `read_memory_detail` / `search_archive` 也归这条：服务端的检索带**分支过滤**
  （`memoryTool.ts:124` 的 `deps.tree.pathSet()`），插件的「往事」就是会话历史。
- 结论：**真宿主机制**，四条都成立。任务书这一条复核通过。

### 3.5 `validate_play` vs `get_readiness`——**历史惯性为主**（与任务书不同）

- 事实：两边的**判据**早已同源（包内 `readiness/play.ts` 的 `readPlayReadiness`），服务端的
  `get_readiness` 只是把工坊面板那份四行（`agentkit/readiness.ts:4-12`）挂成工具；插件把包内完整报告
  挂成 `validate_play`（多 `craft` 取值 / 台账悬空 / 角色卡张数 / 世界状态）。
- 为什么判**历史惯性**：任务书给的理由是「插件为『模型自己写文件』兜错」，但**服务端的 agent 也自己写文件**
  （工坊的 `write`/`edit` 就在 `TOOL_CATALOG` 里），所以「谁需要兜错」不是宿主机制差异；服务端缺的那几项
  （craft 取值、台账对账）在它自己的 store 里全都拿得到。
- 唯一的真约束是**一句话不许有两个版本**：`readinessTool.ts:9-12` 明说工具与提示词《当前状态》共用
  `renderReadiness`，改工具报告就得同时改提示词那一章。
- 结论：**可统一**（一条能力 `play.readiness`，两处渲染 = agent 面完整报告 / 面板四行），
  但代价落在服务端的提示词与既有断言上 → 列为**决策门 D3**，不作为 P5 主干的前置。

### 3.6 另一条任务书没列、我复核后判为**真宿主机制**的

服务端的「角色分叉」（`TOOL_CATALOG` 的角色标记）**不是历史惯性**：剧作家一轮 240s、没有对话流可挂气泡，
所以候选图与需要用户挑选的流程对它无意义（`imageTool.ts:26-33`）。P5 保留角色标记，只收敛**门控机制**
（两边都已经是「能力/配置驱动的禁用集」，只是载体不同：服务端逐剧目 `play.json`、插件插件配置）。

---

## 4. 阶段划分（按收益 / 风险排）

| 阶段 | 收益 | 风险 | 依赖 | 一句话 |
| --- | --- | --- | --- | --- |
| P5-a | 4 | 1 | — | `asset.register` 落包，两侧各一个 face（服务端新增 `import_asset`） |
| P5-b | 4 | 2 | a | `image.cutout` 加素材引用寻址；服务端 `recut_sprite` → `cut` |
| P5-c | **5** | 3 | a,b | 出图拆成 produce + 显式宏；删 `commit_asset`；`generate_asset` 两边同名同义 |
| P5-d | 4 | 2 | c | 元数据出生成工具：`asset.annotate`；`generate_bgm` 两侧收到 4 格 |
| P5-e | 3 | 2 | d | `play.readiness` 能力 + `validate_play` 两侧同名（决策门 D3） |
| P5-f | 2 | 1 | — | 收窄服务端 `view_image`（本地图交给 pi `read`）；**不新增工具** |
| P5-g | 2 | 3 | f | 配置工具形状统一成 patch 对象（决策门 D4） |
| P5-h | 2 | **4** | — | 插件 `generate_bgm` 异步化（决策门 D5，可整段砍掉） |
| P5-i | 3 | 1 | a~g | 契约矩阵按新形态重修 + 守卫加一条 + 文档收尾 |

**实施进度**

| 阶段 | 状态 | 提交（stage-ai / dsh-aivn） |
| --- | --- | --- |
| P5-a `asset.register` 落包 + 服务端 `import_asset` | ✅ 完成 | `3234a72f` / `c2d836b` |
| P5-b `image.cutout` 素材引用寻址；服务端 `recut_sprite` → `cut` | ✅ 完成 | `6f4605ec` / `f9d0f19` |
| P5-c 出图拆 produce + 显式宏 | ✅ 完成（`a0d236e4` `fcc236cb` `cb73e4dd` `fffaf298` / `75117b5` `8996e05` `7f8000f`）：包 188 绿、服务端 702 绿、守卫 9/9、插件 e2e:media 55/55、live injection 20/20 + stagehand 22/22 | — |
| P5-d | ✅ 完成：包新增 `asset.annotate`（元数据一个家 `meta.ts`）、`music.generate` 收到 4 格、`declareMeta` 成唯一写口；服务端新 face `annotate_asset`（三类图走 PlayAssets、配乐走 PlayMusic），`generate_bgm` 3 格、只写来源标记；插件新工具（9→10）、技能与 README 跟上 | — |
| P5-e | ✅ 完成（D3 = 换完整报告）：包里新增能力 `play.readiness`（判据与渲染同源），服务端 `get_readiness` → `validate_play`（描述与报告都取能力），工坊提示词《当前状态》改用同一份；插件 `validate_play` 也切到能力 | — |
| P5-f | ✅ 完成：服务端 `view_image` 整段删掉（本地图走 pi `read`、网图 bash 抓回来再读），`webImage` 缓存管线与 `view` 能力行一并清掉；**插件不补工具**——两边都把看图交还宿主文件工具 | — |
| P5-g 配置工具形状统一 | ⛔ 作废（D4 结论：删工具，不是统一形状 → 见 P6-b） | — |
| P5-h 插件 BGM 异步化 | ⏸ 用户 2026-10-10 定「先不做」——同步异步与队列整体再看 | — |
| P5-i 契约与文档收尾 | 🔄 部分完成：能力矩阵已按 P5-c…f 的新形态重写；§9 已按复核更正；守卫第 10 项（face 参数必须由 pick 声明）未做，另行评估 | — |

**排序理由**：a 是 c 的前置且纯加法（低风险先做）；c 是收益最大的一步（消灭同名不同义 + 拆复合动词），
但要用 a/b 铺路；d 依赖 c（宏的第三步是 register）；e/g/h 都是「形状统一」而非「能力共享」，价值递减、
风险递增，全部排在后面并各带决策门。f 与主链无耦合，任何时候可做。

> 另一条与 P5 无耦合、也**不并进 P5** 的轴——**宿主流程工具文件化**（用户 2026-10-09 提出）——
> 单列于 **§9**：范围分析、逐工具判定、替代形态草案，建议单独立 P6。

---

### P5-a · `asset.register` 落包，服务端新增 `import_asset`

**为什么这么切**：服务端今天**没有**「把一张外来的图登记成素材」的原子口（工坊靠 `generate_image` 直落，
剧作家靠引用即导入），而插件的 `import_asset` 已经就是 register 的形状（`src/media/import.ts:21-57`）。
先把它升成能力，c 阶段删 `commit_asset` 才有落点。

**改动文件**

| 文件 | 动作 |
| --- | --- |
| `packages/agent/src/capabilities/asset/register.ts` | 新增：`assetRegisterFields`（`source` 必填 + `kind` 必填 + `name/spriteId/variant/framing/stature/title/description/prompt/original/meta`）、`ASSET_REGISTER_DOC`（正文取插件 `src/tools/import-asset.ts:16-24` 那份）、`AssetRegisterDeps`、`assetRegister` |
| `packages/agent/src/capabilities/index.ts` | 加进 `CAPABILITIES`（`:19`） |
| `packages/agent/src/index.ts` | 导出（`assetRegisterFields` / `assetRegister` / doc / deps 类型） |
| `packages/agent/test/asset-register.test.ts` | 新增：参数归一化（落位两条必填、空串丢掉）；共同子集由 `web-search.test.ts:51` 的全表遍历自动覆盖 |
| `apps/server/src/agentkit/registerTool.ts` | 新增 face：`toPi(tighten(pick(assetRegisterFields, […]), {…}))`，`description: assetRegister.doc`，`execute` 接 `PlayAssets` 的登记路径（复用 `libraryTool.ts` 的回执风格） |
| `apps/server/src/agentkit/kit.ts` | `TOOL_CATALOG` 加 `import_asset`（roles: workshop）；`CATALOG_ROWS` 的 `image` 行 `tools` 加它 |
| `apps/server/src/agentkit/contract.ts` | `image` 行的 `capabilities` 加 `"asset.register"`；`TOOL_SIDE_EFFECT_CATALOG` 加一行 |
| `dsh-aivn-shared/src/tools/import-asset.ts` | 改成 face：`parameters: toDsh(pick(assetRegisterFields, […]))`，`description: assetRegister.doc`；`targetFromArgs` 的本地归一化删掉（能力里有） |
| `dsh-aivn-shared/src/media/import.ts` | 保留为 IO：`register` 只接「已归一化的落位 + 字节」 |
| `dsh-aivn-shared/src/media/catalog.ts` | 不动（落位与记账的规则已在包内） |

**影响面**：服务端**新增**一个工具（24 → 25），插件工具名不变、参数面文案不变（正文从能力来）。
提示词：服务端 `image` 能力行的 `desc` 与 `workshop.ts` 的相关章节可能要补一句「外来图先登记」——
由守卫 1（`check-agent-contract.mjs:127-144`）兜底：提示词点到它就必须真的装着。

**验证**

```bash
pnpm --filter @aivn/agent test                 # 期望 23 文件 / 175±5 条（基线 22/168）
pnpm --filter @aivn/server typecheck
pnpm --filter @aivn/server exec vitest run test/agentkit.test.ts test/assetLibrary.test.ts test/playAssets.test.ts
pnpm check:agent-contract                      # 期望 9/9
cd /root/projects/dsh-aivn-shared && npm run typecheck && node build.mjs --check   # 期望「产物与源码一致」
npm run e2e:media                              # 期望 53/53 不新增红
```

**停止点**：服务端工具面从 24 变 25 —— **停下来确认**（README 的工具表、设置页的能力说明要同步；
用户是否接受「工坊多一个原子口」）。

---

### P5-b · `image.cutout` 加素材引用寻址；服务端 `recut_sprite` → `cut`

**为什么这么切**：C6 的落点。今天的重抠有两条路——服务端「模型不需要知道任何路径」（安全边界），
插件「模型自己记住留底路径」（易错）。把寻址收成一条：`source` 可以是**剧目内相对路径**或
**素材引用**（`sprite:<id>/<variant>` / `background:<id>` / `cg:<id>`）。

**改动文件**

| 文件 | 动作 |
| --- | --- |
| `packages/agent/src/media/asset-ref.ts` | 新增：`parseAssetRef(str)` / `formatAssetRef(target)`（纯字符串 ↔ `AssetTarget`，零 IO） |
| `packages/agent/src/capabilities/media/cutout.ts` | `source` 的说明改为「路径或素材引用」；`CutoutRequest` 加 `target?: AssetTarget`；`execute` 里先 `parseAssetRef`，命中则给 `target`、否则给 `source` |
| `packages/agent/src/index.ts` | 导出 `parseAssetRef` / `formatAssetRef` |
| `packages/agent/test/asset-ref.test.ts` | 新增 |
| `apps/server/src/playAssets.ts` | `recut(target, tuning)` 保持不变（它已经是 target 寻址）；`cut` 走它 |
| `apps/server/src/agentkit/recutTool.ts` | **删**，换成 `cutTool.ts`（face = `image.cutout` 的 7 格；`source` 给 ref 时走 `PlayAssets.recut`，给路径时走「读剧目内那张图 → 包内 `cutout()` → 写 output」） |
| `apps/server/src/agentkit/kit.ts` / `contract.ts` | 工具名与角色标记换掉；`TOOL_SIDE_EFFECT_CATALOG` 换行 |
| `apps/server/src/{prompt,workshop}.ts` | `recut_sprite` 的字样换 `cut` |
| `dsh-aivn-shared/src/tools/cut.ts` | 描述里「自己拼 `media-cache/sprite-sources/…`」那段删掉，改成「给 `sprite:<id>/<variant>`」；`execute` 里给 ref 时由 `PlayAssets` 去找留底原片 |

**影响面**：服务端工具面 25 → 25（删一加一）。**要新增的能力**：服务端侧「按 ref 取留底原片」的 IO
（`spriteSourcePath` 已经是 private，改成 `cut` 路径的 deps 即可）。插件侧要新增
「按 ref 找留底原片」的 IO（它已有 `media-cache/sprite-sources/` 的写，见 `import.ts:42-51`）。

**验证**

```bash
pnpm --filter @aivn/agent test                          # 期望 24 文件 / 182±5
pnpm --filter @aivn/server exec vitest run test/playAssets.test.ts test/agentkit.test.ts test/image.test.ts
pnpm check:agent-contract
cd /root/projects/dsh-aivn-shared && npm run typecheck && node build.mjs --check && npm run e2e:media
# 插件 media 套件里与抠底相关的判据（M1/M3/M8~M11/M14~M18）逐条看，不看总数就够
```

**停止点（决策门 D1）**：**素材引用的语法**（`sprite:lin/neutral`）—— 需要用户点头，因为它是
一个新发明的字符串约定（可读性 vs 与剧目内路径的区分度）。备选：`sourceType: "path"|"asset"` 两个参数
（更啰嗦但不用发明语法）。**没点头前不要写这一步。**

---

### P5-c · 出图拆成 produce + 显式宏；删 `commit_asset`；`generate_asset` 两边同名同义

> **P5-a 落地时发现的 P5-c 前置（必须在这阶段解决）**：服务端 agent 的**可读面只有 `assets/`**
> （`apps/server/src/playFiles.ts:17` 的 `READONLY_PREFIXES`，另加可编辑面与 `memory/archive/`），
> 而候选图落在 `media-cache/drafts/`。所以「采用 = `import_asset(source=<候选路径>)`」这条在服务端
> **今天跑不通**——模型给的 `media-cache/...` 路径会被白名单当场拒掉。
> 两个可选形态（都属于 C6「对已入库/引擎持有的东西用引用，不让模型拼路径」）：
> **(a) 句柄语法** `source="draft:<draftId>"`（与 D1 定的 `sprite:<id>/<variant>` 同族，宿主用自己的
> IO 解析句柄，模型拿不到任意路径）；**(b) 只读源面**：把候选目录加进可读前缀。推荐 (a)：
> 它不放松任何权限边界，且与 D1 的形状一致。这一条要在 P5-c 动工前定下来（记进决策门）。


**为什么这么切**：这是收益最大的一步，也是 P5 的主干。
- 服务端 `generate_image` 一个 id 两种语义（`imageTool.ts:79`/`:95`）、插件 `generate_image` 是**另一个动作**
  ——同名不同义（C2 违反）；
- 服务端还有 `commit_asset` 这个「另一种编排」（produce/register 的草稿版）；
- 插件有 `generate_asset` 宏（决策 §1：保留为显式宏）。

**目标形状**（终局，一次做到位，不要中间态）

| 工具 | 服务端 face | 插件 face |
| --- | --- | --- |
| `generate_image` | `image.generate` 的 **produce** 面：pick 12 格（去掉 `referenceCharacters`）+ `aspectRatio`；给 `kind` 就走剧目感知落位，**落候选区、不抠底、不入库** | 同一份 pick（**同一套参数、同一段描述**） |
| `generate_asset` | `asset.generate` 宏：`pick(image.generate)` + `meta`，`mode: "queued"`（剧作家）/`"sync"`（工坊）由 face 决定 | 同一份 pick，`mode: "sync"` |
| `commit_asset` | **删** | —（本来没有） |

**改动文件**

| 文件 | 动作 |
| --- | --- |
| `packages/agent/src/capabilities/image/generate.ts` | `kind` 改**可选**（不给 = 通用候选）；`imageTargetOf` 增加「kind 缺席 ⇒ 返回 undefined」；`aspectRatio` 进 `imageGenerateFields`；**删 `referenceCharacters`**（兼容别名是历史包袱，两条 face 都已 pick 它）；`IMAGE_GENERATE_DOC` 补一句「不给 kind = 通用候选，不落素材」 |
| `packages/agent/src/capabilities/asset/generate.ts` | 新增宏：`assetGenerate` = `imageGenerate.execute` →（sprite）`deps.cut` → `deps.register`；描述第一句必须写「= `generate_image` +（立绘）`cut` + `import_asset` 的组合，不藏策略」 |
| `packages/agent/src/capabilities/index.ts`、`src/index.ts` | 注册与导出 |
| `packages/agent/test/image-generate.test.ts` | 补：kind 缺席的归一化、`referenceCharacters` 移除后的行为 |
| `packages/agent/test/asset-generate.test.ts` | 新增：宏的三步顺序、立绘走 cut、同名跳过 |
| `apps/server/src/agentkit/imageTool.ts` | 拆成 `runProduce`（原来的 `runSync` 去掉入库/抠底）与 `runGenerateAsset`（原来 `runQueued` 的排产 + 工坊的直落） |
| `apps/server/src/agentkit/commitTool.ts` | **删**（采用 = `import_asset(source=draft 路径, kind=…, original=原片)`） |
| `apps/server/src/agentkit/kit.ts` | `TOOL_CATALOG`：`commit_asset` 删、`generate_asset` 加；`CATALOG_ROWS.image.tools` 换 |
| `apps/server/src/playAssets.ts` | `draft()` 不再对 sprite 自动抠底（抠底归 `cut`/宏）；宏仍走 `generate` |
| `apps/server/src/{prompt,workshop,orchestrator,playhouse}.ts` | 剧作家的 `generate_image` 字样换 `generate_asset` |
| `apps/server/src/agentkit/contract.ts` | `image` 行的语义重写；副作用表按新工具重排 |
| `dsh-aivn-shared/src/tools/generate-image.ts` | 从手写 schema 改成 `image.generate` 的 face |
| `dsh-aivn-shared/src/tools/generate-asset.ts` | 去掉宿主自加的 `description`（C1 违例，`generate-asset.ts:59-62`），改由 `meta` 承载；描述第一句写清是宏 |
| `dsh-aivn-shared/src/{playwriter,stagehand}/prompt.ts` | `IMAGE_POINTER`（`playwriter/prompt.ts:222`）、`stagehand/prompt.ts:102-103` 的措辞 |
| `dsh-aivn-shared/e2e/verify-injection.mjs:202-213`（A14） | 工具面断言跟着改 |
| `dsh-aivn-shared/e2e/verify-media.ts:255`（M18d）、`:263`（M19）、`:272`（M20） | 门控断言跟着改 |
| `README.md` / `README.en.md`（两侧） | 工具表 |

**影响面（提示词与演出回路）**

- 服务端剧作家的排产路径改叫 `generate_asset`：`emitPreload` + `kick`/`kickSprite` + 到货广播
  （`orchestrator.ts:576-579`、`playhouse.ts:1339`）**逻辑不动，只换工具名与描述**。
- 服务端工坊的候选流程：`generate_image`（候选，不再自动抠底）→（立绘）`cut` → `import_asset`。
  **这是一次功能性变化**：立绘候选不再自动透明。**决策门 D2**，见 §5。
- 守卫 1（提示词点名的工具必须在装配面上）会拦住漏改的名字。

**验证**

```bash
pnpm --filter @aivn/agent test                          # 期望 26 文件 / 195±8
pnpm --filter @aivn/server typecheck
pnpm --filter @aivn/server exec vitest run test/agentkit.test.ts test/image.test.ts test/imagePrompt.test.ts \
  test/playAssets.test.ts test/playhouse.test.ts test/prompt.test.ts test/promptCapabilities.test.ts
pnpm check:agent-contract                               # 9/9
cd /root/projects/dsh-aivn-shared && npm run typecheck && npm run build && node build.mjs --check && npm run e2e:media
dsh-e2e start --patch <provider patch> && E2E_PHASES=first dsh-e2e run e2e/verify-injection.mjs   # 20/20
E2E_PHASES=first dsh-e2e run e2e/verify-stagehand.mjs                                             # 22/22
```

**已完成（2026-10-09 夜）**：包内 `image.generate` 转 produce 语义（`kind` 可选、`aspectRatio` 进共享字段、删 `referenceCharacters`、结果改成结构化的 `ProducedImage`）、新能力 `asset.generate`（显式宏：出图 →（立绘）抠底 → 登记，同名跳过写在文档里）、插件 `generate_asset` 已切到宏（行为不变）、服务端 face 去掉兼容别名。
**待做**：服务端 `generate_image` 只产候选 / 新增 `generate_asset`（剧作家排产、工坊同步）/ 删 `commit_asset`（采用 = `import_asset(source="draft:<草稿id>")`，句柄由宿主解析）/ `draft()` 不再对 sprite 自动抠底；插件 `generate_image` 转 produce face；两侧提示词、e2e 锚点、README。

**停止点**：D2（服务端候选立绘是否不再自动抠底）；以及**这一步做完就要停下来找用户确认**
——它是 P5 唯一一次改变服务端**操作流程**的阶段（模型要连调两个工具），确认后再进 d。

---

### P5-d · 元数据出生成工具：`asset.annotate`

**为什么这么切**：`generate_bgm` 的 10 格里有 8 格是素材表属性（`musicTool.ts:20-43`），
而插件那边这 8 格**完全没有出口**（`media/bgm.ts:37` 只写来源标记）——同一件事在一侧是赘肉、在另一侧是缺口。

**形状（推荐方案）**

- 能力 `asset.annotate`（**新增**）：`target`（`AssetTarget`，**扩展**为含 `bgm`）+ `meta`
  （共享类型 `AssetMetaPatch` = `title / description / tags / mood / scene / loop / volume`）。
- `music.generate` 的 fields **删掉那 8 格**，只留 `name / prompt / model / overwrite`（两侧一致）。
- **元数据的三个承载体**：`annotate_asset`（独立原子面，负责事后改 + 没有 register 步骤的素材如 bgm）、
  `import_asset`/`generate_asset` 的 `meta?`（落成步的属性，因为 register 写素材表声明就在那一步）。
  **生成工具（`generate_bgm`）不承载元数据** —— 这正是任务书 §3 提案 3 要的那条线。
- 备选方案 B（若用户不同意 A）：`meta` 只挂在 register/宏上，`annotate_asset` 只做「事后改」——
  形状一样，只是语义描述不同；代价是 BGM 的元数据必须靠一次单独的 annotate。

**改动文件**

| 文件 | 动作 |
| --- | --- |
| `packages/agent/src/capabilities/asset/annotate.ts` | 新增（fields / doc / deps / execute） |
| `packages/agent/src/capabilities/music/generate.ts` | 删 8 格（`:25-48`），保留 `name/prompt/overwrite/model`；`requestOf` 与 `MusicGenerateRequest` 跟着收 |
| `packages/agent/src/capabilities/asset/register.ts` | 加 `meta?`（P5-a 建的文件） |
| `packages/agent/src/capabilities/image/generate.ts` | `asset.generate` 宏加 `meta?` |
| `packages/agent/src/media/catalog.ts` | 加 `declareMeta(manifest, target, patch)`（现在的 `declareDescription` 是它的特例） |
| `apps/server/src/agentkit/musicTool.ts` | FACE 收到 4 格 |
| `apps/server/src/agentkit/annotateTool.ts` | 新增 face |
| `apps/server/src/playMusic.ts:160-172` | 元数据写入路径改由 annotate 走；BGM 生成只写来源 + 台账 |
| `apps/server/src/agentkit/kit.ts` / `contract.ts` | 工具登记、副作用表、矩阵 |
| `dsh-aivn-shared/src/tools/annotate-asset.ts` | 新增 face |
| `dsh-aivn-shared/src/tools/generate-bgm.ts` | FACE 保持 4 格（不变） |
| `dsh-aivn-shared/src/media/bgm.ts` | 不动（annotate 走 `catalog.ts` 的写口） |
| `dsh-aivn-shared/src/play/play-files.ts:73-78` | 「元数据可以手写进 manifest.json」那段改成「用 `annotate_asset`」 |

**影响面**：服务端工具面 25 → 26；插件 9 → 10（f 阶段再加 1）。
服务端剧作家**按 mood/scene 选曲**这条链路从「生成时一次写全」变成「生成 + 标注两步」——
提示词要明确「生成完顺手标注」。

**验证**

```bash
pnpm --filter @aivn/agent test                          # 期望 28 文件 / 205±8
pnpm --filter @aivn/server exec vitest run test/music.test.ts test/agentkit.test.ts test/playAssets.test.ts
pnpm check:agent-contract
cd /root/projects/dsh-aivn-shared && npm run typecheck && node build.mjs --check && npm run e2e:media
```

**停止点（决策门 D6）**：元数据的三个承载体是否接受；以及**插件不新增「缺描述的素材」自查项**这条
（我建议在 P5-i 加，作为漏标的兜底）。

**实施清单（2026-10-10 盘清，待 D6 放行——落点逐条核对过代码）**

| # | 动作 | 落点 |
| --- | --- | --- |
| 1 | 新能力 `asset.annotate`：`target`（`AssetTarget` 扩 `bgm`）+ `meta`（`AssetMetaPatch` = title/description/tags/mood/scene/loop/volume） | 新文件 `packages/agent/src/capabilities/asset/annotate.ts`；`AssetTarget` 现有 kind 三态在 `media/target.ts` |
| 2 | `music.generate` 删 8 格，只留 `name / prompt / model / overwrite` | `capabilities/music/generate.ts:25-48`；`MusicGenerateRequest` 与 `requestOf` 跟着收 |
| 3 | 元数据写口泛化：`declareDescription` → `declareMeta`（前者成特例） | `media/catalog.ts:118` |
| 4 | 服务端 FACE 收到 4 格 | `apps/server/src/agentkit/musicTool.ts:18-42`（现在 10 格） |
| 5 | 服务端新 face `annotate_asset` + 登记/副作用/矩阵 | 新 `apps/server/src/agentkit/annotateTool.ts`；`kit.ts:276+`、`contract.ts:330+` |
| 6 | BGM 生成只写来源 + 台账，元数据走 annotate | `apps/server/src/playMusic.ts:160-172` |
| 7 | 插件新 face `annotate_asset`（9→10） | 新 `dsh-aivn-shared/src/tools/annotate-asset.ts`；`src/tool-catalog.ts`；`e2e/verify-injection.mjs` A14 |
| 8 | 插件剧目文件说明改「用 `annotate_asset`」 | `dsh-aivn-shared/src/play/play-files.ts:73-78` |
| 9 | 提示词：服务端剧作家「生成完顺手标注」 | `apps/server/src/prompt.ts` 配乐段 |

**D6 要拍的两问**：(a) 元数据三个承载体（`annotate_asset` 独立面 / register·宏上的 `meta?` /
生成工具**不**承载）接受吗？(b) 漏标的兜底自查项放 P5-i 加，还是不要？

---

### P5-e · `play.readiness` 能力 + 两侧 `validate_play`（决策门 D3）

**为什么这么做**：§3.5 的判定——这是历史惯性，可统一。包内已有判据（`readiness/play.ts`），
只差把「agent 面报告」升成能力的 `doc` + 渲染，服务端换报告文本（同时改提示词《当前状态》那一章）。

**改动文件**

| 文件 | 动作 |
| --- | --- |
| `packages/agent/src/capabilities/play/readiness.ts` | 新增（fields 空、`doc` = 现 `validate_play` 的描述、`execute` 返回包内完整报告） |
| `packages/agent/src/readiness/play.ts` | 现状的 `renderReadiness` 保持（面板四行仍可复用它），另加 agent 面完整渲染 |
| `apps/server/src/agentkit/readinessTool.ts` | 改名 `validatePlayTool.ts`；`execute` 换完整报告；描述取能力 doc |
| `apps/server/src/agentkit/kit.ts` | 能力行 `readiness` 的 `tools` 换名；角色是否仍限工坊 = 决策门 |
| `apps/server/src/{workshop.ts,prompt.ts}` | 《当前状态》章节改用完整报告（`readinessTool.ts:9-12` 那条约束） |
| `apps/server/test/{workshop,workshopPrompt,agentkit}.test.ts` | 断言跟着改 |
| `dsh-aivn-shared/src/tools/validate-play.ts` | 迁到能力（描述从能力来） |

**验证**：`pnpm --filter @aivn/agent test`（29 文件）；服务端 `test/workshop*.test.ts` + `test/agentkit.test.ts` +
`test/prompt*.test.ts`；`pnpm check:agent-contract` 9/9；插件 `typecheck` + `build.mjs --check` + `e2e:media 53/53`。

**停止点**：D3 —— 服务端的 agent 报告是否换成完整版（会改提示词与既有断言，是产品可见的变化）。

---

### P5-f · 收窄服务端的 `view_image`（**插件不补工具**，2026-10-09 修订）

**原方案作废**：原计划让插件补一个 `view_image`，理由是「任务书说实现已在包里、补齐只是接线」。
用户指出插件不需要它，实读复核后**确认用户对、任务书错**：

- **DSH 宿主自带看图**：`@deepseek-ai/dsh-tool-fs` 同时提供 `read`（文本）与 `read_image`
  （PNG/JPEG/WebP/GIF，magic-byte 校验，见 `dsh-tool-fs/lib/index.js:778-795`），
  而插件预设已经装了 `tool-fs` 行（`dsh-aivn-shared/src/playwriter/preset.ts:51`）。
  插件再补一个 `view_image` = 与宿主能力重复。
- **服务端的 `view_image` 对本地图同样冗余**：pi 的 `read` 自己就带图片支持——
  `detectSupportedImageMimeType` + 以 `{type:"image", data, mimeType}` 附件送出
  （`pi-agent-core/dist/harness/tools/read.js:15` 的描述与 `:51-53` 的实现），
  而服务端的 `read` 已经常装（`BASE_TOOLS`）。它**唯一**还站得住的增值是
  「http(s) → 本地缓存 → 读进上下文」这一段（SSRF 防护 + `.part` 原子落盘）。

**改成什么**：把 `view_image` 收窄成只收 http(s) 的 `fetch_image`
（URL → `media-cache/web-images/` 落盘 → 返回路径），看图交给两侧宿主的 `read` / `read_image`；
**不新增共享能力**，也不给插件加工具。若 P5-a 的 `import_asset(source=http)` 落地后
「把网图登记成素材」已经覆盖了主要用法，这一步可以整段砍掉。

**改动文件**

| 文件 | 动作 |
| --- | --- |
| `apps/server/src/agentkit/viewTool.ts` | 收窄：`source` 只收 http(s)（本地路径交给 pi `read`）；描述里点名「本地图直接 `read`」 |
| `apps/server/src/agentkit/kit.ts` / `contract.ts` | 工具名与矩阵行同步（若改名 `fetch_image`，守卫 1 会拦住漏改） |
| `apps/server/src/agentkit/contract.ts` | `view` 行的说明改成事实描述（今天写的「DSH 用宿主看图能力」其实**是对的**，只是当时没查证） |

**验证**：`pnpm --filter @aivn/server typecheck` + 受影响子集（`test/agentkit.test.ts` 等）；
守卫 `node scripts/check-agent-contract.mjs` 仍 9/9。

**停止点**：无。反悔点：若模型实际需要「看外链图」，就把 `fetch_image` 保留；
若它只用来读本地图，直接删掉。

---

### P5-g · 配置工具形状统一（决策门 D4）

**为什么这么做**：§2 #5 —— 两种配置工具形状不一致（嵌套三态 vs 17 平铺 `oneOf`）。
统一成**一个 patch 对象 + 数据驱动白名单**：键集合与取值规则是**数据**，schema 里不再逐个写 `oneOf`。

**改动文件**

| 文件 | 动作 |
| --- | --- |
| `packages/agent/src/config/patch.ts` | 新增：`ConfigSpec`（字段名 / 取值（枚举或字符串格式）/ 一句说明）+ `buildPatchFields(spec)`（把规格编译成一格 `patch` 的 `ObjectNode`） |
| `packages/agent/src/craft/params.ts` | 补一份 `CRAFT_CONFIG_SPEC`（现在 `CRAFT_ENUMS` 是数据，形状还不是） |
| `apps/server/src/agentkit/craftTool.ts` | `setCraftParams`（`:22-96`）换成 `patch` 一格；校验改走 `mergeCraftParams`（已有）+ spec |
| `dsh-aivn-shared/src/tools/set-stage-style.ts` | `PARAMETERS`（`:58-60`）换成 `patch` 一格；`validateThemePatch` 不动 |
| 两侧提示词 | 例子里 `set_craft(beatLength=…)` → `set_craft(patch={…})` |

**影响面**：服务端**失去 pi 的 enum 硬校验**（今天非法取值由 `Type.Literal` 当场拒；之后要靠数据校验
返回错误回执）。这是为形状一致付出的代价 —— 所以它是决策门。

**验证**：`pnpm --filter @aivn/server exec vitest run test/craftTool.test.ts test/craftParams.test.ts test/workshop*.test.ts`；
插件 `e2e:media` + `e2e:style` 套件（`node e2e/run.mjs style` 不含真 LLM 的那几条）。

**停止点**：D4 —— 值不值得为形状一致牺牲 pi 的硬校验。

> **2026-10-10 结论：整段作废。** 用户的追问（「这类工具不能用文件工具代替吗」）把题换了：
> 正确的方向不是统一形状，而是**删掉 `set_craft`**（服务端也用 `edit` 改 play.json）。
> 该结论落在 **P6-b**（见 `261009-aivn-agent-package.p6.plan.md`），已随本轴实施完成。

---

### P5-h · 插件 `generate_bgm` 异步化（决策门 D5，可整段砍掉）

**为什么这么做**：任务书 §2.3 指出插件同步等待的旧理由已不成立。但要诚实：**这是风险最高的一步**，
它改的是回合语义（`inject` 落 `next-step`、`followup` 落 `next-turn` 且一轮只认领一条，
见 `AGENTS.md` 与 `stage-tap.ts:183-212`）。

**形状**：`music.generate` 的 face 从「await 完再回执」改成「`deps.start` 发起即返回 + 到货时
用 `agent.followup` 播报一条（并登记 `injected.remember`）」。

**改动文件**：`src/tools/generate-bgm.ts`（投递方式）、`src/media/bgm.ts`（拆出「发起」与「落库」）、
新增一个「到货播报」的接线点（`src/index.ts` 或 `src/hub.ts` 侧）、`src/injected.ts`（登记摘除）。

**验证**：`e2e:media`（离线，可加一条「发起即返回」的判据）+ 一次真 LLM 的 `E2E_PHASES=first` 冒烟。

**停止点**：D5 —— 先确认「到货播报落在哪个轮边界」是否可接受（最坏情况：玩家下一轮才看见）。
**若用户不接受，本段整段不做**：同步等待是**真宿主机制**下的合理选择，不是错误。

> **2026-10-10 结论：用户定「先不做」**（原话：同步异步还有队列的问题后面我们整体再看）。整段搁置。

---

### P5-i · 契约与文档收尾

**改动文件**

| 文件 | 动作 |
| --- | --- |
| `apps/server/src/agentkit/contract.ts` | `CAPABILITY_MATRIX` 按新形态重写：`image` 行拆成 `image`（produce）/`asset`（register+annotate+宏）；`music` 行的差异只剩投递方式；`readiness` 行改成「同名同能力，报告按读者分两份」 |
| `scripts/check-agent-contract.mjs` | 新增第 10 项：**face 参数面必须由 `pick` 声明**（扫 `apps/server/src/agentkit/*Tool.ts` 与插件 `src/tools/*.ts`，出现 `Type.Object({…})` 手写参数面且不在白名单里就红） |
| 两侧 README + `AGENTS.md` | 工具表、提示词地图、e2e 锚点表 |
| 本 plan 的「实施进度」表 | 每阶段落地后追加提交号 |

**验证**：`pnpm check:agent-contract` 期望 **10/10**；全量 live e2e（`injection` / `stagehand` / `stage` /
`entry` 按改动面选段）。

---

## 5. 风险与反悔点

| # | 风险 | 触发条件 | 对策 / 反悔点 |
| --- | --- | --- | --- |
| D1 | **素材引用语法**（`sprite:lin/neutral`）是新发明的字符串约定 | P5-b | 备选：`source` + `sourceType` 两个参数。**没确认前不写这一段** |
| D2 | 服务端的候选立绘**不再自动抠底**（原子路径要求显式 `cut`） | P5-c | 这是「向插件形态靠」的直接后果，宏路径仍一键。**若用户要保留自动抠底，则 c 阶段只做改名与 `commit_asset` 的合并，不做抠底搬家** |
| D3 | 服务端 agent 报告换成完整版（改提示词《当前状态》与既有断言） | P5-e | 可只做重命名与能力化，报告文本不动（那就把它登记为 `intentionalDifference`） |
| D4 | 服务端失去 pi 的 enum 硬校验 | P5-g | 整段可砍 |
| D5 | 插件 BGM 异步化改回合语义 | P5-h | 整段可砍（同步等待是合理选择） |
| D6 | 元数据的三个承载体可能让模型漏标 | P5-d | 承载体收敛为一个共享类型 + 一份文档；P5-i 考虑给两侧自查报告加「缺描述的素材」一项 |
| R-prompt | 改名牵动提示词与 e2e 锚点（`IMAGE_POINTER`、A13/A14、M19/M20、`prompt.ts`、`workshop.ts`） | 每个阶段 | 守卫 1 会拦住漏改；改名批次各自独立成阶段，不与其他语义变更混在一起 |
| R-lib | 插件 `lib/` 是受跟踪产物；`node_modules/@aivn/*` 是手动软链 | 每个插件阶段 | 改完 `npm run build` 再 `node build.mjs --check`；**别在 worktree 跑 `npm install`**；合并前把软链指回 canonical `../stage-ai` 再重建（plan 的风险 R2） |
| R-e2e | live e2e 要 provider patch，且本机内存紧张 | 每个碰提示词的阶段 | 只用 `E2E_PHASES` 挑相关段；单点跑不给验收结论 |
| R-context | 这一步会把「一个 id 两种语义」换成「两个 id 一段共享正文」，模型可能选错 | P5-c | 两段描述的第一句必须互相点名（宏说「= 原子三件套的组合」，produce 说「落成素材走 `import_asset` / 一键走 `generate_asset`」） |

**「做到哪一步该停下来找用户确认」汇总**：D1（P5-b 之前）、D2（P5-c 之前）、P5-c 之后（唯一改操作流程的阶段）、
D3/D4/D5（各自阶段之前）、以及**每一阶段插件侧改完 `lib/` 之后**（要不要跑 live e2e）。

---

## 6. 验证矩阵（本 P5 用到的全部）

| 层 | 命令 | 期望 |
| --- | --- | --- |
| 包 | `pnpm --filter @aivn/agent test` | 基线 **22 文件 / 168 条**（本次实测）；每阶段按 §4 各段的期望数 |
| 包 | 新能力的 `assertCommonSubset` 遍历 | 不新增红 —— 现有的全表遍历在 `packages/agent/test/web-search.test.ts:51`（对 `CAPABILITIES` 逐条过），新能力自动纳入；`test/ir.test.ts:50-56` 只测编译器本身 |
| 服务端 | `pnpm --filter @aivn/server typecheck` | 0 错 |
| 服务端 | `pnpm --filter @aivn/server exec vitest run <受影响子集>` | 基线（19 文件子集）**340 条**（本次实测，文件清单见 §7）；阶段内按改动面挑，不新增红 |
| 服务端 | `pnpm check:agent-contract` | 基线 **9/9**（本次实测）；P5-i 后 **10/10** |
| 插件 | `npm run typecheck` | 0 错（本次实测 ✓） |
| 插件 | `npm run build` + `node build.mjs --check` | 「产物与源码一致」（本次实测：`lib/index.js` 339.6 KiB、`lib/client.js` 174.7 KiB、`skills/` 一致） |
| 插件 | `npm run e2e:media` | 基线 **53 条**（本次计数）；不新增红 |
| 插件 live | `dsh-e2e start --patch <临时 provider patch>` 后<br>`E2E_PHASES=… dsh-e2e run e2e/verify-{injection,stagehand,handmade-play}.mjs` | 基线 **20 / 22 / 4**（本次计数）；按改动面挑段 |
| 交叉 | 「两侧技能副本与包内 md 逐字一致」「能力表覆盖两边全部 face」「同名工具的描述正文同源」 | 由守卫与 e2e 断言共同钉 |

---

## 7. 本次实测的基线与命令（证据）

在写这份计划时实跑过下面这些，数字与上面引用一致：

```
pnpm --filter @aivn/agent test              → Test Files 22 passed (22) · Tests 168 passed (168)
pnpm --filter @aivn/server exec vitest run \
  test/{agentkit,image,imagePrompt,playAssets,craftTool,craftParams,workshopPrompt,workshop,prompt,
        promptCapabilities,assetLibrary,assetLifecycleContract,assetRef,voiceTool,voiceCatalog,music,
        playEnv,webImage,nsfwTool}.test.ts  → Test Files 19 passed (19) · Tests 340 passed (340)
node scripts/check-agent-contract.mjs       → 全部 9 项检查通过
cd /root/projects/dsh-aivn-shared
  npm run typecheck                         → 0 错
  node build.mjs --check                    → 产物与源码一致（lib/index.js 339.6 KiB / lib/client.js 174.7 KiB）
  grep -c "check(" e2e/verify-media.ts      → 53
  grep -c "check(" e2e/verify-injection.mjs → 20   （verify-stagehand 22 / verify-handmade-play 4）
```

任务书给的两个数字我**没有复现**（口径不同，不作为判据）：服务端「受影响子集 131 条」、
包「168 条」已复现。

---

## 8. 与既有计划的关系

- 本计划**不推翻** P0~P4 的任何落地结果，只在其上加 face 层收敛；R1~R8 全部继续有效。
- 三条**已定决策**（任务书 §1）在本计划里被显式承接：
  `generate_asset` 保留为显式宏（P5-c 的回执）；P4 的 face 分叉在这里被重新审（§2/§3）；
  插件 `import_asset` 保留原名、服务端 `library_import` 已改名（P5 不动这两个名字）。
- 若 P5-c 落地，`261009-tool-surface-map.md` 的 §3 判定表需按新形态重出一版
  （它的 HEAD 是 P4 前，本计划 §2 已列出它过时的两行）。

---

## 9. P6 轴：宿主流程工具文件化（范围分析，2026-10-09）

> **2026-10-10 更正（expert 独立复核 + 用户拍板）**：本节有三处论断被推翻，**以下文为准**：
> ① 服务端工具面是 **25** 项不是 24（12 宿主流程 + **13** 其它，`kit.ts:276-305`），插件目录是 **10** 不是 9；
> ② 「`stateFiles` 随快照走，所以搬进 `state.json` 不损回滚语义」**不成立**——`engine` 与 `stateFiles`
>    是分开快照、分开恢复的，普通文件不会自动 branch-local；
> ③ 「工坊文件页与 `set_craft` 共用一条写队列」**不成立**——文件页 PUT 走 `workshop.writeFile` →
>    `playFiles.ts:220-240`，不经 `withPlayConfigLock`，事实是**锁与无锁写者并存**。
> 另：`library_import` 与插件 `import_asset` **不同义**，不计统一收益。
> 复核全文见 `261009-p6-scope-review.md`；执行计划与四问结论见 `261009-aivn-agent-package.p6.plan.md`。

> **这一节只回答一个问题**：服务端那 12 个**宿主流程工具**能不能用文件工具
> （`read` / `write` / `edit` / `grep` / DSL 标签）替代；替代之后两个宿主的工具面是否就统一了。
>
> **结论先行**：
>
> - **不能靠它统一工具面。** 12 个里，**只有 4 个**文件化之后能换来真实的两边收敛
>   （`update_state` / `read_memory_detail` / `set_craft` / `library_import`）；
>   **4 个能文件化但统一收益为 0**（`search_archive` / `list_saves` / `read_lineage` / `list_library`
>   —— 数据确实在盘上，但插件侧**没有对应物**，文件化只是服务端内部重构）；
>   **4 个不该动**（`beat_done` / `enter_nsfw` / `exit_nsfw` / `read_skill`）。
> - 这一块两边**今天完全不统一**（插件 10 个工具里一个流程工具都没有，`src/tool-catalog.ts:53-125`；
>   e2e 反向钉死：`e2e/verify-injection.mjs:151/162` 的 A12/A13b、`e2e/verify-stagehand.mjs:170` 的 S14）。
> - 正确的统一方式是**数据面**而不是**工具面**：领域数据以**剧目文件**为真相源（插件已经这样），
>   工具只在「它动的是运行时」时才存在；**这 12 个里恰好有一半动的是运行时**，文件化不了也不该文件化。

### 9.1 判定口径

| 判定 | 含义 | 「有收益」的判据 |
| --- | --- | --- |
| **能文件化** | 已有的文件工具就能表达同一动作且**不丢语义**；插件侧今天**已经**是这么做 | 插件用文件工具做同一件事 → 真收敛 |
| **有条件** | 能，但要引擎侧新增东西（watcher / 校验 / 把状态落成文件） | 收益 = 换来的统一程度 − 新增机制的成本 |
| **不能 / 不该** | 它动的不是数据而是**运行时**（模型通道、轮收束、宿主通道），或统一收益为 0 | — |

唯一的「有收益」判据是**插件侧今天是否用文件工具做同一件事**。不是 → 文件化只是服务端内部重构，
两边照样不一样，不该为它付引擎机制的成本。

### 9.2 逐工具判定表（12 个）

| # | 工具 | 领域动作 | 依赖的宿主 / 引擎状态（file:line） | 插件今天的对应做法 | 判定 |
| --- | --- | --- | --- | --- | --- |
| 1 | `beat_done` | 本轮收束 + 交出停止点 | `deps.emitStop(ModelStop)` → IR → 广播 → 落谱系（`beatTool.ts:66-74`）；pi `terminate` 收束 turn，批内兜底在 `orchestrator.ts:651-661`；漏调追收束 `orchestrator.ts:74-80`；刻意保留的理由自陈在 **`beatTool.ts:6-17`** | **DSL 标签**：剧本末行 `<stop options="…"/>` / `<stop placeholder="…"/>` / `<stop/>`（`src/preset-tools.ts:36-38`；解析器在 `packages/core`） | **不能**（不该） |
| 2 | `update_state` | 提议世界状态更新（好感度增量 / 旗标 / 场景 / 剧情线） | `deps.engine.affinity`/`flags`（`memoryTool.ts:71-77`）+ `deps.stateFiles`（`:82`）；校验：成员 id / 整数 / \|Δ\|≤5 / clamp 0–100（`memoryTool.ts:7-8, 62-74`）；真值随谱系快照回滚（`orchestrator.ts:1565-1599` 的 `stateAt`/`restoreBranchState`，快照 `:2105-2112`） | **文件工具**：`write`/`edit` 三个文件 `memory/always/state/{scene.md,threads.md,state.json}`（提示词 `src/playwriter/prompt.ts:145-165`；读回 `src/play/play-context.ts:298-330`；周目边界重置 `src/play/play-state.ts`） | **有条件能**（真收益） |
| 3 | `enter_nsfw` | 请求进入限制级通道 | **换模型**：`const model = isNsfw && opts.nsfwModel ? opts.nsfwModel : opts.model`（`orchestrator.ts:625`）＋ pending 三态（`:447-452`）＋ 提示词整段切换（`apps/server/src/prompt.ts:393-399`） | **无**（插件没有这条通道，`src/capabilities.ts:14-18` 里也没有它） | **不能** |
| 4 | `exit_nsfw` | 请求退出限制级通道（+ SFW 摘要） | 同 3；退出提交 `orchestrator.ts:2065-2069`；SFW 摘要由专用模型另跑 | **无** | **不能** |
| 5 | `read_memory_detail` | 读一张记忆卡的全文 | `PlayMemory.readCard(name)`（按标题 / 相对路径 / 文件名三种写法容错，`apps/server/src/memory.ts:97-105`）+ `visibleContext()` 分支可见集（`memoryTool.ts:104-112`） | **`read`**：A 区《记忆索引》每行都带路径，模型直接读（`src/play/play-context.ts:248-266`） | **能文件化**（真收益） |
| 6 | `search_archive` | 全文检索**本分支**历史演出 | MiniSearch + CJK bigram + `tree.pathSet()` 防剧透过滤（`memoryTool.ts:120-127`；`memory.ts:107-131`）；数据**已落盘**在 `memory/archive/events.jsonl`（`memory.ts:15, 37-38, 69, 140-148`），每片带 `entryId`（分支过滤键，`:164-174`） | **无**（往事 = DSH 会话历史，模型没有可 grep 的文件） | **有条件**（数据是文件，但收益 0） |
| 7 | `list_saves` | 列周目（存档） | `PlaySaves.list()`（`lineageTool.ts:38-51`）；数据是文件：`<playDir>/saves/*/meta.json` + `active.json`（`apps/server/src/saves.ts:10-12, 39-47`） | **无**（插件无周目概念；跨周目只有 `endings.json` 账本，且不暴露工具） | **能（数据是文件）但收益 0** |
| 8 | `read_lineage` | 只读某周目的故事树 | `assertSaveId` + `saveStore(saveId).loadSession()` + `LineageTree.describe()`（`lineageTool.ts:58-71`）；渲染含 onPath 过滤 / 快照计数 / 分页 / 中文 kind 标签（`:100-134`） | **无** | **不建议**（渲染语义重，grep 替代不了；收益 0） |
| 9 | `list_library` | 浏览跨剧目素材资源库 | `AssetLibrary.list()` + `libraryEntryMatches` + 截断 40（`libraryTool.ts:104-140`）；库根 `STAGE_LIBRARY_ROOT` | **无，且越界**：插件能力面 `library` **恒假**（`src/capabilities.ts:14`「两者都已出范围」）；`e2e/verify-injection.mjs:151` 的 A12 反向钉死 | **能（库是目录）但收益 0** |
| 10 | `library_import` | 把库条目复制进剧目（写素材表 / 角色卡） | `importFromLibrary`（`libraryTool.ts:157-186`）+ 写盘回调 | **同名不同义**的 `import_asset`（`src/tools/import-asset.ts`）；P5-a 已把它升成共享能力 `asset.register` | **有条件能**（搭 P5-a 便车） |
| 11 | `read_skill` | 读技能全文 | `readSkill(name)` 只读 `apps/server/skills/`（`skillTool.ts:6-12, 18-35`）；守卫 `scripts/check-agent-contract.mjs:297-343` | **宿主技能通道**：预设行 realm（`src/playwriter/preset.ts:63-94`）+ `skill` 工具 | **不能**（不该） |
| 12 | `set_craft` | 改 `play.json` 的 `craft` 段 | `withPlayConfigLock` 串行 + `mergeCraftParams` + **只换 craft 一个键**（`craftTool.ts:12-17, 117-140`）；非法取值由 pi `Type.Literal` 当场拒（`:22-96`） | **文件工具**：`write`/`edit` `play.json`（提示词明写「想改就 edit 这一格」，`src/play/play-context.ts:112-114`） | **能文件化**（真收益） |

### 9.3 「能文件化」的替代形态草案

#### 9.3.1 `update_state` → 写 `memory/always/state/` + 引擎校验 watcher

**形态**：删工具。`state.json` 承载 `{affinity, flags}`，`scene.md` / `threads.md` 不变。
**关键前提（这条真能做，靠它）**：`stateFiles` **本来就是「随快照走的文件内容」**
（`orchestrator.ts:2105-2112` 的 `SnapshotFacts.stateFiles`，回滚走 `:1594-1595`），
所以把 `affinity` / `flags` 从 `engine` 搬进 `state.json` 的队伍里有这样一条希望——**但它不成立**
（2026-10-10 更正：两者是分开快照、分开恢复的，普通文件不会自动 branch-local，见
`261009-p6-scope-review.md` §5）——
今天它们只是恰好存在 `engine` 里而不是文件里（`orchestrator.ts:1706` 的
`renderStateSection(engine, scene, stateFiles)` 把两者拼在一起渲染）。

**需要补的观察机制**（DSH 侧两条现成的，**不用自己写 chokidar**）：

- `ctx.tools` 的 **`tools/post-execute`** 瀑布（`@deepseek-ai/dsh-tools/lib/types/index.d.ts:70`）：
  拦 `write` / `edit` 的 `args.path`，命中 `memory/always/state/` 就跑校验。
- `ctx.workspaceFiles.changes(scope, path, signal)` 目录级文件观察 + `fs/observed` 失效通知
  （`@deepseek-ai/dsh-api-workspace-files/lib/types/index.d.ts:30, 117`）。

**代价与风险**：

- **回执依赖者**：`update_state` 的「已生效 / 被拒绝（请修正后重试）」是模型自纠的抓手
  （`memoryTool.ts:86-93`）。文件化后这个回执要由 watcher 造；不造的话模型改错了好感度**不会知道**。
- **提示词教学点**：服务端 2 处点名（`apps/server/src/prompt.ts:205, 286`）；
  插件侧 `src/playwriter/prompt.ts:145-165` 已是一整章《世界状态》的写法（可整段搬过去）。
- **测试 / e2e 锚点**：`apps/server/test/agentkit.test.ts`（28 处）、`orchestrator.test.ts`（48 处）、
  `prompt.test.ts`（24 处）；插件侧 A13b / S14 断言「没有 `update_state`」。

#### 9.3.2 `read_memory_detail` → `read`

**形态**：删工具。记忆卡**本来就是剧目文件**（`memoryTool.ts:38` 自陈「写口不在这里」）；
A 区索引带路径，模型 `read memory/index/<层>/<名>.md`。
**这已经半教过了**：服务端提示词自己写着「也可以直接 read 每行括号里的路径」
（`apps/server/src/prompt.ts:407`）。

**代价与风险**：丢两样**服务端独有**的便利——`readCard` 的三种写法容错（`memory.ts:97-105`）、
未命中时列出可用条目（`memoryTool.ts:108-111`）；两样在插件侧本来就没有，靠 A 区索引兜。
提示词 1 处（`prompt.ts:407`）。测试锚点 `test/memory.test.ts`。
**这是三条里最干净的一条。**

#### 9.3.3 `set_craft` → 直接 edit `play.json` + 保留校验

**形态**：删工具（或先按 P5-g 收成 patch 形状，再删）。插件今天就是这么做的
（`src/play/play-context.ts:112-114`）。

**代价与风险**：

- **并发**（2026-10-10 更正）：`withPlayConfigLock` 保护的是**服务端内部**的读改写事务；文件页 PUT
  与模型的 `write`/`edit` 本来就在锁外，且是「上游 stale read + 全量写」——加目录锁也挡不住。
  所以删掉 `set_craft` 是「少一个受锁写者」，**不是新增一类竞态**；「人 vs 模型」的冲突要另走
  乐观并发（见 `docs/issues/261010-play-json-write-conflict/`）。
- **硬校验降级**：pi 的 `Type.Literal` 当场拒非法取值 → 退化成 `validate_play` 事后报
  （插件 `validate_play` 的职责里已含「craft 取值对不对」，`src/tool-catalog.ts:60-66`）。
- 提示词 3 处（`apps/server/src/workshop.ts:185, 230, 247`）；测试 `test/craftTool.test.ts`、
  `craftParams.test.ts`；插件 S14 forbidden 列表含 `set_craft`（`e2e/verify-stagehand.mjs:170`）。

#### 9.3.4 `search_archive` → `grep memory/archive/events.jsonl` + 分支路径集合

**形态**（**只在服务端内部重构，不换来统一**）：切片已是 JSONL，每片带 `entryId`（分支过滤键）。
要补两样：(a) 把**当前分支的节点集合**给到模型（一个注入段或一个只读文件）；
(b) 用 `grep` 替 MiniSearch —— 中文**子串匹配**对「找一个词」这类查询不输 bigram 分词。

**代价与风险**：**排序与 limit 语义丢了**（MiniSearch 是相关性排序，grep 是文件顺序）；
**NSFW 过滤丢了**（`memory.ts:132` 的 `opts.nsfw === true || slice.nsfw !== true` 跳过露骨切片，
grep 读不到这个标记）；
**统一收益 = 0**（插件没有 archive 数据，`src/capabilities.ts:14` 里 `lineage` 恒假）。
**真正的价值不在删除**：哪天真要在插件侧补「往事检索」，正确做法就是「引擎逐轮落切片文件 + `grep`」，
而不是把 MiniSearch 移植过去 —— 那是**机制层的统一**，不是工具面的收敛。

#### 9.3.5 `library_import` → `import_asset(source=<库内路径>)`（搭 P5-a 的便车）

**形态**：P5-a 的 `asset.register` 已把「把一张外来的图登记成素材」变成共享原子口；
`library_import` 退化成「源在库目录」的 register + 批量循环，可整条塌进 `import_asset`。
**代价与风险**：库根在 `PlayEnv` 白名单之外（写面只放 characters/memory/config，
`kit.ts:366-375`；库是**只读源**，要另开一条只读源路径面）；测试锚点 `test/assetLibrary.test.ts`。
**插件侧不因此新增工具**（它没有库，`src/capabilities.ts:14`）。

### 9.4 不该文件化的 4 条：依据与「有意差异」登记

| 工具 | 为什么不该文件化 | 登记为 |
| --- | --- | --- |
| `beat_done` | **服务端需要 `terminate` 语义**：工具 terminate 之后没有文本位置可写，且「本轮结束」是编排器判轮边界的信号（`orchestrator.ts:403-407` 的 `beatClosed`、`:651-661` 的 `finishTurn` 批内兜底、`:74-80` 的漏调追收束）。改回标签 = 把 `beatTool.ts:6-17` 里逐条列出的代价（解析器状态机、minItems 校验、提示词约束）重新买一遍。**插件侧之所以是标签，是因为 DSH 的「在新对话中分支」与舞台重建只认助手消息轮尾**——两边 IR 同构、**载体必须不同** | `intentionalDifference`：停止点载体（工具 vs 剧本标签），IR 同构 |
| `enter_nsfw` / `exit_nsfw` | 它换的是**运行时模型**（`orchestrator.ts:625`），不是数据。文件里写个 flag 不会换模型；要新增 watcher + 轮边界切换时机。**且插件侧根本没有这条通道**，文件化对统一零收益 | `intentionalDifference`：限制级通道（服务端双模型 + SFW 摘要；插件无） |
| `read_skill` | 技能**通道**归宿主（服务端只读 `apps/server/skills/` + 守卫；插件是 realm 隔离的预设行）。**正文层已经统一**（`packages/agent/skills/` + `sync-skills.mjs`，见 §3.2）；文件化只会把「哪份技能在哪个通道可见」这条宿主规则搞乱 | `intentionalDifference`：技能通道（工具 vs 宿主 `available_skills`），正文同源 |

> 这 4 条（含 `enter_nsfw`/`exit_nsfw` 两条）今天在 `contract.ts` 的矩阵里**已有行**，
> P5-i 重修矩阵时把它们从「待定」定成「已定」，并给每行补一句「为什么载体必须不同」。

### 9.5 统一后的目标形态

**工具面算术**（2026-10-10 更正：P5-a…f 落地后是 **25 = 12 宿主流程 + 13 其它**；`kit.ts:276-305`）：

| 口径 | 结果 |
| --- | --- |
| 全部文件化的**理论下限** | 25 → **13**（不采纳：4 条零收益 + 4 条不能） |
| **实际执行**（P6-a + P6-b） | 删 2（`read_memory_detail` / `set_craft`）→ 25 → **23**；宿主流程工具 12 → **10** |
| `library_import` 并入 `import_asset` | 只省服务端代码，**不计统一收益**（两者不同义） |
| **叠加 P5 末态** | P5 净 +1（+`import_asset` +`annotate_asset` −`commit_asset`，末态 26；若 P5-f 也删 `view_image` 则 25）→ **26 → 22** |

**保留的 8 个宿主流程工具**（`beat_done` / `enter_nsfw` / `exit_nsfw` / `read_skill` /
`search_archive` / `list_saves` / `read_lineage` / `list_library`）继续各按宿主机制走，
在契约矩阵里逐条登记为有意差异。

**插件侧要不要跟着动**：**基本不动，只动一处**。

- `read_memory_detail` / `set_craft` / `update_state` 本来就是**插件没有的工具** →
  服务端删掉 = 两边天然对齐（`src/preset-tools.ts:36-45` 已写「模型用文件工具就能做的一律不装」）。
- `library_import` → 插件**不加**新工具（它没有库）。
- 所以「两边越像越好」在这一块的落点**不是工具名对齐**，而是这条约定：
  **领域数据一律落在剧目文件里，工具只在「数据是运行时」时才存在** —— 插件今天已经符合，
  服务端做那三条就是向它靠。
- **反向提醒**：不要为「两边像」给插件补 `list_saves` / `read_lineage` / `list_library` /
  `search_archive`。`src/capabilities.ts:14` 已把 library / lineage 判为「**出范围**」，
  那是有意的产品定位差异（复用 §3.3 的结论），不是缺口。

### 9.6 建议的切法

**结论：单独立 P6，不进 P5（不作为 P5-j）。** 三个理由（2026-10-10 起 P6 已立：
执行计划与四问结论在 `261009-aivn-agent-package.p6.plan.md`，本节判定表按该文件的 §2 与 §6 读）：

1. **与 P5 无耦合**：P5 收的是「同一动作两侧不同写法」（face 层），这一轴收的是「工具该不该存在」
   （存在性）。混在一份计划里，P5-c 那次「唯一改服务端操作流程」的停止点会被这一轴淹没。
2. **风险画像不同**：P5 的风险在提示词与 e2e 锚点（可机械兜住）；这一轴的风险在**引擎状态真值**
   （回滚 / 校验 / 写锁），要的是另一套验证（服务端 orchestrator 测试面，不是插件 live e2e）。
3. **有一半条目注定不做**：4 条不能 + 4 条零收益。单独立计划才能把「讨论过并决定不做」写清楚；
   挂在 P5 里会看起来像没做完。

**排序**（收益 / 风险，1–5）：

| 序 | 条目 | 收益 | 风险 | 依赖 |
| --- | --- | --- | --- | --- |
| P6-a | `read_memory_detail` → `read` | 3 | 1 | — |
| P6-b | `set_craft` → `edit play.json` | 3 | 2 | **与 P5-g 共用决策门 D4** |
| P6-c | `library_import` → `import_asset(source=库路径)` | 2 | 2 | **P5-a 必须先落地** |
| P6-d | `update_state` → 状态文件 + watcher | **4** | **4** | 引擎 watcher + 校验回执 |
| P6-e | 矩阵登记 4 条有意差异 + 本轴结论收尾 | 2 | 1 | — |
| — | `search_archive` / `list_saves` / `read_lineage` / `list_library` | 0 | — | **不做**，只登记 |

**必须停下来找用户确认的点**：

1. **P6 要不要立**，以及是否只做零机制成本的三条（P6-a/b/e）先看效果。
2. **P6-d 的代价是动服务端领域模型**：把好感度 / 旗标从 `engine` 真值搬进 `state.json`，
   等于**放弃「引擎拥有状态真值」这条服务端原则**（`memoryTool.ts:36-39` 明写这是它保留工具的理由）。
   与 P5-c 同级，必须单独确认。
3. **`set_craft` 的并发锁**：接受「模型手写 `edit` 可能丢更新」吗？
   若 P5-g 的 D4 结论是「保留 pi 硬校验」，那 P6-b 也应保留工具、整条不做。
4. **`search_archive` 的排序丢失**：若用户在意「检索按相关性排序」，这条连内部重构都不做。
