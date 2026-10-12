# 261012 Pending Indicator 折叠态重构

## 需求背景与目标

Pending indicator 折叠态此前包含较长中文摘要文字（如「剧作家创作中…」）与呼吸圆点，在台词条底缘与工坊底栏视觉负担较重。
本次重构将折叠态彻底精简：
- **不再有字和光点**，收起态只包含浅图标和指示符；
- **spinner 代表文本生成**；
- 文本就绪后 **spinner 变身跳动光标**（代表下一句可用）；
- 其他生成类别展示为**闪烁浅图标**（麦克风/音乐/图片/人像等）➕ **右上角小数字代表队列长度**；
- 保持点击展开/收起的完整交互与队列详情面板。

## 关键改动

1. **`apps/web/src/stage/PromptQueuePanel.tsx`**：
   - 彻底移除收起态里的 `.prompt-queue-text` 与 `.status-indicator-dot`；
   - 聚合除文本生成外其他类别：`voice`（麦克风 `mic`）、`bgm`（音乐 `volume`）、`bg`/`cg`（图片 `assets`）、`sprite`（人像 `users`）、`waitingPrompt`（待注入提示 `chat`）；
   - 新增 `summarizeCategories`：统计活跃类别的队列任务数；
   - 支持 `nextReady` 与 `live` 状态传递：
     - 文本生成中（`live || beat running`）：展示微型旋转 `.dialog-spinner`；
     - 下一句可用（`nextReady`）：spinner 切换为跳动光标 `.prompt-queue-cursor`；
   - 保留点击展开完整面板及管理功能。

2. **`apps/web/src/views/StageScreen.tsx`**：
   - 收集 `playback.current`、`shownLength` 与 `exhausted` 计算 `isLineDone` 与 `isNextReady`；
   - 传递 `nextReady={variant === "dialog" ? isNextReady : false}` 与 `live` 进 `PromptQueuePanel`。

3. **`packages/stage/src/StageTheater.tsx`**：
   - 当 `dialogStatus` 存在时，跳动光标统一由折叠态接管，仅在 `!dialogStatus` 时回退渲染原生 `dialog-next`（`▼`），杜绝双光标并列。

4. **`apps/web/src/app.css`**：
   - `.prompt-queue-badge` 改为现代精致浅图标容器（透明/微浅底、圆角胶囊）；
   - `.prompt-queue-cursor` 纯 CSS 实现跳动指示光标，伴随 `queue-cursor-bob` 动画；
   - `.prompt-queue-cat`、`.prompt-queue-cat-icon`（`queue-icon-blink` 呼吸闪烁）与 `.prompt-queue-cat-badge`（右上角角标小数字）。

5. **验证与测试**：
   - `apps/web/test/pendingPanel.test.tsx` 更新断言并补充文本生成 spinner、下一句可用光标、多类别闪烁图标及队列长度角标等用例（全部 25 项测试通过）；
   - Playwright Chromium 真实渲染实拍截图：`docs/features/261012-pending-indicator-collapse/pending-indicator-showcase.png`。
