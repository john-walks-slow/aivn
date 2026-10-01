# 261002 UX 打磨 验证记录

对象：worktree `feat/ux-polish`，dev 实例 api `127.0.0.1:47239` + web `127.0.0.1:36687`，
剧目 `plays/demo`（10 张背景 / 2 张插图 / 7 个角色）。

## 自动化

| 项 | 结果 |
| --- | --- |
| `pnpm --filter @stage-ai/core build` | 通过 |
| `pnpm --filter @stage-ai/web exec tsc --noEmit` | 通过 |
| `pnpm --filter @stage-ai/server exec tsc --noEmit` | 通过 |
| `vitest run prompt/store/memory/http/playhouse/transport` | 6 文件 64 例通过 |
| `pnpm --filter @stage-ai/web test --run` | 10 文件 66 例通过 |

`store.test.ts` 里「createEmpty 落盘设定模板」一例改写成断言两份文件为空——原断言写的是
模板正文还在文件里，与本轮第 5 条相反。

## 逐条实机

#### 1 去掉那圈黑边框

宽屏 1280×800 取四角与四边中点像素：改前 `(42,37,33)`（深胡桃），改后
`(245,241,232)`（纸面），全页无深色描边。剧目库窄屏（412×892）同样干净。

#### 2 封面

- 未设置：自动取第一张背景（`bg_classroom_sunset.jpg`），剧目库与标题画面一致。
- 设置：工坊「设定与记忆」剧目卡底部列出 10 张候选（8 背景 + 2 插图），点
  `cg_rooftop_confession.jpg` → 保存 → `play.json` 出现
  `"cover": { "kind": "cg", "id": "cg_rooftop_confession.jpg" }`，剧目库卡片与标题画面
  同步换成该 CG。设完已把 `plays/demo/play.json` 还原。

#### 3 导入界面的 tab

| 入口 | 分类 tab | 列表 |
| --- | --- | --- |
| 角色卡「从资源库导入」 | 无 | 7 个角色（含 4 个非主角） |
| 主角卡「从资源库导入主角卡」 | 无 | 同上 7 个 |
| 素材页「从资源库导入」 | 全部/背景/插图/音乐/音效 | 无「角色」 |

原「导入是把内容复制进本剧目…」那段说明已不在 DOM 里（`.picker-note` 不存在）。

#### 4 侧栏返回图标

`.side-exit` 渲染的是 Lucide LogOut（门框 + 穿出的箭头），title「退出这场戏，回到剧目：
黄昏教室」。

#### 5 premise / craft 默认空

新建剧目的两份 `memory/always/*.md` 落盘即空（`createEmpty`）；`GET /api/plays/<id>/craft`
只回 `{ content }`，不再有 `isDefault` 回退。编辑框 placeholder 实测：

- 世界与人物设定：「这个世界在哪儿、什么年代、什么规矩；主要人物是谁、想要什么、彼此什么
  关系；故事从哪个瞬间开始。/ 留空也能开演——剧作家会按它已有的东西自由发挥。」
- 创作口径：「这部剧的台词口径：节奏多密、情绪怎么落地、有什么禁项。/ 留空就用引擎内置
  的通用准则。」

通用准则（`CRAFT_RULES`）常驻系统提示词，与 craft.md 有内容时并存。

#### 6 删冗余描述

`LibraryBrowser` 的导入说明段、CG 空态里的 `assets/cg/` 与 `<cg id="…" />` 实现说明、
立绘差分的路径说明、文件编辑器保存行里的 `{path}` 均已删除。`views/SettingsScreen.tsx`
是运维配置面，hint 属用户文档，未动。

#### 7 crafter 会话 e2e

走浏览器真实通路（工坊对话页，WS `workshop_*`）：

- **切换**：展开会话条 → 点「世界观与人物」→ 顶栏标题切换，历史换成该会话的消息。
- **新建**：「新会话」→ 发一条消息 → 工坊模型真实回「收到」→ 落盘 `tmupo3qn6lg.json`，
  `threads.json` 增一条，标题取首条消息前 20 字。
- **归档/取消归档**：`threads.json` 的 `archived` 随之翻转，列表内位置变化。
- **删除**：点删除 → 原生 confirm 弹出「删除会话「小春的立绘」？」→ 接受 → 列表清空，
  `threads.json` 变 `[]`，`<id>.json` 一并从磁盘消失。

> 踩坑记录：camoufox 自动化里 `window.confirm = () => true` **不生效于 React 的事件处理
> 函数**——eval 跑在隔离世界，改的是隔离世界的 `window`，页面主世界里的原生 confirm 照弹
> 原生对话框并被自动 dismiss，于是看起来像「删除按钮没绑上」。改用 playwright-cli 的
> `dialog-accept` 才走通。判断「按钮没绑事件」前先确认 eval 是不是在主世界。

## 遗留风险

- demo 剧目里 `premise.md` / `craft.md` 仍是旧模板正文（该剧目建于本轮之前），不随代码
  迁移；新建剧目才是空的。
- 删掉画框后，窗口不再按 16:9 约束宽度：超宽屏上界面会被横向拉开，窄屏行为不变。
