# 261017 限制级通道 v3 · 验证记录

## 自动化

| 范围 | 结果 |
|---|---|
| `pnpm -r build` / `pnpm typecheck` | 通过 |
| `pnpm check:agent-contract` | 9 项通过（能力矩阵与工具目录一一对应） |
| `pnpm --filter @aivn/server test`（全套） | 765 passed / 3 skipped |
| `pnpm --filter @aivn/web test agentModelOptions playPane` | 13 passed |

新增/改写的用例：

- `orchestrator.test.ts` 新增「限制级通道」三条：手动开启（下一拍换专用模型 + 那组注入排在引擎提示词之后 + **通道里落下的节点全带 nsfw 标**）、空闲时手动关闭（立刻翻转 + 补带摘要的过渡节点）、剧作家自己调 `enter_nsfw` 也进通道。
- `promptInjection.test.ts`：`active=false` 时既不前置、也要摘掉现场那份旧的；`injectionMessages` 只认有没有消息。
- `prompt.test.ts`：能力关着不提两个工具；能力开着给进入指引；已在通道里只说怎么出来；通道里但没工具时不许教它调不存在的工具。
- `workshop.test.ts`：通道开着才注入工坊，关着同一份配置一条都不给。
- `nsfwTool.test.ts`：合规锚点改作出厂 preset（名字/角色/正文）。
- `promptPresets.test.ts`：出厂那份只在文件从没写过时露面；删掉不再长回来。
- `agentkit.test.ts`：剧作家工具表与能力目录含限制级通道。
- `agentModelOptions.test.tsx`：剧作家卡四个下拉、总下拉数 7。

## 实拍（dev 实例，真模型）

| 场景 | 结果 |
|---|---|
| 连上舞台：`play.json` 开关开着 | 那枚通道角标亮（文件 → 这一局的起点生效） |
| 通道里演一拍 | 那组注入生效（模型照注入的规矩写出标记行），20 个台词节点**全部带 nsfw 标**、`beat_end` 带标 |
| 关掉通道 | 立刻翻转、角标熄、`play.json` 的开关写回 `undefined`；下一拍不再注入 |
| Agent 页拨开关 | 一次点击 = 写盘 + 作用于本局；草稿与盘上那份同步，不产生假脏标记 |
| 舞台导演栏 | 多出「限制级」一枚，标题/角标随通道状态翻转（另见截图） |

## 已知边界

- 「空闲时关掉通道」补的那条过渡节点在路线视图里会表现为一个没有正文的收束节点（它只为全年龄侧那条摘要而存在）。
- 该通道没有对手动开关做多人并发保护（单用户产品，与其它开关一致）。
