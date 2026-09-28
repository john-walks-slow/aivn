# P0 检视报告：Stage DSL 解析器 + 谱系数据模型

> **检视范围**：`packages/core`（DSL 规范/流式解析器/IR 事件/WS 协议/谱系模型）+ workspace 脚手架
> **对照基准**：`260928-stage-ai-mvp.plan.md` v4（§6 DSL v1 规范、D7 谱系归属、D10 四原语）
> **检视方式**：通读全部源码与测试 + 实跑 `pnpm -r test`（35/35 绿）与 `tsc --noEmit`（零错误）+ 边界用例实证探针
> **日期**：2026-09-28

---

## 准入结论：有条件通过

整体质量高：解析器主路径（撕裂容错、stop 闸门、消息边界自动闭合、未知标签字面保留）实现扎实，撕裂等价性测试循环是亮点；谱系模型的 edit-as-event 物化、隐式分岔式重写与 D10 语义对齐度高，类型纪律（strict + noUncheckedIndexedAccess 全开）好。

但存在 **2 个阻塞项**：option 生命周期缺陷（残缺流下静默丢交互数据，恰在 P0 验收命题"残缺流容错"的核心路径上）；exportAll/load 持久化往返不完整（leaf 推断启发式错误 + 快照/书签不持久化，与声称的能力不符）。修复量都不大（合计约 20 行 + 补用例）。

---

## 阻塞问题

### B1. exportAll/load "持久化往返"不完整：leaf 启发式错误，快照/书签全丢

**位置**：`packages/core/src/lineage/model.ts` `load()` / `exportAll()` / `snapshotsByNode` / `bookmarks`

**现象**（实证确认）：

1. **裸分岔状态丢失**：`append(A) → append(B) → forkAt(A)`（分岔后尚未重生成）时导出再 `load()`，live 物化是 `["A"]`，重建后物化是 `["A","B"]`——`load()` 用 `events.at(-1)?.id` 推断 leaf，把挂载点错指到旧分支末端。若在此状态崩溃重启，重生成内容会**接到错误的分支后面**。
2. **快照与书签不在导出内**：`load(t4.exportAll())` 后 `latestSnapshotOnPath() === null`、`listBookmarks().length === 0`。

**影响**：

- D10 明确"**书签 = 传统存档**，路线树完全替代存读档"、D7"**谱系快照随分岔/书签保存**"、§3.6 续演依赖"会话树 + 引擎状态持久化"。这些状态跨进程不存活，P1 编排器若直接采用此 API 做会话持久化（它就在 core 里、有测试背书，几乎必然被直接采用），书签/快照丢失是**静默**的，要到 P6 soak/真机续演才爆，定位代价高。
- Changes 描述声称"exportAll/load 持久化往返"，实际只往返了事件流——实现与声称的能力不符。

**修复建议**：

- 导出结构升级为完整会话状态：`export(): { events: LineageEvent[]; leafId: string | null; snapshots: LineageSnapshot[]; bookmarks: Bookmark[] }`，`load()` 接收同构结构，leaf 显式持久化而非推断。
- 保留"事件日志是唯一真相源"的语义：剧本/分支结构完全由 events 决定；leafId 是会话运行态，snapshots/bookmarks 是用户创建的存档事实——三者都不是事件的派生物，必须显式持久化。
- 补往返用例：裸分岔后导出重载 leaf 不变；快照/书签存活。

### B2. option 生命周期缺陷：`</stop>` 不收束打开的 option；自闭合 `<option/>` 语义错误

**位置**：`packages/core/src/dsl/parser.ts` `consumeCloseTag()`（stop 分支）、`emitStop()`、`handleTag()`（OPTION_TAG 分支）

**现象**（实证确认）：

1. `<stop type="choice"><option>去天台</stop>`（LLM 漏写 `</option>`）→ 产出 `stop { stopType: "choice" }` **无 options**，option 文本"去天台"**静默丢失，连 warning 都没有**。
2. `<option value="a"/><option value="b"/>`（自闭合变体）→ 只留下 `{ text: "", value: "a" }`（空文本死数据），`b` 完全丢失，且误报 `option 嵌套` warning。

**影响**：

- 这两种都是 LLM 真实会输出的残缺/变体形态，而 P0 验收命题恰是"残缺流容错"。§6.1.4 的容错哲学是"保留已流出的内容"——消息边界路径（`endMessage` 里先 `closeOption` 再 `emitStop`）做对了，**流内路径漏了**。
- 选项数据是停止点协议（D8 玩家主权）的核心载荷，静默丢失 = 玩家交互点损坏。`</option>` 缺失时无 warning 也堵死了 D3 护栏的"错误摘要回喂自修正"通道。

**修复建议**（约 5 行）：

- `consumeCloseTag` 的 stop 分支与 `emitStop()` 入口处：先 `if (this.stopParse?.option) this.closeOption();`（与 wrap 自动闭合对称）。
- `handleTag` OPTION 分支：`selfClosing` 时立即收束该 option（不进入悬空态）。
- 补 golden 用例：漏 `</option>` 的流内与边界两形态、自闭合 option、连续自闭合 option。

---

## 高优先级（P1 前应钉死）

### M1. `granularity: "beat"` 无行为语义，beat 边界解析的契约归属未定义

**位置**：`model.ts` `recordRewrite()`、`ws/protocol.ts` `rewrite` 消息

`recordRewrite(nodeId, "beat", …)` 与 `"line"` 行为**完全相同**（都挂到 `target.parentId`）——granularity 字段是装饰性的。段级重写按 D10 应"回退到整个节拍/一次生成批次之前"，需要先解析节拍边界、传节拍首行 nodeId，但：

- WS 协议 `rewrite { nodeId, granularity }` 两字段并列传递，**暗示模型层处理粒度**，实际谁都没处理；
- `LineageEvent` 无 beatId/归组字段（`beat_end` 只是普通行事件），事后虽可沿祖先链找 stop/beat_end 边界推算，但 core 既没提供 helper，也没测试，也没注释说明归属。

P0 只要求结构支持、P6 才落地，故不阻塞；但这是数据模型冻结项，契约缺口应在 P1 编排器动工前钉死。**建议二选一**：core 提供 `beatStartOf(nodeId)` 并在 `recordRewrite` 内按 granularity 分派；或在协议与模型注释中明确"beat 边界解析归编排器，nodeId 必须传节拍首行"。

### M2. choice 无选项时事件静默放行

`<stop type="choice"></stop>` → `stop { stopType: "choice" }` 无 options 字段，原样流入协议层。前端拿到无选项的 choice stop 无法渲染交互 UI，是死路。D3 护栏 1 只覆盖"没有合法 stop 标签→合成 free stop"，"有 stop 但选项为空"这个变体没有护栏归属。建议解析器对此形态至少发 `malformed_tag` warning（供护栏回喂/降级为 free），不要静默。

---

## 建议（非阻塞）

| # | 位置 | 内容 |
|---|---|---|
| m1 | `parser.ts` | 空 say（`<say id="a"></say>`）产出 start+end 零文本事件，前端得空行。行为可接受但未 pin——补测试固化，并由编排器/前端决定过滤策略。 |
| m2 | `parser.ts` | 属性值含 `>` 会截断标签解析（`indexOf(">")` 不感知引号）：`prompt="two > one"` 使整个 `<preload_asset>` 丢弃（有降级路径，不崩）。现实风险低（生图 prompt 偶见 `>`），建议作为已知限制记入 spec 注释；引号感知扫描留作后续打磨。 |
| m3 | `model.ts` | `nextId()` = 时间戳+进程内计数器：重启后计数器归零，仅当时钟回拨+同毫秒同计数才碰撞。单用户 P0 可接受；稳妥做法是 `load()` 后从已有 id 播种计数器。 |
| m4 | `parser.ts` | 非包裹标签的包裹形式未校验（`<scene bg="x">text</scene>` 照发事件、text 丢成 orphan、`</scene>` 报 mismatched）。容忍可接受，加一条 "指令标签应为自闭合" warning 更利于回喂自修正。 |
| m5 | `model.ts` | 书签不自动快照（D7 说"谱系快照随分岔/书签保存"，模型做成了两次独立调用）。编排器层组合没问题，但"从书签继续=冷启动装配"的语义应写进 `addBookmark` 注释，防止 P1 误用。 |
| m6 | `model.ts` | `isAncestor` 逐条调用走 O(depth) 链扫描；D7 检索过滤"祖先链 ⊆ 当前分支路径"若逐条调用是 O(n·depth)。建议 core 提供 `pathSet(nodeId): Set<string>` 供一次性集合判定。 |
| m7 | 仓库根 | 缺 README / AGENTS.md。按项目文档规范新项目应有 AGENTS.md；README 待用户面能力出现（P1+）再补，发布前逐项核对。 |
| m8 | Changes 描述 | 描述称 parser 25 + lineage 10，实际 24 + 11（总数 35 一致）。琐碎勘误。 |

---

## 与计划契约的一致性核对

| 契约项 | 计划出处 | 实现 | 判定 |
|---|---|---|---|
| 9 标签白名单冻结 | §6.2 | `DSL_TAGS` 恰 9 个，属性结构与表格逐项一致 | ✅ |
| stop 类型 choice/free/pause + option 子标签 | §6.2 | `STOP_TYPES` + `OPTION_TAG` | ✅ |
| say/narrate/thought 拆 start/text/end 三段支撑流式 | P0 交付 | `StageEvent` 判别联合 | ✅ |
| 消息边界自动闭合（保留已流出台词） | §6.1.4 | `endMessage()` ✅，但 option 流内路径漏（B2） | 🟡 |
| 每条消息独立解析、跨消息不续标签 | §6.1.5 | 已测（"多消息独立解析"） | ✅ |
| stop 即闸门：闭合后丢弃其后本节拍一切事件，跨消息持续到 resetBeat | §6.1.6 / D3 | 已实现已测（含跨消息+resetBeat） | ✅ |
| 未知标签按字面文本输出；残缺标签/属性才丢弃 | §6.1.4 | 已实现已测（`<i>`、裸 `<`、`<3`） | ✅ |
| 撕裂容错（chunk 任意位置） | P0 验收 | chunk=1/2/3/5/7 等价性循环 | ✅ |
| 行级事件 append-only 日志为唯一真相源 | D10 | events Map + parentId 树，edit 以追加事件表达 | ✅ |
| 原地编辑：默认替换当前分支该行、不产生新分支、日志不改写 | D10 | `editInPlace` + 物化 override；跨分支不可见已测 | ✅ |
| 重写 = 隐式分岔 + 行级截断，旧版本留废弃分支，instruction 可选 | D10 | `recordRewrite` 挂到 target.parent，已测 | ✅（line 粒度）/ 🟡（beat 粒度见 M1） |
| 快照随分支走：路径上最近快照可恢复，旧分支不见未来 | D7 | `latestSnapshotOnPath` 已测 | ✅（内存）/ 🔴（持久化见 B1） |
| 书签 = 命名节点 = 存档 | D10 | `addBookmark` | ✅（内存）/ 🔴（持久化见 B1） |
| turn 用分支深度而非全局计数 | D7 | `nextTurn` 沿父链递增 | ✅ |
| 检索防剧透：祖先链判定 | D7 | `isAncestor`/`ancestorChain` 可支撑 | ✅ |
| WS 四原语消息（fork/edit/ooc/rewrite）正交、不隐式联动 | D10 | ClientMessage 四独立消息 + jump/bookmark | ✅ 设计保真度高 |
| beat_end 双语义（stop / act_end 无 stop 自然收束） | D3（commit 41e27a9 修订） | `BeatEndPayload.reason` | ✅ |
| 重连凭 seq 重放 | §7 | `resume { lastSeq }` + `hello { lastSeq }` + `SequencedEvent` | ✅ |
| 引擎/谱系/记忆快照结构（分岔×记忆快照） | P0 交付 | `EngineStateSnapshot` + `MemorySnapshot`（state 内联、arcs 引用） | ✅ 结构合理 |

**分层正确性**（值得肯定）："指令先于台词"留给提示词+护栏而非解析器强校验；必填属性/枚举校验在解析器内做了基本项且 warning 结构化（type+detail，供 D3 错误回喂自修正通道）；core 不越界实现编排器职责。

---

## 测试充分性评估

**覆盖良好的**：撕裂等价性循环（1/2/3/5/7）、stop 自身撕裂、边界自动闭合、跨消息闸门、stop 前自动闭合 wrap、三种 stop 类型、option value、未知标签字面保留、畸形属性丢弃、orphan 文本、stop 内白名单、mismatched 闭合、嵌套 wrap；谱系的分岔保留旧分支、编辑不跨分支、快照路径、导出重建。

**缺口**（按优先级）：

1. option 生命周期：漏 `</option>`（流内/边界）、自闭合 option、连续自闭合——B2 修复后必须补；
2. 持久化往返的完整态：裸分岔 leaf、快照/书签存活——B1 修复后必须补；
3. 消息边界处未闭合 `<stop>`（实证行为正确：closeOption → emitStop 兜住了护栏路径），但无测试 pin，属关键鲁棒性路径，应加；
4. `<say id="a"></say>` 空行行为 pin；choice 零选项形态 pin（配合 M2）；
5. 双重编辑 last-wins（实证正确）、rewrite 首行（parentId=null，实证正确）——顺手各加一条；
6. 属性值含 `>` 的已知限制用例（配合 m2 记录）。

---

## 附：实证探针记录

```
<option>去天台</stop>            → stop 无 options，文本静默丢失，零 warning     （B2）
<option value="a"/><option .../> → 仅 {text:"",value:"a"}，b 丢失，误报嵌套       （B2）
边界未闭合 stop+option           → 正确收束（此路径是对的）                        ✓
<say id="a"></say>               → start+end 空行                                 （m1）
prompt="two > one"               → preload_asset 整标签丢弃 + orphan 警告          （m2）
双重编辑                          → 后者生效                                       ✓
rewrite 首行                     → parentId=null，正常                            ✓
裸分岔 exportAll→load            → live=["A"] vs rebuilt=["A","B"]                （B1）
load 后快照/书签                 → null / 0                                       （B1）
```

---

## 结论

修复 B1、B2 并补对应 golden 用例后即可合入；M1/M2 建议在 P1 编排器动工前钉死契约归属；其余建议项随手处理。核心架构判断（双层契约、append-only 谱系、四原语正交）与计划高度一致，方向没有需要推翻的东西。
