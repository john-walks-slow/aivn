# 导航与工坊界面一轮收口（11 条）

> 计划已通过 Kandev 落库（`1ad49b12-3a0e-47c3-8572-182e7dd404db`），本文是同一份计划的文件版。

## 背景

一轮 11 条 UI/UX 反馈集中在导航与工坊两块：按钮顺序、图标观感、输入方式、浮层遮挡、工坊形态、设置归属、命名与层级、关闭路径。共同点不是视觉，是**信息架构**：舞台只有一个外壳，工坊不该是盖在它上面的另一个世界。

## 决定

| # | 决定 | 理由 |
| --- | --- | --- |
| 1 | 有周目时「继续（档名）」为主按钮且排在前 | 「继续」是最高频动作，视觉权重先给高频 |
| 2/10 | 折叠键换 `panel-left-open/close` 图标 + 无边框幽灵键 + `padding: 0` | 原图与「回顾」撞脸；根因是全局 button 内边距不是图标 |
| 3 | 三处玩家输入（插一句 / 改台词 / 自由输入）统一模态窗 | 底部输入栏压走立绘与台词条，还吃掉「点画面继续」的手势 |
| 4 | 选肢层移进 `.theater-stage`，只盖画面 | 盖全屏等于在最需要导演动词时把它关掉 |
| 5 | 工坊去掉抽屉，与其它 tab 一样是第四个视图 | 一个外壳一条连接，工坊不该有自己的路由与连接 |
| 6 | 新增工坊「设置」页收「无选项轮次间插入「继续」」+ 语音开关 | 按「谁执行」分两处：浏览器 localStorage vs `.env` |
| 7 | 「创作口径」→「记忆」，覆盖 `memory/**` 四组 | 创作口径只是 `always/craft.md` 一个文件，「记忆」才等于用户真正能改的那面 |
| 8 | 「线程」→「会话」，下沉为对话页内部一层 | 会话是这一页的事，不该占主导航一位 |
| 9 | 非舞台视图都有视图栏 + `×`，`Esc` 同效 | 任何地方都能一键回舞台 |
| 11 | 标题页直达工坊复用舞台外壳 | 顶栏跳变来自工坊自带的 `screen-bar`，外壳统一后自然消失 |

## 实现要点

- `src/stage/view.ts`：`StageView`（四）与 `WorkshopTab`（五）枚举 + `stageViewFromQuery`/`stageTabFromQuery`/`workshopConnectionFromQuery`/`workshopUrl`。`view=` 认不出回舞台，`workshop=1` 独立表达「这条连接开不开演」。
- `src/workshop/memoryFiles.ts`：`memory/**` 路径归组（always / characters / index / 只读产物），纯函数 + 单测。
- `src/ui/Modal.tsx`：portal `body`、触摸捕获、`Esc` 只关最上层、自动聚焦优先输入框。
- `App.tsx`：`<StageScreen key={route.query} />`——hash 变化不重挂同路由组件，这是「回舞台」空操作的根因。
- 删除：`views/WorkshopScreen.tsx`、`workshop/useWorkshopSocket.ts`、`workshop/WorkshopPanel.tsx`、`workshop/CraftPanel.tsx`。

## 风险

- 换连接就可能重开一轮：从工坊回舞台靠 `autostarted` 标志不重开开场，实测周目数未变。
- `?workshop=1` 的连接不计语音观众也不 autostart，别误删——它是「逛工坊不开演」的唯一开关。

## 验证

见 `260930-nav-workshop-ux.validation.md`（浏览器实测 430px / 1200px 两档）。
