# P6-d 设计 · `update_state` → 状态文件 + watcher（只出设计，不实施）

日期：2026-10-10 · 状态：**设计稿**（P6 轴问 3 结论：本次只出设计；迁移必须单独确认）
上游：`261009-aivn-agent-package.p6.plan.md` §3 / §4；复核依据 `261009-p6-scope-review.md` §5

---

## 0. 一句话

把好感度 / 旗标从 `engine` 的内存真值搬进 `memory/always/state/state.json`（插件今天就是这么做的），
收益最高（服务端也变成「领域数据住剧目文件，工具只在动运行时时才存在」），
但**回滚语义、校验回执、提示词教学、测试面**四笔账必须先算清——本稿只算账，不动代码。

---

## 1. 现状（实读）

| 事实 | 位置 |
| --- | --- |
| `engine.affinity` / `engine.flags` 是内存真值，工具只改传进来的对象 | `apps/server/src/agentkit/memoryTool.ts:62-83` |
| `scene` / `threads` 落在 `stateFiles`（**另一套状态**） | 同上 `:82` |
| 收束一轮时**两类都克隆后写快照** | `orchestrator.ts:2104-2112`（`SnapshotFacts.engine` + `.stateFiles`） |
| 读某节点的分支状态时**分别取**：`snapshot.engine` 与 `snapshot.stateFiles` | `orchestrator.ts:1560-1583`（`stateAt`） |
| 回退时**分别装回**：`engine.*` 与 `stateFiles`（原地换内容，不换对象引用） | `orchestrator.ts:1585-1605`（`restoreBranchState`） |
| A 区【状态】区把两者拼在一起渲染 | `orchestrator.ts:1706` 附近的 `renderStateSection(engine, scene, stateFiles)` |
| 每次文件写盘后已有一条回调链 | `agentkit/playEnv.ts:90` → `orchestrator.ts:493-496` → `onPlayFilesChanged` → `rebuildAtBeatBoundary` |
| 插件侧的参照实现（文件承载状态） | `dsh-aivn-shared/src/play/play-state.ts:16-27`、`src/play/play-context.ts:298-330`、`src/playwriter/prompt.ts:145-165` |

**结论**：§9 曾断言「`stateFiles` 本来就随快照走，所以搬进去不损回滚语义」——**不成立**。
快照确实两类都存，但它们是**并列的两格**、分别读写；普通文件是**剧目级**的，不会自动获得
branch-local 版本。搬进文件之后必须自己把「哪一份是分支真值、什么时候覆盖工作态」这套机制写实。

---

## 2. 目标形态

- `state.json` 承载 `{ affinity: { <charId>: number }, flags: { <key>: string|number|boolean } }`；
  `scene.md` / `threads.md` 不变（它们本来就在 `stateFiles` 里）。
- `engine` 不再持有这两格真值；A 区渲染改为「读文件 → 渲染」。
- 工具 `update_state` 删除；模型用 `write` / `edit` 改这三个文件。

**不能丢的四样语义**（全部来自现状工具）：

1. **分支真值**：跳转 / 分岔 / 读回旧轮之后，好感度与旗标必须是那一枝的值；
2. **校验与回执**：「成员 id 不存在 / 非整数 / |Δ|>5 / 越界 0~100」今天当场拒并回
   「已生效：… ；被拒绝（请修正后重试）：…」——这是模型自纠的抓手；
3. **周目边界重置**：新周目要回到 `initialState`；
4. **下一轮可见**：本轮写的值要在下一轮 A 区【状态】区里出现。

---

## 3. 分支真值（这是本设计的核心）

**一句话规则：快照是分支真值，文件是工作态/缓存。**

| 时机 | 动作 | 优先级 |
| --- | --- | --- |
| 模型写 `memory/always/state/*` | 文件即工作态；写后**解析 + 校验**，把结果并入当前运行态（用于本轮后续渲染） | 文件 → 运行态 |
| `closeBeat`（收束一轮） | 把当前运行态（含从文件读来的状态）克隆进 `SnapshotFacts`，随节点留档 | 运行态 → 快照 |
| `jump` / `fork` / `restore` / 读回旧轮 | 用目标节点的快照**覆盖**工作态，并**把文件回写**成该分支的状态（否则文件里留着上一枝的写） | 快照 → 运行态 + 文件 |
| 周目边界 | 用 `play.json` 的 `initialState` 重置运行态与文件 | 初值 → 两者 |

**必须明确的两个反例**：

- **不能只写文件不回写**：从分支 A 跳到分支 B 之后，`state.json` 里还是 A 的值，模型下一轮 `read`
  到的是错的分支——这比现在的行为更糟。
- **不能让文件当分支真值**：一个剧目只有一份 `state.json`，两条分支同时存在时它会互相覆盖；
  所以「文件 → 快照」只允许发生在收束那一刻，其余时候文件都是可被覆盖的缓存。

坏文件时以**快照为准**（文件坏了不影响分支语义），并把坏文件当一次可见的失败报给模型（见 §5）。

---

## 4. 观察与回执：先盘已有钩子

### 4.1 服务端已有

- **per-write 回调**：`PlayEnv.writeFile` 落盘后调 `onWrite({path})`（`playEnv.ts:90`），
  orchestrator 接住（`orchestrator.ts:493-496`），再经 `onPlayFilesChanged` 排一次轮边界重建。
  它**每个文件写都有**，是「写后解析并更新运行态」最省力的挂点。
- **写口本身能回错**：`PlayEnv.writeFile` 捕获 `PlayFiles.write` 的异常并转成 pi 的 `FileError`
  （`playEnv.ts:76-88`，`play.json` 用 `invalid` 码），模型看得到这条错误。所以**校验可以同步做在写口**。

### 4.2 插件侧（**未实测，不得写进实现前提**）

- `tools/post-execute` 瀑布在 `@deepseek-ai/dsh-tools` 的类型里存在（可 block/feedback），
  插件代码里**今天没有用它**；
- `@deepseek-ai/dsh-api-workspace-files` **不在** `/root/projects/dsh-aivn-shared/node_modules/` 下
  （2026-10-10 实测：`ls node_modules/@deepseek-ai/` 无该包），且复核指出它的 `changes(scope, signal)`
  没有 path 参数、只报告被 instrument 的 `fs/observed`（不是 OS watcher）。
- 结论：插件侧要接观察机制，**先做一次宿主集成实测**（确认包是否随宿主提供、inject 服务名、
  workspace scope 怎么拿），实测通过再进设计。

> 本轴是服务端侧改动（插件已经是文件承载），所以插件侧的观察机制**不是本设计的前置**；
> 上面这段只是留档，避免下次想当然。

---

## 5. 失败语义

| 情形 | 处置 |
| --- | --- |
| 坏 JSON | 以快照为准（§3）；把「state.json 解析不了，本次改动未生效」作为可见失败报给模型 |
| 未知角色 id | 拒绝这一项，其余照常（部分成功），回执里分开列「已生效 / 被拒绝」 |
| 非整数 / \|Δ\|>5 / 越界 | 同上（这两条是今天 `memoryTool.ts` 的校验，必须原样保留语义） |
| `flags` 用目标值、`affinity` 用增量 | **必须写进提示词**：增量语义是今天工具描述教的，文件化后没有 schema 帮忙 |
| 并发写（模型 + 文件页 / 两轮重叠） | 写后解析以最后一次写为准；同目录已有 `withPlayConfigLock`，可在同一把锁里做「解析 + 并入运行态」 |
| 本轮写、本轮就要读到 | 靠 §3 的「写后并入运行态」，不等轮边界 |

---

## 6. 「写口当场拒」还是「提议队列」

三条候选路线（按机制成本排序）：

| 路线 | 做法 | 回执路径 | 成本 |
| --- | --- | --- | --- |
| **A · 写口同步校验** | 在 `PlayFiles.write` / `PlayEnv.writeFile` 里解析并校验 `state.json`，不合法就回 `FileError` | 现成：pi 把 `FileError` 回给模型 | 低（但要接受「写口是服务端单边行为」，与 P6-b 否掉 `CRAFT_ENUMS` 入写口的理由同一类） |
| **B · 提议队列** | 文件写只登记「提议」，在轮边界统一校验并提交 | 要新增一条「提交结果」反馈（下一轮注入或系统消息） | 中；且改变了「写完立刻生效」的时机 |
| **C · 后台 watcher** | 新增观察机制（服务端已有 per-write 回调可用；插件侧需实测） | 要把校验结果塞回工具结果或另发一条消息 | 最高 |

**倾向**：A 最省且回执路径现成——但它是「服务端单边写口行为」，与 P6-b 的理由相冲；
B 最符合「快照才是真值」的世界观（提议在轮边界落地，与快照同一时机）。
**这一条是本设计要用户拍的关键取舍**，不在本稿单方面定。

---

## 7. 实施切分（迁移时）

1. **设计**（本稿）：定 §3 的优先级表、§6 的取舍、§5 的失败语义；
2. **原型**：只做 `state.json` 的读写与 A 区渲染，`engine` 暂时双写（旧路径仍生效），
   跑通「写 → 下一轮可见 → 收束 → 分支切换」；
3. **迁移**：删 `update_state`，改提示词（`prompt.ts:205,286` 两处点名 + 插件那份《世界状态》章
   可整段借用），重做测试面（`agentkit.test.ts` 28 处、`orchestrator.test.ts` 48 处、`prompt.test.ts` 24 处）。

---

## 8. 什么结果下这条不做（可检查判据）

满足**任一条**，就停在这里、把「引擎拥有状态真值」登记为服务端有意差异：

1. §6 的取舍确认不下来（A 的「单边写口」不可接受，B 的「轮边界才生效」也不可接受）；
2. 原型阶段出现「分支切换后文件与快照不一致」的用例**修不进 §3 的优先级表**（说明这套机制撑不住）；
3. 迁移成本落在「测试面重做」上超过一个阶段预算（>1 个 goal 轮次包），而收益只有「服务端向插件靠」
   ——插件侧零改动，收敛收益只体现在服务端内部形态；
4. 提示词教学（增量、角色 id、±5、越界）无法在没有 schema 的情况下稳定教会模型
   （表现为原型里模型频繁写错、且 `validate_play` 报得不够及时）。
