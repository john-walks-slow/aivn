# 检视报告

## 概要

本次检视覆盖 `packages/core`、`apps/server`、`apps/web`、`scripts/`、`plays/demo` 与相关文档（共 42 个文件变更）。整体架构清晰、职责分明：成功将角色从记忆层剥离为顶层 `characters/` 目录，主角升格为固定 id `protagonist` 的普通角色卡，工坊平稳拆分为「剧目」与「记忆」两个页签，全仓对旧路径与旧字段的收敛极其彻底，整体质量上乘。

## 需求对齐

本次变更完全满足需求计划中的三项核心目标：
1. **角色卡顶层化**：角色卡从 `memory/always/characters/` 迁至剧目顶层 `characters/`，`PlayFiles`、`PlayStore`、`PlayMemory` 等服务层读写白名单与扫描目录全面适配；`play.json` 的 `protagonist` 字段彻底移除，`characters` 降级为只读元数据。
2. **工坊页签重划**：原「设定与记忆」成功拆分为「剧目」（`PlayPane`，专司 `play.json`）与「记忆」（`MemoryPane`，仅管 `memory/**`），页签顺序在 `stage/view.ts` 与 `WorkshopPane.tsx` 中严格按「对话 / 剧目 / 角色 / 记忆 / 素材 / 文件 / Agent / 设置」对齐。
3. **主角升格为普通角色卡**：主角固定 id 为 `protagonist`，路径为 `characters/protagonist.md`，与普通角色卡共享 `CharacterEditor`，具备立绘、音色、从资源库导入与上台全部能力；工坊角色页禁止删除；A 区角色表增加「玩家扮演」标注，契约规则补充同权说明；润色逻辑改读主角卡；样例剧目 `plays/demo` 完成新结构适配并提供了一次性迁移脚本 `scripts/migrate-play-layout.mjs`。

与计划差异：
- 计划文档第 135 行规划新增的 `apps/web/test/playPane.test.tsx` 遗漏，拆分后的 `PlayPane` 尚无独立前端测试覆盖。

## 阻塞问题

无。

## 建议修改

| ID | 位置 | 问题 | 建议 |
| -- | ---- | ---- | ---- |
| S1 | `apps/web/src/workshop/CharacterPane.tsx:124` | **角色页对主角卡缺失（老剧目未迁/误删空卡）缺乏前端兜底**：若剧目未包含 `characters/protagonist.md`（如老剧目未跑迁移脚本或主角卡内容全空被跳过），`detail.cast` 不含主角，`activeRole` 会降级为普通角色。此时卡片列表里完全无主角卡入口，且「新建角色」只递增 `charN`，导致用户在角色页无法查看、编辑或通过资源库导入恢复主角卡。 | 在 `rolesOf(detail)` 或 `roles` 初始化时做安全兜底：若 `roles` 中未检索到 `isProtagonist` 角色，自动在首位注入一张初始占位主角卡 `{ id: PROTAGONIST_ID, name: "你", body: "" }`。保证主角卡恒驻角色页，用户随时可编辑并保存落盘。 |
| S2 | `apps/web/test/` | **缺少新组件 `PlayPane` 的单元测试**：计划文档第 135 行明确规划新增 `playPane.test.tsx`，但实际改动中仅新增了 `memoryPaneCards.test.tsx`，缺少对新拆出的「剧目」页组件的自动化测试保护。 | 新增 `apps/web/test/playPane.test.tsx`，验证剧目表单渲染、封面拾取/清除、无名角色音色清空以及保存触发 `api.savePlay`。 |

## 非阻塞问题

| ID | 位置 | 问题 | 建议 |
| -- | ---- | ---- | ---- |
| N1 | `README.md:422-432` | **README 工坊页签表行顺序与实现微小出入**：表格中行顺序为「对话、剧目、角色、素材、文件、记忆、Agent、设置」，而代码实现 `TABS` 与计划为「对话、剧目、角色、记忆、素材、文件、Agent、设置」。 | 调整 README 中表格行顺序，将「记忆」移到「素材」之前，保持与 UI 实际展示顺序一致。 |
| N2 | `apps/web/src/workshop/MemoryPane.tsx:188` | **`FileEditor` 的 `useEffect` 依赖继承自旧代码的历史坏味道**：`useEffect(() => setOriginal(value), [path, value])` 在 `value` 改变时会重置 `original`，可能影响输入时的 dirty 判定（注：该逻辑系直接从原 `SettingsPane` 迁移复制）。 | 后续迭代可重构 `FileEditor`，将 `original` 的刷新限制在路径切换或保存成功后。 |

## 准入结论

**结论**：`条件准入`

**说明**：核心架构分层与业务需求对齐完整，底层收敛与数据流迁移严谨，现有测试全绿。建议在合并或后续工作中补齐主角卡前端空态兜底与 `PlayPane` 单元测试。
