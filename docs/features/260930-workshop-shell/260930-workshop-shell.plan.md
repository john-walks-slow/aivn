# 工坊宿主重构：全站唯一浮层 + 默认抽屉

分支 `fix/workshop-ux`（worktree `.worktrees/workshop-ux`，基线 `2cb3f2d`）。

## 背景（用户原话）

> 工坊页面一些问题修改。现在感觉这个页面和之前的 ux 很割裂（双重导航、标题栏等等）。而且最初设想的默认 side drawer/可切换 full 也没做。以及希望：tab 改成对话-素材-配置（原本的创作口径）-文件

拆成四件事：

1. **双重导航**：工坊有两套宿主。舞台里是 `StageScreen` 自持的抽屉（复用 `useStageSocket.onWorkshop` 代转 `workshop_*`），另有独立路由页 `#/play/:id/workshop` → `WorkshopScreen`（`useWorkshopSocket` 自己建第二条 WS + screen-bar「← 标题」+ workshop-bar）。同一个面板两套外壳，标题栏也是两套。
2. **默认抽屉/可切 full 没做**：`WorkshopPanel` 有 `mode` 与切换键，但 `onModeChange` 是可选 prop —— 全屏页传 `undefined` 把切换键藏了；而舞台里点「全屏」时 `.workshop-full` 只有 `flex:1`、**没有任何定位**，实际是挤在舞台下方的容器里铺开，不是铺满视口。两头都没兑现「可切」。
3. **tab 口径**：原为 对话/素材/文件/创作口径，改为 对话/素材/配置/文件（「配置」就是原来的创作口径 `memory/always/craft.md`）。
4. 顺带：`TitleView` 就绪门里的「素材与配置」指向 `/play/:id/assets` —— **该路由根本不存在**，是死链。

## 决策

### D1 宿主形态 = A 全站唯一浮层（用户拍板）

任何入口（舞台 STUDIO 键、Title 的「工坊」按钮）都在**当前页面右侧滑出抽屉**，顶栏「展开」就地铺满全屏、「收起/关闭」回原页面。删掉独立路由与外层 screen-bar，全站只剩一套工坊 chrome。

- 代价：工坊不再有可直达 URL。项目未上线，不做旧 hash 兼容，落回 TitleView。
- 「舞台里切 full 挤在舞台下方」这个 bug 由 `.workshop-full { position: fixed; inset: 0 }` 一并修掉。

否决的方案：保留两套宿主、把 `onModeChange` 保持可选。两套外壳正是「割裂」的来源，且「可切 full」在独立页上天然无意义。

### D2 抽屉打开时加遮罩、点击空白收起

抽屉是模态的：背后页面不接受点击。`.workshop-scrim` 走 `fixed inset:0 / z-index 49`，压在 `.workshop`（50）之下、顶栏（30）之上。

### D3 状态放模块级 store，不放某个页面

工坊不属于任何一页——它挂在 `App` 上，`useWorkshopOverlay()` 用 `useSyncExternalStore` 读同一个模块级 store。这样舞台只知道「开没开」，不持有开合状态，也就不可能再出现第二个宿主。

路由变化即收起（`useEffect(closeWorkshop, [route.path])`），浏览器后退也走这条路。

### D4 Esc 改为全局浮层栈

原来 8 处各自往 window 挂 keydown，一次 Esc 会把底下几层一起关掉（灯箱开着按 Esc，工坊抽屉跟着没了）。新增 `ui/escape.ts`：挂载顺序即层级顺序，栈顶独占 Esc；非浮层但也在 window 上听 Esc 的（`StageTheater` 的方向键/导演注）用 `escapeClaimed()` 让位。

handler 存 ref，换引用不重排栈——栈顺序必须只由挂载顺序决定。

### D5 工坊 WS 连接只有一处

`WorkshopOverlay` 是全站唯一建工坊连接的地方（`useWorkshopSocket`，`?workshop=1` 跳过 autostart）。`useStageSocket` 的 `onWorkshop` 通道随之删除——它存在的唯一理由就是让舞台代转消息。

## 改动清单

见 `260930-workshop-shell.summary.md`。

## 验证

1. `pnpm --filter @stage-ai/web typecheck`
2. `pnpm --filter @stage-ai/web test`（31 passed）
3. 浏览器实拍：抽屉/全屏切换、遮罩点击收起、Esc 分层、四个 tab、Title 入口
4. `reviewer` 检视 → `260930-workshop-shell.review.md`
5. 用户实机验证 → `260930-workshop-shell.validation.md`

## 不做

- 旧 hash `#/play/:id/workshop` 兼容（项目未上线）。
- 给工坊做可直达 URL 的替代方案。
- `WorkshopInbound` 类型本身（`useWorkshopSocket`、`WorkshopPanel` 仍在用）。
