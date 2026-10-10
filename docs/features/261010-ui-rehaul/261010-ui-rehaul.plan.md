# AIVN 全界面现代化重构与体验革命方案 (UI Overhaul Plan)

## 1. 目标与设计哲学

融合两大标杆设计风格：
1. **现代专业工作台风格（Modern Studio / Workspace）**：以 Linear / Raycast / Figma / Cursor 为审美基准，具备高对比度暗色调与透亮浅色调双模式支持、精致微磨砂玻璃（Backdrop blur）、Hairline 细微边框、精准层级阴影、流畅无卡顿的过渡动效。
2. **纯正现代化 Galgame 游戏体验（Cinematic Visual Novel Experience）**：以现代顶级商业 Galgame 与互动叙事系统为对标，舞台 100% 全屏纯净无遮挡沉浸，优雅名牌、高质感台词框、Quick Menu 快捷栏、无缝融入舞台的 Backlog 抽屉与全景星轨路线罗盘，极具视觉冲击力的电影级 Title 标题画面。

---

## 2. 界面与交互重构蓝图

### 2.1 游戏/舞台界面（Stage & Theater）
- **舞台全屏沉浸（Zero-Chrome Theater）**：
  - 彻底移除舞台左侧常驻的灰色后台侧边栏！游戏画面占满整个视口（16:9 自适应居中，无黑框割裂）。
  - **Quick Menu 底部快捷控制条**：直接集成在台词框右下角/底栏（Auto / Skip / Log / Flow / Hide / Save / Studio / Exit），精致图标+小字微排，悬停呼吸发光。
  - **沉浸式台词框（Message Box）**：
    - 磨砂玻璃底（Backdrop Blur + 微渐变），半透明且不遮挡立绘关键细节。
    - 角色名牌（Speaker Badge）：白底 + 对应角色主题描边/强调色，清晰易读，典雅无贴片感。
    - 推进跳动指示器（Blinking Next Indicator）：经典的跳动箭头或菱形流光。
    - 选项卡片（Choice Options）：悬停流光边框、平滑淡入展开、支持键盘 1-9 快捷选择。
- **非侵入式导演坞（Director Dock / Pill）**：
  - 右上角改造成轻量半透明悬浮胶囊：平时微隐、仅占极小面积；
  - 悬停或点击丝滑展开：提示 (Prompt) / 改写 (Polish) / 重写分岔 (Rewrite) / 生成插图 (CG) / 任务队列胶囊 (Tasks)；
  - 操作弹窗（Modal）设计为居中浮动玻璃卡片，完成即隐，不打断沉浸感。

### 2.2 路线树与回顾（Flowchart & Backlog）融入舞台
- **沉浸式回溯抽屉（Backlog Drawer）**：
  - 玩家向上滚动滚轮、按 PgUp 或点击 Quick Menu 的 "Log"，舞台画面原地高斯模糊并暗化，优雅滑入半透明历史回顾面板。
  - 每条台词具备角色名牌、发言内容、语音一键重播按钮；
  - 按 ESC 或下滑顺畅关闭，即刻回到游戏现场。
- **全景剧情罗盘/路线图（Route Flowchart Canvas）**：
  - 点击 Quick Menu 的 "Flow" 或快捷键展开全屏剧情脉络星轨图；
  - 节点卡片质感升级：深色半透明卡、场景CG/背景缩略图渐变融入卡面、分支决策点清晰标记；
  - 交互增强：卡片悬停高亮来路（Ancestors）与去路（Descendants），清晰显示跳转与重写入口，右上角可一键返回舞台当前节点。

### 2.3 标题画面（Galgame Cinematic Title Screen）
- **艺术级版式与质感**：
  - 封面背景带微妙呼吸微动效（Ken Burns / 景深光影氛围）；
  - 剧目标题采用现代典雅排版（主标题艺术字标 + 英文次级小标 + 风格化装饰线）；
  - 去除原生后台梗概长文本铺陈，精炼出纯粹的游戏入口；
  - **玻璃晶透菜单（Title Action Menu）**：
    - `START` / `CONTINUE（最新档位与时间）` / `FLOWCHART` / `EXTRA GALLERY` / `WORKSHOP STUDIO` / `SETTINGS` / `LIBRARY`；
    - 悬停光晕与音效反馈，右下角带有细腻的版本号与周目完成度徽章。

### 2.4 剧目库（Library / Launcher）与存档管理器（Saves）
- **现代化游戏库**：
  - 现代高档启动器质感：深调高质感背景、极简顶栏（搜索框、全局设置、创建/导入快捷动作）；
  - 剧目卡片：精致封面比例、圆角平滑、悬停封面轻度放大并露出浮动控制栏（“开始游玩 ▶”与“工坊 🛠”快捷按钮）；
  - 专属新建/导入磁贴，空状态下带有精美指引。
- **周目与档位选择（Saves Screen）**：
  - 类似主机游戏存档选择界面的质感卡片：包含周目序号、章节首句摘要、更新时间、进入/重命名/删除操作。

### 2.5 现代工坊（Workshop Studio）
- **左侧工作台专属导航轨（Studio Rail）**：
  - 取消顶部生硬挤压的小 Tab，改为现代 IDE/设计工具的标准左侧导航轨：
    - 💬 对话（Story Chat）
    - 📖 剧目（Play & Script）
    - 👥 角色（Cast & Personas）
    - 🎨 素材（Asset Matrix）
    - 🧠 设定（Lore & Memory）
    - 📁 文件（File Workspace）
    - ⚡ 智能体（Agent Brain）
    - ⚙ 设置（Workshop Settings）
  - 轨底固定连接状态指示灯与“▶ 预览演出”快速测试按钮。
- **对话流（Chat Stream）与任务面板**：
  - 现代 AI 交互设计：思考过程折叠胶囊（Thinking Accordion）、工具执行气泡、出图成果画廊；
  - 底部输入区现代化：快捷操作、换行提示、生成中流式打字动效。
- **素材库（Assets）与角色页（Characters）**：
  - 资产矩阵：立绘、背景、CG、音乐、音效分栏展示，直观的差分与缩略图卡片；
  - 角色卡片与立绘绑定一体化，支持实时预览与音色播放。

### 2.6 全局设置页（Global Settings）
- 分组卡片化（模型网关、长会话、生图、语音、网络检索、局域网访问、外观主题）；
- 凭据安全遮罩与开关控件微动效，保存操作常驻底栏并带明确反馈。

---

## 3. 设计令牌重构（Design Tokens）

- CSS Variables 体系：
  - `--studio-bg`, `--studio-surface`, `--studio-surface-elevated`
  - `--studio-border`, `--studio-border-hover`, `--studio-border-active`
  - `--studio-text-primary`, `--studio-text-secondary`, `--studio-text-muted`
  - `--studio-accent`, `--studio-accent-hover`, `--studio-accent-glow`
  - `--theater-msg-bg`, `--theater-msg-border`, `--theater-name-badge-bg`
  - 统一定义于 `packages/stage/src/stage.css` 与 `apps/web/src/app.css`，保证双发行线（AIVN 与 dsh-aivn）契约严格一致。

---

## 4. 实施阶段分解

- **阶段一：全局 Design Tokens 与基础样式架构重构**
- **阶段二：舞台界面全屏沉浸化 + Quick Menu + 导演坞重构**
- **阶段三：Backlog 回顾抽屉与路线图沉浸式融入舞台**
- **阶段四：Galgame 级 Title 标题画面与 Saves 周目界面重构**
- **阶段五：剧目库（Library / Launcher）与全局设置页升级**
- **阶段六：现代工坊（Workshop Studio）全套页面与组件重构**
- **阶段七：端到端测试覆盖、全套高精度实机截图验收**
