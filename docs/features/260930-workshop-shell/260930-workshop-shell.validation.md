# workshop-shell 用户验证

## 验证说明

- 验证对象：工坊宿主重构——全站唯一浮层（默认右侧抽屉 / 可切全屏）、遮罩点空白收起、四 tab 改名与重排、Esc 分层。
- 环境/前置条件：worktree `.worktrees/workshop-ux` 的 dev 服务（api 25002 / web 25003），剧目 `demo`（可开演）与临时剧目（用来验就绪门，已删除）。camoufox headless，视口 1280×800 与 390×844 各一遍。
- 下列「实际结果」由 Agent 在真实浏览器里逐项操作记录（`docs/features/260930-workshop-shell/screenshots/`），用户可按同一路径复核。

## 验证项

| 验证步骤 | 预期结果 | 实际结果 | 状态 | 备注/证据 |
| --- | --- | --- | --- | --- |
| 1. Title Screen 点「工坊」 | 在当前页右侧滑出抽屉（**不再跳页**、顶部没有「← 标题」那第二条标题栏），背后压一层半透明遮罩 | 一致：抽屉 460px 贴在右侧，剧目详情被遮罩压暗，URL 仍是 `#/play/demo` | 通过 | `screenshots/02-drawer-from-title.png` |
| 2. 抽屉打开时点面板外的空白处 | 抽屉收起，回到刚才那一页，页面本身没有被误点 | 一致：`.workshop` / `.workshop-scrim` 均已从 DOM 摘除，URL 不变 | 通过 | DOM 断言 |
| 3. 舞台顶栏点「工坊」→ 点顶栏「展开」 | 面板**铺满整个视口**（不是挤在舞台下方那一块），再点「收起」回到 460px 抽屉 | 一致：`getBoundingClientRect()` = 0,0,1280×800（`workshop-full`），收起后 = x820/460×800 | 通过 | `screenshots/09-stage-drawer.png`、`10-stage-full.png` |
| 4. 逐个看四个 tab | 顺序为 对话 / 素材 / 配置 / 文件；「配置」页就是原来的创作口径编辑器 | 一致：tab 顺序 `[对话,素材,配置,文件]`；「配置」页是 craft.md 编辑器（重新载入/保存），内容与改名前的「创作口径」页同一份 | 通过 | `screenshots/04~06` |
| 5. 抽屉里开全屏音色库，按一次 Esc | **只关音色库**，工坊抽屉还开着；再按一次 Esc 才关抽屉 | 一致：第一次 Esc 后 `{voice:false, workshop:true}`，第二次 `{voice:false, workshop:false}` | 通过 | `screenshots/07-voicelibrary-inside-drawer.png` |
| 5b. 舞台「路线」视图上开着工坊，按 Esc | 只关工坊，路线视图留在原处；第二次 Esc 才回舞台 | 一致：第一次 `{workshop:false, route:true}`，第二次 `{workshop:false, route:false}` | 通过 | DOM 断言（这是旧版「一次 Esc 连关几层」的正面回归） |
| 6. 就绪门里的「素材与配置」 | 打开工坊抽屉并直接落在「素材」页（原来是死链） | 一致：`.workshop-tabs` 中 `素材` 处于 active | 通过 | `screenshots/12-gate-assets-tab.png` |
| 7. 抽屉开着时换页（点导航 / 浏览器后退） | 工坊自动收起 | 一致：跳 `#/play/demo/saves` 后 `.workshop` 消失 | 通过 | DOM 断言 |
| 8. 窄屏（390×844） | 抽屉占满宽度，顶栏不出现「展开/收起」按钮；✕ 与 Esc 仍可关 | 一致：抽屉 390px 满宽，顶栏只剩 ✕（`display:none` 生效） | 通过 | `screenshots/11-mobile-drawer.png` |
| 9. 回归：剧目库 / 设置 / Title / 周目页四屏 | App 改用「screen 单选 + 浮层」后四屏都照常渲染 | 一致：四屏 innerText 均正常 | 通过 | DOM 断言 |

## 验证结论

Agent 浏览器实测 9 项全过（截图与 DOM 断言见上）。**待用户在同一 dev 实例上确认后收尾。**

## 待跟进

- 无。
- 已知取舍（不做）：工坊没有独立 URL；抽屉打开时顶栏被遮罩盖住，STUDIO 键不可再点（模态语义，收起用 ✕ / Esc / 点空白）。
