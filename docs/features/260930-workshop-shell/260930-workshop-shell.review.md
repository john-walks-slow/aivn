# 检视报告

## 概要

本次检视覆盖分支 `fix/workshop-ux`（基线 `2cb3f2d`）中关于工坊宿主重构的所有改动，包含全站唯一浮层架构、模态遮罩、全局 Esc 浮层栈、Tab 口径调整与样式适配。整体架构设计干净、职责边界清晰，彻底消除了历史上的双重导航割裂、独立全屏定位失效以及死链问题，前端测试与类型检查全部通过。提出 2 项建议修改（含输入法组合输入期间 Esc 误关浮层的交互隐患保护）与 2 项非阻塞优化，结论为**条件准入**。

## 需求对齐

变更完全满足用户拍板的方向与 `260930-workshop-shell.plan.md` 的既定决策：
1. **统一宿主与导航消除**：彻底废除独立路由 `#/play/:id/workshop` 与 `WorkshopScreen.tsx`，由挂载在 `App.tsx` 顶层的 `WorkshopOverlay` 统一托管，消除双重导航和标题栏割裂（满足 D1）。
2. **抽屉与全屏切换**：默认以右侧抽屉滑出，通过 `position: fixed; inset: 0` 修复了此前在舞台内切 full 挤在舞台下方的布局缺陷；小屏（≤460px）媒体查询自动隐藏冗余的模式切换键（满足 D1）。
3. **模态遮罩与点击关闭**：抽屉状态下渲染 `workshop-scrim`（z-index 49），隔离底层可交互性，点击空白直接收起抽屉（满足 D2）。
4. **状态管理收敛**：新增 `useWorkshopOverlay` 模块级 store（`useSyncExternalStore`），与具体页面彻底解耦，路由变更自动收起（满足 D3）。
5. **Tab 口径调整与死链修复**：Tab 顺序规范为「对话 - 素材 - 配置 - 文件」，并顺手将 `TitleView` 中指向已删除路由 `/play/:id/assets` 的死链修复为直达工坊「素材」Tab。
6. **Esc 浮层栈**：落地 `useEscape` / `escapeClaimed`，解决了多浮层共存时 Esc 键级联穿透的缺陷（满足 D4）。
7. **连接唯一收敛**：工坊 WS 通道收敛至 `WorkshopOverlay` 中的 `useWorkshopSocket`，清理了舞台 socket 上的代转旁路（满足 D5）。

## 阻塞问题

无。

## 建议修改

| ID | 位置 | 问题 | 建议 |
| --- | ---- | ---- | ---- |
| SUG-1 | `apps/web/src/ui/escape.ts:11-17` | 全局 Esc 监听未过滤输入法组合输入状态（`e.isComposing` 或 `keyCode === 229`）。在工坊对话框、文件编辑器或重命名输入框中打字时，中文/日文用户按 Esc 撤销输入法候选框时，会被全局栈捕获并误关闭浮层。因浮层卸载导致本地 `input` / 编辑态草稿直接丢失。 | 在 `onKeyDown` 顶部添加 IME 组合输入防护：<br>`if (e.key !== "Escape" \|\| e.isComposing \|\| e.keyCode === 229) return;` |
| SUG-2 | `.worktrees/workshop-ux/AGENTS.md:126` | 模块地图中 `src/workshop/` 段落末尾残留陈旧旧描述：「抽屉的 WS 通道复用 useStageSocket.onWorkshop，全屏页走 useWorkshopSocket 独立连接」，与本次架构重构（工坊抽屉和全屏统一走 `WorkshopOverlay` 中的 `useWorkshopSocket`）直接矛盾。 | 删除该句陈旧说明，保持与当前唯一的 `WorkshopOverlay` 架构及前文描述完全一致。 |

## 非阻塞问题

| ID | 位置 | 问题 | 建议 |
| --- | ---- | ---- | ---- |
| ADV-1 | `apps/web/src/workshop/WorkshopPanel.tsx:54` | `tab` 状态声明为 `useState<WorkshopTab>(initialTab ?? "chat")`，仅在组件挂载时读取一次。若工坊在保持开启状态下接收到外部传递的新 `initialTab`，内部 Tab 不会响应切换。 | 虽然当前有遮罩隔离，但为防后续外部联动场景，可补充 `useEffect(() => { if (initialTab) setTab(initialTab); }, [initialTab])` 或在宿主层对关键 Tab 跳转绑定独立 key。 |
| ADV-2 | `apps/web/src/stage/useStageSocket.ts:5` | `useStageSocket.ts` 中已无任何工坊下行业务逻辑，但仍保留了 `WorkshopInbound` 类型定义与旧注释（「与演出事件共用连接、按 type 分流」），工坊模块反向依赖舞台 socket 模块引入该类型。 | 后续可将 `WorkshopInbound` 类型下沉至 `@stage-ai/core` 或迁移至 `useWorkshopSocket.ts`，并修正注释，彻底解耦舞台 socket 与工坊类型的模块边界。 |

## 准入结论

**结论**：`条件准入`

**说明**：工坊 UX 割裂、双重导航与全屏定位缺陷得到了根本性解决，模块解耦利落，测试与类型检查齐备。建议在合并前补齐输入法 Esc 拦截保护（SUG-1，避免中文打字选词取消时误关抽屉丢失草稿）并修正 AGENTS.md 残留文档说明（SUG-2）。
