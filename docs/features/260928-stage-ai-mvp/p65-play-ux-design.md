# Stage-AI 现代 Galgame 游玩层 UI/UX 设计规格书

> **文档标识**：`p65-play-ux-design`  
> **所属版本**：Stage-AI MVP / 游玩层体验重塑（Play Layer UX Revamp）  
> **设计目标**：将当前管理后台式的“浅色上下切块盒子”转变为对标顶级商业 Galgame 与现代 AI 交互的“全屏多层沉浸式舞台（Layered Stage）”。

---

## 0. 概述与设计宗旨

Stage-AI 是一款将 LLM 剧作家流式输出与二次元视听演出实时结合的 AI Galgame 引擎。玩家在游玩过程中具有独特的双重身份：
1. **演员（Actor）**：入戏与角色互动、做出剧情抉择、输入即兴自由台词；
2. **导演（Director）**：任意时刻插入 OOC 导演注、观察与调整谱系路线分支、在工坊中共创剧本设定。

### 0.1 核心痛点与现状诊断
当前前端实现（`apps/web/src/stage/` 及 `app.css`）体现出明显的工程初期原型特征：
- **布局切块生硬**：采用垂直 flex 流（`theater-bar` + `theater-stage` + `theater-dialog` + `stop-panel`），舞台被挤压在屏幕中央，上下被大块实色背景与边框割裂，毫无传统视觉小说的沉浸画幅感；
- **全白扁平风格**：全局使用冷淡的浅灰白底（`--bg: #fafaf8`），与立绘、CG、暗色背景格格不入，高亮文字缺乏轮廓对比；
- **交互割裂**：选项卡片（Choices）与自由输入（Free Box）堆在最底部的单独面板中，像网页表单而不是游戏选项；导演注浮层（Director Box）像普通的弹窗输入框；
- **动效机械单调**：逐字机打字速度恒定为 35ms/字，缺乏逗号/句号的情绪停顿；立绘表情切换直接闪烁变更 `src`，无平滑差分过渡；多立绘并存时无发言人焦点（Speaker Focus）。

### 0.2 本方案的三大重塑原则
1. **全屏沉浸（Layered Stage Architecture）**：舞台占满视口（16:9 或全屏适应），对话框、快捷菜单、决策面板全部演进为**半透明悬浮 HUD 覆盖层**；
2. **节奏重整（Dramaturgical Rhythm）**：打字机注入标点停顿与呼吸韵律，立绘支持差分淡入（Crossfade）与发言人聚焦变暗（Speaker Focus），让 AI 流式输出拥有传统监督打磨出的剧场质感；
3. **双重身份无缝交融（Actor & Director Co-existence）**：自由输入直接化身入戏对话框，导演注（OOC）以沉浸胶囊形式随手唤出，二者层次分明、动静相宜。

---

## 1. 行业与前沿调研发现（真实产品深度对标）

### 1.1 Key / Leaf / Type-Moon 系商业 Galgame 演出界面

#### A. Key 系（《Summer Pockets》《CLANNAD》《AIR》）
*参考资料：[Key Official Summer Pockets UI System](https://key.visualarts.gr.jp/summer/)、[VNDev Wiki - Textbox Guidelines](https://vndev.wiki/Textbox)*

* **ADV 黄金分割**：对话框固定位于屏幕底部 20%~25% 区域，采用 70%~85% 不透明度的带纹理玻璃底板，既保证文字绝对易读性，又隐约透出角色下半身与环境。
* **名字牌（Nameplate）规范**：名字牌通常悬挂或贴合在对话框左上边缘（负边距或微凸设计），带有角色专属的强调色标（如青、粉、紫）与徽记。主角内心独白或旁白时不显示名字牌。
* **Quick Menu 附着设计**：在对话框底部边缘或右侧排列一排低明度微型图标（Auto、Skip、Log/Backlog、Save、Load、Config、Hide）。平时保持 30% 低透明度，鼠标悬停时点亮并浮动，最大程度减少视觉干扰。
* **CTC（Click to Continue）**：每句台词播完后，在右下角循环播放微动效（如小羽毛飘动、光点微闪、倒三角呼吸上下浮动），明确向玩家传达翻页契机。
* **Backlog（剧本历史回溯）**：鼠标滚轮向上或点击 Log 键，即时唤出覆盖全屏的半透明深色抽屉，支持以对话流形式回顾前文，并附带每一句语音的“重听（Voice Replay）”按钮。

#### B. Type-Moon 系（《月姬 -A piece of blue glass moon-》《魔法使之夜 (Mahoyo)》）
*参考资料：[Comparing the Visual Direction of Tsukihime VS Mahoyo](https://arimiadev.com/comparing-the-direction-of-tsukihime-vs-mahoyo/)、[4Gamer 魔法使之夜演出监督专访](https://www.4gamer.net/games/115/G011514/20120511075/index_3.html)*

* **电影化镜头构图（Cinematography Layout）**：打破“两人正面站立对视聊天”的刻板印象。通过机位推拉摇移、近景特写、过肩视点（Over-the-shoulder）与倾斜镜头（Dutch angle），让静态素材呈现极强的动态张力。
* **去 UI 化与纯净沉浸（Minimalist / Invisible UI）**：
  * 《魔法使之夜》常态下屏幕完全没有任何系统按钮，对话框甚至不设常驻背景边框，而是通过优雅的渐变暗角（Vignette）或轻柔的暗黑背影层衬托高对比白色文字。
  * 任何时刻单击鼠标右键或空格，立刻隐退所有文字与边框，露出完整画面。
* **NVL 与 ADV 的灵活混合**：大段世界观描写与内心独白时采用全屏悬浮排版（居中大字、舒缓行距、无名字牌）；角色激烈交谈时切换回底部利落的单行/双行短对话。

#### C. Leaf 系（《WHITE ALBUM 2》《传颂之物》）
*参考资料：[Leaf Official UI Archives](http://leaf.aquaplus.jp/)*

* **内心独白与叙事层级**：WA2 深度利用文本样式区分心理活动——内心独白不使用引号，文字颜色偏暗青灰或斜体，缩进空两格；现实台词使用「……」并配以纯白高亮。
* **选择肢（Choices）的戏剧张力**：选项卡片从来不出现在屏幕边角，而是居中悬浮于全屏纵向 50%~60% 处，半透明浮层覆盖在定格的立绘表情之上，选项按钮带有精致的金属拉丝或光泽微动，悬停时产生微小扩散光晕。

---

### 1.2 主流 ADV 引擎（Ren'Py / Kirisame / Ink）的标准化沉淀

#### A. Ren'Py 的图层模型与 Say Screen
*参考资料：[Ren'Py GUI Customization Guide](https://nightly.renpy.org/doc/gui.html)、[Ren'Py Character and Dialogue System](https://deepwiki.com/renpy/renpy/5.4-character-and-dialogue-system)*

* **Z-Index 分层架构**：
  ```text
  [Overlay Screen (Notifications, Tooltips, System Menus)]  -> Z: 300
  [Choice / Input Screen (Modal Interaction)]               -> Z: 200
  [Say Screen (Dialog Window + Namebox + CTC + Quick Menu)] -> Z: 100
  [Foreground & Transition Layer (Flash, Vignette, Wipes)]  -> Z: 50
  [Master Layer: Sprites (Left, Center, Right, Layered)]    -> Z: 30
  [Master Layer: Background Image / Video]                  -> Z: 10
  ```
* **标点符号微停顿（Punctuation Rhythm）**：
  Ren'Py 引擎默认或通过插件处理文本流时，遇到标点符号会动态插入微停顿：逗号/分号停顿 `100~150ms`，句号/叹号/问号/省略号停顿 `250~350ms`。这种微停顿是消除机械流水感的关键！
* **二段式点击推进（Two-step Dismissal）**：
  第一击：如果当前行文本打字机尚未走完，立即瞬间打印出本行全文，同时语音淡出；
  第二击：文本已经全部显示完毕，点击才消费队列推进到下一行。

#### B. 吉里吉里 (KAG / Kirisame) 与 TyranoScript
* **立绘差分平滑淡入（Crossfade）**：同一个角色的表情切换绝不能直接白闪或生硬撕裂，而是利用绝对定位将新表情贴图叠加在旧贴图上方，在 120ms~200ms 内完成透明度过渡。
* **发言人聚焦（Speaker Focus / Darken Inactive Sprites）**：当角色 A 说话时，角色 A 保持 100% 亮度与正常比例；其余在场角色自动添加 `filter: brightness(0.82) saturate(0.9)` 并微退后 `scale(0.98)`。

---

### 1.3 现代 AI 叙事产品（SillyTavern / AI Dungeon / NovelAI）

#### A. SillyTavern（酒馆）的 VN 模式与原语交互
*参考资料：[SillyTavern Visual Novel Mode Docs](https://github.com/SillyTavern/SillyTavern-Docs/blob/main/Usage/User_Settings/Visual-Novel.md)、[PR #2617 Letterbox VN Mode](https://github.com/SillyTavern/SillyTavern/pull/2617)*

* **Chat 到 VN 的视差映射**：将文本消息流转换为底部单行 ADV 对话框，立绘随角色自动水平排列分布（2 角色为 30% / 70%，3 角色为 20% / 50% / 80%）。
* **AI 核心原语的 UI 落地**：
  * **Swipe（候选重 Roll）**：在对话框右上角显示 `< 1/3 >` 翻页指示，可左右滑动或热键切换 AI 的不同生成变体；
  * **Click-to-Edit（原地快速修正）**：双击台词即可直接切入输入框原地修改，回车即保存，保证剧情连贯性；
  * **Zen Mode（禅模式）**：一键隐藏所有非必要调试面板，仅保留立绘与文本气泡。

#### B. AI Dungeon & NovelAI
* **角色行动分流（Do / Say / Story）**：输入栏提供模式切换胶囊，清晰界定玩家输入的是角色说的话（Say）、角色的行动动作（Do）、还是第三人称旁白推演（Story）。
* **流式追赶骨架**：当大模型正在生成尚未落笔时，对话框出现呼吸闪烁的点阵 `●●●`，输入控件呈现轻柔锁定的能量脉冲。

---

### 1.4 对标总结矩阵

| 维度 | 传统商业 Galgame (Key/Type-Moon) | 主流 ADV 引擎 (Ren'Py) | 现代 AI 叙事 (SillyTavern/AID) | Stage-AI 现存缺陷 | Stage-AI 目标定位 |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **舞台构图** | 全屏覆盖，16:9 画幅，立绘占 85% 高度 | Master 图层全屏，Say 浮层置底 | 背景+立绘居中，自适应窗口 | 垂直上下切块，像后台表单 | **全屏绝对定位叠加（Layered HUD）** |
| **对话框风格**| 深色磨砂玻璃 / 渐变暗角，极具质感 | 贴图或主题 Frame，高度定制 | 现代毛玻璃卡片，支持圆角 | 纯白方块（`#fff`），生硬单薄 | **暗色高斯模糊亚克力（Glassmorphism）** |
| **名字牌** | 独立浮雕，左上悬挑，附带角色色彩 | 独立 namebox，坐标微调 | 消息头标签 / 角色 Avatar | 普通加粗文字，无层次 | **悬挑胶囊，角色主题色亮条** |
| **逐字机节奏**| 随人声或标点停顿，富有情感 | 内置标点延迟，二段式点击 | 流式 SSE 直接吐字，易抖动 | 机械恒定 35ms，无标点停顿 | **标点自适应延时（120~280ms）** |
| **选项形态** | 屏幕中央垂直悬浮卡片，悬停微光 | Choice Screen 居中悬浮 | 树状卡片 / 底部按钮 | 挤在底栏 `.stop-panel`，像表单提交 | **居中悬浮卡片堆栈，带已读记忆** |
| **立绘表现** | 差分 Crossfade，发言人聚焦高亮 | 属性差分切换，暗化未发言者 | 焦点暗化，多角色水平展开 | 直接换 URL，生硬跳闪，无聚焦 | **双缓冲 180ms 淡入，未发言角色暗化** |
| **沉浸隐藏** | 右键/空格瞬隐 UI，纯赏立绘 CG | 一键 Hide Window（按 H / 滚轮下）| Zen Mode 纯净模式 | 无法隐藏，顶部与底栏恒定常驻 | **点击空白/右键瞬隐，微菜单悬停显现** |
| **移动端适配**| PS Vita / Switch 触屏手势 | `variant("small")` 大热区 | 底部浮窗，竖屏自适应 | 简单响应式，文字被挤压 | **9:16 竖屏立绘半身特写，手势抽屉** |

---

## 2. 适用于 Stage-AI 的具体界面架构与组件规格

### 2.1 全屏图层架构（Z-Index Stack 规范）

Stage 必须从现在的 `flex-direction: column` 改为**纯绝对定位的多层级舞台视口**。整体结构严格遵循以下 Z-Index 规范：

```text
┌────────────────────────────────────────────────────────┐
│ Layer 10: Modal / Danger Gate (Audio Unlock / Crash)   │ z: 300
├────────────────────────────────────────────────────────┤
│ Layer 9:  Drawer Screens (Lineage Route, Log, Workshop)│ z: 200
├────────────────────────────────────────────────────────┤
│ Layer 8:  Interactive Overlays (Choices, Free Input)   │ z: 120
├────────────────────────────────────────────────────────┤
│ Layer 7:  Quick Actions Bar (Auto, Skip, OOC, Voice)   │ z: 110
├────────────────────────────────────────────────────────┤
│ Layer 6:  Theater Dialog Box (Nameplate, Text, CTC)    │ z: 100
├────────────────────────────────────────────────────────┤
│ Layer 5:  Screen Atmosphere (Flash, Shake, Vignette)   │ z: 50
├────────────────────────────────────────────────────────┤
│ Layer 4:  Fullscreen Event CG & Transitions            │ z: 40
├────────────────────────────────────────────────────────┤
│ Layer 3:  Character Sprites (Left, Center, Right)      │ z: 30
├────────────────────────────────────────────────────────┤
│ Layer 2:  Scene Environment (Weather particles, Dust)  │ z: 20
├────────────────────────────────────────────────────────┤
│ Layer 1:  Scene Background (Crossfade Image / Skeleton)│ z: 10
├────────────────────────────────────────────────────────┤
│ Layer 0:  Viewport Base (Letterbox / Stage Backplate)  │ z: 0
└────────────────────────────────────────────────────────┘
```

---

### 2.2 舞台构图与多端响应式

#### A. 桌面端（Desktop / Wide Screen）
* **视口规则**：维持 **16:9 标准画幅比例**（如 1920×1080、1280×720）。若浏览器窗口比例宽于 16:9 则产生左右遮幅（Pillarbox），若窄于 16:9 则产生上下遮幅（Letterbox）。遮幅背景使用极暗底色 `#08090b`。
* **尺寸基准**：
  * 对话框宽度：`min(1100px, 92vw)`，居中悬浮；
  * 对话框底部间隙：`28px`；
  * 立绘高度：占舞台有效高度的 `86%`，底部基准线对齐到屏幕底缘，立绘脚部被对话框自然半透遮挡，构成自然的纵深层次。

#### B. 移动端（Mobile / Portrait 竖屏）
* **视口规则**：全屏填充（`100dvw` × `100dvh`）。
* **立绘特写重构**：移动端宽度受限，立绘不再按全身缩放，而是**聚焦上半身特写（Bust Shot）**，立绘高度放大至视口的 `120%~135%`，中心点上移，保证角色的面部表情在手机屏幕上极具视觉冲击力。
* **对话框布局**：紧贴底部，左右留白缩小为 `10px`，高度约 `28% vh`，操作按钮增大触摸靶区（Min `44px`）。

---

### 2.3 对话框（TheaterDialog）排版与微交互数值规格

#### A. 视觉与容器规格
* **尺寸**：PC 端宽度 `92%`（最大 `1120px`），高度固定在 `170px`；移动端宽度 `calc(100% - 20px)`，高度 `180px`。
* **背景材质**：高斯模糊深色亚克力（Glassmorphism）
  ```css
  background: rgba(14, 16, 22, 0.78);
  backdrop-filter: blur(16px) saturate(180%);
  -webkit-backdrop-filter: blur(16px) saturate(180%);
  border: 1px solid rgba(255, 255, 255, 0.12);
  border-radius: 12px;
  box-shadow: 0 16px 36px rgba(0, 0, 0, 0.5), inset 0 1px 0 rgba(255, 255, 255, 0.15);
  ```

#### B. 名字牌（Nameplate）规格
* **位置**：绝对定位贴合在对话框左上角上方，`top: -18px; left: 32px;`。
* **尺寸与外观**：高度 `34px`，左右内边距 `18px`，圆角 `6px 6px 0 0` 或胶囊圆角。
* **色彩映射**：
  * 主角卡（Protagonist）：金色强调条 `border-left: 4px solid #dfc285`，文字 `#f5eedc`；
  * 配角卡（NPC）：依角色声线或固定色相映射（如小春为 `#ff8da1`，老师为 `#5dade2`）；
  * 神秘/未知（ActorId 缺失）：银灰色强调条 `border-left: 4px solid #8c9ba5`；
* **心情标签（Mood）**：若有 `mood` 属性，紧跟在姓名之后，样式为 `font-size: 12px; opacity: 0.65; font-weight: normal; margin-left: 6px;`。

#### C. 文本排版的三种演出形态
1. **角色对话（Say）**：
   * 字体：系统默认无衬线字体栈或高质量排印黑体，字号 `17.5px`（移动端 `16px`），行高 `1.85`；
   * 颜色：主文字 `#f0f2f5`，字间距 `0.04em`；
   * 标点：自动遵循中西文标点避头尾法则（`line-break: strict; word-break: break-all;`）。
2. **旁白叙述（Narrate / Scene）**：
   * 名字牌自动隐藏；
   * 文本整体向内缩进 `16px`，颜色调整为微暗的羽灰色 `#cfd3dc`；
   * 文本居中或左对齐，略带衬线体气质，传递客观环境视角。
3. **内心独白（Thought）**：
   * 名字牌显示为：`主角名（内心）`，字体微暗；
   * 文本使用括号包裹（如 `（……）`），文字颜色微泛幽蓝或金灰（`#dcd8ee`），字体加轻微斜体或思源宋体，表现心声私密感。

#### D. 打字机与呼吸节奏（Rhythm & Typewriter）
* **基础速度**：基准字符速度设定为 **`28ms/字`**（比当前的 35ms 略快，提升阅读流畅感）；
* **标点智能延时（Punctuation Pause）**：
  * 短停顿：遇到逗号 `，`、顿号 `、`、分号 `；` 时，打字机临时额外休眠 **`140ms`**；
  * 长停顿：遇到句号 `。`、叹号 `！`、问号 `？`、省略号 `……`、破折号 `——` 时，额外休眠 **`280ms`**；
  * 效果：在没有 TTS 语音时，纯文字也具备宛如口语呼吸的停顿感，彻底摆脱死板敲字感。
* **二段式点击状态转移**：
  * 状态 A（打字中）：用户点击屏幕任意处 $\rightarrow$ 立即瞬显整句文本（`shownLength = totalLength`），同时通过 `hooks.onFastForward` 触发 TTS 语音 150ms 快速淡出，进入状态 B；
  * 状态 B（当前句播完）：用户点击屏幕任意处 $\rightarrow$ 消费下一条 Cue（推进到下一行）。
* **CTC（Click to Continue）指示灯**：
  * 当前句完全显示完毕且并非处于流式等待时，对话框右下角浮现跳动微箭头 `▼` 或呼吸菱形 `◆`；
  * 动效：周期 1.2s 的柔和上下浮动（`translateY(0) -> translateY(4px)`），颜色为金色 `#dfc285`。
* **生成流追赶指示符（Exhausted & Live）**：
  * 当客户端已追赶上当前所有文本，而后端 LLM 仍在撰写下一拍时，CTC 替换为轻柔呼吸的三点波纹 `● ● ●`（`letter-spacing: 4px; animation: breathe 1.4s infinite;`），并提示微弱副文案“剧作家正在落笔…”。

---

### 2.4 角色立绘差分与焦点系统

#### A. 表情差分平滑淡入（Crossfade Transition）
* 现有代码问题：`url` 变动时直接替换 `<img>` 的 `src`，在网络或浏览器绘制时会产生肉眼可见的瞬时白闪。
* 新规范设计：
  * 立绘挂载槽（Slot）采用**双缓冲渲染**（Active Buffer & Incoming Buffer）；
  * 当检测到同角色表情 `expression` 切换时，新贴图以 `opacity: 0` 叠加在旧贴图上方，在 **`180ms`** 内平滑淡入至 `opacity: 1`，完成后卸载旧贴图。

#### B. 发言人聚焦（Speaker Focus & Darken Inactive Sprites）
* **触发机制**：当前播放行（`current.type === "say"`）的 `actorId` 即为活跃发言人。
* **视觉表现**：
  * **发言人立绘**：保持 `filter: brightness(1.0) drop-shadow(0 8px 24px rgba(0,0,0,0.35))`，图层层级提升至最前，并施加极其微弱的强调放大 `transform: scale(1.01)`（过度时间 240ms）；
  * **非发言人立绘**：自动应用 `filter: brightness(0.78) saturate(0.88)`，层级略微后撤，缩放保持 `scale(0.98)`；
  * **无发言人（Narrate / Scene / 独白）**：所有立绘恢复均衡亮度 `0.9`。

#### C. 立绘待机微呼吸动效（Idle Breathing）
* 立绘待机时绝非死物，施加一个极慢周期的垂直呼吸动效：
  ```css
  animation: sprite-breath 4.2s ease-in-out infinite alternate;
  @keyframes sprite-breath {
    0% { transform: translateX(-50%) translateY(0); }
    100% { transform: translateX(-50%) translateY(-5px); }
  }
  ```

---

### 2.5 停止点与决策交互（StopPanel 进化）

**绝对禁止**将停止点作为屏幕底部的常规表单！停止点应作为舞台中央的强注意力焦点。

#### A. Choice 选项（选择肢卡片堆栈）
* **定位**：位于舞台中央垂直 `48%~58%` 处（避开立绘脸部，刚好落在立绘胸腹部高度），居中悬浮。
* **卡片规格**：
  * 宽度：固定 `540px`（移动端 `88vw`）；
  * 高度：单项 `52px`，项间距 `12px`；
  * 背景：高通透暗金黑底 `background: rgba(22, 24, 34, 0.88)`，边框 `1px solid rgba(223, 194, 133, 0.35)`；
  * 字体：居中对齐，字号 `16px`，带微弱金色光影；
  * 快捷键：卡片左侧带有 `[1]`、`[2]`、`[3]` 数字微标，支持键盘直按。
* **悬停微交互**：
  * 鼠标悬停时，边框变为高亮金光 `border-color: #dfc285; box-shadow: 0 0 16px rgba(223, 194, 133, 0.45);`；
  * 按钮水平微向右滑动 `4px`，并播放轻脆的焦点音效。
* **已选项记忆（Seen / Chosen Hint）**：
  * 若该选项曾被玩家在以往分支中选过，卡片右侧显示微暗勾选标识 `✓ 已选过`，文字颜色偏暗灰，辅助玩家探索全分支。

#### B. Free 自由输入（入戏对话框形态）
* **设计变革**：不要弹出新窗口，而是**让剧场对话框原地变身为输入框**！
* **交互细节**：
  * 当到达 `stopType === "free"` 时，对话框下方的文本展示区变为富文本输入域；
  * 名字牌亮起：显示主角名字与闪烁的金色竖线光标；
  * 占位符提示：例如“（以主角口吻输入你的回应，回车发送…）”；
  * 辅助控制条位于输入框右下角：
    * `✨ 润色`：一键触发 LLM 按主角卡风格重写台词，润色中展示环形微光，润色后出现“撤销”按钮；
    * `发送 / Enter`：主色调高亮胶囊按钮。

#### C. Pause / 幕完继续（Continue Action）
* 对话框右下角原本跳动的 CTC 箭头放大，化身为发光的金色推进胶囊：
  * 普通暂停：`点击继续演出 ▶`
  * 幕完（Act End）：`幕终 · 前往下一幕 ✦`

---

### 2.6 导演注（OOC 原语）专属界面体验

导演注（OOC）是 Stage-AI 区别于一切传统 Galgame 的**杀手级原语**。它是玩家跳出角色、向剧作家发号施令的神器。

* **唤出方式**：
  1. 点击顶部常驻 Quick Bar 的 `🎬 导演` 按钮；
  2. 全局快捷键：随时按下 **`Tab`** 键或 **`Ctrl + D`**。
* **面板设计（Director Console Capsule）**：
  * 从舞台顶端以极具仪式感的弹簧动画（Spring Animation）向下展开一个精致的暗金控制台；
  * 边框带有金色光泽流动动画，顶端标明：`DIRECTOR'S NOTE (OOC) · 剧场导演指令台`；
  * 状态提示：
    * 若演出正在进行中：清晰标明 `“当前正忙：指令将挂起并注入下一拍起始（Beat Steer）”`；
    * 若停在停止点：标明 `“停止点就绪：发送后立即重塑下文剧情走向”`。
* **常用预设意图快捷 Chip（一键填入）**：
  控制台下方附带几个高频导演意图标签：
  * `[⚡ 制造意外危机]`
  * `[🌸 感情线加速]`
  * `[🔍 深入盘问细节]`
  * `[🚪 切换场景至…]`
  玩家点击标签自动追加到输入框，降低打字负担。

---

### 2.7 沉浸与隐藏机制（Immersive HUD）

#### A. 快速功能浮条（Quick Menu Bar）
* **位置**：置于舞台右上角或紧密附着于对话框顶边缘；
* **包含功能**：`[← 标题]`、`[🔊 语音 开/关]`、`[⚡ 自动 开/关]`、`[🎬 导演注]`、`[📜 剧本 Log]`、`[🌿 路线分支]`、`[🛠 工坊]`；
* **隐退规则**：常态下透明度自动降为 `0.25`，鼠标移动到屏幕上边缘或对话框区域时，平滑过渡至 `1.0`（耗时 200ms）。

#### B. 一键隐藏 UI（Hide UI / 纯享看画）
* **触发方式**：
  * 桌面端：单击舞台任意非按钮空白区、点击鼠标右键、或按下键盘 **`H`** 键 / **`Space`** 键；
  * 移动端：在屏幕上执行**向下滑动手势**。
* **行为**：对话框、Quick Bar、导演注等所有 UI 层在 200ms 内淡隐（`opacity: 0; pointer-events: none;`），仅留下纯净的背景图、立绘与全屏 CG；
* **恢复**：再次任意点击或轻触屏幕，UI 瞬间恢复。

#### C. Backlog 历史剧本抽屉
* **触发方式**：桌面端向上滚动鼠标滚轮、点击 `📜 剧本` 按钮；移动端**向上滑动手势**。
* **视觉与体验**：
  * 全屏深黑毛玻璃抽屉从右侧或底部滑出（遮罩透明度 85%）；
  * 文本以时间流形式纵向排列，每条包含角色头像/名字、台词、以及**专属的语音重播按钮（Play TTS）**；
  * 点击任意历史台词节点，支持查看当前节点对应的谱系分岔信息。

---

### 2.8 标题画面（TitleView）现代重塑

当前 TitleView 是一张白纸上排列着几个文本框和按钮，完全失去了“游戏门户”的吸引力。

* **全屏 Key 视觉**：背景铺满剧目最具代表性的 CG 或场景（如夕阳下的教室），并带有轻微的视差缩放滤镜（Ken Burns 缓慢缩放动效）；
* **标题排版**：游戏大标题采用精致的主题字号（`36px~44px`），带有微发光阴影，副标题显示 premise 简述；
* **悬浮操作菜单**：
  * `[ 开始游戏 (Start Game) ]`（高亮主按钮，附带光晕脉冲）
  * `[ 继续游戏 (Continue) ]`（读取最近活跃路线节点）
  * `[ 路线图鉴 (Route Tree) ]`
  * `[ 剧目工坊 (Workshop) ]`
  * `[ 设定与素材 (Assets) ]`
* **就绪门警示卡优雅融入**：若剧目素材未就绪（如缺背景或立绘），主按钮置灰，下方弹出一枚精致的悬浮提示胶囊，一键跳转到工坊由 AI 补齐。

---

### 2.9 完整状态机规格（State Transitions）

游玩层的界面呈现严格受控于以下有限状态机：

```text
┌─────────────────┐       用户点击 / Auto超时
│ 01. 正常打字中  ├──────────────────────────────┐
│  (Typewriting)  │                              │
└────────┬────────┘                              ▼
         │ 遇到标点额外休眠               ┌───────────────┐
         │ (Punctuation Pause)           │ 02. 当前句播完│
         ▼                               │ (LineComplete)│
┌─────────────────┐                      └───────┬───────┘
│ 03. 标点呼吸阻尼│                              │
│   (PauseHold)   │                              │ 用户推进点击
└────────┬────────┘                              │
         │ 休眠结束恢复打字                      ▼
         └──────────────────────────────►┌───────────────┐
                                         │ 04. 消费下条  │
                                         │ (ConsumeNext) │
                                         └───────┬───────┘
                                                 │
                   ┌─────────────────────────────┴─────────────────────────────┐
                   │                                                           │
                   ▼ (遇到普通 Cue)                                             ▼ (遇到 Stop / 耗尽)
         ┌──────────────────┐                                        ┌───────────────────┐
         │ 05. 视觉/音频应用│                                        │ 06. 停止点决策态  │
         │(ApplyVisual/SFX) │                                        │  (Stop Decision)  │
         └─────────┬────────┘                                        └───┬───────────┬───┘
                   │                                                     │           │
                   └──────────────► 回到状态 01                           │           │
                                                                         ▼           ▼
                                                                   [Choice 悬浮]  [Free 对话框]
                                                                         │           │
                                                                         ▼           ▼
                                                                 ┌───────────────────────┐
                                                                 │ 07. 等待 AI 撰写新拍  │
                                                                 │ (Streaming / Exhaust) │
                                                                 │ (三点波纹 ●●● 呼吸)   │
                                                                 └───────────────────────┘
```

---

## 3. 三套可选视觉方向设计

为满足不同剧目题材的叙事需求，提出以下 3 套视觉风格，各具鲜明的调性与美学规范：

### 方向一：日系轻小说 / 青春日常（Subtle Anime Modern）
* **标杆参照**：《Summer Pockets》《CLANNAD》《白色相簿2》
* **设计调性**：通透、夏日感、海风、治愈与微酸青春。
* **配色方案**：
  * 主背景：柔和象牙白 `#fdfcf8` 与 天青微蓝 `#e8f1f5` 渐变；
  * 对话框：半透明纯白亚克力 `rgba(255, 255, 255, 0.82)`，边框 `rgba(80, 130, 200, 0.18)`；
  * 文字色：深绀青色 `#1c2b36`，次级文字 `#5f7382`；
  * 强调色：向日葵金橙 `#ff9f43` 与 樱花粉 `#ff6b81`。
* **排印与装饰**：圆润亲和的现代无衬线体（PingFang SC / Noto Sans CJK SC）；装饰元素为小水滴、细点阵列、夏日微光粒子。

### 方向二：现代电影叙事 / 沉浸黑胶（Cinematic Noir / Modern Dramatic Dark）★【推荐】
* **标杆参照**：《魔法使之夜》《月姬 -A piece of blue glass moon-》《Fate/stay night》
* **设计调性**：冷峻、神秘、厚重、剧场级质感、强戏剧张力。
* **配色方案**：
  * 主背景：极夜黑 `#0c0d12` 与 雾霾紫绀 `#161722`；
  * 对话框：深黑磨砂玻璃 `rgba(16, 18, 26, 0.82)`，边缘反射光 `rgba(255, 255, 255, 0.14)`；
  * 文字色：纯净亮白 `#f2f4f8`，次级文字 `#9aa0b2`；
  * 强调色：古典星尘金 `#dfc285`、暗绯红 `#d63031`（警示/冲突）。
* **排印与装饰**：高质量衬线排印与人文宋体（Noto Serif CJK SC / 思源宋体）；极细几何金线（1px Thin Gold Line）、角标菱形锚点、电影级暗角滤镜（Vignette）。

### 方向三：赛博胶囊 / AI 终端纪元（Cyber Stage Terminal）
* **标杆参照**：《十三机兵防卫圈》《命运动态 (Steins;Gate)》《Cyberpunk: Edgerunners》
* **设计调性**：硬核科技、解构主义、AI 共生、路线网络计算。
* **配色方案**：
  * 主背景：碳黑高密底 `#090a0f`；
  * 对话框：微暗 HUD 视窗 `rgba(10, 16, 24, 0.88)`，边框带微弱霓虹描边；
  * 文字色：冷荧光白 `#e6f1ff`；
  * 强调色：赛博青碧 `#00f2fe`、霓虹紫罗兰 `#7f00ff`、预警琥珀 `#ffb300`。
* **排印与装饰**：切角几何无衬线与等宽字体（Chakra Petch / JetBrains Mono）；装饰元素包含坐标轴标尺、微型数据流闪烁光标、六边形节点。

---

### 明确推荐结论与深度理由

> **强烈推荐落地【方向二：现代电影叙事 / 沉浸黑胶（Cinematic Noir / Modern Dramatic Dark）】**。

**推荐理由**：
1. **美术包容度最高**：二次元立绘与背景图常常色彩斑斓、饱和度较高。深色半透明基底（Dark Translucent）在光学对比上具有天然优势，能完美承载任何色调的插画，绝不喧宾夺主；
2. **掩盖 AI 噪点与生图瑕疵**：AI 生成的画面有时在暗部或边缘带有微小噪点，深色电影暗角（Vignette）与磨砂质感能够有效收敛毛糙感，赋予画面高级的院线胶片质感；
3. **完美呼应“剧场（Stage）”与“导演（Director）”的核心隐喻**：Stage-AI 不仅仅是一个普通的视觉小说，更是一个允许用户扮演导演的剧场。暗色剧院坐席搭配沉静的星尘金（`#dfc285`），让导演注（OOC）、路线谱系树与工坊的出现显得格外专业、尊贵且具有仪式感。

---

## 4. 反模式清单（明确列出「不要做什么」）

在后续具体代码实现与样式重构中，**严禁**出现以下反模式：

1. **禁止使用网页后台切块思维（No Flex Box Web-Layout for Stage）**：
   绝对禁止将舞台拆分成顶栏一行、舞台图片一行、对话框一行、按钮面板一行的堆叠排列！所有 HUD 必须使用绝对定位（Absolute Positioning）悬浮覆盖在舞台画布之上。
2. **禁止把选项按钮置于屏幕底部（No Bottom Choice Buttons）**：
   选择肢（Choices）是剧情戏剧冲突的核心决策点，绝对禁止放在底部当表单按钮提交，必须居中悬浮在画面中下部（视口 50%~60%），形成对峙感。
3. **禁止立绘差分生硬闪烁（No Hard Cut for Expression Changes）**：
   表情差分切换禁止直接修改 `<img src>` 导致白闪，必须通过双缓冲交叉淡入淡出（Crossfade 150~200ms）平滑过渡。
4. **禁止打字机音效使用高频刺耳机械音（No Annoying Typewriter SFX）**：
   若后续增加逐字打字音效，严禁使用高音调打字机机械敲击声（极度引发听觉疲劳）。必须优先静音，或使用极低音量（-18dB）的人声气泡音/轻柔水滴微音。
5. **禁止在未消费完当前句时截断展示（No Truncation During Streaming）**：
   当后端仍在流式下发剧本时，前端打字机必须按既定节奏逐字追赶，严禁为了追赶数据而把正在打字的一行文字强行瞬间刷掉。
6. **禁止阻塞式全屏阻断弹窗（No Blocking Alert Dialogs for Minor Errors）**：
   生图失败、TTS 超时或单次指令重试等异常，严禁弹窗打断游玩。一律采用屏幕顶部 3 秒自动隐退的轻量通知胶囊（Toast Capsule）进行非侵入式提示。
7. **禁止忽视移动端手势（No Desktop-Only Hover Assumptions）**：
   快速菜单和隐藏功能不能单纯依赖 `:hover`。在触屏设备上必须实现标准的“轻触空白处隐藏/呼出”、“下滑隐藏”、“上滑调出 Backlog”手势。
8. **禁止阻断用户快速跳过（Never Block Two-Step Dismissal）**：
   无论打字机动画或立绘淡入淡出有多华丽，当用户点击屏幕时，**第一优先级永远是响应用户的快进意志**（第一击瞬显、第二击前进），绝不能被正在播放的 CSS 动画强行锁死输入。

---

## 5. 与现有代码的落差与改动清单（Gap Analysis）

为平稳实施本设计规格，梳理现有代码与新规格的落差及改造路线：

### 5.1 新增组件清单（待实现）

| 组件文件 | 建议路径 | 核心职责 |
| :--- | :--- | :--- |
| `CinematicStage.tsx` | `apps/web/src/stage/` | 统一的 16:9 画幅容器，处理 Letterbox/Pillarbox 遮幅与全屏手势监听 |
| `LayeredSprite.tsx` | `apps/web/src/stage/` | 双缓冲立绘差分渲染器，处理 180ms Crossfade、发言人聚焦（Speaker Focus）与微呼吸 |
| `ChoiceOverlay.tsx` | `apps/web/src/stage/` | 居中悬浮选择肢卡片堆栈，支持已选记忆与数字快捷键（替代 StopPanel 中的 choice）|
| `FreeInputModal.tsx` | `apps/web/src/stage/` | 融合在对话框内部的主角入戏自由输入器，支持 ✨ 润色与撤销 |
| `DirectorCapsule.tsx` | `apps/web/src/stage/` | 暗金色剧场导演注控制台，支持意图 Chip 标签与 Tab 快捷键呼出 |
| `QuickMenuBar.tsx` | `apps/web/src/stage/` | 自动隐退式快速功能条（语音/自动/导演/日志/路线/工坊）|
| `BacklogDrawer.tsx` | `apps/web/src/stage/` | 全屏半透明历史对话记录抽屉，附带单句 TTS 重听按钮 |

---

### 5.2 现有组件重构清单

#### 1. `apps/web/src/stage/StageTheater.tsx`
* **重构内容**：
  * **DOM 彻底重构**：移除顶栏、舞台、对话框上下排列的旧结构，改为主舞台背景铺底 + 绝对定位多层 HUD；
  * **立绘系统升级**：将原先简单的 `img.theater-sprite` 替换为支持差分淡入与 Speaker Focus 变暗的高阶立绘组件；
  * **沉浸模式状态**：新增 `hideUi` 状态，点击空白处或右键快速隐藏对话框与菜单；
  * **对话框重绘**：实现悬挑式名字牌、内心独白样式、标点停顿韵律、跳动 CTC 光标。

#### 2. `apps/web/src/stage/StopPanel.tsx`
* **重构内容**：
  * **职责剥离**：原有的 choice 逻辑剥离至 `ChoiceOverlay`（居中悬浮）；
  * **输入升级**：原有的 free 逻辑演变为在对话框内部原地激活的自由输入；
  * **精简保留**：本组件退役或重构为纯逻辑调度控制器，不再作为底部单独的大色块面板。

#### 3. `apps/web/src/stage/director.ts` (`usePlayback`)
* **重构内容**：
  * **注入标点微停顿（Punctuation Rhythm）**：在打字机计数器中增加标点判断，遇到逗号延时 140ms，遇到句号/破折号延时 280ms；
  * **发言人状态派生**：在 `Playback` 接口中暴露当前活跃发言角色的 `activeSpeakerId`，供立绘层实现暗化与高亮；
  * **自动播放延时曲线平滑化**：根据文本长度动态优化延时基准。

#### 4. `apps/web/src/views/TitleView.tsx`
* **重构内容**：
  * 摆脱白底列表样式，升级为全屏大画幅 Key 视觉封面；
  * 菜单采用居中半透明浮动面板；
  * 就绪门（Readiness Gate）未过时的提示改为精致的悬浮告警胶囊。

---

### 5.3 纯 CSS 改动清单 (`apps/web/src/app.css`)

1. **主题变量体系升级**：
   ```css
   :root {
     /* 舞台剧场深色系 (Cinematic Noir) */
     --stage-bg: #090a0f;
     --stage-panel: rgba(16, 18, 26, 0.82);
     --stage-panel-border: rgba(255, 255, 255, 0.12);
     --stage-text-primary: #f2f4f8;
     --stage-text-muted: #9aa0b2;
     --stage-gold: #dfc285;
     --stage-gold-glow: rgba(223, 194, 133, 0.35);
     --stage-shadow: 0 16px 36px rgba(0, 0, 0, 0.55);
     --stage-radius: 12px;
   }
   ```
2. **新增关键动画帧**：
   * `@keyframes sprite-crossfade`：立绘表情差分平滑淡入（180ms）；
   * `@keyframes ctc-bounce`：对话框右下角跳动微指示标；
   * `@keyframes director-glow`：导演注控制台金色光晕呼吸；
   * `@keyframes vignette-pulse`：电影暗角微动。
3. **彻底清理旧版切块布局样式**：
   * 移除 `.theater-bar` 实色顶栏、`.stop-panel` 底部固定面板的旧式 CSS 规则，替换为全屏 HUD 样式体系。

---

## 6. 实施路线图与验收检查点

* **Step 1（基础图层与 CSS 骨架）**：
  * 重塑 `app.css`，引入深色电影剧场变量与全局全屏重置；
  * 在 `StageTheater.tsx` 中建立 Z-Index 0~300 的全屏绝对定位图层树。
* **Step 2（对话框与立绘质感升级）**：
  * 落地高斯模糊亚克力对话框、悬挑式名字牌与内心独白排版；
  * 在 `usePlayback` 中落地标点自适应延时与二段式点击；
  * 实现立绘差分 Crossfade 与非发言人压暗（Speaker Focus）。
* **Step 3（停止点与导演注交互进化）**：
  * 改造 Choice 为中央悬浮卡片堆栈，支持已选项记忆；
  * 改造 Free 为入戏对话框模式；
  * 重塑沉浸式金色导演注胶囊控制台。
* **Step 4（沉浸机制与移动端适配）**：
  * 落地一键隐藏 UI（Hide UI）、自动隐退快速功能条；
  * 实现竖屏 9:16 半身特写与触摸手势适配；
  * 重构全屏封面式 TitleView。
