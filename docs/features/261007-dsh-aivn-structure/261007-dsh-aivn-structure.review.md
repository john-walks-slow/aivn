# 检视报告

## 概要

本轮检视针对 `dsh-aivn` 插件目录结构重构（方案 1、2、5）的实施变更。重构全面消除了 `stagehand/tools/` 与共享基础设施的职责倒挂，规范收拢了 `src/` 根目录平铺模块至领域子目录（`play/`、`stage/`、`style/`、`voice/`），并将 e2e 诊断脚本收纳至 `e2e/diag/`。整体重构为纯搬迁与引用重定向，未引入任何运行时行为破坏，构建产物 `--check` 严格一致。

## 需求对齐

- **方案 1 共享工具与基础设施归位**：8 个共享工具已全部迁入 `src/tools/`，共享能力类服务 `capabilities.ts`、`exa.ts` 提升至根目录，`voice-catalog.ts` 归入 `voice/`。`src/stagehand/` 仅保留 `prompt.ts` 与 `context.ts`，名实相符，满足需求。
- **方案 2 领域归组**：`src/play/`、`src/stage/`、`src/style/`、`src/voice/` 划分清晰且正交，宿主接线与宿主级服务留在根目录，92 条相对 import 全部平滑更新，满足需求。
- **方案 5 e2e 诊断脚本整理**：4 个诊断脚本迁入 `e2e/diag/`，脚本相对路径与引用已按层级适配，`style-tokens.check.ts` 保持留在夹具根目录，符合规划。
- **方案 3/4 遵从性**：提示词分层与 `media/` 未做多余折腾，无过度设计与计划偏离。

## 阻塞问题

无。

## 建议修改

| ID | 位置 | 问题 | 建议 |
| --- | ---- | ---- | ---- |
| S1 | `src/client/stage-view.tsx:433` | 注释中仍引用裸文件名 `（见 director.ts）`，与同一文件第 15 行更新的完整路径 `src/stage/stage-log.ts` 风格不一致，跨模块检索易产生认知割裂。 | 建议统一更新为 `（见 src/stage/director.ts）`。 |
| S2 | `src/media/image.ts:6` | 注释中提及 `与 tts.ts / exa.ts 同一口径`，但 `tts.ts` 已搬迁至 `voice/tts.ts`，保持旧文件名不利于新阅读者寻道。 | 建议更新为 `与 voice/tts.ts / exa.ts 同一口径`。 |
| S3 | `src/media/web-image.ts:12` | 注释更新了 `stagehand/exa.ts → exa.ts`，但前项 `tts.ts` 仍未带上 `voice/` 前缀（`与 tts.ts / exa.ts 同理`）。 | 建议同步更新为 `与 voice/tts.ts / exa.ts 同理`。 |
| S4 | `AGENTS.md:43,47` | 正文说明中仍存在裸文件名引用（行 43 `stage-tap.ts 的 openPlay`、行 47 `play-context.ts 的 aivn:play-endings 段`），与前文结构表的子目录路径略有脱节。 | 建议带上对应目录前缀 `src/stage/stage-tap.ts` 与 `src/play/play-context.ts`。 |
| S5 | `src/session.ts:5,33,76` 及 `src/preset-tools.ts:7` | 根目录接线文件的核心导读注释中仍有对已搬迁文件的裸引用（如 `stage-tap.ts`、`director.ts`、`play-files.ts`）。 | 虽未违反计划中「保活裸文件名引用」的最低要求，但建议在有跨目录跳转语义时顺手带上子目录名（如 `play/play-files.ts`、`stage/director.ts`）。 |

## 非阻塞问题

| ID | 位置 | 问题 | 建议 |
| --- | ---- | ---- | ---- |
| N1 | `.gitignore` | 新增了 `/endings.json` 规则，有效防止 e2e 以仓库根为剧目时残留数据污染版本库，改动规范整洁。 | 备忘：确认在合并时该项同提交入库。 |
| N2 | 暂存区分割状态 | 当前 `git status` 下重命名在暂存区（Index），文件内改写与文档改动在工作区未暂存。 | 提交时建议通过 `git add -A` 或针对性 staging 合并为同一笔提交，以保持原子性与 `--check` 的绿态。 |

## 准入结论

**结论**：`条件准入`

**说明**：代码架构重构干净彻底，依赖与路径完全自洽，构建产物逐字节核对无差异，无任何阻塞性缺陷；仅存若干注释内的历史路径细微遗漏，建议在合并入库前顺手同步修正。
