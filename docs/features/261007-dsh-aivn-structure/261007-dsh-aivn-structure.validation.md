# dsh-aivn-structure 用户验证

## 验证说明

- 验证对象：dsh-aivn 目录结构重构（共享工具/基础设施归位、`src/` 根归组、`e2e/diag/` 整理）。
  纯搬迁 + import 重算，**无行为变化**。
- 环境/前置条件：仓库工作树 `feature/dsh-aivn-7fh`；本机 e2e 前置见 `.summary.md`「环境备注」。
- 说明：功能性路径已由自动化覆盖（typecheck、build+`--check`、离线 media/rebuild/ending、实例
  injection/stagehand/stage/style/settings/director 全绿，证据见 `.summary.md`），故用户验证只收
  两项：结构本身是否合意，以及真实后端残余回归。

## 验证项

| #   | 验证步骤 | 预期结果 | 实际结果 | 状态 | 备注/证据 |
| --- | --- | --- | --- | --- | --- |
| 1   | 在仓库根跑 `ls src src/stagehand src/tools src/play src/stage src/style src/voice e2e e2e/diag` | `src/stagehand/` 只有 `prompt.ts`+`context.ts`；`src/tools/` 含 9 个工具 + `context.ts`；`src/` 出现 `play/ stage/ style/ voice/`；`e2e/diag/` 含 `css-diag.mjs shot-tabs.mjs shot-voice.mjs b1-probe.sh` | | 待验证 | 与 `.plan.md` 决策总表逐项对照 |
| 2   | 给实例配上真实的生图 / 音乐 / 语音后端（或设 `DSH_AIVN_TTS_KEYS`），跑 `npm run e2e:media` 与 `voice` 套件 | 搬迁后的 `media/`、`voice/` 模块在真实后端下行为与搬迁前一致（出图/出曲/合成取回正常） | | 待验证 | 本次 e2e 实例未配这些后端，故未覆盖；纯移动风险极低 |

## 验证结论

待验证。

## 待跟进

- 第 2 项为残余回归项；若近期不做真实后端联调，可据「纯搬迁 + build/typecheck 全绿」判定风险可接受，
  在合并时一并记录为已知残留。
