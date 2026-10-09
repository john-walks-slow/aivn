# P6-d 设计 · `update_state` → 状态文件（设计定稿 + 原型/迁移指引）

日期：2026-10-10 · 状态：**设计定稿**（§3 / §5 / §6 已定；实施按 §7 三段走）
上游：`261009-aivn-agent-package.p6.plan.md` §3 / §4；复核依据 `261009-p6-scope-review.md` §5

---

## 0. 一句话

把好感度 / 旗标从 `engine` 的内存真值搬进 `memory/always/state/state.json`（插件今天就是这么做的），
收益最高（服务端也变成「领域数据住剧目文件，工具只在动运行时时才存在」），
但**回滚语义、校验回执、提示词教学、测试面**四笔账要算清。§3 / §5 / §6 已定稿（决策见各节），
§7 给三段实施切分：设计 → 原型（engine 双写过渡）→ 迁移（删 `update_state`）。

---

## 1. 现状（实读）

| 事实 | 位置 |
| --- | --- |
| `engine.affinity` / `engine.flags` 是内存真值，工具只改传进来的对象 | `apps/server/src/agentkit/memoryTool.ts:62-83` |
| `scene` / `threads` 落在 `stateFiles`（**另一套状态**） | 同上 `:82` |
| 收束一轮时**两类都克隆后写快照** | `orchestrator.ts:2104-2112`（`SnapshotFacts.engine` + `.stateFiles`） |
| 读某节点的分支状态时**分别取**：`snapshot.engine` 与 `snapshot.stateFiles` | `orchestrator.ts:1560-1583`（`stateAt`） |
| 回退时**分别装回**：`engine.*` 与 `stateFiles`（原地换内容，不换对象引用） | `orchestrator.ts:1585-1605`（`restoreBranchState`） |
| B 区【状态】区把两者拼在一起渲染 | `orchestrator.ts:1706` 附近的 `renderStateSection(engine, scene, stateFiles)` |
| 每次文件写盘后已有一条回调链 | `agentkit/playEnv.ts:90` → `orchestrator.ts:493-496` → `onPlayFilesChanged` → `rebuildAtBeatBoundary` |
| 插件侧的参照实现（文件承载状态） | `dsh-aivn-shared/src/play/play-state.ts:16-27`、`src/play/play-context.ts:298-330`、`src/playwriter/prompt.ts:145-165` |

**结论**：§9 曾断言「`stateFiles` 本来就随快照走，所以搬进去不损回滚语义」——**不成立**。
快照确实两类都存，但它们是**并列的两格**、分别读写；普通文件是**剧目级**的，不会自动获得
branch-local 版本。搬进文件之后必须自己把「哪一份是分支真值、什么时候覆盖工作态」这套机制写实。

---

## 2. 目标形态

- `state.json` 承载 `{ affinity: { <charId>: number }, flags: { <key>: string|number|boolean } }`；
  `scene.md` / `threads.md` 不变（它们本来就在 `stateFiles` 里）。
- `engine` 不再持有这两格真值；B 区【状态】区的渲染改为「读文件 → 渲染」。
- 工具 `update_state` 删除；模型用 `write` / `edit` 改这三个文件。

**不能丢的四样语义**（全部来自现状工具）：

1. **分支真值**：跳转 / 分岔 / 读回旧轮之后，好感度与旗标必须是那一枝的值；
2. **校验与回执**：「成员 id 不存在 / 非整数 / |Δ|>5 / 越界 0~100」今天当场拒并回
   「已生效：… ；被拒绝（请修正后重试）：…」——这是模型自纠的抓手；
3. **周目边界重置**：新周目要回到 `initialState`；
4. **下一轮可见**：本轮写的值要在下一轮 B 区【状态】区里出现。

---

## 3. 分支真值（定稿）

**一句话规则：快照是分支 / 存档真值，文件是工作态；「文件 → 快照」只允许发生在收束那一刻。**

| 时机 | 动作 | 方向 |
| --- | --- | --- |
| 模型写 `memory/always/state/*`（通用 `write` / `edit`） | 文件即工作态；**引擎不介入**——B 区【状态】区每轮现读文件（与插件同一套），不养运行态镜像 | 文件 → 渲染 |
| `closeBeat`（收束一轮） | 同步读这三个文件，克隆进 `SnapshotFacts.stateFiles`（字段语义不变，只是来源从内存改成盘） | 文件 → 快照 |
| `jump` / `fork` / `restore` / 读回旧轮 / **切换存档** | 用目标节点的快照**覆盖**这三个文件（模型下一轮 `read` 到的就是那一枝的状态） | 快照 → 文件 |
| 新存档 / 周目边界 | 用 `play.json` 的 `initialScene` / `initialState` 重置这三个文件（插件今天由引擎在周目边界做同一件事，见 `dsh-aivn-shared/src/play/play-state.ts`） | 初值 → 文件 |
| **冷启动 / 工坊写盘 reload** | 同「jump」：runtime 从这一枝的重建器起来时，用**这一枝最近快照**回写文件（崩在轮中的写入随那一拍丢——与今天一致） | 快照 → 文件 |

**由此消掉的两套状态**：今天 `engine.affinity` / `engine.flags`（内存）与 `stateFiles`（内存）是两套并列状态、
都各自靠快照回滚，而盘上的 `memory/always/state/*` 在服务端**根本不存在**——没有任何代码写它，
剧作家按提示词去 `read` 只会 ENOENT。定稿后：**盘上那三个文件是唯一的工作态载体**，
`stateFiles` 退化成「快照里的那份拷贝」，`engine.affinity` / `engine.flags` 退化成 `play.json`
`initialState` 的种子（渲染不再读它）。

**两条硬规矩**：

- **不能只写文件不回写**：从分支 A 跳到分支 B 之后，文件里还是 A 的值，模型下一轮 `read` 到的是错的分支；
- **不能让文件当分支真值**：一个剧目只有一份 `state.json`，两条分支同时在世时会互相覆盖。

**多存档**：服务端一个剧目可以有多份存档（`saves/<saveId>/`），而状态文件是**剧目级**的——所以
「切换存档」与「跳转/分岔」同类：切谁就把那棵树的快照回写到文件。同一时刻只有一个活跃存档
（`playhouse` 按剧目缓存 runtime、切档走 `switchSave`），不存在两份存档同时写这三个文件。

**回写的落点**：三条回写（jump/fork/restore、切存档、冷启动）都走 `playhouse.buildRuntime` 那一段
（`playhouse.ts:380-392`）——它同时承担「恢复/切档回写」与「新档播种」两种语义，判据靠 `session`
与快照在不在。工坊写盘 reload 也走它，但那是**同一枝**的重建（`whenIdle` 已等 `pendingPersist` 落地），
回写的是同一份内容。

**术语**：状态区是 **B 区**（每轮的 user 消息，`prompt.ts:491` 自己标着「B 区」），不是 A 区——
A 区是 system prompt，纪元内必须逐 token 稳定才命中前缀缓存（`compaction.ts:8`），
每轮变化的 `stateProblem` 绝不能进那里。插件侧同样是物化成 user 快照
（`dsh-aivn-shared/src/play/play-context.ts:295-330`），两边同形。

**文件页是无锁写者**（已知并接受）：`PUT /api/plays/:id/files` 走 `workshop.writeFile`，不共用
`withPlayConfigLock`（复核 §6）。这三个文件升格为分支真值的工作态之后，用户手改 `state.json`
会被任何一次 jump / fork / 切档静默覆盖。本轴**接受**这个行为，只做两件事：给这三个文件在文件页
加一句说明（「随分支/存档走，跳转或切档会被回写」）+ 把「人 vs 模型的全量写冲突」记在
`docs/issues/261010-play-json-write-conflict/`（乐观并发那条路）。**不为它上锁**。

坏文件按 §5 处置（不拦写、状态区少几行、下一轮的 B 区【状态】区把问题说出来）。

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

## 5. 失败语义（定稿：与插件一致，不新增机制）

| 情形 | 处置 |
| --- | --- |
| 坏 JSON | **不报错、不拦写**：B 区【状态】区少那两行（插件今天就是这个行为），同时由 readiness 的 `stateProblem` 在**下一轮的 B 区【状态】区**里说出来（见 §6） |
| 未知角色 id | 渲染时按已存在的角色 id 过滤（插件同款）；写进去了也不报错 |
| 非整数 / 越界 0~100 | 由 readiness 的 `stateProblem` 报（**已经在包里、两边共用**，`packages/agent/src/readiness/play.ts:258-275`） |
| 好感度语义 | **绝对值**（与插件一致）：先 `read` 现值，加上这一轮的变化再写回去；「单次变化不超过 5」是**提示词规矩**，不从文件里推断（readiness 自己也写着这条没法从一份文件看出来） |
| 旗标语义 | 目标值；只动要改的键 |
| 并发写（模型 + 文件页） | 与 play.json 同一类问题：目录锁挡不住 stale read + 全量写，靠乐观并发解决（独立 issue，不在本轴） |
| 本轮写、本轮可见 | 渲染每轮现读文件，天然满足 |

---

## 6. 校验与回执：三条候选都不选（定稿）

**结论：不往写口加校验、不做提议队列、不加 watcher——把已有的 `stateProblem` 接进 B 区【状态】区就够。**

理由：

1. **已有机制全覆盖**：readiness 的 `readStateProblem`（`packages/agent/src/readiness/play.ts:258-275`）
   今天就判「不是合法 JSON / 好感度不是 0~100 的整数」，而且**两个宿主共用一份**；插件那边已经在
   提示词里写「拿不准就调 `validate_play` 看一眼」。
2. **反馈比工具回执更强**：把这句话接进服务端 B 区【状态】区（渲染时顺手带上），模型**每一轮都看得见**，
   直到改好——不需要它记得调工具，也不需要多一个工具。
3. **与 P6-b 同一条路子**：P6-b 已定「写口只查 JSON 结构、取值对错由 `validate_play` 报」，
   这里只是把同一个判据接进自动注入；反过来若在写口加 `CRAFT_ENUMS` 式的单边校验，就与那条决定自相矛盾。
4. **不加 watcher**：文件每轮现读（§3），没有任何「必须观察写盘才能保持一致的运行态」——watcher 换不来东西。

**代价（承认）**：模型写完的**当轮**看不到「被拒绝」回执，它在下一轮的【状态】区才看到警告。
这与插件今天的行为一致；比「写口当场拒」弱，换来的是零新增机制 + 两边同形。

---

## 7. 实施切分（迁移时）

1. **设计**（本稿）：定 §3 的优先级表、§6 的取舍、§5 的失败语义；
2. **原型**：只做三个状态文件的读写与 B 区【状态】区渲染，`engine` 暂时双写（旧路径仍生效），
   跑通「写 → 下一轮可见 → 收束 → 分支切换」；
3. **迁移**：删 `update_state`，改提示词（`prompt.ts:205,286` 两处点名 + 插件那份《世界状态》章
   可整段借用），重做测试面（`agentkit.test.ts` 28 处、`orchestrator.test.ts` 48 处、`prompt.test.ts` 24 处）。

**原型阶段的可检查判据**（`apps/server/test/orchestrator.test.ts` 的「P6-d 原型」一栏，全部已绿）：

| # | 判据 | 怎么验 |
| --- | --- | --- |
| 1 | 剧作家**直接 `write` state.json**（不走 `update_state`）→ 下一轮 B 区【状态】区就按文件渲染 | 两个 beat 的 fake 流，断言第二个 beat 的 context 里有 `mio 42` |
| 2 | 收束 → 跳回旧轮 → **三个文件回写成那一枝的值** | 两轮各写一次好感度，`jumpTo` 第一轮末尾后断言文件回到 `11` |
| 3 | `update_state` 以**文件**为基准，不把模型直接写的值盖回 engine 旧值 | 文件里 `mio:30`、engine 镜像 `mio:5`，调 `+1` 后断言文件与镜像都是 `31` |
| 4 | 切存档 / 工坊保存 play.json 之后，三个文件与该枝对照一致；工坊保存**不回退**未收束的写入 | 迁移阶段补（需要 playhouse 级的夹具） |

**两条已知小账**：① `update_state` 现在走 `writePlayStateText`（raw 落盘），不吃
`onPlayFilesChanged`——原型期可接受，迁移删掉工具后自动消失；② 旧档迁移一律用
`snapshot.stateFiles`（新）→ `snapshot.engine.affinity/flags`（旧档兜底）→ `session.engine`（冷启动兜底）
这条链，**不许退化成 `initialState`**，否则开发中的档好感度会被清零（`orchestrator.ts:1600-1607`
与 `playhouse.ts` 的 else 支都要保持这个优先级）。

---

## 8. 什么结果下这条不做（可检查判据）

满足**任一条**，就停在这里、把「引擎拥有状态真值」登记为服务端有意差异：

1. §6 的取舍确认不下来（A 的「单边写口」不可接受，B 的「轮边界才生效」也不可接受）；
2. 原型阶段出现「分支切换后文件与快照不一致」的用例**修不进 §3 的优先级表**（说明这套机制撑不住）；
3. 迁移成本落在「测试面重做」上超过一个阶段预算（>1 个 goal 轮次包），而收益只有「服务端向插件靠」
   ——插件侧零改动，收敛收益只体现在服务端内部形态；
4. 提示词教学（增量、角色 id、±5、越界）无法在没有 schema 的情况下稳定教会模型
   （表现为原型里模型频繁写错、且 `validate_play` 报得不够及时）。
