# prompt-capabilities 用户验证

## 验证说明

- 验证对象：剧作家的能力位从三个独立布尔（`canImage` / `canSearch` / `canLibrary`）并到与搭台助手同一套的
  `can: AgentCapabilities`，`can` 由 `CAPABILITY_TOOLS` 表从实际装上的工具算出。**对外行为零变化**——
  逐字等价已由自动化证明（12 组上下文重渲染 diff 全等，见 `261004-prompt-capabilities.summary.md`），
  所以下面只列真机才看得出来、且值得亲自过一眼的两条。
- 环境/前置条件：本机 stage-ai 实例，需要真实模型（消耗少量额度）。不需要新的环境变量或配置。
- 自动化已覆盖：能力位 → 提示词章节的开关（`promptCapabilities.test.ts` 7 条）、
  两份提示词各自的既有断言、`apps/server` 480 条用例全绿、`pnpm -r typecheck` 全绿。

## 验证项

| 验证步骤 | 预期结果 | 实际结果 | 状态 | 备注/证据 |
| --- | --- | --- | --- | --- |
| 1. 开一个周目演两轮（走到停止点并回应一次） | 演出行为与改动前一致：剧作家照常写剧本、照常收束出停止点；没有标签被念到舞台上、没有格式异常 | | 待验证 | 提示词内容逐字未变，这里确认的是装配链路（`orchestrator.ts` 的 `can: this.kit.can`）真的接上了 |
| 2. 工坊「Agent」页把剧作家的「生成剧目素材」关掉，重开一个周目演一轮 | 剧作家不再有出图那一章（会说「本剧目没有开启生图」），也不会去调 `generate_image`；把它勾回来后该章恢复 | | 待验证 | 这正是本次重构盯的那条链路：play.json 的 `agents.playwriter.tools` → `kit.can` → 提示词注不注某一章 |

## 验证结论

待验证。

## 待跟进

无。
