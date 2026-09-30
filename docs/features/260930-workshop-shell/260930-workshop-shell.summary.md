# 工坊宿主重构（260930-workshop-shell）

分支 `fix/workshop-ux`（worktree `.worktrees/workshop-ux`，基线 `2cb3f2d`）。计划见 `260930-workshop-shell.plan.md`，检视见 `260930-workshop-shell.review.md`，验证见 `260930-workshop-shell.validation.md`。

## 做了什么

**工坊不再是页面，是全站唯一一个浮层。** 任何入口（Title 的「工坊」/「素材与配置」、舞台顶栏 STUDIO）打开的都是同一个抽屉；顶栏「展开」就地铺满视口，「收起/关闭」回原页面。独立路由 `#/play/:id/workshop` 与 `WorkshopScreen` 整套删除，双重导航（screen-bar「← 标题」+ workshop-bar）随之消失。

| 位置 | 变更 |
| --- | --- |
| `workshop/useWorkshopOverlay.ts`（新） | 模块级 store（`useSyncExternalStore`）：`openWorkshop` / `closeWorkshop` / `setWorkshopMode` / `toggleWorkshop`。形态 `drawer \| full`、tab `chat \| assets \| craft \| files` 都在这里 |
| `workshop/WorkshopOverlay.tsx`（新） | App 级浮层宿主，**全站唯一建工坊 WS 的地方**（`useWorkshopSocket`，`?workshop=1`）；drawer 时渲染遮罩 |
| `ui/escape.ts`（新） | Esc 浮层栈：挂载顺序即层级顺序，栈顶独占 Esc；`escapeClaimed()` 让非浮层的 window 监听让位 |
| `App.tsx` | 删 workshop 路由；screen 改单选，末尾按浮层状态渲染 overlay；换路由即收起 |
| `views/StageScreen.tsx` | 删本地 workshop state / `onWorkshop` 接线 / `<WorkshopPanel>` 渲染；只读 store + `toggleWorkshop` |
| `views/TitleView.tsx` | 三个入口改 `openWorkshop`；就绪门里指向**已删除路由** `/play/:id/assets` 的死链改为开在「素材」页 |
| `stage/useStageSocket.ts` | 删 `onWorkshop` 代转通道与 `workshop_*` 外发 |
| `app.css` | `.workshop` z-index 40→50；新增 `.workshop-scrim`；`.workshop-full` 改 `position:fixed; inset:0`（修「舞台里切 full 挤在舞台下方」） |
| 4 个浮层 | `VoiceLibrary` / `LibraryBrowser` / 两个 `ImageLightbox` 的 Esc 改走 `useEscape` |
| 文档 | `AGENTS.md` 地图行（删 WorkshopScreen、补 `ui/escape.ts` 与新宿主）、README 工坊章节（入口/四页/Esc 分层） |

`WorkshopInbound` 类型从 `stage/useStageSocket.ts` 移到 `workshop/useWorkshopSocket.ts`——工坊的类型不再寄居在舞台连接里。

## 检视与返工

`review.md` 结论**条件准入**，两条建议都已处理：

- **SUG-1** Esc 未过滤输入法组字（`isComposing` / `keyCode === 229`）——中文选词按 Esc 会误关抽屉、丢草稿。已加。
- **SUG-2** `AGENTS.md` 残留旧 WS 描述——写文档时已顺手清掉。
- 非阻塞项 `ADV-1`（`initialTab` 与内部 tab 状态不同步）**不处理**：唯一能让它成真的路径是「浮层已开着又从页面触发 `openWorkshop` 带新 tab」，而遮罩把页面挡死了，UI 上不可达。为此加同步反而会多一次重渲染。

## 验证

`pnpm --filter @stage-ai/web typecheck` 通过；web 测试 31 passed。浏览器实测 9 项全过，截图见 `screenshots/`：

- `02` Title 抽屉 + 遮罩；`03` 全屏铺满
- `04/05/06` 素材 / 配置 / 文件三页
- `07` 抽屉里的全屏音色库
- `08/09/10` 舞台里的抽屉与全屏（全屏那张是「挤在舞台下方」bug 的正面证据）
- `11` 390px 窄屏；`12` 就绪门「素材与配置」直接落在素材页

**验证时又抓到一个真 bug**：`@media (max-width:460px)` 里的 `.workshop-mode-btn{display:none}` 被 `button.icon-btn`（特异度 0,1,1）压过，手机上「展开/收起」按钮根本没藏住——写成 `.workshop .workshop-mode-btn` 才生效。静态检查与代码审阅都没发现，只有真机量 `getComputedStyle` 才露出来。

## 未做（有意）

- 工坊没有可直达 URL（项目未上线，不做旧 hash 兼容；换页即收起）。
- 抽屉打开时顶栏被遮罩盖住，STUDIO 键不可再点——模态语义，用户选的。
- 手机上不区分抽屉/全屏（没区别）。
