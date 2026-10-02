# 检视报告

## 概要

本次检视覆盖 UI 与舞台亮暗主题支持的实现，包括自定义 Hook `apps/web/src/hooks/useTheme.ts`、路由顶层接入 `apps/web/src/App.tsx`、设置界面 `apps/web/src/views/SettingsScreen.tsx`，并深入评估其与现有样式体系 `app.css` 及剧目专属主题换皮机制 `theme.ts` 的协同表现。整体实现架构尝试解耦 UI（纸面）与舞台（画面）的独立亮暗模式配置，意图明确；但在实现层面存在破坏剧目换皮层叠契约、当前页面切换主题无响应与陈旧闭包缺陷、舞台浅色模式调色板严重半成品导致独白文字不可见且功能按钮隐形等多项严重问题。

## 需求对齐

需求要求为 UI（纸面）与舞台（画面）分别提供亮色 / 暗色 / 跟随系统的独立配置支持，并在设置页提供可切换项与即时生效体验。当前实现与需求的差异与缺陷如下：

1. **即时交互响应缺失**：在设置页切换主题下拉菜单后，当前页面完全不刷新样式，必须手动强制刷新浏览器后才能看到效果，违反了设置项应即时生效的交互要求。
2. **跨页面同步存在陈旧闭包陷阱**：`useTheme` 在 mount 时捕获了常量配置，即使收到 `storage` 事件，执行重算时使用的依然是初始化时的陈旧值，跨标签页同步同样失效。
3. **剧目换皮契约被破坏**：直接向 `document.documentElement.style` 写入内联样式，导致原有 `plays/<id>/theme.css` 的设计令牌覆盖规则完全失效，破坏了 AVG 引擎定制剧目皮肤的核心架构契约。
4. **舞台浅色模式半成品**：选肢卡、浮层按钮 hover 态、旁白独白对比度未做完整适配，出现白底白字与黑白混搭的视觉崩溃。

## 阻塞问题

| ID  | 位置 | 问题 | 建议 |
| --- | ---- | ---- | ---- |
| BLK-01 | `apps/web/src/hooks/useTheme.ts:95-100` | **内联样式注入击穿剧目定制主题换皮契约**：`applyThemeVariables` 使用 `document.documentElement.style.setProperty` 直接在 `<html>` 标签上注入内联样式。根据 CSS 层叠优先级规则，内联声明的权重高于外部样式表（`<link data-play-theme>`）。这导致 `theme.ts` 中挂载的剧目专属主题（`plays/<id>/theme.css`）中覆盖的 `:root` 变量全部失效，彻底破坏了 AVG 换皮与剧目自定义样式的核心能力。 | 改用属性选择器或受控 `<style>` 标签承载变量：在 `document.documentElement` 上设置 `data-ui-theme="light\|dark"` 和 `data-stage-theme="light\|dark"`，将主题变量规则下沉至 CSS 属性选择器；或者动态维护一个层叠顺序先于 `<link data-play-theme>` 的 `<style id="theme-tokens">`，确保剧目自定义 CSS 能正常覆盖。 |
| BLK-02 | `apps/web/src/hooks/useTheme.ts:125-168`<br>`apps/web/src/views/SettingsScreen.tsx:340-366` | **当前窗口切换主题无响应与跨标签页陈旧闭包陷阱**：<br>1. 状态通信仅依赖 `window.addEventListener("storage", ...)`。依 HTML5 规范，`storage` 事件**仅派发至其他标签页/窗口**，当前页面写入 `localStorage` 时绝不会触发。因此用户在当前设置页切换下拉菜单后，页面样式毫无变化，必须手动重刷整页；<br>2. `useTheme` 在 `useEffect` 挂载时通过 `const uiMode = getStoredMode(...)` 声明常量，`applyTheme` 闭包直接引用了该常量。当收到外部事件触发重算时，获取的依然是初次渲染时的旧值，导致跨标签页同步同样失效。 | 建立响应式主题状态管理与通知机制（例如导出统一的 `useTheme` / `themeStore`，在写入时通过 `CustomEvent` 或内部订阅者广播）；在 `applyTheme` 中实时动态读取最新的存储模式，彻底消除陈旧闭包。 |
| BLK-03 | `apps/web/src/hooks/useTheme.ts:41-60`<br>`apps/web/src/app.css:3823-3826, 3923-3959` | **舞台浅色模式视觉崩溃、文字不可读与按钮白底白字隐形**：<br>1. `stageLight` 中 `--dialog-ink-thought` 为浅紫 `#a9a6c4`，在浅色对话框背景 `#fafafa` 上对比度仅约 2.27:1（严重违反 WCAG AA 4.5:1 基准），内心独白完全无法辨认；<br>2. `--choice-bg`、`--choice-line`、`--choice-ink`、`--choice-scrim` 逐字复制自深色模式，导致浅色对话框上浮着纯黑玻璃选肢卡，视觉严重脱节；<br>3. `app.css` 中导演栏按钮 `.dir-btn`（默认 `color: rgb(242 235 222 / 0.72)`、hover 态 `#fff`）及 `.side-drawer-btn:hover` 硬编码为白米色，在浅色背景下直接呈现白底白字，功能按钮彻底消失隐形。 | 完整设计 `stageLight` 调色板：为选肢卡提供浅色半透明玻璃与高对比度文字；调整独白与旁白颜色确保可读性；在 `app.css` 中将 `.dir-btn`、`.side-drawer-btn` 等舞台浮层按钮的前景色与悬浮态全面抽象为主题变量（如 `var(--dialog-ink)` 或专有 token），消除硬编码的白色/米色。 |

## 建议修改

| ID  | 位置 | 问题 | 建议 |
| --- | ---- | ---- | ---- |
| SUG-01 | `apps/web/src/views/SettingsScreen.tsx:22-31, 60-78`<br>`apps/web/src/hooks/useTheme.ts:3-5, 105-116` | **主题配置 Key 与存取逻辑碎片化，缺乏单一真相源**：SettingsScreen 中硬编码了 `"stage-ai:ui-theme-mode"` 与 `"stage-ai:stage-theme-mode"` 等魔法字符串，并手写了对 localStorage 的读取和 `storage` 事件监听，而 `useTheme.ts` 内部也维护了一套私有常量与辅助函数，两者严重割裂，缺乏单一真相源。 | 在主题模块中收敛所有 Key 与存取逻辑，对外暴露强类型 API（如 `getStoredThemeMode`、`setStoredThemeMode`、`useThemeMode`），由 SettingsScreen 与 App 统一调用，消除魔法字符串与重复实现。 |
| SUG-02 | `apps/web/src/hooks/useTheme.ts:26-38` | **UI 深色配色调性背离项目 AVG 和纸墨色美学**：`uiDark` 采用了通用的冷黑灰（`#121212`、`#1e1e1e`）、荧光珊瑚红（`#ff6b6b`）与亮青色（`#6ecff6`），且将 `--accent-ink` 设为纯黑 `#000000`。这与项目原本基于和纸（`#f5f1e8`）、温润墨色（`#23201c`）、传统臙脂（Crimson `#9b3b4f`）建立的日式视觉小说美学严重脱节，且黑色按钮文字在主按钮红底上显得突兀沉重。 | 参照项目既有设计规范，深色调色板应采用温润的炭灰、深墨（`#1a1816`）及暗绯色（深茜），主按钮文字维持浅色墨（`#fff7f3`），保持全站视觉语言的一致性与雅致感。 |
| SUG-03 | `apps/web/src/App.tsx:35`<br>`apps/web/src/hooks/useTheme.ts:124` | **客户端异步执行导致首屏亮暗模式闪烁 (FOUC)**：`useTheme` 完全在 `App` 组件的 `useEffect` 中异步执行。当用户设置为暗色模式时，首屏加载阶段会先以 `app.css` 默认的浅色 `:root` 渲染，待 React 挂载并执行 effect 后才突变切换为暗色，导致明显的白屏刺眼闪烁。 | 在 `index.html` 的 `<head>` 中嵌入微量内嵌脚本，在首屏 DOM 渲染前提前读取 localStorage 并在 `<html>` 标签上打上对应的主题属性标记；或改用优先的类名/属性选择器，消除首屏闪烁。 |
| SUG-04 | `apps/web/src/hooks/useTheme.ts:107` | **类型安全缺失与重复字面量定义**：读取存储模式时使用了 `return val as any;`，且 `"system" \| "light" \| "dark"` 联合类型在多处硬编码。 | 提取并导出类型别名 `export type ThemeMode = "system" \| "light" \| "dark";`，编写标准的类型守卫函数 `isThemeMode(val: unknown): val is ThemeMode`，消除 `any` 断言。 |

## 非阻塞问题

| ID  | 位置 | 问题 | 建议 |
| --- | ---- | ---- | ---- |
| NBL-01 | `apps/web/src/views/SettingsScreen.tsx:94-102, 337-378` | **设置界面信息架构混淆（本地偏好 vs 服务端环境变量）**：设置页整体属于服务端配置（顶部提示“改动写回服务端 .env，重启服务端后生效”，底栏为“保存设置”与“放弃改动”绑定服务端 API）。主题设置纯属浏览器本地偏好，插入在服务端表单中间且夹在 Exa 配置与底栏保存按钮之间，易误导用户认为主题也需要“保存设置”甚至“重启服务”才能生效，且点击“放弃改动”并不能回退已改的主题。 | 在视觉结构上将主题设置与服务端配置分块，或在组标题旁注明“本地偏好，即时生效”，与服务端环境变量保存机制清晰区分。 |

## 准入结论

**结论**：`不准入`

**说明**：当前实现存在 3 项严重阻塞性问题：直接向 `:root` 注入内联样式破坏了剧目自定义 theme.css 的层叠换皮契约、设置页切换主题在当前窗口完全无响应且跨标签页存在陈旧闭包陷阱、舞台浅色模式调色板严重缺陷导致独白不可读且导演栏/抽屉按钮白底白字隐形。须修复上述阻塞问题并按建议重构后重新提交检视。
