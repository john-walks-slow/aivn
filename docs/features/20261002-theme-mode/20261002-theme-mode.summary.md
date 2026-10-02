# 主题模式实现总结

## 需求
- 为 UI（纸面）和舞台（画面）分别提供亮色、暗色和跟随系统三种模式的支持。
- 在设置页提供独立的开关来切换 UI 和 舞台的主题模式。
- 主题切换应即时生效，无需刷新页面。
- 不得破坏现有的剧目定制主题（theme.css）功能。

## 实现方案

### 1. 主题状态管理
- 使用 `localStorage` 持久化两个独立的偏好：
  - `stage-ai:ui-theme-mode`：界面主题（system / light / dark）
  - `stage-ai:stage-theme-mode`：舞台主题（system / light / dark）
- 默认值为 `system`（跟随系统偏好）。

### 2. 自定义 Hook `useTheme`
- 读取上述两个存储键。
- 结合 `window.matchMedia('(prefers-color-scheme: dark)')` 计算实际使用的亮/暗模式。
- 根据实际模式选择对应的颜色变量集合（UI 和 舞台各自有 light / dark 两套）。
- 通过在 `<html>` 元素上设置属性 `data-ui-theme` 和 `data-stage-theme` 来传递主题状态。
- 监听 `storage` 事件以处理其他标签页的改动。
- 监听系统偏好变化事件。
- 监听自定义事件 `stage-ai:theme-change`（由 SettingsScreen 触发）以实现同标签页即时更新。

### 3. CSS 变量覆盖
- 在 `apps/web/src/app.css` 中添加属性选择器：
  ```css
  html[data-ui-theme="dark"] { /* UI 深色变量 */ }
  html[data-stage-theme="light"] { /* 舞台浅色变量 */ }
  ```
- 这样做可以避免内联样式对 `:root` 的直接覆盖，从而不破坏剧目定制主题（即 `plays/<id>/theme.css` 中的 `:root` 变量仍能正常生效）。
- 舞台浅色模式的调色板经过精心设计，确保对比度和可读性：
  - 选肢卡在浅色模式下使用半透明背景，避免与浅色对话框冲突。
  - 心理独白颜色调整为与浅色背景对比度符合 WCAG AA。
  - 导演栏按钮颜色使用主题变量，避免硬编码导致的白底白字问题。

### 4. 入口点
- 在 `apps/web/src/App.tsx` 中引入并调用 `useTheme()` Hook，使主题系统在整个应用启动时生效。
- 保持原有的剧目主题和工坊主题更新机制不变。

### 5. 设置界面
- 在 `apps/web/src/views/SettingsScreen.tsx` 中添加两个下拉选择框：
  - 界面主题（系统 / 浅色 / 深色）
  - 舞台主题（系统 / 浅色 / 深色）
- 切换时更新对应的 `localStorage` 键，并通过 `dispatchEvent(new Event('stage-ai:theme-change'))` 通知同标签页的 `useTheme` 立即重新应用主题。

## 文件变更
- 新增 `apps/web/src/hooks/useTheme.ts`
- 修改 `apps/web/src/App.tsx`
- 修改 `apps/web/src/views/SettingsScreen.tsx`
- 修改 `apps/web/src/app.css`（追加主题覆盖规则）

## 注意事项
- 现有代码中存在一些无关的 TypeScript 错误（如 `WorkshopMarkdown.tsx`），这些错误在本次修改前就已存在，未因本次改动引入新错误。
- 本实现未改动任何服务端代码，所有状态均保存在前端 `localStorage` 中。
- 主题切换即时生效，无需刷新页面或重启服务。

## 后续工作
- 如需在服务端渲染（SSR）或首次加载时避免闪现，可考虑在 HTML 中内联读取 `localStorage` 的值并预设属性。
- 可以考虑将主题状态同步到 URL 查询参数，以便分享和书签。