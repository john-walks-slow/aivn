# 剧作家收成通用工具 · 实施记录

## 来源

2026-10-04。用户判定剧作家的 `create_character` / `write_memory` 与工坊的通用文件工具是同一件事的
两份写法（原话：「我不喜欢这样冗余的做法，还是按照剧作家收成全通用工具吧」），并划出边界
「update_state 是特例可以不用动」。

## 改完之后的剧作家工具集

`beat_done` · `enter_nsfw` · `exit_nsfw` · `update_state`（特例）· `read_memory_detail` ·
`search_archive` · **`read` / `write` / `edit`（新）** · `generate_image` · `list_library` · `web_search`

删掉 `create_character`、`write_memory`。三个 pi 内建文件工具的角色从 `["workshop"]` 变成
`["playwriter", "workshop"]`，`bash` 仍只给工坊。

## 改动清单

| 文件 | 改了什么 |
|---|---|
| `packages/core/src/play/characterCard.ts` | 新增 `characterIdOfPath(rel)`：`characters/<id>.md` → id，其余返回 null。宿主靠它把「一次写盘」翻译成「一个新角色」 |
| `apps/server/src/agentkit/deps.ts` | `PlaywriterKitDeps` 去掉 `writeCharacter` / `writeMemoryCard`，加 `files: PlayFiles` 与 `onWrite: (write) => void` |
| `apps/server/src/agentkit/kit.ts` | 目录里删掉两条；`read`/`write`/`edit` 的 `roles` 加 `playwriter`；`DEFAULT_ENABLED.playwriter` 更新；`playwriterTools` 装配 `PlayEnv` + `createPiFileTools` |
| `apps/server/src/agentkit/playEnv.ts` | 只改注释（不再是「工坊的执行环境」，两个角色共用） |
| `apps/server/src/agentkit/memoryTool.ts` | 删掉两个工具与 `sanitizeMemoryCardPath`；`createMemoryTools` 的依赖收窄成 `engine` / `memory` / `tree` / `stateFiles` / `arcIds` / `characterIds`；`update_state` 逻辑一字未动 |
| `apps/server/src/memory.ts` | 删掉死掉的 `appendCard` / `sortUserCards` 与 `indexDir` 字段、构造项。`loadCards` 本来就按 `file.localeCompare` 排，`[...indexCards, ...arcCards]` 的拼接就是行序不变量 |
| `apps/server/src/orchestrator.ts` | `onWriteCharacter` / `onWriteMemoryCard` → 单个 `onPlayFilesChanged`；`liveCharacterIds(opts)` 的构造期快照换成 `liveCharacterIdsValue` + `onPlayFileWritten`（按 `characterIdOfPath` 登记） |
| `apps/server/src/playhouse.ts` | `writeCharacter` 改走 `PlayFiles.write(characterCardPath(id))`，并把 `knownCharacters` 登记挪到落盘**之后**；删 `writeMemoryCard`；新增 `onPlayFileWritten`（登记 + 排轮边界重建） |
| `apps/server/src/playFiles.ts` | 新增 `GENERATED_PREFIXES`：`memory/arcs/`、`memory/archive/` 看得见、改不动。措辞从「工坊」改成「剧目」（两个角色共用这一层） |
| `apps/server/src/prompt.ts` | 新增 `MEMORY_RULES`；`NEW_CHARACTER_RULES` 改成 `newCharacterRules(can.files)`——第 1 步从 `create_character(...)` 改成 `write(path=..., content=...)` 并带上 frontmatter 字段表，没装写口时整段换成「走临时角色通道」；`scriptLanguageSection` / `FORMAT_RULES` / 记忆索引那句里的旧工具名一并改掉 |
| `apps/server/src/agentkit/kit.ts`（能力位） | 新增 `files` 位（授权工具 = `write`）：提示词那两章的格式说明现在挂在剧作家提示词里，用户在 Agent 页把 `write` 摘掉时必须一起收走，否则就是「教它调一个没有的工具」——项目把这类可见性错配当 bug 治 |
| `apps/server/AGENTS.md` | 工具可见性、白名单、机器产物只读、提示词例外、卡片行序、写盘回调这几条同步 |

## 三个值得单独说的点

**写盘回调不是新一层抽象。** `PlayEnv.writeFile` 本来就是唯一写面（白名单在 `PlayFiles`，
撤销条在这里），回调挂在它落盘成功之后，两条宿主动作（登记角色 id、排一次轮边界重建）
都从这一处出去。剧作家走 `write`、引用即导入写主角卡、`generate_image` 自动注册临时角色——
三条路汇到同一个 `rebuildAtBeatBoundary`，`pendingRebuilds` 保证一轮里最多重建一次。

**「当轮可读」的承诺换了实现。** 从前 `appendCard` 让刚写的记忆卡当轮就能被
`read_memory_detail` 读到；现在写的是文件，当轮就读那个文件（通用 `read` 立刻可读盘），
A 区的索引要等轮边界重建。提示词里把这条讲明白了，不留一个说不清的差别。

**顺手修了一个既有 bug。** `playhouse.writeCharacter` 原本先 `knownCharacters.add` 再落盘，
写失败时集合里会留下一个盘上并不存在的 id，`characterIdsOf` 的并集就带上了它，
`update_state` 会以为这个角色存在。现在登记在落盘之后。

## 验证

- `pnpm -r typecheck` 通过。
- `pnpm --filter @aivn/core test`：151 passed。
- `pnpm --filter @aivn/server test`：614 passed / 3 skipped（删掉 10 条测已删代码的用例，
  新增 10 条钉新链路的用例：写盘回调对 write 与 edit 都触发、`edit` 保住机器字段、
  引擎产物（含大小写混写）写不进去、`can.files` 决定两章注不注、
  跨轮 `write` 建卡 → 下一轮 `update_state` 认这个角色的端到端）。
  614 = 本轮的 603 + 合入前主分支 NSFW 隔离那三条带进来的 11 条。
- `pnpm --filter @aivn/core build` 已跑（core 加了导出）。
- 合入时的两处变基冲突：`createMemoryTools` 的依赖清单取「本改动收窄后的清单 + 主分支新增的
  `isNsfw`」；`memory.test.ts` 保留主分支新增的两条限制级检索用例，删掉被本改动替换掉的
  `appendCard` 用例。
- 真实模型/生图/TTS 的端到端见同目录 `.validation.md`，待用户实机确认。

## 检视回应（.review.md）

0 条阻塞。三条建议逐条处置：

- **S-01（大小写绕过，已修）**：`GENERATED_PREFIXES` 原按字面区分大小写比。Windows / macOS 的
  文件系统不区分大小写，`memory/ARCS/x.md` 在那边就是 `memory/arcs/x.md` 同一个文件——
  只在 Linux 上成立的前提不能留在代码里（桌面版正是这两套系统）。`isGenerated` 改成小写比较，
  测试补了 `memory/ARCS/`、`memory/Archive/` 两个混写路径。这条回归是**白名单收口之后**才浮出来的：
  从前这道守卫在 `write_memory` 的专用入口里，写面收口时被搬到了文件层。
- **S-02（端到端用例，已补）**：新增「跨轮 `write` 建卡 → 下一轮 `update_state` 就认这个角色」，
  走真实工具调用链（`write` → `PlayEnv.writeFile` → `onPlayFileWritten` → `liveCharacterIdsValue`），
  不再是本地 Set 的模拟。分两轮是因为同一批工具调用是并发的，断言顺序会变成掷骰子；
  每轮再拆「工具批次 + beat_done 批次」——`beat_done` 与别的工具同批会把 terminate 吞掉。
- **N-01（`WorkshopWrite` 命名，已改）**：改名为 `PlayFileWrite`（31 处，含注释），
  不留别名——留别名就是留两套叫法。`reloadAfterWorkshopWrite` 是工坊重载那件事的名字，与它无关，未动。
- **N-02（测试桩 `as never`）不处理**：那些桩只借 `store.dir`（`PlayFiles` 的白名单根），
  每个都带一句注释说明为什么不建真目录；抽成 helper 只是把强转挪个位置，不减认知负荷。
- **N-03（当轮读取引导）不处理**：`MEMORY_RULES` 已写明「写完到下一轮边界才进 A 区索引；
  当轮想知道内容就直接 `read` 那个文件」。再在索引那一章复述一遍就是同一条规则写两处，
  正是 `AGENTS.md` 里点名的漂移来源。
