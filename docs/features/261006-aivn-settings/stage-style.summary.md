# 剧目舞台皮肤（开放给搭台助手）—— 实施小结

日期：2026-10-06。仓库：`dsh-aivn`（master）。设计依据：[stage-style.plan.md](stage-style.plan.md)。

## 做了什么

1. **剧目级声明 `theme.json`**（剧目根，与 `play.json` 平级）：键是 `@aivn/stage/stage.css` 里 `.stage-root` 上的 CSS 变量名，值经白名单校验。没有这份文件 = 默认皮，一个变量都不注、逐像素零变化。
2. **白名单 17 键**（`src/style-tokens.ts`，五组）：台词条 7（`--dialog-bg/line/ink/ink-soft/ink-thought/ink-faint/shadow`）、衬底与圆角 3（`--stage-bg/stage-radius/sprite-dim`）、选肢卡 3（`--choice-bg/line/ink`）、字体 1（`--font-ui`）、主色 3（`--accent/accent-ink/accent-soft`）。取值只认颜色（hex / `rgb()` / `hsl()`，含 `/` 与逗号两种 alpha 写法）、与默认值同形的 `linear-gradient(...)`、`0–24px` 圆角、`0.2–1` 压暗、`none|「x y 模糊 颜色」`投影、逗号分隔字体栈；拒 `url(` / `var(` / `calc(` / `color-mix(`。
3. **双闸共用一份实现**：写闸（`set_stage_style` 工具）全有或全无——任一键不合法整次拒绝、一个字节不写；读闸（`readPlayTheme`，`/aivn/play` 组装时）只丢坏键并记一行日志，剧目照常开演。
4. **工具 `set_stage_style`**（搭台助手专属、不门控）：三态与 `set_craft` 对齐（省略 = 不动 / 给值 = 改 / `null` = 回默认，删空则删文件），空参调用 = 回显当前值与默认值对照；描述里写明成组联动（台词条是一套玻璃、`accent` 要配 `accent-ink`、换亮底要改浅投影）与「用户没提样式就别动」。
5. **传输**：`GET /aivn/play` 响应加 `theme` 字段（首挂即得）；SSE 加 `{ kind: 'style', theme }` 全量快照帧（幂等，重连补推最后一条即最新）。
6. **客户端应用**：`stage-view.tsx` 的 `themeCss()` 生成一条作用域规则 `<style data-aivn-theme>`，选择器 `.aivn-stage-view .stage-root.stage-root`（(0,3,0)）——压过 stage.css 基线的 `.stage-root`（(0,1,0)），将来若舞台亮/暗层被激活也仍是「剧目声明过的键主题无权改」。
7. persona 加《舞台样式》章；搭台助手《当前状态》注入段加一行皮肤现状（「改了 N 个键」/「无，默认皮」）。

## 与计划的偏差（实施中发现，已按实际改）

| 计划写的 | 实际做法 | 为什么 |
|---|---|---|
| 皮肤落在舞台根 div 的**内联** `style` 上 | 落在一条**作用域 CSS 规则**上 | `@aivn/stage` 的 `StageTheater` 根 div 自己就带 `.stage-root`（`StageTheater.tsx`），stage.css 在那层把 17 个变量又声明了一遍——外层内联变量被更近的声明遮住，画面一个像素不动（e2e 实测）。作用域规则同时还惠及 `ToastStack` 自带的那个 `.stage-root` |
| 写完把皮肤推给**这条会话**的帧流 | 推给**同剧目（工作目录相同）的所有会话流** | 工具跑在搭台助手会话里，而舞台（AIVN tab）只开在剧作家会话上——只推自己的流，用户得刷新才看得见，「立即生效」就白写了。坐标是会话工作目录（工作区 = 剧目根） |
| 投影校验按 `<n>px <n>px <n>px 颜色>` | 允许无单位的 `0` | 默认值自己就是 `0 10px 30px rgb(0 0 0 / 0.45)`，严格按 px 写会把默认值判非法 |

## 默认零变化怎么保证

- 没有 `theme.json`：`/aivn/play` 的 `theme` 是空对象 → 客户端不渲染 `<style data-aivn-theme>` → 一个变量都不注。
- e2e 用计算样式基线对表（`.theater-dialog .dialog-text` 字色、`.theater-stage` 衬底、`--stage-radius`），与 stage.css 的默认值逐项相等；并且离线段把**白名单 17 键与 stage.css 的声明逐键对表**（键在不在、默认值一不一致、有没有「定义了但没人消费」的死变量）——stage.css 那边改了默认值，这套测试会红。

## 安全

- 没有任意 CSS 注入口：模型交付的是 17 个预定义变量的**值**，全部过格式白名单（不含 `;` `{` `}` `url(` `var(` `calc(`），拼进声明串无逃逸面；未知键在写闸整次拒绝、在读闸丢弃。
- 写入路径只在剧目根的一个文件（`ctx.playDir()`）；不碰 `play.json`、`assets/` 与工作区外。
- 文件坏掉（用户手改坏了 JSON）：读闸给一句带文件名的日志、按默认皮渲染，剧目永不因皮肤打不开。

## 验证

- `dsh-e2e run e2e/run.mjs style`：25/25。含离线 12 项（白名单 / 取值 / 读闸 / 与 stage.css 防漂移），以及真舞台：默认零变化、`theme.json` 落成作用域规则与计算样式、坏键只丢自己、**另一会话里的搭台助手调 `set_stage_style`、已打开的舞台不刷新换装**（跨会话广播）。
- 端到端验收（子代理）：[stage-style.e2e.md](stage-style.e2e.md)——6 项功能用例全过（默认零注入、自然语言驱动的落盘、免刷新换装、`null` 三态、非法值整体拒绝、手改坏键容错），3 项体验观察无关键问题（换装后可读性、圆角可辨、未提样式时助手克制）。
- 检视：[aivn-settings-style.review.md](aivn-settings-style.review.md)。
