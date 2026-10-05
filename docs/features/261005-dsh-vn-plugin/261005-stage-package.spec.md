# 抽取 `@aivn/stage` · 实施规格

工作区：`/root/projects/stage-ai/.worktrees/dsh-vn-stage`，分支 `feat/dsh-vn-stage`。
主仓库 `/root/projects/stage-ai` 有别的 agent 在动，**只在 worktree 里改文件**，不要碰主仓库工作区。

## 为什么

AIVN 的舞台渲染层现在长在 `apps/web/src/stage/`，与 app 的 REST 客户端、UI 基座、路由外壳缠在一起，别的宿主（DSH 插件）无法复用。把它抽成 workspace 包 `@aivn/stage`：

- AIVN 自己的 web 改成消费这个包，**行为与视觉零变化**；
- 新宿主（DSH 插件）只取「画面 + 台词条 + 停止点 + 播放」这一层，不需要路线树 / 回顾 / 工坊 / 存档页。

## 边界

### 移入 `packages/stage/src/`（原 `apps/web/src/stage/`）

| 文件 | 说明 |
|---|---|
| `StageTheater.tsx` | **要把文件末尾的 `HistoryView`（含 `HISTORY_KIND`）切出去**，见下 |
| `StopPanel.tsx`、`StageModes.tsx`、`toast.tsx` | 舞台上的浮层 |
| `director.ts`、`playbackState.ts`、`loopAudio.ts`、`audio.ts` | 播放与音频 |
| `script.ts`、`assets.ts`、`transcript.ts`、`generatedAssets.ts` | IR 行模型 / 素材寻址 / 台词流 / 生成物台账 |
| `viewport.ts`、`view.ts`、`settings.ts`、`cgOptions.ts` | 视口 / 视图与 query 解析 / 舞台主题设置 / CG 画幅选项 |
| `script.test.ts`、`transcript.test.ts`、`audioRules.test.ts` | 跟着被测文件走 |

### 留在 `apps/web/src/`（app 自己的东西）

`StageScreen.tsx`、`StageShell.tsx`、`RouteCanvas.tsx`、`routeTree.ts`、`LineagePanel.tsx`、`CgView.tsx`、`PromptQueuePanel.tsx`、`useStageSocket.ts`、`helloSync.ts`(+test)、`beats.ts`(+test)。

### UI 基座

`ui/Icon.tsx`、`ui/Modal.tsx`、`ui/escape.ts`、`ui/stamp.ts` 这四个被移入的组件用到，**一并移入 `packages/stage/src/ui/`**，并由包 re-export；`apps/web` 里所有 `../ui/Icon.js` / `../ui/Modal.js` / `../ui/escape.js` / `../ui/stamp.js` 的引用改成从 `@aivn/stage` 取（**不要留两份**）。

`ui/ImageLightbox.tsx`、`ui/ModelSelect.tsx`、`ui/RefCharacterPicker.tsx` 留在 app。

### `HistoryView` 切出去

`StageTheater.tsx` 末尾的 `HistoryView`（含 `HISTORY_KIND` 常量）依赖 `api.history()` 与 `HistoryBeat/HistoryEntry` 类型，属于 app 的回顾功能。把它原样（连注释）搬到新文件 `apps/web/src/views/HistoryView.tsx`，`StageScreen.tsx` 改成从那里 import。

移走它之后，`StageTheater.tsx` 里不得再有 `../api.js` 的引用。

## 包的结构

```
packages/stage/
├── package.json      name: @aivn/stage, type: module, exports: "." → ./dist/index.js, "./stage.css" → ./dist/stage.css
├── tsconfig.json     继承根 tsconfig.base.json，composite/declaration 到 dist（照 packages/core 抄）
├── src/
│   ├── index.ts      barrel：导出上面全部组件/函数/类型，**不含 HistoryView**
│   ├── stage.css     舞台样式（见下）
│   └── ui/…
└── scripts/copy-css.mjs   构建后把 src/stage.css 拷到 dist/
```

`package.json` 的依赖：`react`、`@aivn/core`（`workspace:*`）；`lucide-react` 若 Icon 用到。devDeps：`typescript`、`vitest`。
根 `pnpm-workspace.yaml` 已是 `packages/*`，无需改。

`apps/web/package.json` 加 `"@aivn/stage": "workspace:*"` 依赖。

## CSS 拆分

`apps/web/src/app.css` 是 5,741 行的全局样式，按 `/* ── 小节 ── */` 分节。规则：

1. 移入 `packages/stage/src/stage.css` 的小节：`舞台`(977)、`台词流`(1648)、`停止点`(1725)、`模态窗`(1881)、`语音`(2349 起的那节)。
   **注意**：每个小节的起止以「下一个 `/* ──` 标题行」为界，逐行搬、不改内容。
2. 这五节还要带上它们依赖的 CSS 变量：`app.css` 顶部的主题变量区（`主题切换` / `主色预设` / `舞台浅色` / 字体与焦点框那些，约 1–250 行中与舞台相关的部分）要一并复制进 `stage.css` —— **判定标准是：把这几节搬走之后，舞台在 app 里仍然长一样**。允许在 `stage.css` 顶部保留一份变量副本，宁可重复也不要漏。
3. `app.css` 里删掉已搬走的那几节，并在顶部加 `@import "@aivn/stage/stage.css";`（Vite 支持包名 @import）。
4. `.modal` 这类被 app 与舞台共用的选择器：如果 app 其他地方也用，就把它留在 `app.css`，不要搬。

拿不准某个选择器归谁时，用 grep 数一下它出现在哪些 tsx 里：**舞台与 app 都用 → 留在 app.css；只有舞台用 → 搬进 stage.css**。

## 约束

- **不改行为、不改视觉**：这是纯搬家 + import 改线。任何顺手重构、改名、改文案、改样式的动作都不做。
- 不要动 `apps/server`、`packages/core`。
- 不新建与本次无关的文件。
- 编码保持 UTF-8，注释一律保留。

## 验证（必须全过）

在 worktree 根目录：

1. `./scripts/init-worktree.sh`（首次：pnpm install + build core + 链 .env）
2. `pnpm --filter @aivn/stage build` 通过，`packages/stage/dist/` 有 index.js/index.d.ts/stage.css
3. `pnpm -r build` 通过（core → stage → web/server）
4. `pnpm typecheck` 通过
5. 相关单测：`pnpm --filter @aivn/stage test`（script/transcript/audioRules 三条用例必须绿）
6. 真机回归：`./scripts/dev-worktree.sh --no-tunnel` 起服务（端口它自己申请），用 playwright 打开 web 端口，进一个现成剧目（worktree 里已软链主仓库的 plays），确认：
   - 舞台画面渲染（背景/立绘/台词条）
   - 台词条与停止点样式与搬之前一致（截图留证）
   - console 无报错
   截图存 `.worktrees/dsh-vn-stage/docs/features/261005-dsh-vn-plugin/before-after/`（先说明：搬之前也截一张，用于对照）。
7. 收工前 `git add -A && git commit`（提交信息：`refactor(web): 抽出 @aivn/stage 舞台渲染包`），回复里给出 commit hash 与验证结果摘要。

## 交付回复格式

只回复：改动的文件清单（按目录分组）、验证 6 项的逐条结果、两个 commit（若分了「搬之前截图」与「重构」两次提交就都列出）、以及任何你判断需要我知道的偏差。

## 宿主扩展位（给下一个消费者：dsh-aivn 插件）

这三个口子都是**可选**的，缺省即 AIVN app 现在的行为，app 侧一处都不用改：

- `buildAssetIndex(playId, assets, generated?, manifest?, cast?, opts?)`：`opts.assetUrl(path)`
  换掉「素材相对路径 → 最终地址」这最后一步（缺省 `/plays/<id>/assets/<path>`）。
  素材 id → 相对路径的推导（目录清单补扩展名、差分回退）不受影响；
  注意 `spritePresentation()` 只出呈现三轴，本来就没有 URL 字段。
- `StageTheater` 的 `directorBar?: boolean`（缺省 `true`）：`false` 时右上角导演工具栏整块不渲染，
  `--dir-h` 会被显式写回 `0px`（不留空缝）。
- `StopPanel` 的 `onPolish?`：不传即没有润色接口，那一枚「润色」按钮（连同撤销）不出现。
