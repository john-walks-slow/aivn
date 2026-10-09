# P6 · 宿主流程工具文件化 —— 计划

日期：2026-10-10 · 上游：`261009-aivn-agent-package.p5.plan.md` §9（范围分析初稿，2026-10-09）
复核：`261009-p6-scope-review.md`（expert 独立复核，**推翻 §9 三处论断**）
拍板：2026-10-10（full-auto 模式，由 auto-human 代用户裁决；四问结论见 §3）

---

## 0. 一句话

服务端那 12 个**宿主流程工具**里，只有 4 个文件化之后能换来两个宿主的**真收敛**。本轴做其中 3 个
（`read_memory_detail` / `set_craft` / 矩阵登记），把 `library_import` 移出（它换不来统一），
`update_state` 只出设计；其余 4 条登记为**有意差异**，不删不做。

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
`library_import` 若日后并进 `import_asset`，是服务端内部重构，**不计入统一指标**（见 §6）。

---

## 2. 逐条判定（复核后）

| # | 工具 | §9 判定 | 复核后判定 | 本轴处置 |
| --- | --- | --- | --- | --- |
| 1 | `beat_done` | 不能/不该 | 一致 | 不做，登记有意差异 |
| 2 | `update_state` | 有条件能 | 有条件能，但**「不损回滚」不成立** | **只出设计**（见 `261009-p6-d-update-state.design.md`） |
| 3 | `enter_nsfw` | 不能 | 一致 | 不做，登记有意差异 |
| 4 | `exit_nsfw` | 不能 | 一致 | 不做，登记有意差异 |
| 5 | `read_memory_detail` | 能文件化 | 一致 | **P6-a：删工具 → `read`** |
| 6 | `search_archive` | 有条件但收益 0 | 一致（不建议做） | 不做，登记有意差异 |
| 7 | `list_saves` | 能但收益 0 | 一致 | 不做，登记有意差异 |
| 8 | `read_lineage` | 不建议 | 一致 | 不做，登记有意差异 |
| 9 | `list_library` | 能但收益 0 | 一致 | 不做，登记有意差异 |
| 10 | `library_import` | 有条件能并入 `import_asset` | **不一致**：与插件 `import_asset` 不同义 | **移出 P6**（服务端内部重构，另议） |
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

**问 3 · `update_state` → 本次只出设计。**
设计必须写实四件事：分支真值（文件是输入/缓存、快照才是分支真值）、观察与回执（先盘清**已有**钩子，
插件侧 `post-execute` / `workspaceFiles.changes` 必须实测）、失败语义（坏 JSON / 未知角色 / 部分成功 /
并发）、以及「什么结果下这条不做」的可检查判据。

**问 4 · `search_archive` / `list_saves` / `read_lineage` / `list_library` → 不删不做。**
登记理由要写**具体三项损失**（见 §6），不要写「收益 0」。

**开工前的三处更正**（已落进 §1 与 §6）：工具面 25 不是 24；插件目录 10 不是 9；
§9 的「工坊文件页与 `set_craft` 共用写锁」论断是错的——事实是**锁与无锁写者并存**。

---

## 4. 阶段

### P6-a · `read_memory_detail` → `read`（已完成）

删工具（`memoryTool.ts`）、删它的能力位引用（`kit.ts` 的 `TOOL_CATALOG` 与 `memory` 能力行）、
删 `TOOL_SIDE_EFFECT_CATALOG` 与矩阵里的对应行/说法；`PlayMemory.readCard` 随工具一起删（三条命名
容错的最后使用者是它），提示词那一句改成「read 每行括号里的路径」。

**代价**：丢掉标题/路径/文件名三种写法的容错与「未命中时列可用条目」的回执——两样插件侧本来就没有，
A 区《记忆索引》每行都带路径，读得到。

### P6-b · `set_craft` → `edit play.json`（已完成）

删工具（`agentkit/craftTool.ts`）、删 `apps/server/test/craftTool.test.ts`、从能力行与
`TOOL_SIDE_EFFECT_CATALOG` / 矩阵说法里摘掉；`mergeCraftParams` / `CraftPatch` 随工具成为死代码，
一并从 `packages/agent` 摘掉（含它的单测）。提示词与 `galgame-play-setup` 技能改成
「用 `edit` 定点改 `craft` 段 → 跑 `validate_play`」。

**代价**：丢 pi 的 enum 当场拒（退化为 `validate_play` 事后报，包里 `strayCraftValues` 已就位）、
丢结构化回执；并发上不再多一个受锁写者，但那一类竞态今天已存在（模型 `edit` 从来就在锁外）。

### P6-e · 矩阵登记与文档收尾（本阶段）

- `contract.ts` 的 `CAPABILITY_MATRIX`：`memory` / `files` 两行的 `intentionalDifference` 改写；
  `beat_done` / `enter_nsfw` / `exit_nsfw` / `read_skill` / `search_archive` / `list_saves` /
  `read_lineage` / `list_library` 逐条补一句「为什么载体必须不同」。
- 本文件 + §9 的更正 banner + P5 plan 的「实施进度」表。

### P6-d · `update_state` → 状态文件 + watcher（**只出设计**）

设计稿：`261009-p6-d-update-state.design.md`。迁移必须单独确认，不在本轴实施。

### P6-c · `library_import`（**移出**）

与插件的 `import_asset` **不同义**（前者按库 kind/entryId 复制 + 写角色卡/素材，后者是路径/URL/草稿的
登记）。将来若做，是「服务端库导入重构」，省的是服务端代码，**不计统一收益**。

---

## 5. 验证

| 范围 | 命令 | 判据 |
| --- | --- | --- |
| 包 | `cd packages/agent && pnpm typecheck && pnpm build && pnpm exec vitest run` | 全绿（P6 前 196 → P6-a/b 后 193） |
| 服务端 | `pnpm --filter @aivn/server typecheck`；`apps/server` 下定向 `vitest run test/agentkit.test.ts test/orchestrator.test.ts test/prompt.test.ts test/memory.test.ts test/workshop*.test.ts` | 全绿 |
| 契约 | `node scripts/check-agent-contract.mjs` | 9/9 |
| 插件 | 本轴不动插件代码 | 不跑（改动面为零） |

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
