# AIVN 全界面现代化重构（窄屏适配）端到端测试报告

> 测试时间：2026-10-10 11:44–12:27 ｜ 测试人：e2e-tester 子代理
> 被测：`feat/modern-ui-rehaul` worktree，前端 `http://127.0.0.1:37394`（Vite dev）→ 后端 `:30774`
> 规格依据：`261010-ui-rehaul.design.md`

## 测试环境

- Chromium（本机 Chrome，headless，playwright-cli 会话）
- 主视口 **390×844**（`setViewportSize`），回归视口 **1440×900**
- **DPR=1、无 touch 仿真、无 iPhone UA** → 纯 hover 行为改由 CSS/代码取证 + 无 hover 态截图判断
- 剧目：`320000`（主链路、工坊八页、保存测试）、`test`（画廊两列有图）
- 真外部 API 路径（剧作家 LLM、生图、TTS 试听）全部未触发；舞台上只推进过一次已缓冲的句子，之后不再点击推进
- 环境坑（影响后续 e2e，值得记一笔）：浏览器进程继承了 `HTTP_PROXY=127.0.0.1:7890`，而 `NO_PROXY` 里的 `[::1]` 使 Chrome 丢弃整张绕行表 → **`127.0.0.1:37394` 在浏览器里 `ERR_HTTP_RESPONSE_CODE_FAILURE`，改用 `http://localhost:37394` 正常**（curl 一直 200，别被误导）

## 功能类测试项

| # | 验证步骤 | 预期结果 | 实际结果 | 状态 | 备注/证据 |
| --- | --- | --- | --- | --- | --- |
| 1 | 390×844 剧目库 → 点第一张剧目卡 → 标题画面点 CONTINUE → 舞台 | 每步可达，舞台见背景/立绘/台词，点画面推进；全程无需横滑缩放 | 全链路可达：`#/` → `#/play/320000` → `#/play/320000/stage`；立绘+台词渲染；点 (195,300) 句子推进（「少女不答…」→「對了，還沒問你叫什麼。」）；所有页面 `documentElement.scrollWidth` 恒 = 390，无横向溢出 | 通过 | ![剧目库](e2e/shots/a01-library-390.png)<br>![标题](e2e/shots/a02-title-390.png)<br>![舞台](e2e/shots/a04-stage-settled.png)<br>此拍无背景素材（`.theater-bg-fallback`，backgroundImage:none）＝数据侧缺图，非 UI 缺陷 |
| 1b | 同上，看标题画面菜单 | 中文动作名（继续/开始新周目/切换周目/工坊/导出），危险操作收进「更多」 | 菜单为 **全英文** CONTINUE/START/LOAD/WORKSHOP/SYSTEM/EXIT；EXPORT、DELETE 平铺在屏幕右下角，10.5px 白字（rgba(255,255,255,.82)）压在浅色封面上，底缘距屏幕仅 6px、高 22px | 不通过（文案/层级，非阻断） | 规格 §4.3 明列中文文案与「危险操作放更多内」；见 ![标题](e2e/shots/a02-title-390.png) 底部 |
| 2 | 舞台 Quick Menu 的 Log / Route / CG 三入口逐个打开并用 × 回舞台 | 三面板都能开、都能回 | 三入口均打开（回顾/路线/画廊），`.stage-panel-close` 关闭后 `.dialog-text` 仍在＝回到舞台 | 通过 | ![回顾](e2e/shots/b01-log-390.png) ![路线](e2e/shots/b03-route-390.png) ![画廊](e2e/shots/b08-cg-390.png) |
| 2b | 路线面板镜头控制：横向/纵向 + 回到开头/跳最新/缩小/放大/看全树（390 宽） | 7 个控件可命中，不被画布遮挡，动作生效 | `elementFromPoint` 7/7 命中按钮；`.route-scene` transform 实测逐个变化（回到开头 `scale(1)` → 跳最新 `translate(-287,343)` → 缩小 `0.869` → 放大 `1` → 看全树 `scale(0.55) translate(-3216,367)`）；工具条 fixed 于 y=791 h=53，画布在其下方 | 通过 | ![横向模式](e2e/shots/b04-route-h-390.png)<br>按钮 30×30（拇指偏小）；节点卡 132×104（`routeTree.ts` NODE_W/H），规格 §4.7 要求 240×148 最小 |
| 2c | 点节点后卡内「跳转/重写/删除」在 390 下可达 | 触屏无 hover 也能操作 | 点选节点加 `.selected` 后详情浮层展开，三动词 `elementFromPoint` 全部 OK；来路 `.kin`=2、将删 `.doomed`=57 标记正确 | 通过 | ![选中节点](e2e/shots/b07-route-selected.png)<br>缩放 0.73 时动词实际命中区 44×19，偏小 |
| 3 | 工坊八 tab 逐一切换（390×844），每页有真实内容、无横向溢出 | 8/8 渲染，`scrollWidth`=390 | 8/8 有内容（对话 5106 / 剧目 1736 / 角色 3060 / 记忆 188→(载入后)完整 / 素材 2086 / 文件 718 / Agent 15092 / 设置 124 字符正文），`scrollWidth` 全 = 390，`clipped`=0，无竖排中文 | 通过 | ![剧目页](e2e/shots/c-play-390.png) ![角色](e2e/shots/c-characters-390.png) ![记忆](e2e/shots/c-memory-390.png) ![Agent](e2e/shots/c-agent-390.png)<br>![素材](e2e/shots/c-assets-390.png) ![文件](e2e/shots/c-files-390.png) ![工坊设置](e2e/shots/c-settings-390.png)<br>四页表单拼图 [s-ws-forms.png](e2e/shots/s-ws-forms.png)、另四页 [s-ws-misc.png](e2e/shots/s-ws-misc.png) |
| 3b | 对话页输入框与发送键 | 同高、发送键可按 | textarea 271×63 @y774 与 发送 87×63 @y774 **同顶同高**；空内容 `disabled=true`，填入文本后 `disabled=false`（accent 底白字）；未发送任何消息 | 通过 | ![输入可用](e2e/shots/c2-chat-typed.png) |
| 3c | 八 tab 的当前项在 390 下是否可见 | 当前 tab 应可见 | `.studio-nav` scrollWidth 653 > clientWidth 390；进入 `tab=agent` / `tab=settings` 时 `scrollLeft`=0、当前项 right=567 超出容器 390 → **当前 tab 不在屏幕内**，且无渐隐/箭头提示 | 不通过（导航可见性） | 见 [s-ws-forms.png](e2e/shots/s-ws-forms.png) 最右两格的顶部条 |
| 4 | 剧目/角色/记忆/Agent 四页：不滚动，直接按底缘保存键 | 保存键常驻底边、可按、有反馈 | 四页 `.save-row` `position:sticky; bottom:0`，滚动位置 0 即可命中；按钮 y=789、高 43（Agent 页 88×43「保存设置」）。反馈：剧目/角色/记忆「已保存」、Agent「已保存，下一轮生效。」；均验证落盘（`play.json` 标题、`characters/protagonist.md`、`memory/always/premise.md`、`play.json.agents`） | 通过 | ![剧目保存](e2e/shots/d-play-saved.png) ![角色保存](e2e/shots/d-char-saved.png) ![记忆保存](e2e/shots/d-memory-saved.png)<br>反馈文字在编辑器下方而非按钮旁（记忆/Agent 页），`.save-row` 内只有按钮 |
| 5 | 全局设置 390×844：分组胶囊横滑并跳转 | 可横滑、点击跳到对应分组 | `.settings-nav` scrollWidth 689 > clientWidth 330；点最后一个胶囊「主题设置」→ `scrollLeft` 0→359（胶囊滚入可视区）、`.settings-body` scrollTop 0→6015、该项 `is-active` | 通过 | ![设置主题组](e2e/shots/e-settings-theme-390.png) [胶囊条特写](e2e/shots/e-settings-nav-crop.png) |
| 5b | 主色换一个立即生效 | 不保存也生效 | 点紫胶囊 → `--accent` `#1b5aa6`→`#6a5599`（即时）；点回蓝 → `#1b5aa6`。未点「保存设置」，`settings.json` 未被写 | 通过 | |
| 5c | 保存设置/放弃改动常驻底栏；数据目录与监听端口在滚动内容最末尾 | 底栏固定、启动参数在最末 | `.settings-footer` y=768 h=54，在滚动容器 `.settings-body`（sh 6613 / ch 598）**之外**，滚多深都在；「数据目录：… 监听：0.0.0.0:30774」是滚动内容最后一行（rectY 6683，正文末位） | 通过 | 小问题：放弃改动 70×35 与保存设置 88×43 并排高度不齐 |
| 6 | 1440×900 各页扫一遍（库/设置/标题/周目/舞台/工坊 对话·剧目·素材·文件） | 宽屏无回归 | 9 个页面 `scrollWidth` 全 = 1440、`clipped`=0、无竖排中文；保存条仍 sticky（y=833）；布局与重构前同一套桌面骨架 | 通过 | [宽屏拼图一](e2e/shots/g-wide-montage.png) [宽屏拼图二](e2e/shots/g-wide2.jpg) |

## 体验类测试项

| # | 体验场景 | 关注点 | 观察 | 建议/问题 | 备注/证据 |
| --- | --- | --- | --- | --- | --- |
| 1 | 手机竖屏通读一遍（库→标题→舞台→三面板→工坊八页→设置） | 裁切/遮挡、够不够得着、竖排中文、完成度 | 正面：**没有任何一页出现横向溢出或被裁在屏幕右缘之外**（逐页 `scrollWidth`=390、clipped=0）；没有中文被挤成竖排；表单页上下单列、标签在控件上方，读起来顺；保存条/设置底栏都钉得住 | 三处最值得改：<br>① **标题画面**：菜单全英文 + 右下 EXPORT/DELETE 白字压在浅色封面底部几乎看不见、距底缘 6px（真机就是 home 手势区，且 22px 高按不准）<br>② **工坊 tab 条**：八个入口横滑，深链/直接进入靠后的 tab 时看不出自己在哪一页，也没有「右边还有」的渐隐提示<br>③ **舞台两张立绘**：390 下各 484×861，互相重叠、左立绘被裁掉约 1/3，人物顶到屏幕边缘没有喘息 | 见 a02 / s-ws-forms / a04 |
| 1b | 拇指可达性 | 命中区尺寸 | 快捷菜单按钮 28–51 × **30**、导演栏 30×**40**、工坊 tab 胶囊高 **30**、路线节点动词缩放后 44×**19**、标题 EXPORT/DELETE 67×**22** | 普遍低于 44px 触摸准则；窄屏既然已经允许折行，建议把折行省下的纵向空间给到命中区（≥40 高），而不是留白 | 数据来自各页 `getBoundingClientRect` |
| 1c | 术语是否还给玩家 | 文案 | 残留：剧目库指标卡 `ALL PLAYS / ACTIVE PLAYS / TOTAL SAVES / ENGINE STATUS / ONLINE`；舞台底栏 `Auto / Log / Route / CG / Title`；画廊空态「**演出时**在舞台上点生图」；剧目页帮助文案出现 `<say id="passerby">`；记忆卡标题 `scene（state）`、`state.json（state）`、`threads（state）`；剧目卡角标显示内部 id（`320000`、`mahjong`），卡片可访问名也只有 id | 规格 §4.1/§4.10/§4.5 明确要求删掉内部 id 与引擎词；这是「重构没做完」最直观的读数 | a01、b08、c-play、c-memory |
| 1d | 哪一页最像没做完 | 完成度 | 舞台内**画廊空态**：整屏只有一行居中灰字，无图标、无动作按钮（规格 §4.8 要求图标 +「回到舞台生成」+「在工坊管理素材」两个动作）；回顾面板同样只有一行灰字 | 优先补画廊空态，它是玩家最容易撞上的空屏 | ![画廊空态](e2e/shots/b08-cg-390.png) |
| 2 | 舞台台词条读长句 | 是否被菜单压住、能读几行 | **没有被压住**：菜单是 `.dialog-foot` 里随正文流的右半（stage.css 2372 注释即为此意），正文区实测 y 631→774 = 143px ≈ **5.7 行**（15.5px / 行高 24.8px）；台词条 `min-height:30%`(253px) `max-height:62%`(523px)，长句会把底板顶高到约 **17 行** 才开始滚 → 一般句子够读 | ① 正文 15.5px 低于规格 §3.1 的 `clamp(17px,1.45vw,24px)` 下限，手机上偏小；② 打字机没有跟随滚动（`packages/stage` 内无 `scrollTop/scrollIntoView`），>17 行的句子尾部要手动滚进台词条里才能看到 | a04、a05 |
| 2b | 顶部导演栏四个图标（不看提示能否猜出） | 可猜性 | 图标＝气泡 / 铅笔 / 逆时针箭头 / 图片。**气泡、铅笔**直觉可读（插一句、改这句）；**逆时针箭头**第一反应是「撤销」，而它其实是「重写这一轮（分叉留旧枝）」，语义相反；**图片**与右下 CG 画廊入口撞意（一个出图、一个看图）。窄屏 `.dir-label` 被隐藏，只剩 30×40 图标、贴在屏幕顶缘 y=5 | 至少把「重写」换成不会读成撤销的图形（如分叉/刷新+箭头），或窄屏保留 2 字动词；`title` 在触屏永远不出现，不能作为唯一解释渠道 | [导演栏特写](e2e/shots/f-director-crop.png) |
| 2c | 名牌与压暗的观感 | 与规格一致性 | 名牌＝纯白粗字无底无框（stage.css 1114 注释写明按 ATRI 风做），规格 §3.4 要求「白底 + 角色主题色 1.5px 描边 + 深色文字」；非说话者立绘默认 `filter:brightness(0.55)`（StageTheater:805 无条件加 `.dim`），规格 §3.4 要求默认不压暗 | 两处都是「规格 ↔ 实现」相反方向的偏离，需要产品拍板：要么改实现，要么改规格；现状是玩家看到的和验收文档写的不一样 | a04 vs a05 对比（右角色变暗） |
| 3 | 真机手势区 | 底缘安全区 | 舞台台词条、画廊网格、工坊底栏都写了 `env(safe-area-inset-bottom)`，方向正确；但 `index.html` 的 viewport meta 没有 `viewport-fit=cover`，iOS 全屏态下这些 inset 恒为 0 | 若真要上手机浏览器/加桌面主屏，补 `viewport-fit=cover` 再验一次底缘 | — |

## 结论

- **功能：通过 12 · 不通过 2 · 受阻 1**
  - 不通过：标题画面菜单文案（英文 + 危险操作外露）、工坊 tab 条当前项不可见
  - 受阻：回顾面板内容渲染（`320000` 谱系无留存句，`buildTranscript(lineage.view, stage.lines)` 返回空 → 需要一个真正演过几轮的周目才能判断列表/定位/重听是否正确）
- **体验：13 项观察，关键问题 3**（标题画面底部可读性与安全区、工坊 tab 条当前项可见性、舞台两立绘在 390 下的重叠与裁切）＋ 术语残留与空态完成度两类成串的小问题
- **窄屏适配骨架本身是立住的**：390 下 21 个页面/面板零横向溢出、零被裁元素、零竖排中文；保存条/底栏/镜头条/面板返回这些交互骨架全部实测可用，宽屏 1440 无回归。
- **总体：通过（可交付验收），但有 2 项不通过 + 3 项关键体验问题需要跟进**

## 待跟进

1. **标题画面**：菜单换成规格里的中文动作名；EXPORT/DELETE 收进「更多」或至少给暗底渐变 + ≥32px 命中区 + 底缘安全区内边距。（`apps/web/src/views/TitleView.tsx`，注意该文件正被另一 agent 编辑）
2. **工坊 tab 条（`.studio-nav`）**：挂载/切换时把 `.active` 项 `scrollIntoView({inline:'nearest'})`，并给右缘加渐隐或「更多」提示。
3. **舞台窄屏立绘**：两张同框时按视口宽度收敛 `--sprite-height`/`--x`（或 390 下改为一大一小/前后错位），避免左立绘被裁 1/3 且完全盖住背景。
4. **回顾面板**：补一个已演若干轮的周目复验列表、定位、原文折叠区（本轮受阻）。
5. **画廊/回顾空态**：按规格 §4.8 补图标 + 两个动作按钮；文案去掉「演出时」。
6. **术语清理**：剧目库指标卡英文标签、舞台底栏 `Auto/Log/Route/CG/Title`、帮助文案里的 `<say id="passerby">`、记忆卡标题 `state.json（state）`、剧目卡角标内部 id。
7. **规格与实现对齐**：名牌样式（白底描边 vs 无底白字）、非说话者默认压暗（规格要求默认关）、台词字号 15.5px（规格下限 17px）、路线节点 132×104（规格 240×148）——四项请产品明确「改代码还是改规格」，否则下轮验收还会各说各话。
8. **触摸命中区**：快捷菜单/导演栏/tab 胶囊/节点动词统一抬到 ≥40px 高。

## 附：测试数据复原声明

本轮为验证保存链路，对 `plays/320000` 做过 4 次字段写入（标题、主角人设、premise 记忆卡、`agents.playwriter.thinking`），**全部已复原**并经 API/磁盘核对：`title` 原值、`agents` 键已移除、`characters/protagonist.md` 与 `memory/always/premise.md` 字节数与首尾内容回到改前（后者中途被一次 shell 传参转义污染，已按原长度 437 字符精确重建）。全局 `settings.json` 未被写入（未点「保存设置」，主色改动已在页面内回退）。未向任何模型/生图/TTS 接口发起请求。

---

## 后续核对（主 agent，当日 12:5x）

「受阻 1 项：回顾面板内容渲染」已用假 WS 注入一段演出复验（`page.routeWebSocket(/\/ws/)` 发 `hello` + `beat_start` + 16 条 `events`，不触发任何模型请求）：**「台词」栏渲染正常**——玩家输入（accent 左边框）、思考（紫字）、旁白、带名牌的台词，以及真实谱系里的历史行按序混排；390×844 下无溢出、无裁切。证据 `docs/screenshots/m10/06b-log-transcript.png`。

「原文」栏仍读服务端 session 快照（`GET /history`），注入不了，只能等一个真演过的周目——这是设计使然，不是缺陷。另外注意：回顾抽屉**默认落在「原文」栏**（`rawHistory` 初值为 true），玩家点开会先看到「还没有留存的历史」这个空态；是否把默认改成「台词」需要产品拍板。
