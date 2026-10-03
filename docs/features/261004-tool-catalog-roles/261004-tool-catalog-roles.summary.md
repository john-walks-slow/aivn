# tool-catalog-roles 实施小结

- 计划/简报：`/tmp/debt-briefs/2-tool-catalog-roles.md`（本轮债务清单，未入仓）
- 检视：无独立文件（reviewer 子代理在线检视，结论 **条件准入**、无阻塞项；两条建议已落地并复检，见下）
- 用户验证：`261004-tool-catalog-roles.validation.md`（本目录）
- 分支：`refactor/tool-catalog-roles`，worktree `./.worktrees/tool-catalog-roles`，基线 `main@4281ad7`
- 提交：`851e42b`

## 一句话

工具 id 原本有两份并列的权威清单（`kit.ts` 的 `TOOL_CATALOG` 元数据 + `role.ts` 的 `ROLE_INSTALLABLE` 角色可装集），
现在收敛为一份：**角色可见性成为 `TOOL_CATALOG` 每一项自身的属性**；加一个工具从「改两处、漏了只能等红灯」变成「改一行」。

## 动机

简报记录的事实：2026-10-04 那次工具调整加了 4 个工具、删了 5 个，`kit.ts` 与 `role.ts` 两个文件都必须手工同步；
唯一的防错机制是 `agentkit.test.ts` 里一条「拿工厂产物比这份表」的用例，而那条用例本身还有个盲区（见下）。

## 落地事实

- `role.ts` 删除 `ROLE_INSTALLABLE`，只保留角色身份（`AGENT_ROLES` / `AgentRole`）与 UI 文案（`ROLE_META` / `isAgentRole`）。
- `TOOL_CATALOG` 每一项变成 `{ label, group, roles }`；`roles` 定为**非空元组**（至少一个角色，编译期就挡住漏标）。
- 新增导出 `agentToolEntry(id)`：目录项 → `GET /api/agents/tools` 的那一行；**未知 id 直接抛错**（替掉原先的非空断言）。
- 新增导出 `roleTools(deps)`：角色工厂的**原样产物**（尚未过用户启用集那道过滤），给测试当「工厂真正装得出什么」的锚点。经拍板保持导出。
- `DEFAULT_ENABLED.workshop` 仍是**导出的**「装得上的全部减 `bash`」，没有改成显式列表——显式列表会在新增工具时静默漏装。
- `DEFAULT_ENABLED.playwriter` 未动（仍是显式策略清单）。

## 对外行为核对（逐项）

| 项 | 结论 |
| --- | --- |
| 各角色装得上的工具集合 | 未变：剧作家 11 个、工坊 15 个，逐条比过旧 `ROLE_INSTALLABLE` |
| `DEFAULT_ENABLED` | 未变（元素集合一致；工坊侧的元素顺序改为排序后的确定性顺序） |
| `can` 位（image / search / library / voice / shell） | 判定与取值未变 |
| `GET /api/agents/tools` | 载荷形状（`{id,label,group,groupLabel}`，无角色字段）与内容未变 |
| 老 play.json 里的残留工具 id | 照旧被启用集白名单静默过滤，不报错 |

## 防错能力的实测（变异验证）

原用例的盲区：它拿 `ROLE_INSTALLABLE` 当启用集传给工厂再比，等于**拿启用集和自己比**——工厂多装一个没登记的工具照样能过。
现改为比 `roleTools` 的原样产物，两个方向都实测会红：

| 注入的回归 | 结果 |
| --- | --- |
| 剧作家工厂多装一个未登记的工具（`createReadSkillTool`） | `agentkit.test.ts` 1 例失败 |
| 目录把 `beat_done` 多标一个 `workshop` 角色 | `agentkit.test.ts` 2 例失败 |

## 验证证据

- 静态：`pnpm --filter @stage-ai/server typecheck`（`tsc -b --noEmit`）与 `build`（`tsc -b`）均通过。
- 测试：与 agentkit 相关的 7 个文件 113 例全绿 —— `agentkit` / `nsfwTool` / `playEnv` / `workshop` / `workshopPrompt` / `playhouse` / `http`。
- 未跑浏览器 e2e：本次是纯内部重构、无 UI 与行为变更，e2e 对本改动几乎没有鉴别力；用户侧可确认的部分见验证文档。
- 改动规模：4 文件，+124 / −119（`kit.ts` / `role.ts` / `test/agentkit.test.ts` / `test/nsfwTool.test.ts`）。

## 检视结论与处置

reviewer 子代理结论：**条件准入**，无阻塞问题。两条建议均已落地：

1. `roles` 收紧为非空元组 `readonly [AgentRole, ...AgentRole[]]`，让「新增工具忘了标角色」在编译期就不可表达。
2. `installableTools` 末尾排序，默认启用集的顺序不再跟着目录里的行序走。

落地后复检：typecheck 与上述 113 例再次全绿。

## 已知取舍

- **`DEFAULT_ENABLED.workshop` 的元素顺序变了**（改为排序后的确定性顺序）：前端把它当开关初始态装进 `Set`，保存时也会排序，无行为影响。
- **`roleTools(deps)` 为测试保持导出**：它是唯一能锁住「工厂多装一个没登记的工具」这个方向的东西，收紧成私有等于丢掉这条回归的探测能力。
- `apps/server/test/nsfwTool.test.ts` 有一处必要的连带修改（原 3 行 `ROLE_INSTALLABLE` 断言改用 `agentToolCatalog(role)`，并删掉一个未使用的 import）；
  该文件不在简报的显式边界内，但它不涉及被禁改的三个文件，也无并行改动。
