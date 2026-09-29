# 工坊界面现状调研（260929-workshop-ui-refresh）

> 只读调研，未改动任何源码。数据来源：`apps/web` / `apps/server` 现网代码（2026-09-29）。

## 1. 工坊组件地图与抽屉↔全屏切换

| 文件 | 行数 | 职责 |
|---|---|---|
| [apps/web/src/workshop/WorkshopPanel.tsx:15](../apps/web/src/workshop/WorkshopPanel.tsx#L15) | 221 | 面板主体：顶栏（线程入口/标题/tab 切换/模式切换/关闭）、线程抽屉、chat/files 双 tab、写盘撤销条。导出 `WorkshopMode = "drawer" \| "full"`（:9） |
| [apps/web/src/workshop/FileBrowser.tsx:7](../apps/web/src/workshop/FileBrowser.tsx#L7) | 178 | 剧目文件树（按 `dir` 分组）+ textarea 文本编辑器 + 新建/保存/还原/删除 |
| [apps/web/src/workshop/useWorkshop.ts:47](../apps/web/src/workshop/useWorkshop.ts#L47) | 134 | 纯状态机：把 `workshop_*` 下行消息收敛成 `WorkshopState`（threads/messages/streaming/activity/writes/busy/error） |
| [apps/web/src/workshop/useWorkshopSocket.ts:11](../apps/web/src/workshop/useWorkshopSocket.ts#L11) | 75 | 全屏页专用 WS：`/ws?play=<id>&workshop=1`，指数退避重连，只过滤 `workshop_*` |
| [apps/web/src/views/WorkshopScreen.tsx:6](../apps/web/src/views/WorkshopScreen.tsx#L6) | 31 | 全屏工坊页外壳（`screen-bar` 返回标题 + 连接状态） |

**两个宿主（切换机制是「同一个组件、两个宿主」）**

- 抽屉宿主：[StageScreen.tsx:30](../apps/web/src/views/StageScreen.tsx#L30) 持有 `const [workshop, setWorkshop] = useState<WorkshopMode \| null>(null)`；[StageScreen.tsx:241](../apps/web/src/views/StageScreen.tsx#L241) 渲染 `<WorkshopPanel mode={workshop} onModeChange={setWorkshop} onClose={() => setWorkshop(null)} …>`，且仅在 `view === "stage"` 时挂载。WS 通道复用舞台连接：`useStageSocket({ onWorkshop })`（:77）→ `workshopHandlers` ref → `subscribeWorkshop`（:38）传进面板。`onModeChange = setWorkshop` 即**抽屉→全屏的真相来源**（不切路由、不换连接，只改一个 CSS class）。
- 全屏宿主：WorkshopScreen 传 `mode="full"`、**不传 `onModeChange`**——面板里 `onModeChange && …` 的条件渲染（WorkshopPanel.tsx:72）使模式切换按钮自动消失（注释明说「全屏独立页没有可切的另一半」）。
- 入口：[StageTheater.tsx:332](../apps/web/src/stage/StageTheater.tsx#L332) 舞台「更多」菜单里的「工坊」文字按钮 → `onWorkshop()`；[TitleView.tsx:93](../apps/web/src/views/TitleView.tsx#L93) 与 :112 两处 `navigate('/play/<id>/workshop')`；路由注册在 [App.tsx:36](../apps/web/src/App.tsx#L36)。

## 2. emoji / 特殊符号清点

工坊内（翻新主战场）：

| 符号 | 位置 | 组件 | 语义 | 容器 class |
|---|---|---|---|---|
| ☰ | WorkshopPanel.tsx:65 | WorkshopPanel | 按钮图标（线程列表） | `.ghost-btn` |
| 📁 / 💬 | :70 | WorkshopPanel | tab 切换按钮（文件/对话） | `.ghost-btn.small-btn` |
| ⤢ / ⤡ | :78 | WorkshopPanel | 模式切换（放大/收窄） | `.ghost-btn.small-btn` |
| ✕ | :82 / :125 | WorkshopPanel | 关闭面板 / 删除线程 | `.ghost-btn.small-btn` / `.ghost-btn.tiny-btn.danger-btn` |
| ＋ | :97 | WorkshopPanel | 新线程 | `.primary.small-btn` |
| ↩ / 📥 | :116 | WorkshopPanel | 归档 / 取消归档（单键双态） | `.ghost-btn.tiny-btn` |
| 📝 | :190 | WorkshopPanel | 写盘记录行前缀（装饰） | `.write-row .file-path` |
| ＋ | FileBrowser.tsx:116 | FileBrowser | 新建文件 | `.ghost-btn.tiny-btn` |
| ⟳ | :119 | FileBrowser | 刷新目录 | `.ghost-btn.tiny-btn` |
| ✕ | :138 | FileBrowser | 删除文件 | `.ghost-btn.tiny-btn` |

其他页面（同一套视觉语言，翻新时建议一并对齐）：

| 符号 | 位置 | 语义 |
|---|---|---|
| 🔊 | StageTheater.tsx:465 | 语音解锁遮罩装饰（`.voice-unlock-icon`） |
| ◀ / ▼ | StageTheater.tsx:442 / :449 | 回看中提示 / 继续箭头（`.dialog-rewind` / `.dialog-next`） |
| ✨ | StopPanel.tsx:133；AssetsView.tsx:143（说明文案） | 润色按钮 |
| ✓ | StopPanel.tsx:100 | 「已选过」状态标记（`.choice-seen`） |
| 🌿 / ↺ / ✎ / 💬 / ◈ / ♪ / ▣ / ▸ / 🎬 / ● / ◇ / ○ | LineagePanel.tsx:119,174,181,249,279,287,290,307,405-434,446-448 | 导演操作按钮 + 谱系行前缀标记 |
| ❖ / ✎ | RouteCanvas.tsx:6 | `STOP_MARK` 常量，停止点类型标记 |
| ＋ | RouteCanvas.tsx:181、LibraryView.tsx:95、AssetsView.tsx:166/378 | 新增类按钮 |
| ← | LineagePanel.tsx:94/216、SavesView:79、TitleView:58、AssetsView:71、WorkshopScreen:13、SettingsScreen:82 | 返回类按钮 |

**符号本身无独立 CSS class**（都直接写在 JSX 文本里，随按钮字体继承）；`.voice-unlock-icon`、`.choice-seen`、`.lineage-leaf` 只是给符号外层容器上色/排版。

## 3. 图标方案：无

`apps/web/package.json` 依赖只有 `react` / `react-dom` / `@stage-ai/core`；根 `package.json` 只有 `@earendil-works/pi-agent-core` / `pi-ai`。**没有 lucide-react / heroicons / @radix-ui/react-icons / react-icons**，`node_modules` 与 pnpm store 也没有。全仓唯一 `<svg>` 是 [RouteCanvas.tsx:148](../apps/web/src/stage/RouteCanvas.tsx#L148) 的 `route-edges` 贝塞尔画布（不是图标系统），无 `<symbol>` sprite、无自建 Icon 组件。

**结论：无图标库，纯文本符号（emoji + Unicode 几何/箭头字形）。**

## 4. 图片现状

- **URL 拼接**：[api.ts:195](../apps/web/src/api.ts#L195) `assetUrl(playId, dir, name)` → `/plays/<id>/assets/<dir>/<name>`；[stage/assets.ts:32](../apps/web/src/stage/assets.ts#L32) `buildAssetIndex` 同式拼 URL，并用 `stemMap` 把无扩展名的 stem 补成文件名，缺素材回落到生成资产 `generated[stem].url`，仍无则 `null`（文字/静默降级）。
- **静态路由**（[http.ts:90-124](../../apps/server/src/http.ts#L90)）：`/plays/:id/media/tts/*.mp3`、`/plays/:id/media/img/*.jpg`、**`/plays/:id/assets/<kind>/<...>`**。白名单：`ASSET_KINDS = sprites|backgrounds|cg|sfx|bgm`（:26），`sprites` 必须是两段，其余一段；`MIME` 表含 png/jpg/jpeg/webp/gif/mp3/ogg/wav/m4a/zip（:12）。→ **`<img src="/plays/demo/assets/backgrounds/bg_classroom_sunset.jpg">` 直接可用**（demo 实际素材为 `.jpg`）。
- **PlayFile 类型**：[api.ts:20](../apps/web/src/api.ts#L20) / [playFiles.ts:22](../../apps/server/src/playFiles.ts#L22)：`{ path, dir: string[], size, writable }`——**没有 mime / binary / isImage 字段**。
- **文件列表是否含图片**：会含。[playFiles.ts:99](../../apps/server/src/playFiles.ts#L99) `isVisible()` 对 `assets/` 前缀一律放行，`EDITABLE_EXT`（.md/.json/.txt）只决定 `writable`（`assets/manifest.json` 例外为可写）。所以 FileBrowser 树里现在**混着 .jpg/.png 条目**。
- **能否区分二进制**：不能。FileBrowser `select()`（:36）无条件 `api.readFile` → [http.ts:265](../../apps/server/src/http.ts#L265) → `PlayFiles.read()` → `readFile(abs, "utf8")`（playFiles.ts:116），点图片会把乱码灌进 textarea。翻新做图片预览需先加字段或按扩展名分流。

## 5. 样式体系

单文件 [apps/web/src/app.css](../apps/web/src/app.css)，共 2039 行，无 CSS 预处理器、无 CSS Module。工坊段约 1155–1440 行。命名约定：

- 前缀族：`.workshop-*`（布局：`-drawer` / `-full` / `-screen` / `-bar` / `-title` / `-threads` / `-chat` / `-empty` / `-input` / `-writes` / `-files` / `-file-tree` / `-file-editor`）、`.chat-bubble` + `.chat-user` / `.chat-assistant` / `.chat-activity`、`.thread-row` / `.thread-name`、`.file-group-name` / `.file-entry` / `.file-editor-bar` / `.file-state(.dirty)` / `.file-editor` / `.file-path`、`.write-row`。
- 通用按钮原子类：`ghost-btn` / `primary` / `small-btn` / `tiny-btn` / `danger-btn` / `link-btn` / `bar-btn`，混用尺寸修饰类而非图标类。
- 设计变量集中在文件头部（`--panel` `--line` `--accent` `--accent-soft` `--ink*` `--radius` 等），剧目 `theme.css` 可运行时换肤（FileBrowser.tsx:57 `notifyThemeChanged`）。

**无可复用的 lightbox / modal / dialog / 预览组件**：全仓无同名组件，最接近的是 [app.css:978](../apps/web/src/app.css#L978) `.overlay`（「读取路线…」加载态）与 `.choice-overlay`（选肢层），都绑定具体业务，不通用。图片预览组件需要从零建。

## 6. 构建与依赖约束

- `apps/web` scripts：`dev`(vite :5180) / `build`(tsc --noEmit && vite build) / `typecheck` / `test`(vitest)。
- **新增 `lucide-react` 可行**：`~/.npmrc` 已配 `proxy=http://127.0.0.1:7890`，实测 `curl` npm registry 返回 200（需在装了代理的 shell 里跑 pnpm）。本机 pnpm store 有 291M 缓存但**不含 lucide**（首次安装需下载）。
- 替代方案（零依赖）：自建 `apps/web/src/ui/Icon.tsx` 内联 path，或用 CSS mask/字体符号——考虑到只需约 15 个图标且要保持离线可构建，内联 SVG 组件是更稳的路线。

## 翻新要点速记

1. 模式切换的唯一真相是 `StageScreen` 的 `workshop` state；面板内的 `⤢/⤡` 按钮通过可选 prop `onModeChange` 与之通信，重构时勿把它与路由混起来。
2. 符号替换需同步改 CSS 尺寸类（`.small-btn` / `.tiny-btn` 的 padding 依赖字符宽度）。
3. 图片预览要先补「二进制感知」：服务端加 `binary`/`mime` 字段或前端按扩展名分流，否则会重演乱码 textarea。
4. 素材静态服务已就绪（`/plays/:id/assets/**`），预览无需新增后端路由。
5. 无图标库、无弹层组件——这两块是本次翻新要新建的基础设施。
