# UI Overhaul 设计参照系调研（2024–2026）

> 调研范围：视觉小说/ADV/叙事游戏界面语言；创作工具与「工作室」类界面范式；2026 年 web/桌面视觉与动效实践；经典日系 galgame UI 语法与现代审美的结合。
> 每条 = 作品/产品名 + 设计特征 + 来源链接。文末列出低可信度来源，供二次核实。
> 采集时间：2026-10-04。

---

## 一、视觉小说 UI 的经典语法（可作为「不能丢的地基」）

- **ADV 范式（Yuzusoft《サノバウィッチ / Sabbat of the Witch》为行业基准）**：文本框占屏幕底部约 1/8，半透明彩色底，目的是「不遮蔽背景与立绘」；底部一排极小按钮（存/读/跳过/设置），可整条隐藏；角色名在文本框内左上对齐；正文只占文本框约 2/3 宽，留 1/3 空白使每屏文字量恒定、不显凌乱。核心目标：**让界面尽可能像不存在**。来源：https://forums.fuwanovel.moe/blogs/entry/4226-ui-design-%E2%80%93-an-anatomy-of-visual-novels/
- **NVL 范式**：文本框覆盖大部分屏幕（常无立绘）；多数作品屏上**不放任何按钮**，一切功能收进暂停菜单，以换取叙事专注。来源：同上
- **破规则型 UI**（研究文章中举《Girlfriend Simulator》为例）：用「画框」式 UI 包住背景与立绘并占据大量屏幕，大按钮嵌在窗框边缘形成连贯感；背景是不安的暗橙+眼睛；左上角有随选择递增的「不安度」表——UI 本身承担情绪表达。来源：同上
- **ATRI -My Dear Moments-**（ANIPLEX.EXE, 2020，日方教程常引）：舞台设定为大半沉入海底的近未来，因此文本框用**水蓝色**而非安全的全黑；不设姓名窗，人名直接显示在文本框上方；文本框边缘放角色头像标出说话人。来源：https://arai-novelgamelabo.com/entry/2024/10/28/170000
- **文本框行数经验值**（同上）：3 行为主流，2 行不少见，**4 行以上偏多**；姓名窗要考虑多语言——日文放得下、其它语言会溢出，需程序化加宽。
- **VN 标准选项清单**（叙事型 UI 比 RPG 细得多）：文字送り速度、逐角色语音音量、主/语音/SE/BGM 分轨音量、未读/既读跳过开关、字号、行距/注音/文字特效开关、**窗口透明度**、UI 布局切换（单手模式）。来源：https://note.com/sg_kaliya/n/n713bf7108ebc
- **主菜单/存档/CG 鉴赏的通用要素**（VNDev Wiki）：主菜单=开始/继续/读档/设置/EXTRA/退出；「继续」应排最上；EXTRA 可拆成画廊、音乐室、影片；**从主菜单进入的存读档界面应禁止保存**；部分作品在通关后更换主菜单背景/BGM 甚至整套布局。存档槽需现「章节名+时间+截图+玩家备注」。来源：https://vndev.wiki/Graphical_User_Interface
- **文本框技术细节**（VNDev Wiki）：逐字出现通常先完成断行再逐步显形，避免出现字词跳行；Ren'Py 使用 TeX 的 Knuth-Plass 最小不齐算法；名牌可用不同字体/颜色区分角色（可作用于名牌文字、正文、底色或装饰）。来源：https://vndev.wiki/Textbox
- **竖屏 VN 实验（2025-07）**：1080×1920，黑白为主+极少黄；上下加带（band）制造纵深与「合上画面」感；三分法构图；中央放一个圆做视觉焦点。来源：https://note.com/ukiuki_uki/n/ncc95a9ac4b6d
- **居中 vs 左对齐论争（2025-07）**：VN 习惯左对齐；有人主张「文本框居中 + 头像也居中」可减少视线来回。来源：https://ringo10wagon.hatenablog.com/entry/2025/07/31/120000

---

## 二、2024–2026 被广泛引用 / 获奖的叙事作品标杆

### Type-Moon 系（「现代 AAA 视觉小说」的公认样板）

- **月姫 -A piece of blue glass moon-**（2021 日 / 2024 国际）：NVL 排版，**只有最新一行亮、之前的行降亮度**以保证可读性；内建**流程图**（看进度、看因果、任意跳已解锁场景）；「教えて！シエル先生」式 BAD END 讲解；CG 鉴赏随剧情逐张解锁、背景有时刻/破损差分；画廊内含音乐播放器（重复/音量/上下曲）；设置内含「自动跳过已读场景」；语言切换约 5 次以内。UI/LOGO 由 WINFANWORKS 设计。来源：https://staging.rpgsite.net/review/16013-tsukihime-a-piece-blue-glass-moon-review ・ https://towardstheendsky.blogspot.com/2023/09/tsukihime-piece-of-blue-glass-moon.html ・ https://vndb.org/s39352
- **该作的负面参照**：Siliconera 指出其文字与背景对比不足、dock 模式下正文与立绘/背景糊在一起——**「美术溢出动效」与可读性的经典冲突**。来源：https://www.siliconera.com/review-tsukihime-a-piece-of-blue-glass-moons-worth-the-wait/
- **魔法使いの夜 / Witch on the Holy Night** 与 TsukiRe 的导演法对比：Mahoyo 用第三人称 + 鸟瞰 + 长建立镜头 + 慢淡入；TsukiRe 用第一人称 + 大量荷兰角 + 主观特写。两者都把 **GUI、场景构成、氛围** 视为美术指导的一部分。来源：https://arimiadev.com/comparing-the-direction-of-tsukihime-vs-mahoyo/
- **Fate/stay night REMASTERED**（2024-08-07）：UI 明确参考 Tsukihime 重制版；16:9 全 HD；完整手柄支持（大屏 + 蓝牙手柄躺着读成为卖点）；含流程图、音乐播放器、结局表；十字键上可快速切同日场景；96% Steam 好评 / Metacritic 89。负面：菜单呆滞、按钮延迟、不可自由改键。来源：https://noisypixel.net/fate-stay-night-remastered-review/ ・ https://www.rpgfan.com/review/fate-stay-night-remastered/ ・ https://store.steampowered.com/app/2396980/

### 欧美/独立叙事作品

- **Clair Obscur: Expedition 33**（Sandfall, 2025-04-24，GOTY 级）：UI 主管 Brieuc Inisan 公开过「重叠菜单、晦涩图标、战斗数值埋在多层嵌套里」的 alpha 原型，之后**从零重建层级、图标与可读性**；成品「连菜单都像装置艺术」（泼墨式动效）；刻意**无小地图、屏上信息极简**；无障碍含**可调弹反时间窗**与色盲滤镜；1.5.0 补丁补充界面缩放、文字可读性、照相模式、配装预设（Lumina Sets）。来源：https://medium.com/design-bootcamp/clair-obscur-expedition-33-the-ux-alchemy-of-a-perfect-rpg-b247e284e85a ・ https://finalboss.io/clair-obscur-expedition-33-how-evolving-designs-and ・ https://megagames.com/news/clair-obscur-expedition-33-update-1-5-0-expands-the-game-with-new-content-and-major-improvements
- **Metaphor: ReFantazio**（Atlus，TGA 2024 最佳美术指导）：UI 设计师 Koji Ise 在 GDC 2025 讲述——先做了 5 套原型（羊皮纸/NES 复古/焦虑心理/思绪之海/彩墨情绪）全部废弃，最终关键词「超·Stylish」；四支柱 **Cool / Immersive / Intriguing / Buzzworthy**；每个视觉元素都带意义（颜料波动=情绪流动，几何线=思考路径，字体排版=内心语言化）；战斗结算刻意用**俯瞰视角**，因为设定中「王始终从天空注视」；营销物料直接用 UI 而非主视觉，有玩家表示「看到主菜单就决定买」。来源：https://www.4gamer.net/games/367/G036702/20250322013/ ・ https://noisypixel.net/persona-metaphor-ui-design-evolution/ ・ https://news.qq.com/rain/a/20250408A074HG00
- **Slay the Princess**（Black Tabby，Ren'Py）：单色手绘；用**选项置灰**表达主角失去能动性（The Tower 章）；UI 本身被解读为故事的「象征界」。来源：https://www.gamedeveloper.com/design/deep-dive-player-centered-narrative-design-in-slay-the-princess ・ https://exa.ai/library/publication/2vp367s1xxt
- **1000xRESIST**（sunset visitor, 2024）：**逐章改变机制与呈现**——第二章改第一人称、第三章固定第四面墙机位 + 故事书式浮空文字、第九章把同一套机制重语境化为监控录像；环境极简、光线与背景色先于台词定调；受剧场/舞蹈背景影响。来源：https://jam-alade.com/mechanics-and-storytelling-in-1000xresist/ ・ https://www.ensemble.art/blog/inside-the-art-direction-of-1000xresist-with-kodai-yanagawa
- **Mouthwashing**（2024）：开发者对谈中讨论其非线性叙事与呈现取舍。来源：https://www.resetera.com/threads/developer-one-on-one-mouthwashing-1000xresist-minnmax-interview.1092924/
- **2025 Golden Lance 最佳 UI**：获奖 **The Outer Worlds 2**（不打扰、切换技能/装备动画顺滑、提供简化选项降低认知负荷、可自定义战利品稀有度配色）；亚军 **Donkey Kong Bananza**（3D 地图做成可旋转的立体微缩模型、情境弹窗、「Ad Lib」字体致敬 1990s DKC 宣传物料）。来源：https://lordsofgaming.net/2025/12/2025-golden-lance-award-for-best-ui/

### 2025 年 LLM 叙事产品（形态最接近 AIVN 的对标）

- **Hidden Door**（2025-08 上线）：**卡片式世界**（角色/地点/情节卡），叙述者另有一副「情节卡」牌堆，玩家抽牌推进；有暗骰决定成败；美术全手绘。设计评论（Ian Bicking）指出：需先让模型写下「玩家在哪、谁在场、彼此关系」的世界状态再写正文；**选项必须先想好后果再写选项**；延迟是硬伤，故主张部分预生成；创始人 Hilary Mason 称每回合拆成 16 个任务、用 Postgres 作「游戏引擎层」、每个 IP 一个约 100 行的 world seed；**第一版 UX 只有一个输入框，结果用户普遍卡文，才转向卡片隐喻**。来源：https://ianbicking.org/blog/2025/08/hidden-door-design-review-llm-driven-game ・ https://www.theverge.com/games/757816/hidden-door-early-access-ai-story ・ https://aigamechangers.substack.com/p/the-machine-is-not-itself-creative
- **AI Dungeon / Latitude**：聊天式单栏正文 + 底部指令栏 + 侧栏（设置/冒险信息/世界设定）；Memory Bank、World Info Panel、undo/redo；设计哲学是「最小打扰」。后续产品 Voyage 以「World Engine」维护世界状态（血量/背包/金钱/地理/关系）。来源：https://aitoolbox360.com/ai-tools/ai-dungeon/ ・ https://latitude.io/

### AI 角色聊天（工坊侧的角色/对话参照）

- **SillyTavern**：主题可存/可分享；**三种聊天版式** Flat（连续聊天流）/ Bubbles（IM 气泡、圆角+轻 3D）/ Document（文档式，隐藏头像、时间戳与消息按钮）；可调聊天宽度 25–100%、字号 0.5–1.5×、面板模糊 0–30、文字阴影 0–5；开关含 Reduced Motion / No Blur / 文字阴影 / **Visual Novel 模式** / Zen Sliders / 头像悬停放大 / 标签当文件夹 / 点击即编辑；可直接写自定义 CSS。来源：https://github.com/SillyTavern/SillyTavern-Docs/blob/main/Usage/User_Settings/uicustomization.md
- **SillyTavern Visual Novel Mode**：立绘居中，群聊时自动散开；可开 MovingUI（仅桌面）拖动立绘；第三方扩展提供 **Letterbox Mode（影院黑边）**、Focus Mode（非说话者压暗）、Traditional VN Mode（只显示最后一条消息）。来源：https://github.com/SillyTavern/SillyTavern-Docs/blob/main/Usage/User_Settings/Visual-Novel.md
- **NovelAI 风格 SillyTavern 主题（可直接借用的 token 实例）**：边框 #22253f、强调 #f5f3c2、控件底 #0e0f21、按钮 #191b31 / hover #282b44、删除 #ff7878、成功 #7eff90、错误 #ff483f、信息 #73dfff、警告 #ffc906；字号 18px；标题 Eczar + 正文 Source Sans 3；圆角 3px；**用 1px 描边代替阴影**。来源：https://gist.github.com/khanonnie/d572c9e88cd7150f0850b61ce30a0d2c
- **Character.AI**：首页即角色信息流（卡片预览 + 分类 tab + 最近/推荐搜索）；聊天页像普通 IM 但每则回复带头像、自然打字指示、可左右滑查看多个候选回复；建角向导=头像→名称/一句话→人格描述→开场白→高级设置；设计分析称其优化的是**会话深度**而非打开频次。来源：https://gummble.com/blog/character-ai-app-design-analysis
- **Talkie**（MiniMax）：移动优先，TikTok 式角色卡滑动发现流（可见粉丝数、创作者可发布）；语音消息为第一等公民（可克隆音色、10 分钟通话）；贴纸系统接近 LINE/WeChat；**Mini-Theater Mode** 提供预制分支场景，剧情一致性优于自由对话。来源：https://aichathub.uk/platforms/talkie-ai/ ・ https://aicompanionguides.com/blog/talkie-ai-roleplay-champion-review/

---

## 三、创作工具 /「工作室」界面范式

### 暗色工作区范式（Linear / Raycast / Vercel）

- **Linear**：暗色优先；**极端克制用色**（品牌色只占 1–10% 亮度）；用**感知均匀色彩（OKLCH）替代 HSL**；**三变量主题**（base / accent / contrast）自动产出 WCAG 高对比主题；层级靠字重与字号而非颜色；固定侧栏 + 横向 header 组成 L 形；**内容面板零间隙零圆角、像电子表格一样用 1px 边框切分，圆角只留给真正悬浮的浮层**；三档边框透明度（strong/default/subtle）；右侧右键动作菜单；**乐观 UI**（先改界面，失败再静默回滚）；全键盘可达 + 命令面板（每项旁标快捷键）；动画约 200ms 且只传达状态；「Saving...」出现在被编辑字段旁而非角落 toast。来源：https://github.com/marcus/marcus-skills/blob/main/skills/linear-design-patterns/references/linear-design-system.md
- **Linear 的产品判断（12 条原则）**：含「为 AI 功能造**工作台而非聊天框**」、「为共享上下文而非交接而设计」、「让动作可逆」。来源：https://github.com/tylergibbs1/linearprincipals
- **Raycast 设计系统**：画布 #07080a，四级表面阶梯 #0d0d0d / #101111 / #121212，发丝边框 #242728，**零投影**，唯一主 CTA 是纯白胶囊 #ffffff；Inter + `font-feature-settings: "ss03"`（单层 g）构成品牌签名；圆角聚在 4/6/8/10/16px，9999px 只给胶囊与头像；红色斜纹渐变全页最多出现一次；**无浅色模式**。来源：https://www.shadcn.io/design/raycast
- **Vercel Geist**：Geist Sans + Geist Mono + Geist Pixel（5 种像素风格变体）；设计系统分 colors / typography / materials / grid。来源：https://vercel.com/geist/geist/ ・ https://github.com/vercel/geist-font/
- **这个流派的方法论总结**：真正被羡慕的不是配色而是原则——**排版优先、克制留白、单色底 + 一个强调色、把真实产品好好展示、动效只用于引导、细节处见功力**；抄表面只会得到「戏服」。「一个有强排版、真克制、细节讲究的浅色界面，比一个拥挤而平庸的深色界面更显高级。」来源：https://studiomaydit.com/blog/linear-vercel-raycast-aesthetic

### 引擎/专业编辑器

- **Godot 4.6「Modern」主题**（基于 passivestar 的 Minimal Theme，Inter 为编辑器字体）：**把蓝色基底换成中性灰 #292929，理由是蓝色会扰乱视口的感知白平衡**；旧主题保留为 Classic；对比度乘数回到 0.3 默认；弹出菜单加深。社区批评值得当作 checklist 读：层级连线消失、dock 内底与边框不再区分、下拉与列表项无法区分、tab 高度约为节点两倍、整数与布尔/枚举属性行高不一致（26px vs 31px）。来源：https://godotengine.org/article/dev-snapshot-godot-4-6-dev-3/ ・ https://github.com/godotengine/godot/pull/111118 ・ https://github.com/godotengine/godot/pull/114162 ・ https://github.com/godotengine/godot/issues/112229 ・ https://github.com/godotengine/godot/issues/112393
- **Blender Workspaces**：顶栏 tab = 预设窗口布局；默认 Layout 工作区 = 3D Viewport（左上）+ Outliner（右上）+ Properties（右下）+ Timeline（左下）；工作区是 data-block、随 .blend 保存，可「Load UI」；**默认只给一个工作区，其余从菜单按需添加，避免浪费 tab 空间**。来源：https://docs.blender.org/manual/en/4.5/interface/window_system/workspaces.html ・ https://archive.blender.org/developer/differential/0002/0002451/index.html
- **Blender 面板视觉更新**：把面板分隔从「一条线」改为**留白 margin**；折叠图标从三角改为箭头；圆角与全局一致（新增 panel_roundness，默认 0.4）。来源：https://projects.staging.blender.org/ZedDB/blender/commit/93544b641bd6
- **DaVinci Resolve 的「页」范式**：Media / Cut / Edit / Fusion / Color / Fairlight / Deliver / Photo 八页，每页工具栏负责显隐各面板；面板可半高/全高，可双屏、全屏时间线；布局预设可存/取/更新/删除/导出/导入；`Workspace > Reset UI Layout` 一键复位；**当前拥有焦点的面板顶部有一条高亮**。长期社区抱怨：面板不可自由停靠——2010 年就有人提过，可作为反面案例。来源：https://ltbits.github.io/davinci-resolve-manuals/DR17/DR17-RM-01%E2%80%93DaVinciResolveInterface.pdf ・ https://forum.blackmagicdesign.com/viewtopic.php?uid=16&f=33&t=187471&start=0
- **Roblox Studio 新版灵活 UI（2025-11）**：默认紧凑布局、菜单扩展、测试控件集中、viewport 菜单；ribbon tab 完全可定制（可自建 tab、混入任意插件工具、工具可无限重复）；**密度调节**、可整条折叠工具栏、超宽屏可左对齐 tab；正在清理多年不一致的用色并接入全局色板 token。来源：https://devforum.roblox.com/t/an-update-on-the-new-flexible-studio-ui/4085392
- **Novaboard（像素画工具）的界面文档**：完整停靠/浮动/多面板浮窗/弹出到第二屏；工作区预设；面板 tab 末尾有齿轮与最小化（折叠成图标条，点图标以可缩放 flyout 打开）；**Zen Mode 一键隐藏全部面板**；**布局按屏幕宽度分桶保存**（笔记本与外接显示器各留一套）；面板显隐有快捷键（Shift+F1..F10）；Simple / Advanced 双 UI 模式；**同时保有两套主题（浅色槽 + 深色槽）**，用日/月按钮切换。来源：https://novaboard.app/docs/interface/
- **Floptle 编辑器**：egui_dock 停靠壳，预设 Scene / Shading / VFX，布局按项目持久化；**保存状态用一枚常驻 chip（✔ saved / ● unsaved / 保存完成绿光）而非 toast**，理由原文是「『刚才存上了吗』是稍后才问的问题，那时 toast 早没了」。来源：https://fopull.com/floptle/docs/subsystems-editor
- **OrigoZero 编辑器**：三层结构（顶栏域菜单 / 可停靠面板 dock / 底下的世界）；F3 隐藏整个 dock；布局按 world 存在本地；**AI agent 以标签页形式与 Claude Code / Codex CLI / Cursor CLI 并排**；agent 用 `show.file` / `show.text` 把产物开成一个新的可关闭面板供人审阅；实现细节值得抄：**只有叶子节点中处于激活态的 tab 才重建**；init.luau 加载失败时以「带错误信息的标签页」出现而不炸编辑器。来源：https://origozero.ai/docs/topics-editor-editor-ui
- **VNForge（Godot 事件表式 VN 编辑器）**：三栏——左为分类组件面板（点按即把方块实例化到中间）、中为可滚动的事件表 VBox（线性排列对话/选项/背景等方块）、右为 ≥400px 检查器；深色 StyleBox 具体值：主底 rgb(27,29,37)、工具栏 rgb(48,50,61)、各面板 rgb(39,41,51)；按钮标签用 Lato-Black。来源：https://deepwiki.com/tindrew/VNForge/2.1.1-event-sheet-interface
- **unreal-umg-design-system**：三级 token（primitives → semantics → components），主题可继承；可导入导出 W3C DTCG JSON 与 CSS 自定义属性；**拖色时实时按 WCAG 给每一对文字/底色打分**；500 个控件整体换肤 1.4ms；密度/减少动效/文字缩放/色觉重映射都是一次开关全局生效。来源：https://github.com/sinanata/unreal-umg-design-system
- **JEngine 编辑器 UI**：shadcn 风格单色体系，**深浅色之间是真正的色彩反转**（深色 Primary = 浅色 Secondary）；间距 Xs2/Sm4/Md8/Lg16/Xl24；JTabView 支持 maxTabsPerRow 自动换行。来源：https://jengine.xgamedev.net/en/docs/v1.1/ui-components

### AI-native 创作工具

- **vibe-coding 模式库（Lovable 整理）**：Canvas Panel 模式——「聊天可以操舵，但画布让产物保持可见、可指定、跨轮次稳定」；早期 AI 编辑器是代码优先、像 IDE，下一代引入渲染画布；结构上普遍是 聊天面板（会话流/输入框/上下文附件/设计-视觉模式切换/Plan-Build 工作流选择）+ 画布面板（头部工具栏含 Design/Code/Preview 模式 tab 与 Publish/Share）+ 可拖动分隔 + 可折叠聊天，**桌面端画布约占 80% 宽**；移动端策略各家不同；**用户呼吁组件/区块级「锁定」**（锁布局、锁文案、锁视觉风格）。来源：https://vibecodingux.lovable.app/patterns/canvas-panel
- **Cursor Visual Editor（v2.2+，2025-12-11）**：IDE 内置浏览器 + Figma 式右侧栏；选中元素后可调 Layout（grid/flex/row/column/freeform、对齐/分布、padding/margin 盒模型）与 Appearance（字体族/字号/字重、行高、字距、对齐、含渐变的取色器、边框、阴影、模糊）；**自动识别 React 组件 props 并以下拉呈现变体**；Apply 把改动序列化成结构化变更清单；支持「点选 + 自然语言」并行多元素改；自动读出项目里的设计 token。作者定位：Figma 负责早期探索，Cursor 在真实组件上施工。来源：https://nehtus.com/story/cursor-launches-pro-design-tools-figma/ ・ https://www.stork.ai/blog/cursor-just-killed-the-design-handoff ・ https://www.humai.blog/cursor-launches-visual-editor-a-game-changer-for-design-to-code-workflows/
- **Figma Make → Design「Copy design」**：把 Make 的生成结果以**结构化可编辑图层**带回设计画布（并收购了 html.to.design 的技术）。来源：https://www.figma.com/blog/bringing-figma-make-to-the-canvas/
- **Rosebud AI（游戏版 vibe coding）**：首页只有一个输入框（可打字或上传参考图），下方是 Browse Games 供 remix；编辑器左栏是与「Rosie」的对话（可上传截图报 bug、「Continue with next step」建议后续、Clear Memory、History 检查点），右栏 Preview / Assets（支持 .glb/.gltf/.obj，可筛选「本项目内」与「全部上传」，可生成图并抠底）/ Code（付费）；顶栏可接 Supabase、下载代码；发布流程含标题/描述/缩略图/是否允许 remix。来源：https://www.rosebud.ai/blog/how-to-start-with-rosebud-ai-game-maker-platform ・ https://rosebud.ai/tutorial

### 写作 / 叙事编辑工具

- **Sudowrite**：三栏——左=项目文档树，中=正文编辑器，右=Chat + History；**所有 AI 功能的结果都以「卡片堆」出现在右侧 History**，点击展开/收起，卡堆顶部以斜体显示本次 Prompt，并有一排「chiclets」小标签说明 AI 参考了哪些上下文，卡片标注所用功能名（First Draft 与 Quick Edit 例外）。来源：https://docs.sudowrite.com/getting-started/dQph1snuwbfMWG9wRjsNug/interface/ubBg2ZEoAwasV98E3ZBwjn
- **Novelcrafter**：左侧栏（可钉住工具、帮助/提示词/导出、同步指示）+ 小说导航 + 顶部导航（**模式：plan / write / chat / review**；View；Filters；Settings）+ 主面板；各类 Actions 菜单挂在 幕/章/场景、Codex 条目、片段、聊天上；写作界面有格式菜单（字体与字号、段距与栏宽、对齐、场景分隔符样式）与**Focus Mode**（隐藏摘要与侧栏）；有一条**纵向时间线**与正文高亮颜色联动；Codex 自动追踪、Grid/Matrix/Outline 三视图实时同步、Scene Archive 不丢删除内容。2025-05 更新：**可同时钉多个面板**、下拉可搜索、`/note` 生成黄色且不计入 AI 上下文的区块、移动端/平板缩放改善、幕标题吸顶。来源：https://www.novelcrafter.com/help/docs/app/app-layout ・ https://www.novelcrafter.com/help/docs/write/the-write-interface ・ https://www.novelcrafter.com/blog/may-2025-new-prompting-system-update
- **Naninovel（Unity VN 框架）**：Story Editor 有独立 Web 版（sandbox，可在不开 Unity 的情况下试写并预览）；交互模型**刻意模仿 Unity 编辑器**——选中资源（文件或图节点）后在 inspector 区显示对应编辑器，作者称这带来「结构编辑与直接编辑的干净分离」；剧本以「行」为单位可视化；故事图里进入脚本节点即变**可视化剧本编辑器**（label 节点里直接改台词）。内置 UI 接口清单可直接当屏幕清单抄：IBacklogUI / ILoadingUI / IMovieUI / ISaveLoadUI / ISceneTransitionUI / ISettingsUI / ITitleUI / IExternalScriptsUI / IVariableInputUI / IConfirmationUI / **ICGGalleryUI** / **ITipsUI** / IRollbackUI / IContinueInputUI / **IToastUI**。来源：https://naninovel.com/guide/editor ・ https://naninovel.com/guide/gui
- **Yarn Spinner 的 VS Code 扩展**：语法高亮 + 自动补全；**图视图里每个节点卡片直接显示前几行台词**，可拖动排布、可自动纵向/横向布局、可上色、可分组（`group:`）、可加便签（`style: note` + `color:`），节点位置写回 `position` 头字段；内置预览跑真实运行时，可切 saliency 策略；导出**录音用表格（Excel/CSV）**、Markdown、DOT/Mermaid。来源：https://yarnspinner.dev/editor/ ・ https://docs.yarnspinner.dev/3.1/write-yarn-scripts/yarn-spinner-editor/writing-yarn-in-vs-code
- **叙事工具横评（2025-11）**：Twine 非为游戏而做；Yarn Spinner 的可视化是「被动的、不可交互的」且绑定 Unity；Ink 无可视化编辑、绑 Unity/Unreal；NarrativeFlow 主张「视觉节点 + 同一份故事的脚本视图」双视角、导出前即做逻辑校验、内置协作/合并/冲突检测/本地化、多引擎 JSON 输出。来源：https://narrativeflow.dev/blog/twine-vs-yarn-spinner-vs-ink-vs-narrativeflow-which-branching-dialogue-tool-is-right-for-your-game/
- **Ren'Py 的 GUI 分层（可直接映射到我们的 app.css 令牌体系）**：intermediate 级只改颜色/字体/图片，保留 screens.rpy 结构；存读档槽用 384×216 缩略图 + 时间 + 可选存档名；`gui/overlay/game_menu.png` 作为所有游戏菜单类界面的公共遮罩；gallery / music room / replay 是内建概念，用 persistent 记录解锁。来源：https://renpy.org/dev-doc/html/gui.html ・ https://renpy.org/dev-doc/html/rooms.html ・ https://www.renpy.org/doc/html/persistent.html
- **Ren'Py 画廊实现范本（2025-03）**：4×3 网格、每格 300×169；未解锁用纯色块、hover 换深色；带解锁进度条与百分比文字；hover 时显示「Locked / View larger」；放大时 1 秒淡入淡出再延时隐藏；返回键在右下角。来源：https://toomanyteeth.net/news/ren-py-tutorial-create-an-unlockable-gallery

### 素材 / 参考图管理

- **Eagle**：深色精致系统——画布 #000000、分区深 #0B1118、抬升面板 #121A24、主文字 #F8FAFC、次要 #A8B0BA、主操作 #0072EF；标题约 60/66px 中重、卡片标题约 20/30px；**渐变文字只用在个别词/数字/分区标记上**。功能面：标签/文件夹/智能文件夹（按名称、标签、颜色、格式自动归集）/直接标注/自定义动作/查重/评分/自动打标；「0.5 秒内找到文件」；支持插件（JS+HTML）。智能文件夹用法示例：「This Week's Inspiration」自动收集近 7 天打了某标签的图。来源：https://refto.one/eagle/home/2026-02-16 ・ https://www.eagle.cool/ ・ https://www.eagle.cool/blog/post/eagle-image-pin-on-top-for-designers
- **PureRef 的极简哲学**：「屏上永远只有你的图」，其余全靠快捷键与右键菜单（另有命令面板）；提供层级面板（Ctrl+J）、可嵌套分组（Ctrl+G / Shift+G）、锁定分组（整体选中 vs 逐个选中）、富文本便签（字体/对齐/链接/清单）、裁剪（C）、**会跟随图片移动的绘制批注（Ctrl+D）**、GIF 支持与逐帧查看/抽帧、SpaceMouse、像素画最近邻采样。来源：https://www.pureref.com/handbook/navigation/ ・ https://www.pureref.com/handbook/2.0/features/
- **refern**：自称「notion / obsidian 的气质，但有能用的画布系统」；不搬动原文件、就地读取；可导入 Eagle 的文件夹/标签/评分/来源链接、PureRef 2.x 的 board、Allusion 的标签。来源：https://www.refern.app/

---

## 四、2026 年 web / 桌面视觉与动效实践

### 潮流位次（多来源交叉）

- **Bento 网格**：从 Apple 营销页走进产品页与大厂设计系统（Ramp、Linear、Notion、Attio、Vercel）；2026 的版本是**嵌套与响应式**——大格本身是一个 mini bento，格子按设备换内容，部分格子像 live widget。来源：https://line25.com/articles/web-design-trends-2026/ ・ https://brainy.ink/paper/web-design-trends-2026
- **可变字体 + 动态排版**：字号/字重/宽度随滚动、悬停、加载变化；**创作者共识是「只动一个轴」，且把轴绑到用户能感知的信号（滚动/悬停/焦点/加载）而不是纯时间**。来源：https://elements.envato.com/learn/web-design-trends ・ https://brainy.ink/paper/web-design-trends-2026
- **暗色优先**：Linear / Raycast / Arc / Vercel 都默认暗色；理由包含 OLED 省电与营销物料更好看。来源：https://www.inspirefusion.com/web-design-inspiration-trends-2026/
- **Glassmorphism 2.0**：与 2021 年那波的区别在于**把模糊当作层级工具而非装饰**（前景/后退/可交互）；Apple 的 Liquid Glass 是主要推动力；但对立观点明确：有分析称它在头部生产站点上「事实上已经消失」，原因是可读性与性能代价。来源：https://elements.envato.com/learn/web-design-trends ・ https://toimi.pro/blog/web-design-trends-what-works/ ・ https://line25.com/articles/web-design-trends-2026/
- **动效的判定标准**：2026 年的共识是「这个微交互有没有帮读者做决定」——有则留（磁性光标在 80–120px 内轻微吸附、滚动联动的数字跳动、悬停时在邻格给出实时预览），无则删。**正在淘汰的**：glass 光斑、全屏自动播放 hero 视频、劫持滚动的开场、等权三栏特性行、跑马灯 logo 墙、五个 CTA 的 hero、把暗色模式做成简单反色。来源：https://brainy.ink/paper/web-design-trends-2026
- **风格两极分化**：技术未来主义（暗色 + 霓虹 + shader + bento）与编辑式反潮流（米白 + 衬线 + 温暖 + 克制）——**成功者是选定一极并执行到位，而不是把两者混起来**。来源：https://toimi.pro/blog/web-design-trends-what-works/
- **游戏 UI 专项（2026）**：结构性的变化只有四条——跨平台成为基线（意味着**要做的是共用设计系统与数据模型的多个界面，而不是一个界面的多种布局**）、无障碍从加分变预期、**自适应界面技术上已可行但「自适应必须可解释」**（静默变化会透支信任）、以「一个会话」为设计单位。其余视觉潮流（霓虹、粗野字、glass、颗粒、斜切面板）会循环。**明确的警告：饱和强调色压在近黑底上长会话会「振动」、glass 按设计降低对比、颗粒进一步降低——菜单可以承担美学，游玩中的常驻层不行。** 来源：https://www.wandr.studio/blog/game-ui-design-trends-2026

### 两套 2025 年的系统级设计语言

- **Apple Liquid Glass**（2025-06-09 WWDC 发布，横跨 iOS/iPadOS/macOS Tahoe/watchOS/tvOS/visionOS 26）：一个「会折射背景、随尺寸与环境自适应」的材料；**只用于浮在内容之上的导航层**，不要「glass 叠 glass」；两个变体 **Regular**（自适应、万能）与 **Clear**（永久更透明、需要压暗层，仅当「压在富媒体内容上 + 内容不会被压暗层伤害 + 上面内容够粗够亮」三条同时满足时用），两者不可混用；小元素（符号/字形）会随底下内容明暗翻转、大元素（菜单/侧栏）不翻转；新着色方式从底下内容亮度生成色调（像真彩玻璃），**只给主要操作着色**；引入 Scroll Edge Effects（soft / hard，可柔化代替硬分隔线）与侧栏 inset + 背景延伸；控件圆角与硬件外框保持同心；层级尽量靠布局与分组而非装饰；列表行高与圆角整体加大。无障碍含 Reduced Transparency / Increased Contrast / Reduced Motion。**2026 年 WWDC 已宣布针对批评做修订**：降低默认透明度、调整玻璃效果与侧栏圆角、重做图标，并给用户一个「更清透 ↔ 更着色」的滑杆。来源：https://developer.apple.com/videos/play/wwdc2025/219/ ・ https://www.apple.com/sn/newsroom/2025/06/apple-introduces-a-delightful-and-elegant-new-software-design/ ・ https://wwdcnotes.com/documentation/wwdc25-356-get-to-know-the-new-design-system/ ・ https://en.wikipedia.org/wiki/Liquid_Glass
- **Google Material 3 Expressive**（2025-05-13）：不是 M4，是 M3 的演化；46 项研究、18000+ 被试、三年来最重的一次更新；14–15 个新/改组件（button groups、FAB menu、loading indicators、split button、toolbars）；**motion physics 用弹簧（damping + stiffness）合成 token**，Web 端建议优先用弹簧，否则用曲线模拟弹簧；emphasized typography 支持可变字体表达情绪并自动调整可读性；动态取色改为更鲜明以强化元素区分；眼动实验称关键元素被发现的速度最多快 4 倍，点击耗时下降；品牌感知提升（亚文化感 +32%、现代感 +34%、叛逆感 +30%）；官方口号是「move beyond 'clean' and 'boring'」。来源：https://m3.material.io/blog/building-with-m3-expressive ・ https://design.google/library/expressive-material-design-google-research ・ https://9to5google.com/2025/05/05/material-3-expressive-leak/

### 动效令牌（可直接照抄的数值表）

- **Material 3 motion physics**：弹簧合成 token（阻尼+刚度），Web 上「能弹就弹，否则用模拟弹簧的曲线」。来源：https://m3.material.io/styles/motion/overview/specs
- **Unified UI 的时长/曲线/弹簧表**：instant 0 / fast 100 / moderate 150 / normal 200 / slow 300 / slower 400 / slowest 500 ms；曲线 standard `cubic-bezier(0.2,0,0.38,0.9)`、decelerate `(0,0,0.2,1)`、accelerate `(0.4,0,1,1)`、emphasize `(0,0,0.15,1)`、snap `(0.2,0,0,1)`；弹簧 gentle 150/20/1、snappy 300/25/0.8、bouncy 400/15/0.8、stiff 500/35/1；stagger 50 / 30 / 80ms；明确建议**标准 UI 转场不要超过 300ms**。来源：https://www.unified-ui.space/docs/motion
- **Matos UI 的「按性格命名的七个弹簧」**：fast 0.24s/bounce 0.16（微反馈）、snappy 0.14s/bounce 0（跟随指针，手动选）、moderate 0.38s/0.18（下拉、tab、抽屉）、slow 0.52s/0.18（对话框、sheet）、gentle 0.72s/0.06（氛围式，手动选）、morph 0.85s/0.12（layout 形变）、playful 0.56s/0.42（语气，手动选）；**退出时长约为进入的 70%**；**用面板的 elevation offset 自动挑弹簧档位**，组件只声明一次；hover 抬升是单独一个 token（`--ease-lift: cubic-bezier(0.4,0,0.2,1)`、`--duration-lift: 380ms`、按下 150ms），刻意不用弹簧曲线因为 2px 的位移用弹簧会「像抽搐」；入场 reveal 可用 focus-pull `blur(6px) → blur(0)`。来源：https://matos-ui.com/docs/foundations/motion
- **ttoss 的语义化契约**：core duration none/xs50/sm100/md200/lg300/xl500；语义 token 只有 5 个角色——`motion.feedback` / `motion.transition.enter` / `motion.transition.exit` / `motion.emphasis` / `motion.decorative`；**「静态主题」是被允许的合法姿态**（把值映射为 none，但语义名不变）。来源：https://ttoss.dev/docs/design/design-system/design-tokens/families/motion
- **Kinesis**：115 个按「感觉」命名的缓动 token，含平台签名档（Apple Fluid、iOS System Spring、M3 Emphasized/Standard、Fluent Expressive、Vercel Spark、Framer Motion Pop、Stripe Gloss）、触感档、滚动档。来源：https://github.com/twickstrom/kinesis

### 色彩系统

- **Radix Colors 的 12 阶语义**：1–2 应用/组件底；3–5 组件底（常态/hover/active/选中）；6–8 边框（subtle/default/strong）；**9–10 实色底（9 是该色阶彩度最高、最纯的一步，也是白字最常用的一步）**；11 低对比文字、12 高对比文字，且 11/12 在同色阶第 2 步底上**保证 Lc 60 / Lc 90 的 APCA 对比度**；暗色模式只需给容器加一个 class；每个数值都有 alpha 变体，且 alpha 版被设计成「叠在任何底上视觉上等于原色」。**别名建议**：按用途命名（accent/primary/neutral/brand）而非组件名（避免 `CardBg`/`Tooltip` 这类会让同一个变量被迫服务多处的名字），浅/深需要翻转的用「可变别名」。来源：https://www.radix-ui.com/colors ・ https://www.radix-ui.com/colors/docs/overview/aliasing ・ https://github.com/radix-ui/website/blob/main/data/colors/docs/palette-composition/understanding-the-scale.mdx
- **Radix Themes 的语义 token 对照表（浅→深）**：`--color-background` white → `var(--gray-1)`；`--color-overlay` `var(--black-a6)` → `var(--black-a8)`；`--color-panel-solid` white → `var(--gray-2)`；`--color-panel-translucent` `rgba(255,255,255,0.7)` → `var(--gray-a2)`；`--color-surface` `rgba(255,255,255,0.85)` → `rgba(0,0,0,0.25)`。来源：https://deepwiki.com/radix-ui/themes/3.1-color-system-and-design-tokens
- **OKLCH + 两层 token 的浅深对照实例**（背景/surface/surface-raised/on-*/muted/primary/on-primary/primary-hover/border/border-strong/success/warning/danger 各给浅深两套值）：https://www.cssshowcase.com/snippets/layout/semantic-tokens

### 字体

- **Geist / Inter / Satoshi 三者定位**：Geist（Vercel，2023，可变，约 18KB，配 Geist Mono，技术感，Next.js 生态首选）；Inter（2017，可变含 `opsz` 光学尺寸轴、`tnum` 等宽数字、`zero`/`ss01–ss08`，18 款样式，SIL OFL，可自由子集化/自托管）；Satoshi（ITF/Fontshare，2021，ITF 免费许可但**不允许修改或再分发字体文件**，无可变字体）。一项对 33 个生产 Framer 模板的统计显示 **Inter 出现在 33/33，Satoshi 为 0**——「想要不像所有人，Inter 恰恰是最容易撞脸的选择」。来源：https://diversekit.com/blog/geist-vs-inter ・ https://diversekit.com/blog/satoshi-vs-inter
- **排版即架构（2025-11 的实操文章）**：把字体分成三层角色——Body 用覆盖面广的 Noto Sans（含 CJK，保证用户输入任何文字都不出豆腐块）、Display 用有个性的 Hanken Grotesk（标题/品牌）、Mono 用 Fira Mono（技术文本）；理由是 Inter/Geist 在遇到希腊/西里尔/日文等未覆盖字形时会回退到系统字体造成视觉断层。来源：https://goker.me/typography-architecture-on-the-web
- **Satoshi 可变字体陷阱**：文件默认值是 900（大多数可变字体默认为 400），@font-face 若不声明 `font-weight: 300 900` 会导致整站变 Black；另附 `ascent-override` / `descent-override` / `size-adjust` 的 fallback 写法以免加载时跳版。来源：https://design.item.com/guidelines/typography
- **CJK 排版硬约束**：Material 官方指南把 CJK 归为 Dense script——Title 到 Caption 各级**字号比英文大 1px**，行高比英文**多 0.1em**（因为汉字占满整个 em 框，英文只占下半部）；CJK 字体一般提供 7 个字重；字体栈建议 Roboto → Noto → sans-serif。Source Han Sans / Noto Sans CJK v2.000 支持 5 种语言变体（日/韩/简/繁台/繁港），88 个字体资源，个别汉字需要 5 套不同字形。来源：https://m1.material.io/style/typography.html ・ https://ccjktype.fonts.adobe.com/2018/11/shsans-v2-technical-tidbits.html
- **CJK Web 排版 checklist**：按平台给字体栈（PingFang SC / Microsoft YaHei UI / Source Han Sans SC / Noto Sans CJK SC）；用 `lang` 属性切字体（同一套 CJK 字体可能含多语言字形但渲染方式不同）；日文正文用 `line-break: strict`；注音用 `ruby`；竖排用 `writing-mode: vertical-rl` + 逻辑属性；字间用 `text-autospace`；CJK 全字体 5–20MB，**必须子集化**或走 Google Fonts 按需子集。来源：https://symbolfyi.com/guides/cjk-web-typography/
- **HarmonyOS Sans（中文系统字体的设计取舍，可作中文界面主字参考）**：可变、覆盖汉/拉丁/西里尔/希腊/阿拉伯 5 大书写系统 105 种语言；针对中文笔画复杂导致的**可变字重笔画连接处易碎**做统一优化；西文选几何造型、大开口、减少字宽比例差异，使其比 Roboto 更宽更大、**与中文匹配度更高**；**深色模式下用更细字重，让视觉粗细与浅色模式保持一致**。来源：https://www.hanyi.com.cn/custom-font-case-7
- **可直接照搬的 CJK 友好 token 阶梯（鸿蒙规范整理）**：间距以 4 为基（4/8/12/16/24/32/48/64）；字号阶梯 11/12/14/16（正文默认）/18/20/24/28/36 fp；圆角 4/8/12/16/24 vp；语义色层 brand_primary、text_primary/secondary/tertiary/inverse、bg_primary/secondary/tertiary/emphasize、border_default/emphasize、success/warning/danger/info；控件高度主按钮 48vp、次按钮 40vp、输入框 48vp、标签 24vp。**明令禁止**：13/15/17fp 这类脱离阶梯的字号、11/13/17vp 这类脱离 4 基线的间距、深色模式仍用纯黑/纯白（应给 #F7F8FA 与 #1A1A1A）。来源：https://github.com/douya-labs/harmony-app-dev/blob/main/references/ui-design.md
- **游戏专用字号底线（角分辨率法）**：真正的度量是**视觉张角**而非像素——正文经验下限约 0.3°；1080p 电视 2 米外约需 20–22px，掌机 30cm 约 14–16px；建议用 1.25（Major Third，信息密集 HUD）或 1.333（Perfect Fourth，菜单/展示）比例建 scale；角色化命名（HUD-Label / Tooltip-Body / Menu-Header / Display / Diegetic-Prop）；可变字体的 `opsz` 轴用于在小编号下自动开大 x 高度与字腔；工程侧注意 Unity TextMeshPro 用 SDF 渲染、Unreal 两者皆可；**Figma 预览与引擎渲染在小字号下差异很大，必须在真机上测**。来源：https://www.sidebearings.com/game-ui-type-system/
- **HUD 文字最小尺寸的官方来源**：Microsoft Xbox 无障碍指南给出 4K 下主机 52px、PC 与 VR 36px 的字符高度下限——「比大多数设计师预期的大」。来源：https://www.wandr.studio/blog/game-hud-design

### Tauri 桌面壳（本项目直接相关）

- **自制标题栏的官方做法**：`decorations: false` + capability 权限（`core:window:allow-close` / `allow-minimize` / `allow-toggle-maximize` / `allow-start-dragging`）；`data-tauri-drag-region` **只作用于直接标注的元素**，子元素要各自标注；macOS 想保留原生红绿黄灯又想自定义背景，用 `TitleBarStyle::Transparent` 并从 Rust 侧设窗口底色。来源：https://v2.tauri.app/learn/window-customization/
- **Windows 11 的坑（务必提前知道）**：一旦 `decorations: false`，**悬停最大化按钮时的 Snap Layouts 浮出菜单会消失**，且无法在 HTML/CSS/JS 里找回——因为 Windows 只给以 `HTMAXBUTTON` 回应 `WM_NCHITTEST` 的窗口提供该功能，而 Tauri 的 WebView2 子窗口覆盖了整个客户区、抢先应答。社区解法是叠一个不绘制的透明原生子窗口吃掉那块矩形；另需 `minWidth ≤ 500px`（最好 ≤330）否则浮出菜单出现但吸附失效；圆角要调 `DwmSetWindowAttribute` 的 `DWMWA_WINDOW_CORNER_PREFERENCE = DWMWCP_ROUND`（只是 hint，且使用 per-pixel alpha 或窗口区域的窗口永远无法圆角）；存在约 8px 的不可见缩放边框，因此 `outerPosition()` 与 `innerPosition()` 会不一致。现成插件：https://github.com/Zbrooklyn/tauri-snap-layouts ・ https://github.com/oovz/tauri-plugin-decoration
- **一份完整的「单组件树 + 平台自适应」教条**：只适配**都是真正 OS 绑定**的部分——窗口装饰（mac 红绿灯在左、Win 最小化/最大化/关闭在右、Linux 依桌面环境）、滚动条（mac 悬浮自动隐藏 / Win 常驻细条）、修饰键标签、系统字体回退（`-apple-system "SF Pro"` / `"Segoe UI Variable Display"` / `Inter, "Ubuntu Sans", system-ui`）、原生菜单栏（macOS 在屏幕顶、Win/Linux 在窗内）、强调色绑定。**关键立场**：吸收宿主 OS 的交互模式（拖拽区、红绿灯、sheet 动画），但**不要整套吸收它的材质**（Liquid Glass 的半透明、Mica/Acrylic 会与自己的纸感/主色冲突）；**绝不在 Vue 应用里画一条假的 macOS 菜单栏**。来源：https://github.com/ttitamu/tti-ux/blob/main/design/platform-awareness.md
- **一份可直接对照的桌面应用设计文档（Tauri v2 + SvelteKit）**：多 webview 结构（主窗 / 44px 高的浮动录音条 / 模态选择器 / 全屏选区遮罩 / 常驻置顶摄像头气泡）；`--border` 一律 40–60% alpha；**主色绝不作为大面积填充**，深色模式下把主色混进表面的比例**低于 8%**；文案多数小于 14px 换取密度；页面 hero 28/32px semibold tracking-tight + `text-balance`；分区小标题 11px bold uppercase tracking 0.15em；**唯一的玻璃表面范式** `bg-card/70 + border-border/60 + shadow-craft-inset + backdrop-blur`，浮动录音条用 `bg-card/95 + backdrop-blur-3xl`，并明确写「**永不用平涂填充——玻璃需要一个非平凡的背景才读得出来**」；两套缓动（cubicOut 用于进出场，`cubic-bezier(0.16,1,0.3,1)` 用于 boot-pop/对话框，页面切换用 Apple 曲线 `cubic-bezier(0.32,0.72,0,1)` 280ms）；时长表 hover 200 / hero 320 / 卡片 stagger 240 且 delay = i×40（上限 240）/ 对话框进 200 出 150。来源：https://github.com/kanakkholwal/recast/blob/main/apps/desktop/DESIGN.md

---

## 五、影视化演出（VN「演出感」的具体可达手段）

- **2D AVG 演出要素拆解（2025-10，机核）**：演出要素 = 文本 / 立绘（含头像立绘）/ 背景（含 CG）/ 镜头 / 音乐音效。立绘效果（抖动、行为调用、附带特效、**生成与销毁**——后者是连接两个镜头、让角色在新机位「丝滑出现/消失」的关键，通常是多重效果的组合如「消融+震动+平移」）；镜头效果（转场切屏、景深）；背景效果（重影、抖动、一次性 CG 特效）；文本框与头像效果（能做的有限，因为文本框的首要职责是让人读）；角色在屏上有一个隐形的 XYZ 轴与固定常用点位；**立绘挂点在角色中心或腰部，角色不是生成在坐标上而是生成在挂点上**。空镜头（只有背景）的典型用途：动作无法用现有立绘机制表演、需要远景、单人心理独白、打电话、要给物件特写、**希望读者把注意力放回文字**。平移/环绕/推拉靠「立绘、背景、镜头之间的速度差」伪造。**工程实践：把常用复合效果封装成命名预设**（如 fadeout_left、shake_up_move）再调用。来源：https://www.gcores.com/articles/205249
- **月姬 Remake 的镜头语言（2025-06，机核）**：背景图上下加**粗黑边遮罩**表示背景与立绘的分离关系（类似「错觉 3D 图」）；立绘纵向占比常超 70%，头顶经常超出屏幕，形成「宽银幕近景」比例；用一张全景丰富背景图**裁切出不同景别**，像动画摄影；有明确的焦距/透视概念——**背景按等效焦距做虚化，立绘大小由焦距与位置关系决定**；有明确的「Cut（分镜）」概念与蒙太奇；**只要不露出脚踝以下，就能不加影子不改背景地把立绘与背景融合**；多人景深仅靠立绘大小区分远近；近景虚化可用「单独插入沙发图/遮罩 + 后处理光照与清晰度差分」实现；主观感受镜头先给感官碎片（发梢、落在眼前的高跟鞋）再给完整角色，作者引富野由悠季的解释：对一个人的印象往往不是整体形象而是某个感官片段的记忆。来源：https://www.gcores.com/articles/196861

---

## 六、可检索的参考资源库

- **Game UI Database 2.0**（Edd Coates）：1300+ 游戏、55000+ 界面截图，可按标题/界面类别/色值/图中文字/关键词检索，按类别、动画、颜色、材质、布局、品类筛选；另有未剪辑 UI 视频档案；获吉尼斯世界纪录；与 Lost in Cult 合作出版《The Game UI Bible》（400–500+ 页，收录 Valve、Criterion、Media Molecule 等工作室）。https://www.gameuidatabase.com/
- **Interface In Game**：5000+ 截图，20+ 界面要素分类（Menu 6081、In-Game 5186、Overlay 3021、Stats 2013、Inventory 1241…），15 个品类、10 种视觉主题；含 Ubisoft / Warhorse / Gameloft / Behaviour / Territory Studio 等设计师访谈；提供 60+ 线框 PSD；免费。https://mazikbox.com/p/interface-in-game
- **VNDev Wiki**：GUI 与 Textbox 词条是 VN 界面要素的权威清单（主菜单、存读档、EXTRA、画廊、NVL/ADV 定义、打字机与断行）。https://vndev.wiki/Graphical_User_Interface ・ https://vndev.wiki/Textbox
- **Fuwanovel「UI Design – An Anatomy of Visual Novels」**：ADV/NVL 语法与破规矩的经典分析文章（2025-05）。https://forums.fuwanovel.moe/blogs/entry/4226-ui-design-%E2%80%93-an-anatomy-of-visual-novels/
- **Visual Novel Interfaces（tumblr）**：纯截图画廊，快速浏览各社 GUI 风格。https://visual-novel-interfaces.tumblr.com/
- **VNConf 2025 两场直接相关演讲**：Demereu「A Guide to UX and UI: Making Your Game Appealing and Readable」（moodboard→交互流程图→线框→对比度→视觉层级→一致性）；Kigyo「Make your visual novel readable: Good UI for your textbox」。https://www.youtube.com/watch?v=X0pEwpPGPZI ・ https://www.youtube.com/watch?v=B8Moc8512ps
- **NomnomNami《How can I design a good UI for my VN?!》**（11 页 PDF，4.9/5，95 评分）：最常被引用的 VN UI 入门；指出最糟的两种做法是「正文铺满整宽」与「只用不到 30% 宽度」。https://nomnomnami.itch.io/how-can-i-design-a-good-ui-for-my-vn
- **Making Your Visual Novel Accessible（spiralatlas）**：VN 无障碍清单——Skip（且只跳已读）、Autoplay、Self Voicing、键盘导航、大字号、改键、简单语言、字幕与音效文字说明；并提醒**改字号不会自动缩放文本框与菜单**这个最大的坑。https://spiralatlas.github.io/making-your-visual-novel-accessible/
- **VN 文本可读性数值（三方交叉）**：每行 70–80 字符上限（VNConf）；≤60–70 字符、桌面 ≥16px、移动 ≥18px、行高 1.4–1.6、WCAG AA 4.5:1、深色半透明底 + 白字最稳、正文避免彩色（对话 UI 指南）；**理想行长为 8–10 个词**（Ren'Py issue 讨论）。https://www.abratabia.com/game-ui-design/dialogue-ui.php ・ https://github.com/renpy/renpy/issues/6316
- **Game UI 的分类学（diegetic 光谱）**：Diegetic（存在游戏世界内、角色可见，如《死亡空间》脊椎血量）> Spatial（在世界内但角色不可见，如浮动伤害数字）> Meta（世界外但有叙事理由，如受伤时屏幕血迹）> Non-Diegetic（纯覆盖层）。来源：https://generalistprogrammer.com/game-ui-ux-design
- **Diegetic 的实证证据（弱）**：VR 对照实验中 11/13 被试偏好 diegetic GUI，但沉浸感量表未达显著；2026 年的导航引导研究同样只有非显著趋势（效应量大、样本不足），结论倾向「两者互补」。https://diglib.eg.org/server/api/core/bitstreams/98e0c224-5491-454f-aa95-d5622f5def68/content ・ https://exa.ai/library/publication/5hpqxv96cyt
- **HUD 设计的反面清单（WANDR）**：最小化 HUD 不会消除信息需求，只会**把成本转移到压力更大的时刻**；diegetic HUD「通常搬不走」（曲面暗处斜排的数字凌晨三点读不了）；可行折中是**固定位置的小常驻核心 + 其余全部情境化**；反馈必须 100ms 内，缓动曲线在真机上按速度测；对比度必须对**渲染器能产出最糟背景**验证，而不是对 mockup。https://www.wandr.studio/blog/game-hud-design
- **Juice 与 UI 音效**：Juicy audio 三要素 = 强调/放大、凝聚/一致、通感；**每帧最多 4 个并发 UI 音效**、屏幕震动 ≤5px/≤200ms、白闪 ≤2 帧；音效做 ±5–15% 随机变调防疲劳；频段分工（20–80Hz 体感、80–300Hz 重量感、300–2000Hz 信息、2000–6000Hz 存在感/攻击性、6000–20000Hz 空气感）；把关键音放在环境音未占用的频段以免掩蔽。https://exa.ai/library/publication/bpwtxqrxmp0 ・ https://learning.nepa-ai.com/256-aesthetics-juice-game-feel ・ https://medium.com/@mezoistvan/juicy-ui-why-the-smallest-interactions-make-the-biggest-difference-5cb5a5ffc752
- **9-slice 与间距基线**：9-slice（四角不拉伸、四边单向拉伸、中间双向）是游戏 UI 最重要的工程概念；间距建议早定 4/8/16/24/32 并只用这些值——「间距随意是界面看起来『说不上哪里不对』的最常见原因」。https://generalistprogrammer.com/tutorials/game-ui-design-best-practices
- **AI 生成游戏 UI 的逆向管线（学术）**：SPRITE（arXiv 2604.18591）——VLM 先把截图转成 YAML 中间表示（层级嵌套镜像 Unity UXML），再用 GroundingDINO + SAM2 做像素级切分、LaMa 做遮挡补全，最后由 GPT-5 / Claude 4.5 生成 UXML/USS；YAML 比 JSON 省 20–30% token。https://arxiv.org/abs/2604.18591

---

## 七、AIVN 的直接同类（AI 生成视觉小说）——竞品形态与界面决策

- **IntelliVNG Studio**（FE-square）：多 Agent VN 创作工坊。**自由模式**（一句话创意自动生成世界观/角色/场景/剧情）与**专业模式**（表单手工填写，每个字段都有「AI 自动补全」）双轨；Story Planner（Tree-of-Thoughts）/ Node Writer（Few-shot CoT，按依赖分层**并行**生成）/ Story Reviewer（ReAct + 工具调用）/ Orchestrator；**节点式剧本编辑器**（拖拽连线、条件变量、实时整体与局部预览）；Generation Dashboard 分阶段展示 agent 日志；立绘（透明形状）/背景/BGM 随时补生成；导出为**单 HTML 离线可玩**或 DSL JSON；AI 编辑助手支持自然语言增删改节点、**思考过程可视化**、Token 用量追踪、SSE 打字机。来源：https://github.com/FE-square/IntelliVNG
- **novel2galgame**（lin1753）：把中文恋爱 txt 小说一键转成 Ren'Py 游戏。7 Agent LangGraph 管线 + RAG（ChromaDB 稠密 + BM25 + 元数据 → RRF 融合 → Cross-Encoder → LLM 终排），解决百万字跨章一致性；**VN Script IR v1.0 冻结、8 种 step 类型、Zod schema 为权威定义**，Web 预览与 Ren'Py 导出共享同一份 IR；资产清单→生成→SHA256 缓存；**15 页 React 工作台**（项目列表 / 3 步向导 / 模型配置 / 总览 / 章节管理 / 场景工作区 4 tab（原文·解析·归因·脚本）/ **VN Step 拖拽编辑器** / 浏览器内 VN 预览 / 视觉提示词 / 资产管理 / RAG 检查器 / IR 原始视图 / 任务日志 / 项目设置）。来源：https://github.com/lin1753/novel2galgame
- **Foreverse「剧场模式」**：把书架里任何一本小说**就地**切成 galgame 演出——立绘+名牌+逐字台词+AI 场景配图+选择肢；**进出共享同一阅读进度**（在剧场读到哪，退出后阅读器就翻到那页）；选择肢二击确认后 AI 续写成正式分支写回书里；**把正文编排成舞台脚本这一步不调用任何 AI，纯本地规则、零成本离线可用**；说话人归因「宁可放进旁白，不冒错认的险」（人工标注 15 段代表段落，强归因部分零误判）；「生成此景」先弹费用确认、同场景重进复用不重复扣费。来源：https://foreverse.app/zh/theater
- **dsh-galgame-generator**（DSH 插件）：剧本文档 + 立绘/背景/音乐 → 自包含 `.galgame.html`（双击即玩、素材全内嵌、localStorage 9 槽存档）；立绘跟随说话人 0.35s 淡入淡出不闪、旁白全隐藏；`名字·表情: 文件.png` 定义差分并在存档中保留；`[bgm 文件 0.5]` 带音量；OP/ED/CG 动画支持 gif/svg/mp4/webm/avi；`[存档 N]` 可配 1–20 槽；播放器含打字机/自动/快进/历史/结局画面。来源：https://github.com/baisama-cloud/dsh-galgame-generator
- **ArtiMeow AI GalGamer RT**：Electron 实时 AIGC galgame 框架——AI 实时生成剧情与背景图；**时间线以流程图呈现、可回档到任意节点**；知识库自动维护世界观/角色/地点；UI 自述为「现代化渐变设计 + 动画」「全屏背景 + 半透明文本框」，可调字号与透明度。来源：https://github.com/B5-Software/ArtiMeow-AIGalGamerRT
- **AI-GAL**（tamikip，Ren'Py 为基础）：V1.6（2025-03-19）新增 ComfyUI 支持、美化界面、剧情生成更稳；V1.5 起支持多语种、快照保存与分享、与角色一对一对话模式；曾「重建 GUI 并更名 AI GAL 启动器」；支持**分支选择模式**（用 AI 给的分支或自己写）；生成前可设主题；支持转场特效。来源：https://github.com/tamikip/AI-GAL
- **WorldOS 视觉小说制作器**：浏览器内的 VN 舞台——上传背景与立绘（建议透明底 PNG），每角色可配多张立绘各写一句适用说明（微笑/生气/害羞），AI 写每一幕并**按剧情自动切表情**；背景允许 AI 即时生成并被「记住」，下次回到同一地点画面保持一致。来源：https://worldos.cc/zh-cn/apps/visual-novel

---

## 八、中文游戏 UI 的一手案例（可参考其论证方式）

- **《和平精英》UI 2.0 复盘（腾讯光子设计中心）**：先做同品类与新品的视觉趋势研究，结论是「现代游戏视觉**逐渐明亮、扁平、高效、娱乐化**，同时配合炫酷拟真的动效场景」；定下「简洁直观 / 硬朗气质与冒险冲击力 / 扁平轻薄」三原则；**大厅按功能划成四大模块，排行榜/军团/设置/邮件全部下沉到二级**；提炼出「拟态」设计语言（随时令赛季改变外观，内核不变）与「全景化动态背景」（每个界面都「活起来」，赛季切换整体换新）。来源：https://blog.csdn.net/wubaohu1314/article/details/120789384
- **《无畏契约手游》视觉设计解析**：美术必须「为玩法服务」；地图地面以暗色为主与角色形成对比、形状规整、掩体与包点交代清楚、**不放无意义装饰**；每个英雄有且只有一两种主题色，让玩家用颜色分辨英雄；角色遵循「**上繁下简**」——下装颜色深、设计密度低，减少视觉焦点；不可互动部分才用来展示美术功力。来源：https://news.qq.com/rain/a/20251225A04SOS00

---

## 九、低可信度 / 需二次核实的来源（仅作线索，勿直接引用为事实）

- 若干中文 SEO 站的「游戏 UI 趋势」「色彩心理学」「夜纹设计」长文，内容有明显 AI 生成与重复特征，其中的具体百分比（如「提升留存 27%」「点击率 +19%」）无可查出处：https://www.eoopo.com/2025/12/29/... ・ https://www.oryoy.com/news/...
- 一份以「美术部 UI 设计规范手册」为名的文库上传文档，规格值（如按钮 3.5rem×2.5rem、主色 #004D99、Pantone 2025「深海蓝」）自相矛盾且无法溯源：https://max.book118.com/html/2026/0520/8043111077010073.shtm
- 上表中引用的部分 2026 年趋势文章本身带有营销/引流性质（Line25、ProofMatcher、inspirefusion 等），其「采用率百分比」为作者自拟，应只取其**定性判断**而非数字。

## 十、可执行要点摘要（供设计评审直接引用）

1. **「不打扰」仍是 VN 界面的第一性原则**（ADV 半透明底 + 底部小按钮 + 可整体隐藏），破格只在情绪表达需要时使用，且必须先保证存读档不难受。
2. **姓名窗与文本框要按多语言与字号变化设计**——先留出溢出处理方案（程序化加宽/换行），否则中文/日文排版在英文下必崩。
3. **只高亮最新一行**（月姬重制）是解决 NVL 大段文本可读性的低成本高收益手法；**流程图**已成为现代 VN 的标配而非加分项。
4. **可读性数值可量化**：行长 60–80 字符、行高 1.4–1.6、正文 ≥16px、AA 4.5:1、字号与文本框宽度联动、并提供字号/透明度/版面开关。
5. **工具侧的现代范式已相当收敛**：暗色优先、极端用色克制、发丝边框代替阴影、圆角只给浮层、命令面板 + 全键盘、乐观 UI 与静默回滚、面板可停靠/可存布局/可 Zen。
6. **但「按任务分页/分工作区」比「把所有面板都堆在一个画布上」更被专业工具采纳**（Blender workspaces、DaVinci pages、Novaboard Simple/Advanced），对「舞台 + 工坊」双面产品有直接参考价值。
7. **游戏感与工具感共存的可行配方**：常驻层克制（对比度优先、反馈 100ms 内），让**菜单与过渡**承担美学（泼墨、颜料、字体排版、Liquid Glass 式的层级感）；Liquid Glass 的官方立场本身就是「只用于导航层」。
8. **动效应有 token 化数值表**（时长 100/150/200/300/400/500ms，弹簧按性格命名并按 elevation 自动选档），并对 `prefers-reduced-motion` 全局降级。
9. **色彩系统建议用 OKLCH + 两层 token（primitives → semantic），暗色不是简单反色**；Radix 的 12 阶语义（9 为实色、11/12 为文字）可直接借用命名逻辑。
10. **中文界面需要单独的字体决策**：HarmonyOS Sans 这类「为中西文匹配而设计、深色模式用更细字重」的做法，比直接套 Inter + 系统中文回退更稳。
11. **Tauri 壳要提前决定**：是否自制标题栏（代价是 Windows 11 Snap Layouts 需额外原生叠加层）、是否跟随宿主材质的交互模式而非材质本身。
