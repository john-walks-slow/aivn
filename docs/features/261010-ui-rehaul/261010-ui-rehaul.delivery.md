# 前端全面重构：交付说明

分支 `feat/modern-ui-rehaul`（worktree `.worktrees/modern-ui-rehaul`，改动全在工作区、零提交）。
同视口（1280×720）、同剧目（`stub`）的**改前 / 改后**实拍：

![宿主页面 改前改后](<../../screenshots/before-after/host-pages.png>)

![舞台与工坊 改前改后](<../../screenshots/before-after/stage-and-workshop.png>)

---

## 一、六块界面各自改了什么

| 目标里的那一块 | 关键改动 |
| --- | --- |
| 素材库 | 从「四列卡片 + 底部文字链」改成控制台：品牌头、搜索、四张指标卡、筛选胶囊、卡片悬浮动作、浮动的新建/导入；空态与「无结果」都给下一步动作 |
| 全局设置 | 单列长表单 → 左侧九组导航 + 可折叠分组 + 底栏常驻的保存/放弃；数据目录与监听行移到滚动区内容末尾 |
| 舞台与导演工具 | 台词条改为压暗玻璃 + 章节标题卡；导演栏三态（图标/展开/弹窗）；快捷行 Auto/Log/Route/CG/Title；**修好八个行为词**（此前被入场动画选择器盖掉，一个都不演）与四类特效（抖动/闪光/宽画幅/暗角） |
| 工坊工作台 | 九宫格 rail（窄屏自动居中所选 Tab）+ 全宽面板；对话/剧目/角色/记忆/素材/文件/Agent/设置各自重排；待注入队列胶囊、脏数据守卫、离线 toast |
| 路线树与 Transcript | 路线画布（节点卡、运镜七键、图例、回看中不重播演出）；回顾页重排（说话人、时间、跳转） |
| Token 与动效 | 令牌层重建（浅/深两套 + 五档主色）；`prefers-reduced-motion` 归零；入场/退场/差分交叉淡化；窄屏命中区统一 ≥32px |

## 二、怎么自己验

```bash
# 起开发态（本机已在跑：Vite 37394 → 后端 30774）
pnpm --filter @aivn/web dev
```

- 桌面：`http://localhost:37394/#/` → 剧目库；任一周目 → 舞台 / 工坊
- 手机：同一地址开窄屏（或浏览器设备模拟 390×844）；舞台 ⟷ 工坊用左上角切换器
- 暗色：设置页「主题设置 → 界面主题」切「跟随系统 / 亮 / 暗」；主色有五档预设 + 自定义
- 舞台只能纵向：这是有意设计（画面衬底要压住背景亮部），不是漏了

## 三、测试与证据

| 线 | 结果 |
| --- | --- |
| 单元测试 | `@aivn/stage` 62 例；web 侧按影响面指名跑（playerReceipt / routeControls / stageKeyboard / stageFresh / stageHostExtras / pendingPanel / titleMenu / modalScrim / workshopChatTail / playPane / characterCards / memoryPaneCards / settingsCredentials / themeAccentInk …）全绿 |
| 零错误扫查 | 16 页 × 390/1440 共 32 次加载：控制台 error/warning 与未捕获异常 **零命中**；受控点按（跳过花钱与写数据的键）同样零命中 |
| 布局体检 | 16 页 × 390/768/1440：横向溢出零；命中区与最小字号按口径核过 |
| 对比度体检 | 浅色与深色两套主题 × 16 页逐元素算前景/背景，查出的问题全部修掉（状态字、徽标、占位符、主色墨色） |
| 实拍 | `docs/screenshots/`：`before-after/`（改前改后）、`baseline/`（改前原图）、`after-1280/`（改后同视口）、`m1..m12`（逐轮证据） |

## 三点五、自己复跑这几条

```bash
BASE_URL=http://localhost:37394 node scripts/audit-ui.mjs                       # 390 + 1440，浅色
BASE_URL=http://localhost:37394 WIDTHS=1440 THEME=dark node scripts/audit-ui.mjs # 深色
```

一条命令扫控制台报错 / 横向溢出 / 对比度（含占位符）/ 窄屏命中区，非白名单问题以非零码退出。
「已判定就这样」的几项（标题页压在插画上的字、次要层级文字）在脚本的 `ACCEPTED` 里，各写了理由。

## 四、等你拍板

四条产品口吻/设计取向问题，附**实拍 A/B**与我的建议：见
[待拍板清单](261010-ui-rehaul.decisions.md)。它们不是没做完，是两种都成立、只能选一种。

## 五、合并回 main 之后必须做（跨线义务）

1. `packages/stage` 是两条发行线共享包：重建 `pnpm --filter @aivn/stage build`；
   `dsh-aivn` 那边还要 `npm run build` 并让 `node build.mjs --check` 变绿——它的 `lib/`
   **打包期**吃进 stage，不重建就静默跑旧代码（见 `docs/references/261009-cross-host-verification.md`）。
2. 本树有另一位写者同时在改 `packages/stage` 与设置页；合并前用 `git diff -- <file>` 归属每一处改动，
   不要整树提交。
