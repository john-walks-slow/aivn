# 检视报告

## 概要

本次检视覆盖 `feat/sprite-entity` 分支（需求「立绘即素材：角色卡与立绘解绑」）在 packages/core、apps/server、apps/web 及数据迁移脚本上的全部改动及阻塞项复验。整体架构设计极其清晰，立绘彻底解耦为独立资产，舞台落位由 core 的纯 CSS 变量预设表驱动，解耦和回落链路均已闭环。

## 需求对齐

完整满足计划书（`261004-sprite-entity.plan.md`）与架构约定：
- **命名恒等与解耦**：立绘目录名即 `spriteId`，文件名 stem 即 `variant`，废弃中间映射表；角色卡瘦身为仅承载人设与音色。
- **呈现三轴预设**：`framing × stature × shot` 及 `anchor` 预设表收敛于 `packages/core`，缺省数值与旧 CSS 像素级一致，媒体查询在 CSS 变量层面切换。
- **名字回落链闭环**：卡 `name` → `<say name>` → 素材表 `title`（通过 `spriteTitlesOf` 合并进 WS `cast` 与编排器 `names` 字典）→ `id`；无卡主体 TTS 走剧目级 `defaultVoiceId`。
- **参考垫图完备**：工坊生图 `neutral` 定妆照支持垫图，且垫图候选覆盖全部立绘主体（含无卡主体）。

## 阻塞问题

无（原 2 处阻塞问题均已完成修复与测试验证）。

| ID  | 位置 | 问题 | 修复状态 |
| --- | ---- | ---- | -------- |
| BLK-01 | `apps/server/src/http.ts:503-519` | `PUT /api/plays/:id/assets/sprite` 路由内部 `pick` 函数使用 `as never` 返回 `void` 未抛异常，入参非法时不中断流程引发 `ERR_HTTP_HEADERS_SENT`。 | **已修复**：`pick` 改为抛出异常，由外层 catch 统一返回 400；`http.test.ts` 新增用例验证非法参数时 400 且不写盘。 |
| BLK-02 | `apps/server/src/playhouse.ts:1247`、`apps/server/src/orchestrator.ts:1481` | `cast` 与 `rebuildBeats.names` 未合并素材表中的无卡主体 `title`，导致舞台演出与历史重构中无卡主体退化显示裸 id。 | **已修复**：core 导出 `spriteTitlesOf`，`playhouse` 在 `createRuntime` 时将 `spriteTitles` 补入 `cast` 并下发 WS `hello`，`orchestrator` 的 `rebuildBeats` 亦补入 `spriteTitles` 打底。 |

## 建议修改

| ID  | 位置 | 问题 | 处理结论 |
| --- | ---- | ---- | -------- |
| SUG-01 | `apps/web/src/workshop/ImageGenDialog.tsx` | 立绘生成定妆照时缺少参考图选择器。 | **已优化**：引入 `canPickRefs`，在生成 `neutral` 定妆照时开放 `RefCharacterPicker`。 |
| SUG-02 | `apps/web/src/workshop/AssetsPanel.tsx`、`StageTheater.tsx` | 垫图候选列表仅读 `detail.cast`，无卡主体无法被点选为 CG 垫图参考。 | **已优化**：`AssetIndex.spriteIds` 与 `AssetsPanel` 均改为按实际立绘目录提取候选，名称回落到 `title`。 |
| SUG-03 | `apps/server/src/agentkit/imageTool.ts` | 工具入参未保留旧别名字段。 | **维持现状（合理解释）**：工具 schema 为模型契约，避免别名诱导大模型输出旧参数；旧名兼容仅保留于 DSL 解析与谱系重放。 |

## 非阻塞问题

| ID  | 位置 | 问题 | 处理结论 |
| --- | ---- | ---- | -------- |
| ADV-01 | `scripts/migrate-sprite-declarations.mjs` | 旧卡无有效机器字段时迁移会留下空 frontmatter。 | **已优化**：无机器字段时不再输出空栅栏。 |
| ADV-02 | `apps/web/src/workshop/AssetsPanel.tsx` | 新建立绘弹窗未带 `title` 输入框。 | **维持现状（合理解释）**：名牌在卡片上录入即可，保持弹窗交互克制。 |

## 准入结论

**结论**：`准入`

**说明**：2 项阻塞问题已彻底修复且均有测试护航；建议项中体验相关问题已补齐，契约相关项保持严格设计亦属合理；同批次对 `assetRef` 回落链的增强逻辑严密，无次生问题。整套改动满足准入要求，可以合并。
