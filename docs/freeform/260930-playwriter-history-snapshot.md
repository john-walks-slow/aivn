# 剧作家 session 历史快照（只读 REST）

> 260930 · 服务端改动，`apps/server/**`，未触碰 `apps/web/**`，未改 `packages/core/**`，未新增任何 WS 消息。

## 目标与路线

让客户端能拉到「这一场的完整 session 历史」：剧作家的**思考过程**、**原始 DSL 文本**（未经解析，含非剧本内容）、**工具调用**。
走**只读历史快照**路线：加一个 REST 端点读落盘数据，不新增 WS 流式消息。

## 改动的文件与关键位置

| 文件 | 改动 |
| --- | --- |
| `apps/server/src/history.ts` | **新增**。历史数据模型 + `HistoryRecorder` 累积器 + 截断 + 磁盘校验 |
| `apps/server/src/orchestrator.ts` | 累积器接入、`get history()`、分岔回退、`restoredHistory` 恢复 |
| `apps/server/src/store.ts` | `saveSession` 增 `history` 键；新增 `loadHistory()` |
| `apps/server/src/playhouse.ts` | `persist` 透传历史；建 runtime 时回灌 `restoredHistory` |
| `apps/server/src/http.ts` | `GET /api/plays/:id/history` |
| `apps/server/test/helpers.ts` | 假流加 `thinking`（`FakeResponse.thinking`） |
| `apps/server/test/history.test.ts` | **新增** 10 个用例 |

### 关键位置

- `history.ts:36` `HISTORY_BEATS_KEPT = 20`（保留拍数常量，注释了定这个数的理由）
- `history.ts:56` `class HistoryRecorder`：`addUser` / `addAssistantMessage` / `rebaseTo` / `snapshot`
- `history.ts:130` `parseHistory`（session.json → 结构化历史，缺/坏一律空表）
- `orchestrator.ts:433` `get history(): HistoryBeat[]`（公开只读访问器）
- `orchestrator.ts:904` `beginBeat` 记 user 原文（B 区：状态区/导演注/玩家表态）
- `orchestrator.ts:562` busy 中 OOC 走 `steer` 时记 user 原文
- `orchestrator.ts:1017` `message_end` 记完整 assistant 消息（思考块与 toolCall 只在这里拿全）
- `orchestrator.ts:683` `rebaseAt` 里 `rebaseTo(tree.pathSet(), this.beatNo)`，历史跟着分支回退
- `store.ts:95` `loadHistory()`；`store.ts:110` `saveSession(..., history?)`
- `playhouse.ts:389` persist 透传 `orchestrator.history`；`playhouse.ts:396` `restoredHistory: await store.loadHistory()`
- `http.ts:283` `GET /api/plays/:id/history`

## 数据结构

```ts
type HistoryEntry =
  | { beat: number; seq: number; role: "user" | "thinking" | "assistant"; text: string }
  | { beat: number; seq: number; role: "toolCall"; name: string; args: Record<string, unknown> };

interface HistoryBeat { turn: number; entries: HistoryEntry[] }
```

- `beat` = 拍号（与 `runtime.beatNo` 同尺）；`turn` 是它在拍分组里的冗余副本。
- `seq` = 拍内自增（从 1 起），稳定排序与去重的锚。
- `text` **不解析、不裁剪**——「模型到底吐了什么」是这层的唯一职责。
- 条目顺序 = assistant 消息 `content` 块的原顺序（思考与 DSL 谁先谁后如实保留）。

### 分支语义

`rebaseTo(onPath, completedBeat)` 两条判据缺一不可：

1. `onPath` 滤掉兄弟与废弃分支的拍（沿用 archive 防剧透的同一原则：历史随分支走）。
2. `completedBeat` 滤掉「拍中分岔即截断」砍掉后半的那一拍——它在旧分支上不成立，新分支要重新演一遍，混着看等于把两个世界的同一拍拼到一起。

从磁盘恢复的历史没有分支来路（`leafId = null`），一律视为已在当前分支上。

## 最终 API 契约

```
GET /api/plays/:id/history        （只读；无存档作用域 / 缺文件 / JSON 坏 / 结构不对 → 一律 200 + {"beats":[]}）
```

读**活动档**（`active.json` 指针那棵树），与 `/lineage` 同源同规则（周目隔离）。
不建 runtime、不改任何状态、不触发 reload。

```json
{
  "beats": [
    {
      "turn": 1,
      "entries": [
        { "beat": 1, "seq": 1, "role": "user", "text": "…" },
        { "beat": 1, "seq": 2, "role": "thinking", "text": "…" },
        { "beat": 1, "seq": 3, "role": "assistant", "text": "<原始 DSL>" },
        { "beat": 1, "seq": 4, "role": "toolCall", "name": "update_state", "args": { "…": "…" } }
      ]
    }
  ]
}
```

无历史时返回 `{"beats": []}`。非 GET 返回 405。

## 落盘

`session.json` 顶层新增 `history` 键（`version / lineage / engine / scene / runtime / **history** / savedAt`）：

- **只在拍边界写**——复用现有 `saveSession` 的调用时机（`persist` 在 `finishBeat` 里调），没有新增任何写盘时机。
- 保留最近 **20 拍**（`HISTORY_BEATS_KEPT`）。定这个数的理由：历史体积随拍数线性涨，单拍原文常带长思考 + 未裁剪 DSL（比落谱系的行级文本大一个量级），而 `session.json` 每次拍收束都全量重写；无上限攒下去会既胀又慢。20 拍足够回看「最近这一段怎么写的」，更早的内容在 archive 与纪元摘要里另有去处。
- 截断在累积器内做，落盘与对外快照是同一份截断结果，两边不会打架。
- `exportZip` 本就排除 `saves/`，历史不会漏进剧目包。

## 测试

命令（在 worktree 根执行）：

```
pnpm --filter @stage-ai/server typecheck     # tsc -b --noEmit
pnpm --filter @stage-ai/server test          # vitest run
```

结果：**typecheck 绿**；**test 15 文件 / 141 用例全绿**（含新增 `test/history.test.ts` 10 例）。

`test/history.test.ts` 覆盖：

- 多拍累积后形状正确（按拍分组、拍内 seq 自增、角色顺序与模型输出一致、注入原文落在它真正开启的那一拍）
- `toolCall` 的 `name` / `args` 原样落位（含 `beat_done`）
- 超出保留拍数后按拍截断（`HISTORY_BEATS_KEPT + 1` 拍 → 剩 20 拍，最早的整拍连同条目一起丢）
- 拍中截断：第 2 拍中途分岔 → 第 2 拍历史不进新分支；第 1 拍原样保留
- 分岔后重演：兄弟分支历史被丢弃，新分支接着开拍
- 落盘读回一致；缺 `session.json` / JSON 坏 / `history` 非数组 / 条目结构不对 → 空表不抛错
- 端点：读活动档、**非活动档不串场**、无活动档 / `session.json` 损坏仍 200 + `{"beats": []}`

沿用 `test/helpers.ts` 的 fake StreamFn 注入方式（新增 `FakeResponse.thinking` 让假流能吐 thinking 块，事件序与真实流一致：`thinking_*` 在 `text_*` 之前）。

> `test/image.test.ts:35` 有一个**既有 flake**（与本次改动无关）：它用硬编码 `setTimeout(10ms)` 等 image manifest 的 fire-and-forget 落盘，并行负载高时偶发失败。本次改动未触及 `imageAssets`/`imagegen`；连续三次全量跑（一次失败、两次 141/141）与隔离跑（12/12）确认了它的偶发性。

## 已知限制 / 风险

1. **读到的是上一次落盘快照**。端点读盘，`persist` 在拍收束时才写，所以在飞的一拍收束前看不到它的历史。符合「只读历史快照」的定位，但前端要按「最多落后一拍」预期。
2. **只保留最近 20 拍**，更早的历史不可回看（数据在累积器里就被丢了，不是被端点裁掉）。要看更早的内容得靠 archive 检索或纪元摘要。
3. **纪元压缩不裁历史**。压缩砍的是 LLM 对话体，历史是独立账本，所以长周目里历史会一直涨到 20 拍上限为止（单拍上限体量未做字符数封顶——正常 DSL 拍远小于上限，但极端超长输出理论上会撑大 `session.json`）。
4. **分岔语义是推断的**：`beat` 到谱系节点的映射用的是「每组记首条时的叶 id」+「拍号 ≤ 恢复后的 `beatNo`」两条启发式。`rewrite(granularity="beat")` 这类会先在叶上插事件再 rebase 的路径，实测行为正确，但没有专门的用例覆盖每种五动词组合。
5. **busy 中的 OOC（`steer`）记在 `beatNo + 1`**：按 D9 语义它注入后 agent 续写下一拍，拍号必然 +1，所以归属是对的；若将来 steer 改成在当前拍内插话，这条归属需要跟着改。
6. 服务端重启回灌了历史（`restoredHistory`），否则第一次落盘就会把重启前的记录抹成空白——这条已实现，但同样没有专门的端到端用例（需要真起 runtime）。
