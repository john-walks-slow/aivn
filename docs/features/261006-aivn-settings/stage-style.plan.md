# 舞台样式面开放给搭台助手 —— 设计与实施计划

日期：2026-10-06。仓库简称：**插件** = `/root/projects/dsh-aivn`（master）；**stage-ai** = `/root/projects/stage-ai`（main）；**worktree** = `/root/projects/stage-ai/.worktrees/dsh-vn-stage`（feat/dsh-vn-stage，`@aivn/stage` 的实际来源，见插件 `package.json` devDependencies `@aivn/stage: file:../stage-ai/.worktrees/dsh-vn-stage/packages/stage`）。`@aivn/core` 链的是 stage-ai 主仓库（`file:../stage-ai/packages/core`）。

样式事实（已逐行核实）：

- 舞台客户端渲染在插件 `src/client/stage-view.tsx`：`stage.css` 在 L38 import、L44 `injectCss` 注入；舞台根 DOM 是 L430 `<div className="stage-root aivn-stage-view" style={{ height: '100%', minHeight: 0 }}>`。
- 全部令牌定义在 worktree `packages/stage/src/stage.css` 的 `.stage-root`（L45–117），两批：① 纸面 L47–66，② 画面 L69–95；同文件 L98–104 还有 `--sprite-dim` 与 `--choice-*`、L106–116 是运动变量。
- 亮/暗主题层是 `html[data-ui-theme="dark"] .stage-root`（L132–146）、`html[data-accent="…"] .stage-root`（L151–190）、`html[data-stage-theme="light"] .stage-root`（L195–217）。写入这些属性的是 AIVN app 的 `apps/web/src/hooks/useTheme.ts` L52–57（`applyTheme`）、L77–83（`applyAccent`）——**插件客户端没有 import 它**（`src/client/stage-view.tsx` L20–39 的 import 清单里没有，`@aivn/stage` 的 `index.ts` 也不导出它）。已核实 DSH 宿主源码（`/usr/lib/node_modules/@deepseek-ai/dsh/apps/web/src`）不存在任何 `data-ui-theme` / `data-stage-theme` / `data-accent` / `data-theme` 写入：**这三层属性选择器在 DSH 插件环境里永不命中，插件舞台恒走 `.stage-root` 默认基线（浅纸面 + 暗画面）**。

## 1. 能暴露哪些旋钮

### 1.1 白名单（17 键，按意图分组）

所有「消费者」行号都指 stage.css（worktree `packages/stage/src/stage.css`），且只列**插件渲染路径上真实可见**的消费者（插件 `directorBar={false}`，见 `src/client/stage-view.tsx` L443；因此导演栏一族的消费者不算）。

**A. 台词条组（7 键）** —— 台词窗与说话人名牌是同一套玻璃（`.dialog-name` 与 `.theater-dialog` 共用变量，stage.css L773–777）：

| 变量 | 默认值（stage.css 行号） | 格式 | 改了会看到什么 |
| --- | --- | --- | --- |
| `--dialog-bg` | `linear-gradient(178deg, rgb(28 24 25 / 0.9), rgb(17 15 17 / 0.94))`（L70） | 颜色 或 `linear-gradient(<0–360>deg, <颜色>, <颜色>)` | 台词条底（L326 `.theater-dialog`）与名牌底（L774 `.dialog-name`） |
| `--dialog-line` | `rgb(238 226 204 / 0.55)`（L71） | 颜色 | 台词条与名牌的描边（L327、L773） |
| `--dialog-ink` | `#f2ebde`（L72） | 颜色 | 台词正文字色（L794 `.dialog-text`）、名牌字色（L775）、打字机光标底色（L815 `.dialog-cursor`）、回看键 hover（L871） |
| `--dialog-ink-soft` | `#c6bba9`（L73） | 颜色 | 旁白字色（L801 `.dialog-text.narrate`）、台词条右下提示行（L864 `.dialog-hint`）、「（继续）」卡字色（L986 `.choice.ghost`）、回看键（L866–871 `.dialog-rewind`） |
| `--dialog-ink-thought` | `#a9a6c4`（L74） | 颜色 | 内心独白字色（L804–805 `.dialog-text.thought`） |
| `--dialog-ink-faint` | `rgb(242 235 222 / 0.45)`（L75） | 颜色 | 选肢卡「已选过」角标（L981 `.choice-seen`） |
| `--dialog-shadow` | `0 10px 30px rgb(0 0 0 / 0.45)`（L86） | `none` 或 `<0–24>px <0–60>px <0–100>px <颜色>` | 台词条投影（L336 `.theater-dialog`）；换亮色台词条时要跟着改浅（亮色主题的配对值见 L208） |

**B. 衬底与圆角组（3 键）**：

| 变量 | 默认值 | 格式 | 改了会看到什么 |
| --- | --- | --- | --- |
| `--stage-bg` | `#17130f`（L69） | 颜色 | 舞台衬底：图片未到/加载中露出的底（L311 `.theater-stage`）、CG 视图衬底（L740 `.theater-cg`） |
| `--stage-radius` | `10px`（L90） | `0–24px` 整数 | 台词条与名牌的圆角（L328、L773）——这是「浮在画面上的窗」的圆角，与纸面 `--radius`（L60，页面卡片用）不是一回事 |
| `--sprite-dim` | `0.55`（L98） | `0.2–1` 数字（两位小数） | 非发言人立绘的压暗强度（L413–419 `.theater-sprite.dim`） |

**C. 选肢卡组（3 键）** —— 不在任务给出的两批清单里，但必须与 A 组一起开：它们定义在 stage.css L99–101，与台词条同属「画面玻璃层」，且亮色舞台主题（L209–213）把 choice 与 dialog **成套**换掉——只开 dialog 不开 choice，剧目改亮色台词框后选肢卡仍是暗玻璃，视觉撕裂。插件的「开演」按钮也是 `.choice`（`src/client/stage-view.tsx` L458–464）：

| 变量 | 默认值 | 格式 | 改了会看到什么 |
| --- | --- | --- | --- |
| `--choice-bg` | `rgb(24 21 23 / 0.92)`（L99） | 颜色 | 选肢卡/开演卡底色（L1077 `.choice`） |
| `--choice-line` | `rgb(238 226 204 / 0.4)`（L100） | 颜色 | 选肢卡描边（L1078） |
| `--choice-ink` | `#f2ebde`（L101） | 颜色 | 选肢卡字色（L1082） |

**D. 全局字体（1 键）**：

| 变量 | 默认值 | 格式 | 改了会看到什么 |
| --- | --- | --- | --- |
| `--font-ui` | `system-ui, -apple-system, "Segoe UI", "PingFang SC", "Noto Sans CJK SC", "Microsoft YaHei", sans-serif`（L64–66） | 逗号分隔字体名，每项 ≤ 64 字符、总长 ≤ 200，字符集见 §5 | 台词（L793）、名牌（L778）、选肢卡（L1076）、Toast（L1460 附近）全部换字体。注释里的教训（L62–63）要写进工具描述：别推荐依赖本机衬线字体（缺字时笔画发虚） |

**E. 主色组（3 键）** —— 纸面批里唯一值得开的一组，因为它们在插件画面上有真实可见面：

| 变量 | 默认值 | 格式 | 改了会看到什么 |
| --- | --- | --- | --- |
| `--accent` | `#3f6b93`（L56） | 颜色 | 选肢卡左侧色尺（L1079）、hover 描边（L1092–1093）、主按钮底（L1129 `button.primary`）、链接键（L1024 `.link-btn`）、键盘焦点环（L34）、文字选中底（L41） |
| `--accent-ink` | `#f7fbff`（L57） | 颜色 | 主色底上的字色（L1130）——改 `--accent` 时要配套 |
| `--accent-soft` | `#dde7f0`（L58） | 颜色 | 主色淡底（文字选中 L41–43、`.bar-btn.on` L272–274） |

### 1.2 不暴露的键与理由

| 键（定义行号） | 理由 |
| --- | --- |
| `--nameplate-bg/ink/line`（L93–95、亮色改写 L214–216） | **死变量**：stage.css 全文无 `var(--nameplate-*)` 消费者（grep 无命中；同名定义在 `apps/web/src/app.css` L93–95 也一样只是定义）。插件里名牌真身 `.dialog-name` 消费的是 `--dialog-*`（L773–777）。开了它模型会困惑「改了怎么没反应」 |
| `--dialog-veil`（L85）、`--dialog-bad`（L78） | 死变量：stage.css 内无 `var(--dialog-veil)` / `var(--dialog-bad)` 消费者（grep 无命中；消费者在 AIVN app 自己的排队面板样式里，插件不注入 app.css） |
| `--dialog-hover`（L84）、`--dir-text-shadow`（L82） | 消费者只有 `.dir-btn` 一族（L1406、L1414、L1424）；插件 `directorBar={false}`（stage-view.tsx L443），导演栏整块不渲染（`packages/stage/src/StageTheater.tsx` L661–662 的条件块） |
| `--dialog-text-shadow`（L81） | 与舞台亮暗主题强耦合：亮色主题把它置 `none`（L204），深浅两套配对是设计过的（L79–80 注释）。单独开给模型，一次改动就会把浅底台词的字压糊 |
| `--choice-active-bg`（L102/212） | 派生值：`color-mix(in srgb, var(--accent) …%, transparent)`，跟 `--accent` 自动走 |
| `--choice-scrim`（L103/213） | 渐变形状与主题联动（L971 的选肢遮罩），白名单形状写死收益低、误配观感差 |
| `--bg --panel --panel-2 --paper-glow --ink --ink-soft --ink-faint --line --link --radius`（L47–60） | 插件里的可见面只剩 Toast（L1453–1459 `.toast`）、空态 Notice（stage-view.tsx L490–504，L497 用 `var(--ink)`）、StopPanel 次级键（L1009–1027 `.ghost-btn`/`.link-btn`）与全局按钮底（L1104–1109）。全是「错误提示与工具键」：改坏了伤可用性，改好了用户看不见；且这套纸面与 DSH 宿主自己的界面直接相邻（同一屏），剧目级改它会与宿主视觉打架 |
| `--shadow`（L104） | 消费者 `.theater-more`（L293）在插件里不出现（StageTheater.tsx 无该类渲染，grep 无命中） |
| 运动变量 `--type-ms --pause-* --fade-ms --move-ms --act-ms --move-ease --hover-ms`（L106–116） | 是演出节奏不是样式面；且 `prefers-reduced-motion` 会整组压零（L119–126），模型改了也未必看得见。明确不在本需求范围 |

### 1.3 取值校验（白名单外无口子）

- **颜色**（13 键）：`#rgb` / `#rrggbb` / `#rrggbbaa`，或 `rgb()/rgba()`、`hsl()/hsla()`（空格与逗号两种参数语法都认，stage.css 自己用的是空格语法，如 L70）。正则白名单 + 分量范围（0–255 / 0–360 / 0–100% / alpha 0–1 或 0–100%），拒绝一切函数名不在表内的写法（`var(`、`url(`、`color-mix(`、`calc(`、表达式拼接）。
- **`--dialog-bg`**：额外接受 `linear-gradient(<整数 0–360>deg, <颜色>, <颜色>)` 单一形态（与默认值同形，L70）。
- **`--stage-radius`**：整数 0–24，单位 px 必写。
- **`--sprite-dim`**：数字 0.2–1（至多两位小数）。
- **`--font-ui`**：逗号分隔的字体名列表；每项匹配 `^["']?[A-Za-z0-9][A-Za-z0-9 _'()!.-]{0,63}["']?$`（覆盖 `"Segoe UI"`、`Noto Sans CJK SC`、通用族 `sans-serif`）；整串再禁 `;{}<>url(` 与反引号；总长 ≤ 200。
- **`--dialog-shadow`**：`none` 或 `<0–24>px <0–60>px <0–100>px <颜色>`（x 偏移 / y 偏移 / 模糊 / 颜色，与默认值 L86 同形，不带 spread 与 inset）。
- 单值长度上限 64 字符（`--font-ui` 200）；theme.json 整文件 ≤ 4KB（与 routes.ts L29 的 `BODY_LIMIT = 8 * 1024` 同量级，留一半给 JSON 结构开销）。
- 键白名单：只收 §1.1 的 17 键，白名单外的键整体拒绝并列出全部合法键名（见 §5 出错表现）。

## 2. 声明落在哪

**结论：剧目根一份 `theme.json`（与 `play.json` 平级），键 = §1.1 白名单变量名（不带 `--` 前缀与否由实现定，建议**原样带 `--` 前缀**，与 stage.css 令牌名一一对应），值 = 通过 §1.3 校验的字符串。**

三个候选的对比：

| 候选 | 结论 | 依据 |
| --- | --- | --- |
| `play.json` 新段 | **不选** | ① `parsePlayConfig` 是白名单透传（`packages/core/src/play/config.ts` L242–277），不认识的键直接丢——加段必须改 stage-ai 主仓库的 core 包，而本需求是纯客户端渲染偏好，不该让引擎 DSL 包背上皮肤的包袱。② `play.json` 坏了 = 剧目打不开（`src/play.ts` L56–62 特意把报错做成可读的，说明这是真实风险面）；样式坏了只该「回默认皮」。③ 引擎已有 `craft` 段先例（config.ts L228–229），但 craft 是**剧作家每轮要读的行为参数**，样式没有任何运行时逻辑读它 |
| `assets/manifest.json` | **不选** | 语义是素材描述表（`src/assets.ts` L60–82），键是素材 id；样式不是素材。混进去会让「素材表有两个写者」的约定（persona `src/stagehand/prompt.ts` L180–181）变成三个用途 |
| 剧目根 `theme.json` | **选** | ① 与 AIVN app 的对标物 `plays/<id>/theme.css` 同位置同语义（定义在 `apps/web/src/theme.ts` L2–5「剧目主题层」；服务端端点 `apps/server/src/http.ts` L396–403；工坊可写白名单 `apps/server/src/playFiles.ts` L92–94）。插件这份是它的**受限版**：app 侧写者是人、收任意 CSS 走 `<link>` 直挂（theme.ts L17–26）；插件侧写者是模型，必须收成白名单键值 + 服务端校验（§5）。② 读写双方都在插件仓库内，stage-ai 两处 checkout 零改动。③ 容错独立：文件不存在 = 默认皮（`readManifest` 同款 ENOENT 处理，`src/assets.ts` L72–74）；JSON 坏了 = 一行可读报错 + 回退默认（L76–81 先例），剧目照常开演。④ 「进不进 git」随剧目目录整体走——DSH 会话工作区就是剧目根（`src/play.ts` L3–6），插件不管理剧目目录的版本控制，与 `play.json`/`characters/`/`assets/` 同待遇 |

谁能写、谁读：写者 = 搭台助手（经 `set_stage_style` 工具，§4）与用户（手改文件）；读者 = 插件宿主侧（`/aivn/play` 组装，§3）与搭台助手（空参回执，§4.3）。引擎（`@aivn/core`）与渲染包（`@aivn/stage`）都不读它——皮不进引擎。

## 3. 客户端怎么应用

### 3.1 注入点与优先级

- 挂在 `src/client/stage-view.tsx` L430 那个 `<div className="stage-root aivn-stage-view">` 的 **React `style` 内联 CSS 变量**上：`style={{ height: '100%', minHeight: 0, ...themeVars }}`。React 18 的 `style` 支持自定义属性键（TS 侧 `as React.CSSProperties` 断言）。
- 为什么内联而不是再注入一张 `<style>`：内联样式的优先级高于一切选择器，天然压过 stage.css 的 `html[data-stage-theme="light"] .stage-root`（L195）与 `html[data-accent="…"] .stage-root`（L151–190）——语义正是「**剧目声明的键，主题无权改；未声明的键，主题说了算**」。这个取舍在 AIVN app 里被反过来用过（`apps/web/src/hooks/useTheme.ts` L49–50 的注释：app 不用内联是因为剧目 theme.css 挂 `:root`，内联会压掉它）；插件里没有 theme.css 直挂层，内联就是剧目覆盖的唯一层，无冲突。
- ToastStack 在该 div 内（stage-view.tsx L478），变量可达。两个已知缺口，写明即可：Notice（L490，自己另起一个 `.stage-root`，空态提示不吃剧目皮）；`@aivn/stage` 的 Modal portal 到 body、继承链断（stage.css L10–11 注释）——插件当前没有渲染带 Modal 的路径（导演栏关闭），不构成实际问题。
- **默认视觉零变化**：无 `theme.json` → `/aivn/play` 不带 theme 字段 → `themeVars` 为空对象 → style 里一个变量都不设，computed style 与今天逐像素一致。

### 3.2 深浅两套主题下剧目覆盖怎么取舍

- 事实：插件里舞台主题切换不存在——DSH 宿主不写 `data-ui-theme`/`data-stage-theme`/`data-accent`（已核实，见文首），stage-view 不引 `useTheme`，舞台恒走 L45–117 的默认基线（浅纸面 + 暗画面）。所以今天「与主题切换的先后关系」就是：**剧目覆盖压在唯一基线上，无竞争**。
- 前瞻语义（写给实现与工具描述）：若未来舞台亮/暗切换被激活（stage.css L195 那层命中），剧目声明的键仍然赢（内联 > 属性选择器）。因此工具描述要写明：**你给的值在亮、暗两种舞台主题下都原样生效**——深浅敏感的键（`--dialog-text-shadow` 等）不进白名单（§1.2）就是这个原因；想整体换亮色台词条，就按 A 组整套给值（`--dialog-shadow` 参照 L208 的亮色配对值改浅）。

### 3.3 文件改了之后不刷新就生效（数据从哪来）

两条通道，幂等：

1. **首挂/切会话**：`GET /aivn/play`（`src/routes.ts` L72–81）的响应在现有 `dir/config/voice` 之外加 `theme` 字段（合法变量名 → 值的扁平对象；没有 theme.json 时整个字段缺省/为 null）。客户端 `PlayPayload`（stage-view.tsx L65–71）加 `theme?: Record<string, string>`，L169–176 的加载流程把它存进 state。
2. **运行中变更**：SSE `frame` 流加一种新帧 `{ kind: 'style'; theme: Record<string, string> }`（全量快照，幂等）：
   - `src/hub.ts`：`StageFrameBody` 联合（L32–35）加一支；新增 `appendStyle(sessionId, theme)`（与 L49–64 的 `append`/`appendBeat`/`appendVoice` 同构）。帧进缓冲（L71–74），重连补推幂等——最后一条 style 帧总是最新快照。
   - 触发方：`set_stage_style` 工具写完 theme.json 后调 `ctx.hub.appendStyle(ctx.sessionId, theme)`。工具的 `PlayContext` 本来就带着 hub 与 sessionId（`src/preset-tools.ts` L123–134）。
   - 客户端：stage-view.tsx L206 的 frame 分发加 style 分支 → `setThemeState(frame.theme)` → React 重渲 → 内联变量更新。
   - **用户手改 theme.json 不广播**：与 AIVN 的 theme.css 同语义——写者负责通知（app 侧是工坊存盘广播 `THEME_CHANGED`，`apps/web/src/theme.ts` L36–39）；手改后刷新页面/切会话生效。不做 fs.watch（不为低频路径引入平台差异面）。

## 4. 工具面

### 4.1 工具定义

- **名字**：`set_stage_style`（搭台助手专属，与 `set_craft` 同层装配在 `src/preset-tools.ts` L146–158 的搭台分支里，**无能力位门控**——纯本地校验与写文件，不依赖任何后端配置，恒注册；`capabilities.ts` L17–28 不加位）。
- **参数 schema**：17 个键全部可选，每键 `oneOf: [ { type: 'string', description: <该键格式与后果> }, { type: 'null' } ]`——**三态语义与 `set_craft` 逐字对齐**（`src/stagehand/tools/set-craft.ts` L21 的 RESET 文案、L38–106 的 oneOf 结构）：省略 = 不动；给值 = 校验后写入；给 `null` = 恢复默认（从 theme.json 删该键，删空则整个文件删除）。对象整体**不**支持嵌套分组——17 键平铺，模型少犯「组内漏键」的错。
- **AND 语义**：一次调用 = 一次原子事务——任一键校验失败，整个调用拒绝，不落盘不广播（§5）；全部合法才写文件 + 广播 + 回执。

### 4.2 描述正文（写给模型看，实施时放入 `src/stagehand/tools/set-stage-style.ts`）

要点清单（照 set_craft.ts L23–32 的行文风格组织）：

1. 一句话身份：设置这部剧的舞台皮肤（台词条、选肢卡、名牌、舞台衬底、圆角、字体、主色），写进剧目根的 `theme.json`，写完立即推到已打开的舞台，不用刷新。
2. 三态：省略 = 保持现状；给 null = 恢复引擎默认。
3. 值格式逐组给**可抄的示例**：颜色 `#1c1819`、`rgb(28 24 25 / 0.9)`；`dialog_bg` 还可 `linear-gradient(178deg, rgb(28 24 25 / 0.9), rgb(17 15 17 / 0.94))`；`stage_radius` `0–24px`；`sprite_dim` `0.2–1`；`font_ui` 逗号分隔字体名（示例给默认值全文）；`dialog_shadow` `none` 或 `0 10px 30px rgb(0 0 0 / 0.45)`。
4. **后果与联动警告**：台词条那组是一套玻璃（底/描边/字/旁白/独白/角标/投影），改底色就要连字色一起想；换亮色台词条时 `dialog_shadow` 要改浅；`accent` 影响选肢卡左尺与按钮主色，改它要配套 `accent_ink`；`font_ui` 别只写一个本机未必有的字体名，栈尾要留 `sans-serif` 兜底。
5. **什么时候别用**：用户没提样式就不要动——默认皮是设计过的（stage.css L45–117 的注释就是设计说明）；「顺手美化」不是理由；不要用它表达情绪或主题暗示（那是台词与配乐的事）。
6. 空参调用 = 查看当前样式（回执给「当前值 vs 默认值」对照）。
7. 改完告诉用户去舞台 tab 看效果，并复述改了哪几个键。

### 4.3 读面

不新增 get 工具。**空参回显**：`set_stage_style()` 不带任何参数 → 回执渲染「当前生效值 + 默认值」对照表（set_craft 的同款先例，set-craft.ts L131–135）。默认值表是文档性的（抄自 stage.css §1.1 的行号列），漂移由 e2e 兜底（§6 测试点 5）。

另外在搭台助手的《当前状态》注入段（`src/stagehand/context.ts` L35–47 的 `readStagehandSnapshot`）加一行：`theme.json（改了 N 个键）` 或 `theme.json（无，默认皮肤）`——文件清单本来就会列出它（L50–59），补这一行是让模型在动手前知道现状，不必读文件。

### 4.4 persona

`src/stagehand/prompt.ts` 加一章 `# 舞台样式（set_stage_style）`，**恒出现不门控**（理由见 §4.1），插入位置在 `writingPoints`（L154–185）之后、`MUSIC` 之前，拼装处 L221–236 的数组里对应加一行。内容 = §4.2 的压缩版（四五行：做什么、成组联动、什么时候别用、空参可查）。

### 4.5 界面复用同一套路径

用户侧不新增任何样式编辑 UI（§6 明确不做）。「界面」就是舞台渲染本身 + 与助手的对话；数据面（theme.json + `/aivn/play` 的 theme 字段 + style 帧）是唯一通道，将来任何 UI（预览器、设置面板）都读写它，不另开旁路。

## 5. 安全与边界

1. **没有任意 CSS 注入口**：模型交付的是 17 个预定义变量的**值**，经 §1.3 格式校验后才存在；没有任何路径把模型文本当 CSS 规则注入。注入点唯一：stage-view.tsx L430 的内联 CSS 变量（§3.1）。CSS 变量值不会被解析成选择器/声明，配合格式白名单（拒 `url(`、`var(`、`calc(`、`color-mix(`、`;{}<>`），无外联与注入面。
2. **校验是双闸，共享一份实现**：写闸 = 工具 execute（新文件 `src/style-tokens.ts`：白名单键表 + 逐键校验器 + describe + 默认值表）；读闸 = `/aivn/play` 组装时（新文件 `src/theme.ts` 的 `readPlayTheme(dir)`）对 theme.json 逐键再过一遍白名单——用户手改的文件同样过闸，非法键丢弃 + 服务端日志一行（`oneOf` 的先例口径：丢非法值不让剧目出事，`packages/core/src/play/config.ts` L279–284）。客户端不校验，只消费服务端已过滤的数据。
3. **写入路径**：只在剧目根写 `theme.json` 一个文件（工具拿 `ctx.playDir()`，preset-tools.ts L126–130）；不碰 `play.json`、不碰 `assets/`、不碰 DSH 工作区外。工具用读改写（读现有 → 应用 patch → 序列化写回），与 set_craft.ts L112–143 同构。
4. **长度与数量上限**：单值 ≤ 64（font_ui ≤ 200）、整文件 ≤ 4KB、键 ≤ 17 个白名单键（§1.3）。
5. **出错表现**：
   - 任一键非法：**不落盘、不广播**，工具抛错，回执逐键列出「键名 → 收到的值 → 合法形状」（模型可据此重试整包）；拒绝是全有或全无，杜绝「改了一半」。
   - theme.json 不存在：不是错误（默认皮）。
   - theme.json JSON 坏了（用户手改坏）：`readPlayTheme` 抛可读错误（带文件名，`src/assets.ts` L76–81 的先例文案风格），`/aivn/play` 捕获后按无主题处理 + 日志一行——舞台照常渲染默认皮，剧目永不因皮肤打不开。
   - theme.json 值合法但 JSON 里混了白名单外的键：读闸丢弃 + 日志；写闸（工具）则整体拒绝（写者是模型，要求更严，逼它修正认知）。
   - SSE style 帧解析失败：客户端丢弃该帧（stage-view.tsx L208–212 坏帧丢弃的既有口径）。

## 6. 实施步骤与明确不做

### 6.1 按文件、按顺序（全部在插件仓库；stage-ai 两处 checkout 零改动）

1. **`src/style-tokens.ts`（新）**：17 键白名单（键名/格式校验器/默认值/一句话后果）、`validateThemePatch`（全有或全无，逐键报错）、`describeTheme`（当前值 vs 默认值对照渲染）。纯函数、无依赖。
2. **`src/theme.ts`（新）**：`readPlayTheme(dir)`（读 theme.json：ENOENT → null；坏 JSON → 可读错误；逐键过读闸白名单）、`THEME_FILE = 'theme.json'` 导出。
3. **`src/hub.ts`**：`StageFrameBody`（L32–35）加 `{ kind: 'style'; theme: Record<string, string> }`；加 `appendStyle`（仿 L49–56）。
4. **`src/routes.ts`**：`/aivn/play` 处理（L72–81）调 `readPlayTheme(play.dir)`，合法时响应加 `theme` 字段。
5. **`src/stagehand/tools/set-stage-style.ts`（新）**：schema + §4.2 描述 + execute（读 theme.json → `validateThemePatch` → 写回 → `ctx.hub.appendStyle` → 回执 `describeTheme`；空参走回显分支）。
6. **`src/preset-tools.ts`**：搭台分支（L146）`tools.push(createSetStageStyleTool(play))`。
7. **`src/stagehand/prompt.ts`**：加「舞台样式」章（§4.4），拼装数组（L221–236）插入。
8. **`src/stagehand/context.ts`**：`readStagehandSnapshot`（L35–47）加 theme.json 现状一行。
9. **`src/client/stage-view.tsx`**：`PlayPayload`（L65–71）加 `theme?`；state 加 theme；L430 的 div 展开 `...themeVars`；frame 分发（L229–254 一带）加 style 分支。
10. **`README.md`**：Agent 工具表（L277 起）加 `set_stage_style` 行；正文加一小节（什么时候用、值格式、theme.json 是什么、手改后刷新生效）。
11. **`e2e/verify-style.mjs`（新）+ `e2e/run.mjs`**：MODULES 表（L14–31）加 `style` 模块。构建（`pnpm build`，bundle 进 lib/）后跑。

### 6.2 测试点与 e2e 断言点

1. `style-tokens.ts` 单元断言（并进 verify-style.mjs 的 node 段，esbuild 临时 bundle 后直跑，`e2e/verify-media.ts` 的先例）：合法颜色/渐变/长度/字体栈全过；`url(`、`var(`、超范围数值、白名单外键、超长值全拒且报错文案含键名。
2. 默认零变化（浏览器段，`e2e/css-diag.mjs` L56–100 的 getComputedStyle 探针范式）：无 theme.json 的会话，`.theater-dialog` / `.choice` / `.stage-root` 探针的计算值与改动前基线一致（基线值可硬编码自 stage.css §1.1 默认列）；`style` 属性上无任何 `--` 变量。
3. 应用链路：预置一份合法 theme.json → `/aivn/play` 响应带 theme → 舞台 div 的 inline style 出现变量 → 探针计算值变化（与 theme.json 值一致）。
4. SSE 帧：浏览器开着舞台时（node 侧或另一会话）改 theme.json 并 `appendStyle` → 不刷新页面，探针计算值在帧后变化。
5. 防漂移：解析页面已注入的 `style[data-plugin-css="@aivn/stage/stage.css"]` 文本（inject-css.ts L10 的挂载痕迹），提取 `.stage-root` 块的变量名，断言白名单 17 键 ⊆ 提取集、默认值表与实际声明一致——stage.css 改名/改默认值时此测试红。
6. 工具面（`verify-stagehand.mjs` 的会话日志断言范式）：搭台助手会话里 `set_stage_style` 出现在工具面；一次合法调用 → theme.json 落盘且内容与参数一致；一次含非法值的调用 → 回执报错、theme.json 字节不变；空参调用 → 回执含默认值对照。
7. 剧作家会话不装该工具（preset-tools.ts L140–144 分支验证，会话日志断言）。

### 6.3 明确不做

- **不做任意 CSS 注入**：不收 CSS 文本、不挂 `<link>`、不引 AIVN 的 theme.css 机制（差异与理由见 §2）。
- **不动 stage-ai 两处 checkout**：stage.css、`@aivn/stage`、`@aivn/core` 零改动；死变量（`--nameplate-*` 等）留在原处不删（它们是 app 侧的活变量，见 §1.2）。
- **不做纸面批与运动变量**（§1.2 全表）。
- **不做样式编辑/预览 UI、预设主题库、亮暗舞台切换**——舞台主题切换本身（激活 `html[data-stage-theme]` 那层）是另一个需求。
- **不做 fs.watch 手改监听**：手改 theme.json 靠刷新/切会话生效（§3.3）。
- **不做对比度自动校验**：只做格式白名单；可读性靠成组联动警告文案（§4.2 第 4 条）。
- **Notice 与 portal Modal 不吃剧目皮**（§3.1 已说明缺口与理由，不补）。
