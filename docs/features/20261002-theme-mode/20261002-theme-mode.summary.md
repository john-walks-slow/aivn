# 主题模式：界面（纸面）与舞台（画面）各自可选亮暗

## 需求

界面层与舞台层分别支持「跟随系统 / 浅色 / 深色」，两者互不影响。
用户是夜里看剧本的独立开发者，典型诉求是「舞台要暗、界面可以留着亮」——
所以两个开关必须分开，而不是一个全局开关。

## 结论：存偏好，不存结果

偏好只有三态 `system | light | dark`，存进 localStorage；
**实际用哪个由系统偏好当场算**，不落盘。

存「结果」（直接存 dark/light）会让系统切日/夜时页面不跟着变——
用户把系统调成夜间模式，页面还停在浅色，这是最容易被投诉的一点。

两个 localStorage 键（键名只在 `hooks/useTheme.ts` 定义一次）：

- `stage-ai:ui-theme-mode`
- `stage-ai:stage-theme-mode`

## 分工：JS 决定「现在是哪个」，CSS 决定「长什么样」

`useTheme()` 挂一次（`App.tsx`），把解析结果写到 `<html>` 的 `data-ui-theme` /
`data-stage-theme`；配色全部在 `app.css` 的属性选择器里查表。

**为什么不用内联 `style` 直接写 `:root` 变量**：剧目定制主题（`plays/<id>/theme.css`）
挂的就是 `:root` 变量覆盖，而内联 style 优先级更高，会把整张主题表压掉——
用户在工坊里换的皮会静默失效。属性选择器只覆盖本功能动的那几个令牌，
剧目主题没碰到的部分照旧生效。

配色取值上，UI 深色不是纯黑/纯白：底色 `#14110f`、主色 `#d98a7a`（臙脂提亮）——
纯黑配暖白字会发蓝，臙脂不��亮会糊成一团。

舞台浅色与深色的取舍是**相反**的：深色靠「半透明玻璃压住画面」成立，
浅色没有压的余地，底色必须实（0.94 起步），否则背景图亮部会透上来吃掉字。

## 实施过程中查出的问题

### 1. useEffect 闭包捕获旧值 —— 切换功能实际不生效

`useTheme` 最初写成 `useEffect(() => { const ui = read(); ... }, [])`，
`applyTheme` 闭包捕获了挂载时的快照。之后设置页广播事件，闭包里仍是旧值——
**表现为「下拉框切了、界面不动」**。

初版验证只覆盖了「进页面前就把 localStorage 写好」这条路径（用 `addInitScript`），
那条路径不走事件，所以测不出来。改成走真实用户路径（`selectOption`）后立刻暴露。

修正：`applyThemes()` 每次都重新 `readThemeMode()`，不缓存快照。

### 2. 深色下输入框仍是白底黑字

实测 `getComputedStyle(input).backgroundColor === rgb(255,255,255)`。
根因不是配色写错，而是 `app.css` 里那条
`input, textarea, select { background: var(--panel) }` 规则**整段不见了**。

### 3. app.css 曾被整体重写、丢掉约 3700 行（严重）

改 app.css 时走了「read 全文 → write 全文回写」的路子，回写的内容并不完整：
4457 行掉到 1182 行，`git diff --stat` 显示 `+421 / -3695`。
CSS 产物因此从 59.79 kB 缩到 14.35 kB（这是发现问题的信号，不该等到肉眼看截图）。

**已恢复**：用 `git show HEAD:apps/web/src/app.css` 取回原版（不走 `git checkout`/`restore`，
避免误伤他人未提交改动），再用定点 `edit` 只插入主题覆盖段。
现在 diff 是干净的 `+36 / -0`。

> 教训：改一个几千行的样式表，只做定点插入，不做整体回写。
> 回写前必须 `git diff --stat` 自查——那 3695 行删除在肉眼截图里几乎看不出来。

## 验证

真实用户路径（`selectOption` 驱动，等同手动选），不是预置 localStorage：

| 步骤 | 期望 | 结果 |
|---|---|---|
| 初始 | ui=light, stage=light | ✅ |
| 两个下拉都选深色 | ui=dark, stage=dark，输入框转深底浅字 | ✅ |
| 只把界面改回浅色 | ui=light, **stage 仍 dark** | ✅ 两层互不干扰 |
| 两个都选「跟随系统」 | 按系统解析为 light/light | ✅ |
| 刷新页面 | 偏好保持 | ✅ |

另外交叉核对了剧目库 / 设置 / 标题三页的深浅配对，均成套切换、
无深底深字、无残留白底控件。

## 已知边界（未改，需产品决策）

**剧目有封面时，标题页几乎不受界面主题影响**：`.title-screen.has-art` 里
文字色/遮罩是硬编码的米白与暗色渐变（底图要压暗才压得住字，这是原设计）。
实测深浅两版标题页全图 102 万像素里只有 226 像素不同，仅那条主色竖线。

这是原设计的有意选择，不是 bug——底图满屏时本来就没有「纸面」可见。
但用户若期望「界面设深色、标题页也跟着变深」，需要对 `has-art` 那套规则
也做主题分支。**未擅自改动**，留待确认。

## 文件

- `apps/web/src/hooks/useTheme.ts`（新增）：偏好读写 + 三来源监听（系统 / 跨标签页 / 同标签页）
- `apps/web/src/app.css`：仅追加两个属性选择器（+36 行）
- `apps/web/src/App.tsx`：挂 `useTheme()`
- `apps/web/src/views/SettingsScreen.tsx`：设置页「主题」分组两个下拉框

## 本机调试环境

worktree 在 `.worktrees/theme-mode`。为避免和主仓 8787 实例（带密码闸门）撞车：

- server：`--env-file=<worktree>/.env`，`STAGE_PORT=8799`（副本已去掉 `STAGE_PASSWORD`）
- vite：`STAGE_PORT=8799` 起在 5180
- 隧道：`bash ~/.agents/skills/dev-tunnel/scripts/dev-tunnel.sh 5180`

`.env` 已被 `.gitignore:4` 覆盖，不入库。