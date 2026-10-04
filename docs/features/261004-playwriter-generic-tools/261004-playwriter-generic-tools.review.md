# 检视报告

## 概要

本报告针对 worktree `./.worktrees/generic-tools`（分支 `feat/generic-tools`，基于 main `4c605d0`）中未提交的代码变更进行检视。
本次重构将剧作家的专用写口（`create_character` 与 `write_memory`）彻底收拢至与工坊一致的 pi 内建通用文件工具（`read` / `write` / `edit`），通过 `PlayFiles` 和 `PlayEnv` 实现了白名单与写操作的单一收口，并修复了角色登记的时序缺陷。
整体实现架构清晰，数据流与生命周期管理合理，核心链路已形成闭环。

## 需求对齐

本次改动完整满足了「剧作家改用通用文件工具、保留 `update_state` 特例」的业务需求：
1. **写口收拢与单一白名单**：删除了 `create_character` / `write_memory`，剧作家与工坊统一挂载 `read` / `write` / `edit`，共用 `PlayFiles` 白名单与 `PlayEnv`，消除了双套写口与重复白名单维护成本。
2. **状态与记忆分离**：`update_state`（随谱系快照回滚）和 `read_memory_detail`/`search_archive`（防剧透历史过滤）继续保留为专用工具，设计边界合理，通用文件写口无法触碰分支状态。
3. **机器产物防篡改**：`memory/arcs/` 与 `memory/archive/` 经由 `PlayFiles.GENERATED_PREFIXES` 成功收归为「只读可见，禁止文本写口写入」。
4. **提示词与契约对齐**：卡片格式与定点编辑规则准确补充至 `prompt.ts`，未暴露剧作家缺失的工具（如 `list_voices`），字段名与 `parseCharacterCard` 严格一致。
5. **死代码清理与时序修复**：移除了 `appendCard` / `sortUserCards` / `indexDir`；`playhouse.writeCharacter` 调整为落盘成功后才登记 `knownCharacters`，避免写失败产生孤儿 ID。

---

## 阻塞问题

无。

| ID  | 位置 | 问题 | 建议 |
| --- | ---- | ---- | ---- |
| -   | -    | 无   | -    |

---

## 建议修改

| ID  | 位置 | 问题 | 建议 |
| --- | ---- | ---- | ---- |
| S-01 | [apps/server/src/playFiles.ts:90,106](apps/server/src/playFiles.ts#L90-L106) | **`GENERATED_PREFIXES` 存在跨平台大小写匹配绕过隐患**：当前 `isGenerated(rel)` 使用字面量 `startsWith` 区分大小写匹配 `memory/arcs/` 与 `memory/archive/`。在 Windows/macOS 等大小写不敏感的文件系统上，若传入混用大小写的路径（如 `memory/Arcs/foo.md` 或 `memory/Archive/events.jsonl`），因 `isGenerated` 为 `false` 且 `rel.startsWith("memory/")` 为 `true`，会被 `isEditable` 放行写入，从而破坏引擎产物的只读防剧透约束。 | 建议在 `isGenerated` 与 `isEditable` 判定前统一对路径做小写化归一化处理，或采用不区分大小写的正则（如 `/^memory\/(arcs|archive)\//i.test(clean)`），确保跨平台环境下的只读安全。 |
| S-02 | [apps/server/test/orchestrator.test.ts:913-937](apps/server/test/orchestrator.test.ts#L913-L937) | **编排器角色写盘联动缺少端到端测试覆盖**：在「同轮写下角色卡后 update_state 能写该角色好感度」用例中，测试是通过直接在本地 Set 执行 `ids.add(characterIdOfPath(...))` 模拟回调，未走通真实工具调用 `write` -> `PlayEnv.writeFile` -> `orchestrator.onPlayFileWritten` -> `liveCharacterIdsValue.add` 的链路，未能验证该对象引用的端到端联动。 | 建议在 `orchestrator.test.ts` 中补充一条端到端集成用例：使用剧作家工具集实际执行 `write` 写入 `characters/newcomer.md`，随后立即执行 `update_state`，断言新角色的好感度提议被成功应用。 |

---

## 非阻塞问题

| ID  | 位置 | 问题 | 建议 |
| --- | ---- | ---- | ---- |
| N-01 | [apps/server/src/agentkit/deps.ts:35,76](apps/server/src/agentkit/deps.ts#L35-L76) | **类型命名带有历史角色偏向**：`WorkshopWrite` 现已被剧作家和工坊共用（`PlaywriterKitDeps.onWrite`），注释仍为「工坊对话里的一次写盘」，与通用化方向略有出入。 | 可在后续重构中重命名为 `PlayFileWrite` 或保留别名兼容，提升概念自解释性。 |
| N-02 | [apps/server/test/helpers.ts](apps/server/test/helpers.ts) 及多个测试文件 | **测试桩中大量使用粗暴的 `as never` 断言**：为满足 `new PlayFiles(opts.store)` 取 `store.dir` 的需求，多处测试直接传入 `{ dir: "..." } as never`。 | 建议在 `test/helpers.ts` 中提取统一的 `createMockStore(dir)` 辅助工厂函数，减少散落在各测试文件中的 `as never` 类型强转。 |
| N-03 | [apps/server/src/prompt.ts:388](apps/server/src/prompt.ts#L388) | **提示词对写卡当轮的读取引导可更明确**：第 388 行指出「需要某条完整内容时调用 read_memory_detail 工具（传名称），或直接 read 那个文件」。因新卡写入当轮尚未进入 `PlayMemory.cards`，当轮调 `read_memory_detail` 会返回未找到。虽然 `MEMORY_RULES` 说明了下轮才进索引，但若模型误用仍可能产生困惑。 | 建议在提示词中轻量强化说明：「当轮刚写完的卡请直接使用 `read` 查看全文」。 |

---

## 准入结论

**结论**：`条件准入`

**说明**：无阻塞问题。通用文件工具重构目标完全达成，写口与白名单收拢彻底，边界与生命周期处理得当。建议在合并前或后续小版本中处理 `S-01`（跨平台大小写校验）与 `S-02`（编排器端到端集成测试补全）。
