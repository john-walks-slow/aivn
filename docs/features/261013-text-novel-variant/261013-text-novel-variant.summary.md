# 纯文本 / 文本为主的互动小说主题变体（`novel` / `nvl`）实施总结

## 一、背景与目标

在现有 6 档 ADV 单句对话框主题（`atri` / `card` / `cinema` / `hud` / `scroll` / `velvet`）之上，调研并落地两套面向「纯文本 / 文本为主互动小说」的主题变体：
1. **`novel`（书页流 · 互动小说）**：居中纵向实体书页（深色夜读炭黑纸 / 浅色暖棉纸），同场连续段落累积，四种句型（旁白缩进、台词左栏悬挂名牌、内心独白斜体、玩家输入 `▸` 左轨标记）纯靠排印区分，停止点选项紧随文末展开；无图剧目即开即玩，有图剧目自动将背景模糊为书页外围暗景并在页顶内嵌窄幅场景画框（Scene Plate）。配套开始菜单为 **M6 书籍扉页**（双开精装书页 + 章节目录）。
2. **`nvl`（音响小说 · 全屏叠字）**：背景与立绘全屏在场，左浓右淡渐变纱保证文字对比度，同场已读段落半透明退后、当前句高亮，换景自动翻页，停止点选肢在页末横向渐隐带展开。配套开始菜单为 **M7 序章全屏**。
3. **纯文字剧目配置与工坊 Agent 协同**：为 `craft.assets.background` 补齐 `"off"`（不用背景图），并更新工坊提示词与 `galgame-ui-style` / `galgame-play-setup` 技能，使用户在工坊对话中提出「我想要纯文字的」时，工坊 Agent 能直接写入 `theme.css`（`--play-style: novel`）并将 `play.json` 的 `craft.assets` 设为 `{"background": "off", "cg": "off", "sprite": "off"}`。

## 二、主要改动

| 模块 / 文件 | 改动摘要 |
| --- | --- |
| `packages/core/src/play/config.ts` | `CRAFT_BACKGROUND_SOURCES` 新增 `"off"` |
| `packages/agent/src/craft/params.ts` | `BACKGROUND_LABEL` 与 `backgroundDirective` 新增 `"off"` 分支 |
| `packages/stage/src/playbackState.ts` | 新增 `buildPageView()` 纯函数与 `PageEntry` / `PageView` 类型，按场景换底（`<scene bg>` / `clear`）与 `<title>` 自动分页，聚合同场连续段落 |
| `packages/stage/src/director.ts` & `index.ts` | `usePlayback` 计算并返回 `page: PageView` |
| `packages/stage/src/StageTheater.tsx` | 新增 `useDialogStyle` 监听 `html[data-dialog-style]`，`novel` / `nvl` 下渲染 `.dialog-page-head`、`.dialog-scene-plate`、`.dialog-page-flow` 及页内选肢 |
| `packages/stage/src/stage.css` | 新增 `html[data-dialog-style="novel"]` 与 `html[data-dialog-style="nvl"]`（含深浅模式与 `≤720px` 窄屏规则） |
| `apps/web/src/ui/playTheme.ts` | `PlayStyleId` 与 `PLAY_STYLES` 新增 `"novel"` 与 `"nvl"` |
| `apps/web/src/app.css` | 新增 `html[data-menu-style="novel"]` 与 `html[data-menu-style="nvl"]`（含深浅模式与 `≤760px` 窄屏规则） |
| `apps/web/src/workshop/PlayPane.tsx` & `api.ts` & `TitleView.tsx` | 背景来源下拉增加「不用背景图」；`readinessAdvice` 在 `sprite: "off"` / `background: "off"` 时不再提示缺立绘/背景图 |
| `apps/server/src/workshop.ts` & `apps/server/skills/**` | 工坊提示词、`galgame-ui-style`、`galgame-play-setup` 补充 `novel` / `nvl` 与纯文字剧目的一键配置指引 |
| `docs/features/261013-text-novel-variant/` | 外部调研报告、计划文档、原型（`showcase.html` / `title-showcase.html` / `render.mjs` / `verify-prod-css.mjs`）及对照截图 |

## 三、验证结果

- 类型检查：`pnpm typecheck` 全部通过。
- 契约守卫：`pnpm check:agent-contract` 全部 9 项检查通过。
- 单元测试：
  - `pnpm --filter @aivn/core test test/config.test.ts`（16 passed）
  - `pnpm --filter @aivn/stage test src/playbackState.test.ts`（9 passed）
  - `pnpm --filter @aivn/agent test test/readiness.test.ts`（10 passed）
  - `pnpm --filter @aivn/server test test/workshop.test.ts`（49 passed）
  - `pnpm --filter @aivn/web test test/playThemeCss.test.ts`（7 passed）
- 视觉与响应式验证：`node docs/features/261013-text-novel-variant/verify-prod-css.mjs` 实测 1280×720（深/浅）与 390×844（窄屏）零横向溢出。
