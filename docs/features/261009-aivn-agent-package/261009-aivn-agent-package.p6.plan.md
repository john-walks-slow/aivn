# P6 · 宿主流程工具文件化 —— 计划

日期：2026-10-10 · 上游：`261009-aivn-agent-package.p5.plan.md` §9（范围分析初稿，2026-10-09）
复核：`261009-p6-scope-review.md`（expert 独立复核，**推翻 §9 三处论断**）
拍板：2026-10-10（full-auto 模式，由 auto-human 代用户裁决；四问结论见 §3）

---

## 0. 一句话

服务端那 12 个**宿主流程工具**里，只有 4 个文件化之后能换来两个宿主的**真收敛**。本轴做其中 3 个
（`read_memory_detail` / `set_craft` / 矩阵登记），把 `library_import` 移出（它换不来统一）；
`update_state` 原先只出设计，2026-10-10 按 P6-d **已迁移**（状态改由剧目文件承载）；
其余几条登记为**有意差异**，不删不做；`beat_done` 的载体差异已于 2026-10-10（P6-e）统一。

方向（用户 2026-10-10 原话）：

> 最干净最通用。最少冗余工具（通用工具能做且能做好，就不一定要专用工具）。但仍然保持易用。

---

## 1. 现状数字（更正 §9）

| 口径 | §9 写的 | 实际（2026-10-10 实读） |
| --- | --- | --- |
| 服务端 `TOOL_CATALOG` | 24（= 12 宿主流程 + 12 其它） | **25**（= 12 宿主流程 + **13** 其它，`apps/server/src/agentkit/kit.ts:276-305`） |
| 插件工具目录 | 9 | **10**（`/root/projects/dsh-aivn-shared/src/tool-catalog.ts`，P5-d 加了 `annotate_asset`） |

25 里没有第 13 个宿主流程候选；差的是「其它」那一栏（P5-a…f 落地后：`import_asset` / `annotate_asset`
进、`commit_asset` / `view_image` 出）。

**本轴落地后的算术**：25 → **23**（`read_memory_detail` − 1、`set_craft` − 1）；宿主流程工具 **12 → 10**。
**P6-d 迁移之后**：23 → **22**（`update_state` − 1），宿主流程工具 **10 → 9**（2026-10-10 实测
`apps/server/src/agentkit/kit.ts:275-315` 22 行）。
`library_import` 若日后并进 `import_asset`，是服务端内部重构，**不计入统一指标**（见 §6）。

---

## 2. 逐条判定（复核后）

| # | 工具 | §9 判定 | 复核后判定 | 本轴处置 |
| --- | --- | --- | --- | --- |
| 1 | `beat_done` | 不能/不该 | 一致 | **已统一**（P6-e）：改由剧本末行 `<stop …/>` 承载，两个宿主同一句话 |
| 2 | `update_state` | 有条件能 | 有条件能，但**「不损回滚」不成立** | **已迁移**：删工具，状态改由 `memory/always/state/` 三文件承载（`261009-p6-d-update-state.design.md`） |
| 3 | `enter_nsfw` | 不能 | 一致 | 不做，登记有意差异 |
| 4 | `exit_nsfw` | 不能 | 一致 | 不做，登记有意差异 |
| 5 | `read_memory_detail` | 能文件化 | 一致 | **P6-a：删工具 → `read`** |
| 6 | `search_archive` | 有条件能 | 一致 | **保留**（重审 2026-10-10，理由见 §6） |
| 7 | `list_saves` | 能 | — | **工具已删，能力保留**：改由只读的 `saves/` 面提供（2026-10-10，见 §6 甲） |
| 8 | `read_lineage` | 能 | — | 同上 |
| 9 | `list_library` | 能 | 一致 | **保留**（重审 2026-10-10，理由见 §6 乙） |
| 10 | `library_import` | 能并入 `import_asset` | 并入后**一致** | **已统一**（2026-10-10，见 §6 丙） |
| 11 | `read_skill` | 不能/不该 | 一致 | 不做，登记有意差异 |
| 12 | `set_craft` | 能文件化 | 有条件能；锁的那条描述有误 | **P6-b：删工具 → `edit play.json`** |

判据只有一条：**插件侧今天是不是已经用文件工具在做同一件事**。不是 → 文件化只是服务端内部重构，
两边照样不一样，不该为它付引擎机制的成本。

---

## 3. 决策记录（2026-10-10，auto-human 代用户裁决）

**问 1 · `set_craft` 的去留 → A：直接删，不做写锁工程。**
理由：模型本来就能 `edit play.json`（`PlayEnv` 白名单里就有），删 `set_craft` 是「一个受锁写者换成
已有的同风险写者」，不是新增竞态；`withPlayConfigLock` 只保护**服务端内部**的读改写事务，对
「上游 stale read + 全量写」天然无效。
两个**必须**的配套：
1. 提示词补一句「改完 `craft` 段跑一次 `validate_play`」（写口 `assertPlayConfig` 只做结构校验，
   craft 的取值白名单靠 `readiness/play.ts` 的 `strayCraftValues` 事后报）。
2. 「play.json 人 vs 模型冲突」**单开一条 issue**（见 §7）——文件页 PUT 与 HTTP 保存都是 stale read
   全量写，今天就能丢整份 JSON，与删不删工具无关；修法是乐观并发（版本/etag + compare-before-write）。

**被否掉的可选项**：把 `CRAFT_ENUMS` 加进 `assertPlayConfig` 造「写口当场拒」——技术可行，
但会在服务端单边造一处与插件不同的行为，违背「最少机制」。

**问 2 · 第一阶段范围 → a + e，并把 b 一起做掉；c 移出。**
理由：b 原先挂的依赖是「等写锁」，问 1 定了不修锁，依赖消失、b 变便宜；a 与 b 才是真正的收敛收益，
第一阶段不做 b，P6 就没什么统一收益。顺序：a → e → b 收尾。c 不计入统一指标。

**问 3 · `update_state` → 已迁移（P6-d）。**
设计稿 `261009-p6-d-update-state.design.md` 定稿四件事：分支真值（快照是分支/存档真值、文件是工作态）、
校验与回执（不往写口加校验、不做提议队列、不加 watcher——把 readiness 的 `stateProblem` 接进 B 区）、
失败语义（坏 JSON 只少两行、好感度改绝对值）、以及「什么结果下这条不做」的可检查判据。
2026-10-10 实施：删 `update_state`、三文件成为工作态载体、B 区每轮现读、收束进快照、
jump/fork/restore/切档/冷启动回写、新档播种初值。

**问 4 · `search_archive` / `list_library` → 保留（写真实理由）；`list_saves` / `read_lineage` → 已删。**
2026-10-10 重审：不许再写「收益 0」，逐条给理由（见 §6）。

**§6 甲 · `list_saves` / `read_lineage` —— 工具删、能力留（2026-10-10，当天更正）**

**读树是有意提供的能力**（用户当天明确）：模型要能回答「演到哪了」「这个角色出现过几次」。
所以收掉的只是**两个专用动词**，能力改由**通用文件读口**提供——与「通用 Agent + 原子化工具」
那条主线一致，也免得两宿主的工具面为此差两位（插件那边没有谱系数据，凑不出这对工具）。

- **工具面**：删 `agentkit/lineageTool.ts`、`lineage` 能力位、契约矩阵那一行、副作用目录两行、
  `WorkshopKitDeps` 的 `saves` / `saveStore`、web 两处工具标签。
- **能力面**（改由文件口提供）：`PlayFiles` 把周目目录开成**只读可见**——
  `saves/**` 与剧目根的 `active.json`（看得见、改不动，与 `memory/archive/` 同一个口径），
  `.jsonl` 认作文本（不认的话 `read` 会当二进制拒掉）。工坊提示词《读故事树》改成教
  「哪份文件回答哪个问题」：`active.json` → 当前周目 id、`saves/<id>/meta.json` → 列周目、
  `saves/<id>/lineage.jsonl` → **行级事件流**（`kind`/`text`/`turn`/`parentId`，分支看 parentId）、
  `session.json` → 很大、按 offset/limit 分段读。

**与旧工具的能力差（认账）**：旧工具默认只回**当前分支路径**并且渲染过；现在模型拿到的是原始行，
分支要自己按 `parentId` 认。行数多时按 offset/limit 分段读（工坊开了命令行就直接 grep）。

**§6 乙 · `search_archive` / `list_library` —— 保留**

- `search_archive`（仅剧作家）：它回的不是「读文件拿得到的东西」——**相关性排序 + 分支 pathSet 过滤 +
  NSFW 过滤**（限制级切片只以 SFW 摘要进入检索）+ 跨存档历史。插件侧根本没有归档层，这条能力
  无法用通用文件工具等价替代；删了等于把「想起前面某一幕说过什么」从剧作家手里拿走。
- `list_library`：素材资源库是**应用级**数据，在剧目根之外（用户自己的库目录，HTTP 面
  `/library/<kind>/<id>/<file>` 只读服务它），文件工具按白名单够不到。它是「引用即导入」那条路的
  发现入口——模型得先知道库里有什么，才能在剧本里写下那个 id。要删得先把库目录开进文件白名单，
  那是把读面铺得更大，不划算。

**开工前的三处更正**（已落进 §1 与 §6）：工具面 25 不是 24；插件目录 10 不是 9；
§9 的「工坊文件页与 `set_craft` 共用写锁」论断是错的——事实是**锁与无锁写者并存**。

---

## 4. 阶段

### P6-a · `read_memory_detail` → `read`（已完成 · `5c0adfeb`）

删工具（`memoryTool.ts`）、删它的能力位引用（`kit.ts` 的 `TOOL_CATALOG` 与 `memory` 能力行）、
删 `TOOL_SIDE_EFFECT_CATALOG` 与矩阵里的对应行/说法；`PlayMemory.readCard` 随工具一起删（三条命名
容错的最后使用者是它），提示词那一句改成「read 每行括号里的路径」。

**代价**：丢掉标题/路径/文件名三种写法的容错与「未命中时列可用条目」的回执——两样插件侧本来就没有，
A 区《记忆索引》每行都带路径，读得到。

### P6-b · `set_craft` → `edit play.json`（已完成 · `5c0adfeb`）

删工具（`agentkit/craftTool.ts`）、删 `apps/server/test/craftTool.test.ts`、从能力行与
`TOOL_SIDE_EFFECT_CATALOG` / 矩阵说法里摘掉；`mergeCraftParams` / `CraftPatch` 随工具成为死代码，
一并从 `packages/agent` 摘掉（含它的单测）。提示词与 `galgame-play-setup` 技能改成
「用 `edit` 定点改 `craft` 段 → 跑 `validate_play`」。

**代价**：丢 pi 的 enum 当场拒（退化为 `validate_play` 事后报，包里 `strayCraftValues` 已就位）、
丢结构化回执；并发上不再多一个受锁写者，但那一类竞态今天已存在（模型 `edit` 从来就在锁外）。

### P6-e · 矩阵登记与文档收尾（已完成 · `40e53b0d` `31aacae9`）

- `contract.ts` 的 `CAPABILITY_MATRIX`：`memory` / `files` 两行的 `intentionalDifference` 改写；
  `beat_done` / `enter_nsfw` / `exit_nsfw` / `read_skill` / `search_archive` / `list_saves` /
  `read_lineage` / `list_library` 逐条补一句「为什么载体必须不同」。
- 本文件 + §9 的更正 banner + P5 plan 的「实施进度」表。

### P6-d · `update_state` → 状态文件（**已完成**）

设计稿：`261009-p6-d-update-state.design.md`（§3 / §5 / §6 定稿，经 auto-human 复核后修了
「B 区 vs A 区」的术语与双写基准两处）。**原型已提交**（`69d467fd`）：

- 三个状态文件成为工作态载体：B 区【状态】区每轮现读、收束存快照、jump/fork/restore 与
  冷启动/切档用快照回写、新档用 `initialState` 播种；
- 顺带修掉「服务端根本没有代码写这三个文件、剧作家 read 会 ENOENT」的现状缺陷；
- `update_state` 过渡期双写、以文件为基准；
- 三条原型判据已绿（直接 write → 下一轮可见 / 跳回旧轮回写 / 文件为基准不 clobber）。

**检视**：reviewer 结论「准入」（无阻塞）；唯一建议 S1（恢复构造路径不自包含）已修（`204ce7f2`）并补判据。

**残留（下一轮实机时可顺手看）**：§8 判据 4「提示词能不能稳定教会模型」只能在真实模型的一轮演出里观察
——单元测盯住的是解析 / 渲染 / 回写三件事。风险偏低：这套措辞与插件同源，插件那边已经跑了很久；
先看的现象是「模型是不是直接 `write` 三个文件」与「好感度是不是写了绝对值」。

**迁移（已落）**：删 `update_state` + `memoryTool.ts` 收成 `archiveTool.ts`（只剩 `search_archive`）；
提示词新增《世界状态》章、`beat_done` 与记忆卡两处指路改写；readiness 的 `stateProblem` 接进 B 区
（包内导出，与 `validate_play` 同源）；测试面重做（`orchestrator` 89、`playhouse` 21，含
「新档播种初值 + 切档回写」那条判据 4）。

### P6-c · `library_import`（**已并入** `import_asset`，2026-10-10）

与插件的 `import_asset` **不同义**（前者按库 kind/entryId 复制 + 写角色卡/素材，后者是路径/URL/草稿的
登记）。将来若做，是「服务端库导入重构」，省的是服务端代码，**不计统一收益**。

---

## 5. 验证

| 范围 | 命令 | 结果（2026-10-10 实跑） |
| --- | --- | --- |
| 包 | `cd packages/agent && pnpm typecheck && pnpm build && pnpm exec vitest run` | 27 文件 / **195** 通过（P6 前 196：删 3 条补丁用例、增 2 条漏标自查用例） |
| 服务端 | `pnpm --filter @aivn/server typecheck`；全量 `vitest run` | typecheck ✓；**689 通过 / 3 跳过 / 0 失败** |
| 契约 | `node scripts/check-agent-contract.mjs` | **9/9**（第 1 项已扩到技能正文） |
| Web | `pnpm --filter @aivn/web typecheck`；`vitest run` | typecheck ✓；**219 通过** |
| 插件 | `npm run typecheck`、`build.mjs --check`、`npm run e2e:media` | 全绿；**58/58**；lib 354.9 KiB（随包重建一次） |

**提交**：服务端/包 `5c0adfeb`（P6-a/b 代码）→ `40e53b0d`（文档）→ `31aacae9`（P5-i 技能/界面/守卫）
→ `e4025191`（readiness 漏标自查）；插件 `f5c77c0`（lib 随包重建）。

---

### P6-e · 停止点载体统一（**已完成**）

设计稿 `261010-p6e-stop-tag.design.md`（经 reviewer 检视「条件准入」，三条阻塞已按 §2.1 原子性规约 /
夹具纪律 / NSFW 文本改写落进设计）。落地：删 `beat_done` 工具与 `stage` 能力、
`packages/agent` 新增共享正文 `STOP_TAG_RULES`（两个宿主引同一份）、轮边界改成「这一 run 结束」、
停止点事件改由 `closeBeat` 统一补发、NSFW/写作参数/提示词全部改教标签。
顺带修掉一个真 bug：`buildRuntime` 给**非活动存档**重建时也会回写剧目级状态文件，把活动档的播种盖掉。

---

### P7 · 插件补限制级（NSFW）通道（**必做**，2026-10-10 用户点名）

设计稿 `261010-p7-plugin-nsfw.design.md`（§8 记实施进度）。第 1 步（工具 + 打标 + 角标 +
重建重推）已完成并验证（插件侧 `typecheck` / `build --check` / `rebuild` 套件 17/17）；
第 2–7 步（换模型、提示词章与合规声明、退出摘要与模型可见面替换、配置面与 README、检视与落地）待做。

---

## 6. 不做清单与登记理由

| 工具 | 登记为 | 理由（写具体损失，不写「收益 0」） |
| --- | --- | --- |
| `beat_done` | `intentionalDifference`：停止点载体 | 服务端需要 `terminate` 收束语义与轮边界信号；插件必须是剧本末行标签（DSH 的分支/重建只认助手消息轮尾）。**同一个 IR、不同载体** |
| `enter_nsfw` / `exit_nsfw` | `intentionalDifference`：限制级通道 | 换的是**运行时模型**，文件 flag 换不动；插件侧没有这条通道 |
| `read_skill` | `intentionalDifference`：技能通道 | 通道归宿主；**正文层已经同源**（`packages/agent/skills/` + `sync-skills.mjs`） |
| `search_archive` | `intentionalDifference`：往事检索 | 插件侧没有 archive 数据。文件化会丢三样：**相关性排序**（MiniSearch → grep 的文件顺序）、**limit 语义**、**NSFW 过滤**（`memory.ts:132`） |
| `list_saves` / `read_lineage` / `list_library` | `intentionalDifference`：周目 / 故事树 / 跨剧目库 | 插件没有这些产品概念（`capabilities.ts` 里 library / lineage 恒假）。数据虽在盘上，但「能读」≠「同一产品动作」 |

**留档的机制结论**（下次别再把「数据在盘上」当成「同一产品动作」）：将来真要在插件侧做往事检索，
正确做法是「**引擎逐轮落切片文件 + grep**」，不是把 MiniSearch 移植过去——那是机制层的统一，
不是工具面的收敛。

---

## 7. 后续（不在本轴）

- **play.json 的人 vs 模型冲突**：`docs/issues/261010-play-json-write-conflict/`（乐观并发：版本/etag +
  compare-before-write）。今天文件页 PUT 与 HTTP 保存都是 stale read 全量写，能丢整份 JSON。
- **`library_import` 服务端内部重构**：另议，不计统一指标。
- **P6-d 迁移**：先看设计稿的结论与「不做」判据。


---

## §6 丙 · `library_import` → `import_asset(source="library:<kind>/<entryId>")`（已统一，2026-10-10）

设计与取舍见 `261010-p6c-library-import.design.md`。落地形态：

- **模型可见面**：入库只剩 `import_asset` 一个动词，来源是它的一格参数——剧目内路径 / http(s) 网址 /
  （服务端）`draft:<id>` / **`library:<kind>/<entryId>`**。库来源那条路不走登记引擎（一个条目可能落
  好几份文件：立绘包 = 若干差分 + 角色卡），直接调 `importFromLibrary` 并逐份列回执。
- **落位与来源要对得上**：`kind=background` 只认 `backgrounds`、`kind=cg` 只认 `cg`、
  `kind=sprite` 收 `sprites` 与 `characters`；对不上就顶回来，一个字节都不落。
- **命名统一成 `as`**：原先 `target: "protagonist"` 是「改名」的特例，现在统一成 `as`（缺省条目 id），
  主角就是 `as: PROTAGONIST_ID`——角色卡与立绘都落在同一个 id 下。HTTP 面的 wire 格式（`target`）没动。
- **引擎那份保留全能力**：`importFromLibrary` 仍收 `variants` 与 `as`，HTTP 素材页按钮与
  「引用即导入」（`assetRef.ts`）照用；`createLibraryTools` 收成只管 `list_library` 一件事。
- **认账的两处收窄**：① 模型面不再能「只导某几条差分」（界面照旧能挑，模型面整包导更不容易出错）；
  ② 音频（bgm / sfx）不从模型面导入 —— `import_asset` 是图像登记（共享能力 `asset.register` 只认
  background / cg / sprite），音频入库走界面按钮与剧作家的「引用即导入」（`<scene bgm>` 会自动补）。
- **共享正文**：`asset.register` 的 `source` 说明与 doc 补上这一格（宿主中立 + 条件化），
  插件侧跟着重建 `lib/`。

**验证**：服务端 typecheck ✓、契约守卫 9/9 ✓、全量 **695 通过 / 3 跳过 / 0 失败**
（新增三条走模型面的用例：背景改名落盘 + 描述覆盖、角色包图与卡同落 `spriteId` 名下、
库类别对不上时顶回来且不落盘）；矩阵里 `library` 那一行从「不一致」改成「只差一格来源，动词同义」。
