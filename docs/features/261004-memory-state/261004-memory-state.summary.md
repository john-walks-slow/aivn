# 261004 剧作家记忆与上下文系统优化 —— 实施总结

分支：`feat/memory-state-optim`（基线 main `b26e7c7`）

## 为什么做

2026-10-04 对剧作家记忆/上下文/角色/状态四个系统做了一轮检视（报告见本目录 plan 的起因部分），
产出 15 条问题。本轮只做其中**收益大、改动小**的 5 项，探索性方向另立（见 plan §6–§8，不开工）。

## 做了什么

| # | 项 | 落点 | 状态 |
|---|---|---|---|
| 1 | 写记忆卡工具 | `agentkit/memoryTool.ts`（`write_memory`）、`memory.ts`（`appendCard`）、`kit.ts`、`playhouse.ts` | 完成 |
| 2 | 建卡即重建（bug 级） | `playhouse.ts` `onWriteCharacter` 排 `rebuildAtBeatBoundary`；`orchestrator.ts` `liveCharacterIds` 可变集 | 完成 |
| 3 | session.json 原子写 | `store.ts` `saveSession` 走 tmp + rename | 完成 |
| 4 | 死代码/漂移注释清理 | 删 `memory.ts` `indexContext` getter | 完成 |
| 5 | A 区角色分级 | `prompt.ts`（roster 一行制 + 全卡按需）、`orchestrator.ts` `recentCast()` | 完成 |

### 1. write_memory 工具

剧作家此前只能**读**用户设定卡（`read_memory_detail` / `search_archive`），不能写——设定只能由工坊或用户补。
新工具只写 `memory/index/**` 这一层：

- 路径守卫 `sanitizeMemoryCardPath`：拒绝对路径、`..`、`\`、点开头段，以及 `always/` `arcs/` `archive/` 三个前缀（正则带 `i`）。
- 同路径重复写 = 更新（`appendCard` 先查 `file` 再决定覆盖或新增）。
- 语义与 `create_character` 一致：**即时进内存 `cards`（当轮可读），排一次轮边界重建才进 A 区**。
- 只装给剧作家（工坊已有 pi 的 read/write/edit）。

### 2. 建卡即重建（两条 bug）

- `create_character` 原来**不排重建**——角色卡要等下一次纪元压缩才进 A 区，新角色登场后模型手上一份人设都没有。现由 `playhouse` 的 `onWriteCharacter` 闭包排 `rebuildAtBeatBoundary`（注意放在闭包里而非 `private writeCharacter`：PlayAssets 自动注册那条路自己有 `silent` 重建，放公共函数里一轮会排两次）。
- `update_state` 的角色成员校验原本取**构造时快照** `new Set(memory.characters.keys())`，同轮刚 `create_character` 建的角色当轮写不了好感。改为可变集 `liveCharacterIdsValue`，`onWriteCharacter` 回调里 add。A 区全文仍等轮边界重建，「纪元内冻结」不变。

### 3. session.json 原子写

`saveSession` 改成 tmp + rename（与 `saves.ts` 的 `writeSaveMeta` 同一写法），临时名带 `randomUUID()` 防并发共用。
`loadSession` 的 catch→null 语义**故意不改**：原子写已让坏文件成为罕见情况，不叠第二层。

### 5. A 区角色分级（roster 一行制）

角色卡全文注入是 A 区唯一的线性增长项（30 角色 ≈ 52k 字）。规则：

- 角色数 ≥ 5 **且**给了 `activeCast` 才分级；不给 `activeCast` = 老行为（小剧目行序抖动伤前缀缓存，不值）。
- 在场角色（含主角，恒在场）注全卡全文；最近没出场的只注一行摘要（截 100 字）。
- 在场表 `recentCast()` 从内存事件尾部按 **120 条事件**窗口倒扫 `say/thought/actor`。

## 检视与返工

三轮 reviewer 检视，前两轮均「不准入」，共修掉 6 个真问题：

**阻塞级（会让分级彻底失效）**

1. `recentCast` 循环条件写反（扫到 30 个**不同角色**才停）——常规剧目角色不到 30 个，会一路扫穿全历史 = 全员标记在场 = 分级从不生效。改为按事件条数窗口。
2. 构造函数里 `restored.events` 回填**晚于** `buildAgent`——冷启动（服务器重启续演）时 events 空，除主角外全员被误折叠，恢复出来的一轮比热启动少一整层设定。回填整块提前到 `buildAgent` 之前。
3. `sortUserCards` 只重排「第一个 arc 之前」那段——新卡是先 `push` 到末尾的（可能落在 arcs 之后），压根没参与排序。改为 filter 出 user/arcs 两段分别处理再 splice 拼回。

**建议级**

4. 提示词写「轮边界后自动补全卡」是**虚假承诺**（普通轮边界不重建）。改成讲事实；`write_memory` 也补上重建，让回执的「下一轮进 A 区索引」兑现。
5. 卡片行序即提示词前缀——`appendCard` 的 push 破坏 `loadCards` 建立的不变量，重启后行序重排、前缀缓存全废。
6. `rebuildAtBeatBoundary` 同轮多次触发会链式多重重装三份 runtime → 同剧目只挂一个待办。

第三轮结论：**准入，无遗留问题**。完整报告见 `261004-memory-state.review.md`。

## 验证

- `npx tsc --noEmit` 干净。
- `npx vitest run`（apps/server）：**552 passed / 3 skipped**，40 文件通过 / 2 跳过。
- 新增测试 9 个：`memory.test.ts`（appendCard 落盘/覆盖/纯内存 + arcs 分区排序边界）、`orchestrator.test.ts`（write_memory 路径守卫 + 同轮建卡后 update_state 放行 + 冷启动与热启动 A 区一致）、`store.test.ts`（原子写读回 + 崩在写一半时旧档保住）、`prompt.test.ts`（分级三态）。
- 未跑真实 LLM/TTS/生图调用（按项目测试规范，涉及真实外部 API 默认 mock）。

## 遗留 / 后续

plan §6–§8 三个方向**只记录不开工**，需用户定夺后再动：

- carryOver 补偿摘要（对话尾接不住时的信息损失）
- 快照 diff 与 lineage.jsonl 作为恢复来源
- NSFW arc 泄漏隔离（`indexSection` 至今不看 `nsfwMode`，限制级纪元摘要会照常注入）

## 用户验收

见 `261004-memory-state.validation.md`。