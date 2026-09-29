# stage-ai 路线树（Route Tree）UI/UX 设计规格书

> **文档编号**：p65-route-tree-design  
> **归属需求**：docs/features/260928-stage-ai-mvp/260928-stage-ai-mvp.plan.md（D10 四原语与路线树）  
> **受众**：UI/UX 设计师、前端架构师、交互工程师  
> **核心使命**：将底层 append-only 行级事件日志升华为符合 galgame 玩家心智的“可理解、可探索、防误导”的分支路线树。

---

## 1. 业界标杆调研发现（Prior Art & Research Findings）

为了设计一个让普通视觉小说玩家（而非 Git 资深开发者）也能流畅理解并操作的分支界面，我们对**版本控制工具**、**多分支叙事游戏**、**AI 互动剧情产品**以及**网状小说创作工具**进行了横向与纵向深度调研。

### 1.1 版本控制图形化工具：拓扑流与通道管理

| 产品 / 特性 | 核心设计做法 | 对 stage-ai 的关键启示 | 真实参考来源 |
|---|---|---|---|
| **GitKraken**<br>（Subway Map Layout）| 1. **地铁线通道（Lanes）**：每个分支占据一个固定垂直列，不同分支赋予高辨识度色彩；<br>2. **主干锚定（Pin Branch to Left）**：当前活跃分支（或主线）固定靠左，分支从右侧伸展；<br>3. **智能降噪（Smart Branch Visibility）**：自动聚焦当前检出分支及其上下游，折叠或淡化无关噪音；<br>4. **交互式重构**：拖拽节点直观触发 rebase/cherry-pick。 | 严格单向流动的时间轴比自由 2D 网状图更容易阅读；用固定主通道（Spine）锚定当前进度，分支一律单向向右偏折，能极大缓解分支迷失。 | [GitKraken Commit Graph](https://www.gitkraken.com/features/commit-graph)<br>[GitKraken 11.10 Features](https://gitkraken.com/blog/gitkraken-desktop-11-10-from-top-requests-to-todays-release) |
| **GitLens**<br>（Commit Graph & Minimap）| 1. **双层布局模式**：提供紧凑模式（Compact Graph Layout），视口变窄时自动将文字折叠为 Avatar 和图标；<br>2. **高阶 Minimap（鹰眼图）**：右侧提供代码仓库的全景微缩图，用色块标记 HEAD、分支分叉与变更量，支持视口快速拖拽定位。 | 当玩家生成剧情超过 30 幕后，全景视图必须配合 Minimap 才能在长故事线中不迷路；节点需要具备“远景简略/近景详尽”的响应式自适应能力。 | [GitLens Commit Graph](https://help.gitkraken.com/gitlens/gl-commit-graph/) |
| **GitHub Commit Graph** | 1. 严格按 commit 时序由上至下排列；<br>2. 贝塞尔样条曲线（Bézier Curve）连接分叉点与合并点；<br>3. 节点带 Hover 卡片展示完整提交载荷。 | 曲线弧度算法能够自然消除直角的生硬感；平滑的三次贝塞尔曲线（Cubic Bézier）是表达“分岔”时最具流动美感的方式。 | [GitHub Repo Insights Graph](https://github.com/) |

### 1.2 叙事分支与视觉小说产品：玩家心智与叙事聚合

| 产品 / 特性 | 核心设计做法 | 对 stage-ai 的关键启示 | 真实参考来源 |
|---|---|---|---|
| **底特律：变人**<br>（*Detroit: Become Human*）| 1. **Beat（叙事节拍）为节点**：节点绝非一行台词，而是一个“行动目标 / 场景小节 / 关键抉择”（如“解救人质”、“发现线索”）；<br>2. **Active Path 高亮**：走过的有效路径全亮（发光蓝线与蓝框），未经历的选项保持灰色线框（Fog of War）；<br>3. **检查点跳转（Checkpoint Warp）**：玩家可在流程图中点击任意检查点重演，尝试不同结局；<br>4. **跨章节影响标记**：节点带锁形图标（Lock）或死亡图标，直观提示因果闭环。 | **必须做节点聚合**！玩家关心的最小心智单位是“场景/节拍”，而不是“第 42 行角色说了什么”。树状图必须是节拍级，行级文本应下沉到二级检查抽屉。 | [Polygon: Detroit Flowchart Analysis](https://www.polygon.com/2018/4/23/17268876/detroit-become-human-ps4-gameplay-david-cage)<br>[Interactive Pasts: DBH Flowcharts](https://interactivepasts.com/how-games-tell-tales-part-3-detroit-become-human-freedom-of-choice-and-intended-play/) |
| **极限脱出：善人死亡**<br>（*Zero Escape: Virtue's Last Reward*）| 1. **FLOW Chart 任意跳跃（Time Leap）**：树状图是核心叙事玩法本身，玩家随时可 Jump 回过去修改选择；<br>2. **剧情锁机制（Story Locks）**：部分分支走到尽头显示“To Be Continued”，需去另一分支获得密码后，锁自动变绿解锁；<br>3. **宏观密室 / 剧情段分类**：节点清晰标注文档段（Novel）与密室解密段（Escape）。 | 谱系树跳转不只是调试工具，而是玩家探索平行世界的核心乐趣；跳转到历史分支必须保证“记忆状态无缝切换（杜绝剧透）”。 | [GameDeveloper: The Storytelling Secrets of VLR](https://www.gamedeveloper.com/design/the-storytelling-secrets-of-i-virtue-s-last-reward-i-)<br>[Zero Escape Wiki: FLOW Chart](https://zeroescape.fandom.com/wiki/FLOW_Chart) |
| **AI Dungeon**<br>（Latitude）| 1. **原语组合**：提供 Retry（重摇）、Edit（原地改）、Undo（回退）、Branch（分岔）；<br>2. **Retry Stack 翻页器**：多次重摇的内容堆叠在同一槽位后（1 of N），供玩家左右翻页；<br>3. **教训与痛点**：由于没有全局清晰的可视化分支树，玩家常困惑“我点了 Undo 会不会把之前生成的记忆弄丢？”“改了前面一句，后面的 AI 还记不记得”。 | “原地修改”与“开辟平行线”在视觉上极易混淆；必须通过强视觉符号与微动效明确告诉玩家：“历史未被销毁，已沉淀为备选世界线”。 | [AI Dungeon FAQ: How to Play](https://help.aidungeon.com/faq/how-to-play)<br>[The Prompt Bench: Conversation Mechanics](https://thepromptbench.com/ai-product-ux/regenerate-undo-branch-conversation-mechanics/) |
| **Ren'Py 流程图生态**<br>（BranchPy / RenpyWebFlowchartViewer）| 1. **按 label / menu 聚合**：将包含几十行对话的代码块收拢为一个图节点；<br>2. **三车道语义（Semantic Lanes）**：A 车道为主线脊柱，B 车道为 call 旁支，C 车道为死胡同/废弃路线；<br>3. **两栏联动**：点击左侧图节点，右侧 Inspector 展开具体的台词与条件变量。 | 树图与剧本的关系是“目录与文章”：树负责骨架、定位与分岔，抽屉负责血肉、台词与微调。 | [BranchPy User Guide: Flowchart](https://branchpy.com/docs/v1.2/user-guide/flowchart/)<br>[RenpyWebFlowchartViewer](https://github.com/JavaGamer/RenpyWebFlowchartViewer) |

### 1.3 知识图谱与互动小说：排版陷阱与空间布局

| 产品 / 特性 | 核心设计做法 | 对 stage-ai 的关键启示 | 真实参考来源 |
|---|---|---|---|
| **Twine 2**<br>（Story Map）| 1. **Passage 卡片**：以段落（Passage）为节点，节点之间用带箭头的连线表达跳转；<br>2. **2D 无限画布拖拽**：支持平移、三档缩放（Zoom 1x/0.6x/0.3x）、网格吸附；<br>3. **致命陷阱（Spaghetti Nodes）**：纯手动拖拽在故事超过 30 个节点后必然变成“意大利面条式”乱麻，连线交叉严重。 | 坚决避免让玩家手动排版节点的 2D 画布！故事天然具备时序因果，必须采用**自动分层图算法（如 Sugiyama 变体或单向分道树）**自动保持整洁。 | [Twine Reference: Navigating the Story Map](https://twinery.org/reference/en/editing-stories/navigating.html)<br>[Twine DotGraph Proofing Format](https://mcdemarco.net/tools/scree/dotgraph/) |
| **Obsidian**<br>（Graph View）| 1. **力导向图（Force-Directed）**：用物理引力/斥力自动排布网状双链；<br>2. **局部图谱（Local Graph）**：只展示当前节点周围 1~3 度的局部网络；<br>3. **全局搜索与过滤**：支持按标签、路径筛选高亮。 | 纯力导向图适合发散知识点，不适合因果时间树；但其“局部聚焦（Local Neighborhood）”与“按路径高亮”对于长树过滤噪音极具借鉴意义。 | [Obsidian Help: Graph View](https://help.obsidian.md/plugins/graph-view) |

---

## 2. 适用于 stage-ai 的设计方案（Design Specification）

### 2.0 决策记录（与用户逐条盘过的结论，2026-09-29）

| 议题 | 结论 |
|---|---|
| 卡片粒度 | **一拍一张卡**。切分只认 beat 边界（`beat_end` 之后的首个事件），**不因换场景额外切一刀** |
| 信息层数 | **单层**。路线树本身就是全部，砍掉「点卡片呼出剧本抽屉」那一层 |
| 跳转 vs 分岔 | **两个都留**，但语义必须不同：跳转 = 只读回看（客户端本地，不动世界线）；分岔 = 世界线写操作（服务端 leaf 迁移） |
| 书签 | **砍掉**。它是「存档位」时代的遗留；树可读之后不解决任何问题。结局收集改用「走过的拍自动高亮」 |
| 行级编辑 | **不进树**，留在「剧本」页行内 |
| 废弃分支 | **占位显示**，半透明 + 虚线边，与主活动路径一眼可分 |
| 配色 | 跟随 ①②③ 三层 CSS 令牌，**默认 plain 浅色**；本文提到的任何「时间观测仪」风格降级为可选 theme.css，不是默认 |

### 2.1 核心挑战与信息架构重塑

#### 痛点复盘
`LineageTree` 的真相源是 append-only 的行级事件（`scene`/`actor`/`say`/`narrate`/`thought`/`sfx`/`stop`/`player`/`ooc`/`beat_end`/`edit`/`rewrite`）。现有 `LineagePanel.tsx` 的 `RouteTree` 把全量事件平铺缩进，导致：

1. **行级刷屏**：一幕十几行事件全展开即上百行文本，玩家读不动；
2. **缺乏空间拓扑**：只靠 `margin-left` 缩进，看不出分岔源头、平行世界、死胡同；
3. **心智模型误导**：点「重写」时以为原地覆盖，实际是在 append-only 树上开辟平行分支。

#### 关键澄清：beat 是什么
**beat = 剧作家的一次完整演出单元**。代码定义：`turn_start` →（若干轮工具调用）→ 模型调用 `beat_done` → `turn_end`，末端 append 一条 `beat_end` 事件（`reason` 为 `stop` 停拍等玩家，或 `act_end` 一幕自然写完）。

beat **不是**存储实体，而是行级日志上的一个区间——所以卡片是渲染期聚合出来的视图，不进日志。编辑与重写的锚点都是**行**：

- `edit` 挂在目标行自身（`parentId = 目标行`），物化时覆盖该行文本 → 从任何上游分岔都带得走；
- `rewrite` 挂在目标行的**父节点**（`parentId = target.parentId`），旧目标行连同其后一切留在废弃分支。

**beat 与 `turn` 不等价**：pi-agent 的一个 turn 只是一轮工具调用，一个 beat 内部通常有 3~5 轮（查记忆 → 写台词 → `beat_done`）。划拍的是 `beat_done` 工具调用。

### 2.2 节点模型设计（Node Aggregation Model）

#### 2.2.1 节拍切分规则（Beat Chunking Policy）
按事件流顺序扫描，遇下列任一条件即**结束当前拍**并开新拍：

1. `beat_end` 之后的首个事件（编排器追加的硬边界，权威来源）；
2. `rewrite` 事件（分岔本身即新世界的起点，其后属新拍）。

**不作为切分依据**：`scene` 换背景只更新卡片的场景字段，不额外开卡——否则一拍的卡片会被切碎，与玩家记忆里的「这一幕」对不上。`stop` 亦不切：它天然是某一拍的收尾，归属该拍。

#### 2.2.2 BeatCard 数据契约
```typescript
export interface BeatCard {
  /** 代表事件 id = 该拍首个事件的 id（视图锚点，不是存储身份）。 */
  id: string;
  /** 拍内事件 id 列表，展开时用于渲染完整剧本。 */
  eventIds: string[];
  turn: number;
  /** 摘要：拍内首个 say/narrate/thought 的文本，截 32 字。 */
  preview: string;
  /** 拍内出现过的说话人（用于头像堆叠）。 */
  speakers: string[];
  /** 拍内最后一次 scene.bg，null 表示沿用上游。 */
  sceneBg: string | null;
  /** 该拍的收束方式。 */
  stopType: "choice" | "free" | "continue" | "pause" | null;
  /** stop=choice 时的选项列表；本分支实际走的选项。 */
  options?: string[];
  chosen?: string;

  // 拓扑与状态（由谱系视图推导）
  onPath: boolean;      // 是否在当前活动主线上
  isLeaf: boolean;      // 是否是当前叶所在拍
  isAbandoned: boolean; // 非活动路径且无在途后续 → 半透明虚线卡
}
```

#### 2.2.3 导演操作（收敛后共五个）

| 动词 | 作用在 | 是否动世界线 | 入口 |
|---|---|---|---|
| ⤴ **跳转** | 一拍 | 否——只读回看，播放头退回那一刻，看完点「回到最新」，**服务端零操作** | 树卡片单击 |
| 🌿 **分岔** | 一拍 | 是——leaf 迁到该拍，记忆快照回滚，从这儿岔出去演 | 树卡片按钮 |
| ↺ **重生成** | 一拍 | 是——从拍首行之前分岔重演，**这一拍及之后全部作废** | 树卡片按钮（可填导演意图） |
| ✎ **编辑** | 一行台词 | 否——追加 edit 覆盖目标行 | 剧本页行内 |
| 💬 **导演注** | 一拍 | 是——先分岔再注入意图开拍 | 剧本页拍首 |

**砍掉的**：书签（与树重复）、单句重写（并入剧本页行内，不单列动词）。

**必须防误导的三条**：
- 「重生成」按钮下方常驻小字「这一拍之后的剧情会作废」——它是分岔 + 重演，不是原地换一版；
- 废弃分支的卡片不隐藏、不删除，用半透明 + 虚线边表达「这是另一个宇宙」；
- 「跳转」进入回看态时，顶部亮黄条「回看中 · 回到最新」，并禁用选肢与自由输入（那是分岔后的动作，不该在回看里发生）。

### 2.3 布局算法：垂直分道平滑树

对比过的三种体系：

| 方案 | 优点 | 缺点 | 取舍 |
|---|---|---|---|
| **垂直分道地铁图** | 结构稳、零连线交叉、单屏 15~20 拍、与自上而下的阅读习惯一致、虚拟滚动零成本 | 横向表达力克制，分支多时变宽 | **采用** |
| 水平树形流程图（Ren'Py 路线图） | 符合玩家对「结局图鉴」的传统认知 | 纵深长时横向滚动剧烈，竖屏体验差 | 淘汰 |
| 2D 自由无限画布（Twine/React Flow） | 自由度高 | 极易乱麻，只读回溯时是负担，移动端手势冲突 | 淘汰 |

坐标与连线算法：
1. **通道分配**：DFS，主线恒占 Lane 0；遇到分叉（该拍有 ≥2 个子拍）时，未激活分支依次分到 Lane 1、2…；Lane 宽 `48px`，卡片水平居中于 `x = lane * 48 + half`。
2. **纵深**：Y 轴按时间单调递增，`y = index * 84px`；卡高 52px，间距 32px。
3. **连线**：父卡右下 → 子卡左上的三次贝塞尔，控制点水平偏移 `24px`；活动路径实线 `#1px`，废弃分支虚线 + 半透明。
4. **虚拟滚动**：卡高定长，命中区间二分，`O(log n)` 定位，DOM 只渲染视口 ± 3 张。

### 2.4 卡片视觉规格

```
┌──────────────────────────────────────────────┐
│ ▎第 12 拍 · 黄昏教室            ◐ 3 位说话人   │  ← 左色条=场景；右侧头像堆叠
│ 「成交。拿人手短，怪猎的账等会再算……」        │  ← preview，2 行截断
│ ──────────────────────────────────────────  │
│ [⤴ 跳转]  [🌿 从这里岔出去]  [↺ 重生成]      │  ← 三个动词
└──────────────────────────────────────────────┘
```

- 当前活动拍：左侧 3px 实心色条 + 1px 主色描边 + 「▶ 进行中」角标；
- 废弃分支：整体 `opacity: .45` + 虚线描边，不显示动词按钮（要进入它只能先分岔）；
- 手机竖屏：单列全宽，纵向滚动，动词按钮横向均分。

### 2.5 极端状态处理

1. **空状态**：树为空时显示「演出几拍后这里会长出路线树」+ 一张示意骨架卡，不画假数据。
2. **极深主线（100+ 拍）**：定高虚拟滚动；顶部吸一条迷你主线进度条（当前拍位置 + 已探索拍数）。
3. **分叉爆炸（频繁重生成）**：同一位置多次重生成会产生多条废弃分支，卡片纵向按时间排、横向最多占 3 条 Lane，超出的收进「还有 N 条平行宇宙」折叠组。
4. **单拍超长（> 30 行）**：卡上只显示摘要与「展开看完整剧本」按钮，展开就地内联，不跳页。

### 2.6 与「剧本」页的职责分离

| 维度 | 路线树 | 剧本页 |
|---|---|---|
| 视觉单位 | 一拍一张卡，纵向分道 | 一行一句，逐行铺开 |
| 定位 | 我在哪、岔出去过哪、怎么回去 | 这句话写得怎么样 |
| 动词 | 跳转 / 分岔 / 重生成 | 编辑（行内）/ 导演注（拍首） |
| 联动 | 点卡片 → 舞台进入回看态 | 行内编辑 → 舞台立即按新文本演出 |

**不设抽屉、不做嵌套**。两层信息架构已砍：树就是全部，行级操作在独立的剧本页里做，两者平级切换。

### 2.7 主题与配色

树的所有颜色走 ①基础 / ②演出层 / ③运动层 三组 CSS 令牌，默认 plain 浅色。文中的「时间观测仪」等风格降级为剧目作者可自备的 `plays/<id>/theme.css`，**不是默认皮肤**。

## 3. 三套可选视觉方向（均为**可选主题**，默认 plain 浅色）

三套方案都不作为默认皮肤。路线树只消费 ①/②/③ 三层 CSS 令牌，作者把任意一套写成 `plays/<id>/theme.css` 即可整体换肤；下文的具体数值仅作参考。

### 方案 A：二次元未来感“时间观测仪”（Chrono-Observer HUD）——【深色主题推荐】

```
       [01 晨雾的校门] (Scene: Gate)
             │
             ▼
       [02 走廊相遇] (Actor: Mio)
             │
      ┌──────┴──────────────────────┐
      ▼                             ▼ (Ghost / 0.4 opacity)
 [03 天台对质 ● 当前]           [03-v1 沉默离去] (Abandoned)
  ▸ "……太慢了！"                  ▸ "算了，当我没说。"
  (Active / Cyan Glow)          (Muted Dashed)
```

- **视觉调性**：科幻观测界面、世界线变动率、暗黑沉浸式 HUD（类似《命运石之门》世界线仪 +《底特律》科技感流程图）。
- **色彩规范**：
  - 底色：深灰黑微透毛玻璃（`rgba(15, 18, 24, 0.85)`）；
  - 当前主干：荧光青/青空蓝（`#00f2fe` 到 `#4facfe` 渐变发光，2.5px 粗线）；
  - 玩家选择/分岔点：琥珀金菱形指示器（`#f6d365`）；
  - 导演注分支：霓虹紫场记牌标识（`#b176f2`）；
  - 废弃/历史版本：深灰冷调（`#4a5568`），线条变为带微点虚线。
- **质感与动效**：卡片悬浮有轻微青色流光描边；当前正在生成的节点带有脉冲呼吸光晕（Glow Pulse）；连线在生成新分支时有粒子沿曲线流动的动效。
- **推荐理由**：与 AI galgame 的核心心智（“玩家是操控故事命运的造物主/观测者”）完美共鸣。极具二次元高级质感，在深色舞台背景下极度协调，且各色通道语义对比极强。

---

### 方案 B：地铁路线图式极简流（Subway Metro Flow）

- **视觉调性**：极简扁平工程风，类似 GitKraken、现代设计系统（Linear / Vercel）。
- **色彩规范**：纯黑背景，彩色实心圆点代表节点（红、绿、黄、蓝不同通道），细实线连接。
- **优缺点**：清晰度极高，信息密度大；但缺少二次元游戏的情感氛围，过于偏向专业开发者工具，容易让普通 galgame 玩家产生“我在上班写代码”的严肃感。

---

### 方案 C：纸质剧本与拍立得故事板（Script Storyboard & Polaroid）

- **视觉调性**：文艺怀旧、片场导演工作台、拍立得相纸与打字机牛皮纸。
- **色彩规范**：米黄纸张质感、胶带粘贴装饰、卡片类似拍立得照片（上部是场景 CG/立绘小图，下部是手写体台词）。
- **优缺点**：故事代入感强，视觉温润；但在处理复杂分支、数十次重写和深度嵌套时，拟物风会占用极大屏幕面积，导致空间利用率急剧下降，小屏设备体验较重。

---

## 4. 「不要做什么」（反模式与避坑清单）

在为 stage-ai 设计路线树时，以下 5 种反模式必须严格回避：

### ❌ 反模式 1：让玩家误以为“改写/重写会篡改或丢失历史”
- **错误做法**：在 UI 上提供名为“删除并重写”、“撤销后覆盖”的按钮，或者重写后直接把旧节点从树上删掉。
- **正确做法**：底层是纯 append-only，**永远不删节点**。文案一律使用“重新演绎（开辟新分支）”、“保留为历史版本 v1”。在视觉上，旧分支永远能在废弃分支区找到并一键跳回。

### ❌ 反模式 2：把每一行台词都画成一个树节点（行级节点灾难）
- **错误做法**：像现有初步实现一样，将 `say`, `actor`, `scene` 全平铺在树里。5 分钟游戏产生 200 个节点，玩家完全迷失。
- **正确做法**：必须以 **Beat** 聚合为宏观卡片，切分只认 `beat_end` 边界（换场景不额外切）。行级事件进独立的「剧本」页，不进树。

### ❌ 反模式 3：提供无约束的 2D 自由拖拽画布
- **错误做法**：允许玩家像 Miro 或 Twine 那样自由拖放节点位置。
- **正确做法**：叙事因果具有严格时序性。坚决采用有向分层自动布局（Auto-layout Lane），禁止手动拖拽位置造成混乱。

### ❌ 反模式 4：操作原语隐式强绑定（违反四原语正交）
- **错误做法**：点击“修改文字”时自动为玩家开新分支；或者点击“打书签”时自动把玩家视口跳转回过去。
- **正确做法**：严格遵循计划 D10——编辑只覆盖那一行且不产生分支；跳转是纯客户端只读回放、零 WS；分岔是唯一的世界线写操作；重生成 = 分岔 + 重演并显式警告「之后作废」。

### ❌ 反模式 5：跨分支记忆与剧透污染
- **错误做法**：在路线树废弃分支上直接展示未来剧透内容，或者跳转到分支后把其他平行线的记忆带过来。
- **正确做法**：严格遵守 P4 记忆契约——检索与上下文仅沿当前节点的祖先链生效，废弃分支的文本在未点击主动展开时只显示概括摘要，防止破坏悬念。

---

## 5. 落地现状（Delta Analysis）

### 5.1 文件清单（实际）

| 文件 | 角色 |
|---|---|
| `apps/web/src/stage/beats.ts` | 纯函数：把 `LineageView` 聚合成 `BeatCard[]`；`firstLineOf` 定位该拍首行。无 React 依赖，配 `beats.test.ts` |
| `apps/web/src/stage/LineagePanel.tsx` | 路线视图（拍卡片流 + 展开后的拍内操作）与剧本视图（行级 ✎ 改写台词）共用外壳 |
| `apps/web/src/stage/director.ts` | 只读回看游标：`scrub/seek/history`，零 WS |
| `apps/web/src/views/StageScreen.tsx` | 双视图切换、`busy` 计算（`streaming ∥ connecting ∥ !settled`） |
| `apps/web/src/stage/useStageSocket.ts` | 协议加 `beat_settled`，对外只暴露一个 `settled` 布尔 |
| `apps/server/src/orchestrator.ts` | `rebaseAt`、拍生命周期、每个剧本事件写入 `payload.seq` |
| `apps/server/src/rebuild.ts` | `lineageToEvents` 重放时沿用原 seq |
| `packages/core/src/lineage/model.ts` | `describe()` 暴露节点 `seq`；`editInPlace` 挂被编辑行之下 |

没做：Lane 贝塞尔连线、自由缩放画布、Minimap、暗色主题预设（默认 plain 浅色，深色留给剧目 `theme.css`）。

### 5.2 定位锚点：seq 必须跨纪元稳定

每张卡靠「本拍首个剧本事件的 seq」落到舞台行上。编排器给每个剧本事件节点写入 `payload.seq`（与客户端 `ScriptLine.seq` 同尺），**重放时不再从 1 重新编号**——分岔/编辑/重生成会 `rebase` 重放整条路径，若重编号，分岔点之前的卡片锚点全部漂移。

一个前提：一行台词现场至少占 3 个 seq（`say_start` + ≥1 段 `say_text` + `say_end`），重放正好是 3 个事件，因此沿用原 seq 不会与下一行撞号，编号也不倒退。老档没有 `payload.seq` 时退回顺序编号。

### 5.3 其他契约变化

1. **聚合位置**：纯前端聚合，core 仍只输出行级事件 + `seq`。
2. **`edit` 挂载点修正**：`editInPlace` 的 `parentId` 为**被编辑行自身**（作为其子节点追加），物化时覆盖该行文本。改旧行 = 世界线停在那行、其后转废弃分支。
3. **跳转 / 分岔去重**：跳转 = 客户端只读回看（零 WS）；服务端只保留 `rebaseAt` 作为世界线写操作。
4. **书签下线**：`bookmark`/`unbookmark` 消息、UI 与 `LineageTree` 侧存储一并删除。
5. **新增 `beat_settled`**：`beat_end` 推送时 `beatPending` 仍为 true，玩家此时点分岔/重生成会被「演出进行中」拒掉。`beginBeat` 的 `finally` 里在 `!busy` 时补发 `beat_settled`，客户端据此解锁操作。
6. **废弃分支不可回看**：分岔后旧行的剧本行已不在客户端缓冲里，`firstLineOf` 返回 null → 卡片无回看目标，只作半透明占位。

## 6. 总结与落地实施路径

本设计规格通过**“一拍一卡、单层视图”**的核心架构，把底层 append-only 行级事件日志聚合成符合玩家心智的分支世界线；通过**“废弃分支半透明占位 + 重生成显式警告”**消除对回溯与作废的误解；跳转（只读回看）与分岔（世界线写操作）在数据层彻底分开，行级编辑下沉到剧本页；配色全部走 CSS 令牌、默认 plain 浅色，深色演出向风格降级为剧目作者可自备的 `theme.css`。
