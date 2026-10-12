# 261012-workshop-chat-lightbox-and-overflow Summary

## 问题与根因

1. **工坊对话点击图片无反应**：`WorkshopPane.tsx` 在早先重构为 `.workshop-studio` 布局（`cff194cf`）时，保留了 `lightbox` 状态和 `setLightbox` 调用，但遗漏了组件底部的 `<ImageLightbox>` JSX 渲染节点。
2. **手机端并排候选图溢出对话区产生横向滚动**：模型在回复中常使用 3 列 Markdown 表格对比候选立绘（及 36 位长 UUID 草稿 ID）。原先 `.md-image img` 固定 `height: 190px; width: auto`，单列最小内容宽度约 138px，3 列合计约 414px；而 `.md-body table` 为默认 `table-layout: auto`、`.md-body code` 未配置断行、`.workshop-chat` 缺少 `overflow-x: hidden`，导致表格冲破气泡与对话容器产生横向滚动。

## 修复内容

- [`apps/web/src/workshop/WorkshopPane.tsx`](../../../apps/web/src/workshop/WorkshopPane.tsx)：在 `.workshop-studio` 末尾补回 `{lightbox && <ImageLightbox ... />}` 挂载。
- [`apps/web/src/app.css`](../../../apps/web/src/app.css)：
  - `.workshop-chat` 增加 `overflow-x: hidden`，`.chat-bubble`、`.chat-turn`、`.md-body` 增加 `min-width: 0`。
  - `.md-body table` 设为 `table-layout: fixed`，表格内 `.md-image img` 设为 `width: 100%; height: auto; max-height: 190px` 随列宽等比缩放。
  - `.md-body code` 与 `th`/`td` 增加 `overflow-wrap: anywhere` 自动折行长串。
  - 窄屏（`≤720px`）下 `.chat-assistant` 放宽为 `max-width: 100%`，单元格内边距收紧为 `5px 4px`。
