# 261006-aivn-image-parity 端到端测试报告

## 测试环境
- **被测项目**：dsh-aivn（`/root/projects/dsh-aivn`，master 分支工作区改动）
- **依赖底层**：`@aivn/stage`（`/root/projects/stage-ai/.worktrees/dsh-vn-stage/packages/stage`）
- **测试框架与工具**：`dsh-e2e`（端口动态分配，worktree 最小组合实例）、Vitest、Esbuild + Node.js 离线套件
- **测试运行模式**：全套件通过 `dsh-e2e start --wait-ready` 拉起实例，离线单测与 E2E 结合

## 功能类测试项

| # | 测试步骤 | 预期 | 实际 | 状态 | 证据 |
|---|----------|------|------|------|------|
| 1 | 运行 `npm run e2e:media` | 41 条离线素材与生图/守卫/SSRF断言全绿 | 41/41 条断言全部通过（含景别措辞、编号锚点、自动补 neutral、同名跳过、play.json 覆盖、URL SSRF 拒答及抠底回归） | 通过 | `e2e/verify-media.ts` (41/41 Pass) |
| 2 | 运行 `dsh-e2e run e2e/run.mjs injection` | 校验 A 区 6 段+【状态】注入，`list_assets` 不在工具面 | 16/16 条断言全部通过：`validate_play` / `beat_done` 存在，工具面无 `list_assets` 或旧名 `list_library` | 通过 | `e2e/verify-injection.mjs` (16/16 Pass) |
| 3 | 运行 `dsh-e2e run e2e/run.mjs stagehand` | 校验搭台助手工具面与随包技能库 | 25/25 条断言全部通过（`verify-stagehand` 21条 + `verify-handmade-play` 4条）：`set_stage_style`/`validate_play` 在，`list_assets`/`create_play` 不在；`galgame-audio`/`galgame-visual-craft` 在技能清单 | 通过 | `e2e/verify-stagehand.mjs` & `e2e/verify-handmade-play.mjs` |
| 4 | 运行 `dsh-e2e run e2e/run.mjs stage` | 校验舞台 tab 挂载、逐字上屏、选项沉淀与二轮推进 | 19/19 条断言全部通过（`verify-stage` 14条 + `verify-opening` 5条）：舞台无报错挂载，台词逐字流式打字，选择选项后时间线沉淀，剧作家写完第二轮 | 通过 | `e2e/verify-stage.mjs` & `e2e/verify-opening.mjs` |
| 5 | 运行 `dsh-e2e run e2e/run.mjs style` | 校验皮肤白名单/读闸离线对表 + 真舞台皮肤生效 | 25/25 条断言全部通过：12条离线白名单与容错校验，13条端到端舞台 CSS 变量与主客体渲染动态绑定 | 通过 | `e2e/verify-style.mjs` (25/25 Pass) |
| 6 | 检查 `@aivn/stage` 舞台层新行为 (`<scene clear/>` 清台与立绘层级 `orderSeq`) | 包内离线单测 35 条全绿 + 端到端舞台正常加载运行 | 离线 35 条 Vitest 覆盖了入场次序、重新入场 orderSeq 递增、说话中置顶以及 `<scene clear/>` 触发舞台 sprites 清空；端到端 `verify-stage` 舞台加载与渲染无报错 | 通过 | `/root/projects/stage-ai/.worktrees/dsh-vn-stage/packages/stage/src/actorCue.test.ts` (35/35 Pass) |

## 体验类测试项

| # | 体验场景 | 关注点 | 观察 | 建议/问题 |
|---|----------|--------|------|-----------|
| 1 | 剧作家在真实演出里想补素材时的交互体验 | 工具面变化、A 区素材信息利用、同名跳过守卫 | 1. 剧作家提示词与工具面中已无 `list_assets` 工具，AI 直接使用 A 区动态注入的《素材清单》与《角色表》进行已知素材查询与引用。<br>2. 尝试生成已有同名素材时，`generate_image` 触发 guard 守卫拦截并直接返回跳过通知与 Stage DSL 引用示例（如 `<scene bg="...">` / `<actor id="..." variant="...">`），无需等待 70-140 秒且防止静默覆盖旧图。 | 体验流畅，跳过守卫能极大地降低重复生图成本并提供准确的引用建议。 |

## 证据图

![舞台交互与台词渲染](/root/projects/dsh-aivn/e2e-artifacts/stage-dialogue.png)

![剧作家舞台挂载与渲染](/root/projects/dsh-aivn/e2e-artifacts/stage.png)

## 结论
- 功能：通过 6 项（含 41 条离线素材套件 + 16 条 injection + 25 条 stagehand + 19 条 stage + 25 条 style + 35 条 stage 包单测）· 不通过 0 · 受阻 0
- 体验：1 项观察，关键问题 0
- 总体：**通过**

## 待跟进
无（本次改动所有功能与体验测试项全量通过）。
