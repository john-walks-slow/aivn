# P0 检视报告（第二轮）：阻塞项修复复核

> **检视范围**：`packages/core` 第一轮修复（B1/B2 + M1/M2 + m2–m6）+ 工作区整体合入状态
> **对照基准**：[第一轮报告](./260928-stage-ai-mvp.review.md)（有条件通过）· [计划 v4](./260928-stage-ai-mvp.plan.md) §6/D7/D10
> **检视方式**：通读修复后全部源码与测试 + 实跑 `pnpm -r test`（45/45 绿）与 `pnpm -r typecheck`（零错误）+ **30 项独立边界探针**（含 JSON 深度往返、撕裂变体、混合收束，见附录）
> **日期**：2026-09-28

---

## 准入结论：通过（代码层），提交前需处理 1 项仓库卫生

两个阻塞项 B1、B2 **均验证为真修复**——不是表面补丁：探针覆盖了第一轮报告的全部实证场景（裸分岔往返、流内漏 `</option>`、自闭合 option），并追加了 JSON 深度往返（真实持久化路径）、撕裂等价、混合形态（悬空+自闭合、嵌套 stop、闸门后残留）等 30 项，全绿。修复未引入新缺陷；Changes 描述与实现逐项相符，无虚报。

唯一需在**提交前**处理的是工作区里的 `.gitignore` 回退（见下），它不属于 core 代码，但按当前工作区状态直接提交有把本机 agent 记忆目录带进仓库的风险。

---

## 一、阻塞项复核

### B1. exportAll/load 持久化往返 → ✅ 已修复

**验证证据**（探针 + 测试双重）：

| 第一轮缺陷 | 修复后行为 | 验证方式 |
|---|---|---|
| 裸分岔 leaf 用事件尾推断，指错分支 | `LineageStore { events, leafId, snapshots, bookmarks }` 四字段显式持久化；`load()` 后 leaf 不漂移，重生成接到正确分支 | 探针 Q1 + 测试「裸分岔状态」 |
| 快照/书签不持久化 | 往返后 `latestSnapshotOnPath()` / `listBookmarks()` 存活（含 engine/memory 载荷） | 探针 Q2 + 测试「快照与书签跨进程存活」 |
| —（追加） | **JSON.stringify→parse 深度往返**（真实落盘路径）物化一致、再导出幂等、往返后 fork/append/turn 语义正常；edit 事件往返 override 生效（双重编辑 last-wins）、rewrite 载荷存活且不占行 | 探针 Q2/Q3/Q4 |
| m3：重启计数器碰撞 | `load()` 后 `seedNextId` 从 events+snapshots+bookmarks 播种，单调不回退 | 探针 Q6 + 测试 |

`exportAll` 已删除，源码无残留引用。导出顺序（Map 插入序）天然保证父先子后，`attach()` 的父节点校验对损坏数据快速失败——持久化边界行为正确。

**分层判断**：修复保住了"事件日志是唯一真相源"语义（leafId 是运行态、快照/书签是用户存档事实，三者都不是事件派生物，显式持久化是对的划分），与第一轮修复建议一致。

### B2. option 生命周期 → ✅ 已修复

**验证证据**：

| 第一轮缺陷 | 修复后行为 | 验证方式 |
|---|---|---|
| `<option>去天台</stop>` 文本静默丢失零警告 | `emitStop()` 入口先 `closeOption()`，选项照发，无误报嵌套警告 | 探针 P1（整段 + P2 撕裂等价）+ 测试 |
| 自闭合 `<option/>` 只留空文本死数据 + 误报嵌套 | 自闭合立即收束入 `options`，连续自闭合不丢、零警告 | 探针 P4（chunk=1 撕裂等价）+ 测试 |
| —（追加） | 悬空 option 后跟自闭合 option 顺序保持（A 先 b 后）；消息边界混合形态收束正确；stop 后残留 `</option>` 被闸门吞；嵌套 `<stop>` 容忍（第二个丢弃告警，第一个正常收束） | 探针 P3/P5/P7/P11 |

消息边界路径（endMessage：closeOption → emitStop → closeWrap）回归确认无恙；`stopParse` 与 `openWrap` 不共存的不变量成立（stop 开标签时强制闭合 wrap），endMessage 的收束顺序无隐患。

---

## 二、修复引入的新问题扫描：未发现阻塞项

对 B2 涉及的 `handleTag/emitStop/closeOption/consumeCloseTag` 与 B1 涉及的 `export/load/seedNextId` 全路径走查 + 探针轰炸，三个非阻塞观察：

| # | 位置 | 观察 | 判定 |
|---|---|---|---|
| n1 | `model.ts` `load()` | **load 到非空树是静默合并**（探针实证：已有 1 事件的树 load 后 2 事件）。docstring 未声明"空树"前置。P1 编排器必然 new 后 load，实际无风险，但一行注释值得加 | 建议随手 |
| n2 | `parser.ts` `emit()` | `"gated"` 警告分支目前不可达（feed/run 双重短路在 emit 之前丢弃）——纯防御死代码 | 无害，保留可 |
| n3 | `model.ts` `saveSnapshot()` | 快照可挂在 edit/rewrite 等结构节点上（不占剧本行但占树节点）。探针证实从其后代仍可沿祖先链发现，语义自洽；编排器组合时知道即可 | 记录即可 |

M2（choice 零选项 → 事件照发 + malformed_tag warning）、m4（指令标签非自闭合 warning）、m2（spec 注释钉死 `>` 已知限制）、m5（addBookmark 冷启动注释）、m6（`pathSet()`）逐项核对实现与测试均在位。

---

## 三、合入前需处理（仓库卫生，非代码缺陷）

**`.gitignore` 回退**：工作区对 `.gitignore` 的未提交修改**移除了** `plays/`、`media-cache/`、`.mnemon/`、`*.local` 四条（新增了 `*.tsbuildinfo`、`.env.*`、`coverage/`、`.worktrees/`）。后果：

- `.mnemon/` 是本机 agent 记忆目录，**当前真实存在且已变成未忽略的 untracked**（`git status` 可见 `?? .mnemon/`）——按此状态提交会把机器本地数据带进仓库；
- `plays/`、`media-cache/` 是计划 §8.1 的运行时剧目数据目录，P1 落地后同样会被误提交。

该改动在 packages/core 之外，可能是并行 Agent 或工具顺手做的（本工程多 Agent 同时工作）。**处理方式**：提交前恢复 `.mnemon/`、`plays/`、`media-cache/` 三条（`*.local` 视意图定），或与改动方确认后按 hunk 挑选提交。core 代码本身不因此返工。

---

## 四、残留项对照（第一轮 → 本轮）

| 项 | 第一轮要求 | 本轮状态 |
|---|---|---|
| M1 粒度契约 | 协议**与**模型注释钉死 beat 边界归属 | 🟡 `model.ts recordRewrite` 注释已钉死（beat 解析归编排器、nodeId 传节拍首行）；`ws/protocol.ts` 的 `rewrite` 消息仍无对应一行注释。补上即闭环 |
| m7 仓库文档 | 新项目应有 AGENTS.md | 🔴 未处理（仍无 README/AGENTS.md）。非代码阻塞，但按项目文档规范应在提交时补一份最小 AGENTS.md |
| 测试缺口 #3（边界未闭合 stop） | 应加 pin | ✅ 由「漏写 </option>：消息边界同样收束」覆盖同一 endMessage 收束路径 |
| 测试缺口 #5（双重编辑 last-wins / rewrite 首行） | 顺手各加一条 | 🟡 未加测试；本轮探针 Q3 已实证行为正确。可不阻塞 |
| m8 计数勘误 | — | ✅ 本轮描述 45/45 与实跑一致 |

---

## 五、验证实录

```
pnpm -r test        → Test Files 2 passed, Tests 45/45 passed (parser 30 + lineage 15)
pnpm -r typecheck   → tsc -b --noEmit 零错误（strict + noUncheckedIndexedAccess 全开）
独立探针（30 项，/tmp/stage-ai-probe.mjs，对 dist 构建）：
  B2 组 13 项：流内漏</option>收束、撕裂等价、悬空+自闭合顺序、连续自闭合、
              边界混合收束、闸门吞残留、自闭合choice警告、撕裂stop头、
              stop内白名单、嵌套stop、裸</option>警告 … 全绿
  B1 组 17 项：裸分岔leaf不漂移+重生成接对分支、JSON深度往返（物化/快照/书签/
              leaf/再导出幂等/重启后fork+append）、edit last-wins、rewrite载荷、
              空树、计数器单调、pathSet/isAncestor、turn=分支深度 … 全绿
```

---

## 结论

B1、B2 修复到位且经独立探针验证，第一轮的全部阻塞项清零；修复未引入新问题，Changes 描述无虚报。**代码达到合入准入**。提交动作本身前处理两件事：恢复 `.gitignore` 被移除的运行时目录/本机目录条目（必须），顺手补 `ws/protocol.ts` rewrite 注释与仓库 AGENTS.md（建议）。P1 编排器动工前无遗留契约缺口。
