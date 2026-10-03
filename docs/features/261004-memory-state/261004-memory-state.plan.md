# 记忆/状态五项优化计划

日期：2026-10-04 · 分支：`feat/memory-state-optim` · 工作区 `.worktrees/memory-state`
基线：`b26e7c7`（已合入 角色卡顶层化 + 写作参数化；五项在新主干上重核，全部仍存在）

背景材料：SOTA 调研（`docs/freeform/261004-longform-memory-sota.research.md`，只取结论、不照搬机制）、
现状量化（B 区上限约 4.1–4.5k 字符；A 区角色表是唯一线性项，30 角色 1500 字档约 52k；
压缩触发 157286 token；session.json 500 轮约 5MB）。

## 开工项（本轮实现）

### 1. 写记忆卡工具 `write_memory`（补 index 层写口）

现状：剧作家能读 index 卡（`read_memory_detail`）、能建角色卡、能改状态，
唯独写不了 `memory/index/` 用户设定卡——世界演进无落点。

- `memory.ts`：新增 `PlayMemory.appendCard(file, detail)`（照抄 `appendArc`，
  `arc:false`，layer 取子目录；`parseCard` 导出复用）+ 落盘 `memory/index/<file>.md`。
  同文件即覆盖（更新语义），`cards` 去重按 `file`。
- `deps.ts`：`PlaywriterKitDeps` 加 `writeMemoryCard?: (rel: string, content: string) => Promise<void>`。
- `memoryTool.ts`：新增 `write_memory` 工具（schema：`file` 路径 + `content` 全文 markdown，
  上限 8000 字对齐建卡）。路径守卫：归一化后必须落在 `index/` 内、`.md` 结尾，
  拒绝 `always/`、`arcs/`、`archive/`（机器产物与每轮注入层不可写）。
  写完即时进内存 `cards`（不等重建，与建卡语义一致），回执报"本轮 A 区索引即带得上"。
  头注释的 `write_memory` 漂移同步转正。
- `kit.ts`：`TOOL_CATALOG` 登记（roles `["playwriter"]`，group `memory`），
  `DEFAULT_ENABLED.playwriter` 加上。工坊不需要（已有 read/write/edit）。
- 测试：`memory.test.ts` 加 appendCard（新增/覆盖/分支可见性）；agentkit 工具表测试同步。

### 2. 建卡即重建（bug 级，两处）

现状：`create_character` 回执写"下一拍边界出现在角色表里"，实际无任何重建调用；
且 `update_state` 的成员校验是构造时 `new Set` 快照（`orchestrator.ts:444`），
同轮建卡后写好感被"不是本剧角色"拒绝。

- 重建：`playhouse.ts:1068` 的 `onWriteCharacter` 闭包里，写盘成功后调
  `this.rebuildAtBeatBoundary(playId, ...)`（与 assetRef 角色导入同一条路 :614）。
  不进 `private writeCharacter` 内部——PlayAssets 自动注册路已有自己的 silent 重建，
  进共享函数会一次建卡排两次重建。
  `memoryTool.ts:120/132-134` 与 `prompt.ts:201` 的"下一轮边界"措辞保持（修完即为真）。
- 成员校验：构造时那个 `Set` 改传可变集合，`onWriteCharacter` 闭包写盘成功后
  `set.add(charId)`（`deps.ts:60` 注释同步）。`update_state` 实现不动，
  同轮建卡后写好感即放行；A 区全文仍等轮边界重建（纪元内冻结不变）。
- 测试：orchestrator 或 playhouse 用例——调 `onWriteCharacter` 后重建被排期；
  同轮建卡 + `update_state` affinity 放行。

### 3. session.json 原子写

现状：`store.ts:176` 整文件直接 `writeFile`，崩在写一半上留半截 JSON；
`loadSession` catch 一律 null 丢整档。`saves.ts:61-67` 已有 tmp+rename 样板。

- `saveSession` 照抄 `writeSaveMeta`：`session.json.tmp` → `rename`。
  `loadSession` 语义不动（坏档仍 null——原子写后坏档只剩磁盘级损坏，无需第二层）。
- 测试：`store.test.ts` 加落盘断言（文件存在且为完整 JSON；可 mock writeFile 中途抛，
  旧文件仍在）。

### 4. 死代码清理

- 删 `memory.ts:87-93` `indexContext`（全仓唯一命中是定义本身，A 区实际走 `visibleContext`）。
  先 grep 确认无调用方再删。
- `lineage.jsonl` 写路保留（append-only 取证链，单轮几 KB），本轮不动——用它做恢复是探索项，
  见方向 §7。

### 5. A 区角色分级（roster 一行制 + 全卡按需）

现状：`prompt.ts:255-270` 全卡全文注入，角色数是 A 区唯一线性项。

- `PromptContext` 加 `activeCast?: readonly string[]`（编排器在 `buildAgent` 调用点
  从近期事件取最近说话/上台的角色 id：`say_start.id` + actor 指令 id，取最近 K 轮去重；
  protagonist 恒算在场）。
- `buildSystemPrompt` 角色表：在场（含主角）全卡全文；在场外只注一行
  `- name（id）：正文首个非空行截 100 字` + 末尾一行提示"要用人设先建卡/读盘"。
  角色总数 ≤4 时不分级（全注全文，避免小剧目行序抖动伤缓存）。
- 出场判定只读内存事件，不读盘；阈值 K 与截字数收成 `prompt.ts` 顶部常量。
- 测试：`prompt.test.ts`——5+ 角色时不在场者只一行；在场/主角全文；≤4 全全文。

## 方向（本轮只定方向，不开工）

### 6. carryOver 截断补偿

`CARRY_OVER_TOKENS=8000` 从尾切、无补偿（`orchestrator.ts:596-610`），与纪元压缩
（renderSeed 摘要）是两套失忆观。方向：重建 seed 统一走"切点前摘要 + 切点后原文"，
摘要可用现有 compaction 摘要器的小预算版本。待工坊两分支稳定后再动
（碰 `buildRuntime/carryOverFrom/renderBeats` 同一片）。

### 7. 谱系快照 stateFiles 全量冗余 + lineage.jsonl 转正

每轮快照存 stateFiles 全文（`orchestrator.ts:1304-1310`），500 轮约 5MB 量级。
方向：快照存 diff（相对父快照的 changed keys），读时沿链合并；`lineage.jsonl`
从取证链转正为恢复源（事件溯源重建树）。这是存储格式变更，老档迁移要另案设计，
本轮不动。

### 8. NSFW 弧泄漏隔离

`can.nsfw` 只门控进/退指引（`prompt.ts:306-312`），`indexSection` 注 arcs 不看
nsfwMode（`:313-317`），NSFW 轮压出的 arc 摘要下一纪元进 SFW 的 A 区。
方向：compaction 产物打 `nsfw` 标记（arc 文件 frontmatter + `IndexCard` 字段），
`visibleCards/visibleContext` 按 `nsfwMode` 过滤。碰 compaction + memory + prompt，
与 craft-params 的 NSFW 章节邻接，等它稳定后再排。
