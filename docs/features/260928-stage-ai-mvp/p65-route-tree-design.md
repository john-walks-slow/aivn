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

### 2.1 核心挑战与信息架构重塑

#### 痛点复盘
现有代码中 `LineageTree` 的真相源是 append-only 的行级事件（`say`, `narrate`, `actor`, `scene`, `sfx`, `stop`, `edit`, `rewrite` 等）。现有 `LineagePanel.tsx` 的 `RouteTree` 直接将全量事件平铺并按缩进展示，导致：
1. **行级刷屏**：一幕 10 句台词 + 4 个演出指令，全树展开立即产生上百行文本，普通玩家无法阅读；
2. **缺乏空间拓扑**：仅靠 `margin-left` 缩进，无法看清分岔源头、平行世界以及哪个分支走向了死胡同；
3. **心智模型误导**：玩家点击“改写台词”或“重写此句”时，误以为是原地覆盖或时光倒流，不知道自己其实是在 append-only 树上开辟了新分支。

#### 双层信息架构（Two-Tier Architecture）
将**宏观故事拓扑**与**微观演出剧本**清晰解耦：

```
┌─────────────────────────────────────────────────────────────────────────────┐
│ 【层级一：宏观路线树（Route Flowchart）】                                     │
│  - 视觉单位：叙事节拍卡片（Beat Node）                                       │
│  - 玩家感知：这一幕在哪（背景/BGM）、发生了什么核心事件、产生了什么分岔          │
│  - 核心操作：查看全景、世界线跳转（Jump）、开辟平行分支（Fork）、加书签（Bookmark） │
└──────────────────────────────────────┬──────────────────────────────────────┘
                                       │ 点击某个 Beat 节点
                                       ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│ 【层级二：微观剧本抽屉（Beat Script Inspector）】                            │
│  - 视觉单位：行级台词/演出事件（Line Event）                                 │
│  - 玩家感知：具体的台词文字、立绘表情、角色心声、音效触发                       │
│  - 核心操作：原地文字润色（Edit）、单句重写（Rewrite）、注入导演注（OOC）        │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

### 2.2 节点模型设计（Node Aggregation Model）

将底层离散的 `LineageEvent[]` 动态聚合为面向玩家的 **`BeatNode`（节拍卡片）**：

#### 2.2.1 节拍边界切分规则（Beat Chunking Policy）
满足以下任一条件时，结束当前 Beat 并开启下一个 Beat：
1. **停止点事件**（`kind === "stop"`）：选择支或玩家自由输入点（决定性分岔点）；
2. **场景转场事件**（`kind === "scene"`）：换背景/换地点；
3. **显式重写标记**（`kind === "rewrite"`）：玩家回溯重写的切断点；
4. **节拍收束事件**（`kind === "beat_end"`）：编排器工具收敛边界。

#### 2.2.2 BeatNode 数据契约
```typescript
export interface BeatNode {
  id: string;                    // 该节拍的代表 ID（取首个事件 ID 或 stop/rewrite 事件 ID）
  turnRange: [number, number];   // 时序水位范围 [minTurn, maxTurn]
  sceneBg?: string;              // 当前节拍的背景图 asset id / path
  sceneTitle: string;            // 场景名称或摘要（如“黄昏的天台”）
  speakerAvatars: string[];      // 本节拍发过言的角色 ID 列表（用于渲染头像堆叠）
  previewText: string;           // 核心摘要（取本节拍最有代表性的 1 句台词或旁白，截断 32 字）
  
  // 分支与状态
  type: "story" | "choice" | "rewrite_origin" | "branch_root";
  choiceOptions?: string[];      // 若为 stop=choice，记录当时给出的选项列表
  chosenOption?: string;         // 本分支实际选择的选项
  
  // 拓扑属性
  parentId: string | null;       // 上一个 Beat 的代表 ID
  childrenIds: string[];         // 后续分支 Beat ID
  onActivePath: boolean;         // 是否处于当前正玩的活动主线上
  isAbandoned: boolean;          // 是否为被重写抛弃的历史分支（非活动且无后续）
  isCurrentLeaf: boolean;        // 是否是当前正处于的叶子节点
  
  // 存档事实
  bookmark?: { id: string; name: string };
  
  // 包含的行级原始事件（仅展开 Inspector 时使用）
  eventIds: string[];
}
```

---

### 2.3 布局算法选型对比与取舍

我们对比了三种适合 Web 端流程图的布局体系：

| 方案 | 原理与特性 | 优点 | 缺点 | 本项目取舍 |
|---|---|---|---|---|
| **方案 1：垂直分道地铁图<br>（Vertical Multi-Lane Subway Map）** | 类似 GitKraken。Y 轴严格对齐时间先后（最新在下，或者最新在上），X 轴按通道（Lane 0, 1, 2...）分配。主线恒定占用 Lane 0，分支向右侧车道排布。 | 1. 结构极稳，零连线交叉；<br>2. 空间利用率极高，单屏可展示 15~20 幕；<br>3. 极其容易实现虚拟滚动（Virtual Scroll）。 | 横向表现力偏克制，分支繁多时右侧横向宽度增加。 | **最推荐作为默认核心布局**。<br>与当前自上而下的阅读习惯无缝契合，计算开销仅 $O(N)$。 |
| **方案 2：水平树形流程图<br>（Horizontal Flowchart / Sugiyama）** | 类似底特律变人/Ren'Py 流程图。从左到右延伸，X 轴为深度/步骤，Y 轴为分支展开。使用分层图（Layered Graph Drawing）算法。 | 1. 最符合 galgame 玩家对“路线图/结局图鉴”的传统认知；<br>2. 节点有足够宽度展示卡片封面与富信息。 | 节点纵深长时需要大量横向滚动；手机端横屏勉强可用，竖屏体验极差。 | **可作为宽屏/桌面端备选模式**，或全屏“结局全貌图鉴”时切换。 |
| **方案 3：2D 自由无限画布<br>（Infinite Canvas / Node Graph）** | 类似 Twine / React Flow 自由拖拽。支持用户随意挪动位置。 | 自由度最高，视觉炫酷。 | 容易形成乱麻（Spaghetti）；对只读回溯的玩家而言徒增整理负担；移动端手势冲突。 | **坚决淘汰**。<br>游戏分支需要确定性秩序，不是白板绘图。 |

#### 推荐方案（方案 1：垂直分道平滑树）坐标与连线实现算法
1. **通道分配（Lane Assignment）**：
   - 采用深度优先遍历（DFS），优先走 `onActivePath === true` 的节点，固定分配在 **Lane 0**（最左侧主通道）；
   - 当遇到分叉点（`node.children.length > 1`）时，未激活的分支依次分配给 **Lane 1, Lane 2, ...**；
   - 每个 Lane 宽度固定为 $W_{lane} = 48\text{px}$，卡片放置在所属 Lane 的中心 $X = \text{lane} \times W_{lane}$。
2. **平滑分支连线（Cubic Bézier Curve）**：
   - 设父节点引出点为 $(X_1, Y_1)$，子节点接入点为 $(X_2, Y_2)$：
   - 当 $X_1 == X_2$ 时，绘制直线：`M X1 Y1 L X2 Y2`；
   - 当 $X_1 \neq X_2$ 时，绘制 S 型贝塞尔曲线：
     $$\text{Control Point 1} = (X_1, Y_1 + (Y_2 - Y_1) \times 0.5)$$
     $$\text{Control Point 2} = (X_2, Y_2 - (Y_2 - Y_1) \times 0.5)$$
     SVG 路径指令：`M X1 Y1 C X1 (Y1+dY/2), X2 (Y2-dY/2), X2 Y2`。
   - 曲线视觉效果圆润顺滑，与现代 IDE 和地铁图一致。

---

### 2.4 交互流程与用户反馈（四正交原语 + 跳转 + 书签）

现有核心契约：**分岔、编辑、OOC、重写四原语正交，不隐式联动**。界面交互必须明确反映这一契约：

```
       ┌─────────────── 玩家在路线树 / 剧本抽屉中选中某一节点 ───────────────┐
       │                                                                   │
       ▼                                                                   ▼
【宏观操作：路线树层级】                                             【微观操作：剧本行层级】
├─ ⤴ 跳转（Jump）: 移到该处只读回看                                  ├─ ✎ 原地编辑（Edit）: 仅替换该句文字
├─ 🌿 分岔（Fork）: 移到该处作为新起点，等待行动                     ├─ ↺ 重写此句（Rewrite Line）: 回退并重生该句
└─ ⭐ 书签（Bookmark）: 命名节点 + 保存快照                         ├─ ↺ 重写整幕（Rewrite Beat）: 回退并重生整幕
                                                                    └─ 💬 导演注（OOC）: 注入指令重新演绎
```

#### 2.4.1 原语逐项交互规格与反馈

| 操作原语 | 玩家动作与操作入口 | 视觉呈现与状态变化（即时反馈） | 服务端交互与通信 | 核心防误导保证 |
|---|---|---|---|---|
| **⤴ 跳转<br>（Jump）** | 在路线树任意 Beat 卡片上点击 **「跳转到此」** | 1. 视口平滑过渡，高亮指示环（Focus Ring）瞬间附着到目标节点；<br>2. 顶部状态条亮起黄色徽章：`[只读回放模式：第 X 幕]`；<br>3. 舞台实时同步重放该节点时刻的画面与背景音。 | 调用 `jumpTo(nodeId)`，服务端下发 `rebase`，重置客户端事件缓冲，不产生新事件。 | 提示“当前为回放，在此做出新选择或输入将自动分岔”。 |
| **🌿 分岔<br>（Fork）** | 在非叶子节点或历史节点点击 **「从此开辟新路线」** | 1. 目标节点右侧萌发出一颗带发光动画的空分支芽节点（Sprout Node）；<br>2. 路线树主高亮线（Active Spine）切换至新路线；<br>3. 舞台停留在该分叉点结尾，等待玩家在舞台上输入台词或选选项。 | 调用 `forkTo(nodeId)`，leaf 移到该节点，等待下一次行动。 | 明确告知原路线完整保留，新路线正在等待你的第一次选择。 |
| **✎ 原地编辑<br>（Edit）** | 在剧本抽屉中点击某句台词的编辑铅笔图标，修改文本后按回车保存 | 1. 目标行立即显示新文本，右上角打上极具辨识度的金黄色小标签 `[已润色]`；<br>2. 路线树**完全不产生新分支**，拓扑保持单线；<br>3. 浮现 Toast 提示：“台词已润色，后续演绎将参考修正后的文本”。 | 调用 `editLine(nodeId, newText)`，append edit 事件，覆盖目标台词。 | 不开新分支、不重跑 LLM。明确传达“微修错字/文风”的心智。 |
| **↺ 重写<br>（Rewrite）**<br>*(核心痛点)* | 在卡片或剧本行点击 **「重写此幕 / 重写此句」**，可弹出微型输入框填入“导演意图”（如：“让她更傲娇一点”） | 1. **动画裂变**：被重写的旧节点整体向右下方滑开，颜色转为灰度幽灵态，打上标签 `[历史版本 v1]`；<br>2. **新生通道**：从前置节点引出一条全新的流光脉冲线，生成一个闪烁打字机状态的 `[重新生成中 v2...]` 节点；<br>3. 舞台重新进入流式生成打字机态。 | 调用 `rewrite(nodeId, granularity, instruction)`，底层追加 rewrite 事件，旧分支自然变为未选路径，立即触发生成。 | **坚决不在视觉上“擦除”旧节点**！用版本编号（v1/v2）和分支平移直观证明“这是平行宇宙分岔”，旧历史随时能切回去。 |
| **💬 导演注<br>（OOC）** | 在目标节点点击 **「注入导演注重演」**，输入对戏指导（如：“突然下起大雨”） | 类似重写，卡片连接线上出现一块显眼的橙色场记牌图标（🎬 Director Note），下方长出新分支。 | 调用 `oocAt(nodeId, text)`，先 fork 再注入导演注并开拍。 | 场记牌标识与正常选择支（菱形）明显区分，让玩家知道这是场外干预。 |
| **⭐ 书签<br>（Bookmark）** | 在卡片右上角点亮五角星，输入名字（如：“告白前夕”） | 卡片右上角浮现永久金色星标和名称气泡，同时在顶部“书签直达栏”增加一个磁贴。 | 调用 `addBookmark(nodeId, name)`，在节点挂快照。 | 书签不改变当前所在位置（与跳转正交）。 |

---

### 2.5 极端状态自适应处理（Edge Cases）

#### 1. 空状态（Zero State / Fresh Game）
- **场景**：刚开始新剧目，仅演出 0~1 拍。
- **呈现**：路线树不展示空荡荡的画布，而是呈现一颗发光的“故事起点（Prologue）”种子节点，带有轻微呼吸脉冲动效，并引导文案：“舞台刚拉开帷幕，随着你的选择与指导，这里将长出一整棵命运之树。”

#### 2. 极深主线（Deep Linear Graph / 100+ Beats）
- **场景**：玩家一路线性游玩了几十幕，没有分岔。
- **呈现**：
  - **虚拟列表优化**：只渲染视口内上下 2 屏的 Beat 卡片，DOM 节点数控制在 20 个以内；
  - **里程碑折叠（Milestone Compression）**：连续无分岔的平庸节拍，自动收缩为紧凑的地铁圆点（Dot View），仅展示当前节拍、场景转场节拍和选择支节拍；
  - **一键回到底部**：右下角常驻悬浮按钮 `[● 定位当前]`，点击带平滑缓动滑回当前正在演出的叶节点。

#### 3. 分叉极多 / 频繁重写（Dense Rewrites / Branch Explosion）
- **场景**：玩家在同一处连续点了 5 次“重写整幕”，产生 5 条平行分支。
- **呈现**：
  - **版本堆叠折叠（Version Stacking）**：同一锚点长出的废弃分支不直接横向占满屏幕，而是折叠为堆叠卡片样式 `[已归档的 4 个历史版本 ▾]`；
  - 点击“展开历史”，才以横向抽屉展开供玩家对比回看；
  - 废弃分支默认透明度降至 `0.35`，色彩去饱和度（Monochrome/Muted），连线变为虚线，确保当前有效路线一眼突出。

---

### 2.6 缩放与导航体系（Zoom & Navigation）

为了在多分支世界线中保持方向感，设计**“双层缩放 + 鹰眼罗盘”**：

```
                    ┌───────────────────────────────┐
                    │ 路线树工具栏                  │
                    │ [全景缩略 25%]  [标准详述 100%]│
                    │ [🎯 定位当前]   [🔍 搜索台词/书签] │
                    └───────────────────────────────┘
```

1. **两档语义化缩放（Semantic Zooming）**：
   - **详述视图（100% Zoom）**：默认模式，展示完整 Beat 卡片（背景缩略图、角色头像、台词前瞻、书签名、操作按钮）；
   - **鸟瞰视图（Bird's-Eye 30% Zoom）**：通过滚轮或缩放按钮触发。卡片收缩为纯色条柱与状态小圆点，隐藏长文本，高亮主干流光与书签金星，供玩家纵览全局分支拓扑。
2. **Minimap 鹰眼微缩图（右下角 140x90px）**：
   - 等比微缩渲染所有分支线条；
   - 绿色视口矩形框（Viewport Frame）跟随主画布滚动，支持在 Minimap 上直接拖拽视口；
   - 当前玩家所在位置显示呼吸黄点。

---

### 2.7 编辑器与路线树的职责分离（Master-Detail）

明确规定双界面的分工，杜绝功能臃肿与心智混淆：

| 维度 | 路线树视图（Route Tree - Master） | 剧本抽屉（Script Inspector - Detail） |
|---|---|---|
| **视觉呈现** | 节点卡片流、拓扑连线、分支流向、Minimap | 垂直时间流剧本、完整台词对话气泡、立绘调度注记 |
| **主要定位** | 宏观因果梳理、世界线跳跃、存档管理 | 微观阅读品味、字句推敲、细腻调试 |
| **原语权限** | ⤴ 跳转（Jump）、🌿 分岔（Fork）、⭐ 命名书签 | ✎ 原地润色（Edit）、↺ 单句重写、💬 句级导演注 |
| **联动响应** | 点击树上任意 Beat 卡片，自动在右侧/下方呼出剧本抽屉，并滚动到该 Beat 的第一行台词。 | 在剧本抽屉中点击某行“从此分岔”，路线树即时响应动画并高亮新分支。 |

---

## 3. 三套可选视觉方向对比与推荐

### 方案 A：二次元未来感“时间观测仪”（Chrono-Observer HUD）——【★ 强烈推荐】

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
- **正确做法**：必须以 **Beat（场景/停顿/分岔）** 聚合为宏观卡片。行级事件只在展开的剧本抽屉中作为详情查看。

### ❌ 反模式 3：提供无约束的 2D 自由拖拽画布
- **错误做法**：允许玩家像 Miro 或 Twine 那样自由拖放节点位置。
- **正确做法**：叙事因果具有严格时序性。坚决采用有向分层自动布局（Auto-layout Lane），禁止手动拖拽位置造成混乱。

### ❌ 反模式 4：操作原语隐式强绑定（违反四原语正交）
- **错误做法**：点击“修改文字”时自动为玩家开新分支；或者点击“打书签”时自动把玩家视口跳转回过去。
- **正确做法**：严格遵循计划 D10——原地编辑就是当前分支原地覆盖，加书签就是纯打标记不动位置，跳转就是纯只读回放，分岔就是明确开辟新支线。

### ❌ 反模式 5：跨分支记忆与剧透污染
- **错误做法**：在路线树废弃分支上直接展示未来剧透内容，或者跳转到分支后把其他平行线的记忆带过来。
- **正确做法**：严格遵守 P4 记忆契约——检索与上下文仅沿当前节点的祖先链生效，废弃分支的文本在未点击主动展开时只显示概括摘要，防止破坏悬念。

---

## 5. 与现有代码的落差清单与落地路线（Delta Analysis）

### 5.1 前端改动与新增组件清单

| 组件/文件路径 | 现有状态 | 改造目标 / 新增内容 |
|---|---|---|
| **`apps/web/src/stage/LineagePanel.tsx`** | 仅有缩进列表式 `RouteTree` 与单列 `BranchScript` | **拆分重构**：<br>1. 保留 `BranchScript` 并增强为右侧滑出抽屉；<br>2. 原 `RouteTree` 替换为图形化 `RouteFlowchart` 容器。 |
| **`apps/web/src/stage/tree/RouteFlowchart.tsx`** *(新增)* | 无 | 路线树主画布容器，负责处理平移、缩放、Minimap 渲染、当前节点自动居中。 |
| **`apps/web/src/stage/tree/BeatGraphCanvas.tsx`** *(新增)* | 无 | SVG 拓扑连线层 + HTML 卡片层：计算 Lane 轨道坐标、生成平滑贝塞尔曲线、管理高亮与废弃状态。 |
| **`apps/web/src/stage/tree/BeatNodeCard.tsx`** *(新增)* | 无 | 单个节拍卡片：展示场景名、核心台词预览、头像堆叠、原语操作快捷悬浮栏（跳转/分岔/书签/详情）。 |
| **`apps/web/src/stage/tree/Minimap.tsx`** *(新增)* | 无 | 右下角鹰眼微缩导航器，提供全树等比缩略与视口拖拽。 |
| **`apps/web/src/stage/tree/useBeatAggregation.ts`** *(新增)* | 无 | 前端纯函数 Hook：输入 `LineageView`（离散事件），基于边界规则实时聚合并缓存为 `BeatNode[]` 树结构。 |

### 5.2 后端与核心契约（packages/core）协同

1. **core 层聚合能力（建议）**：
   - 目前 `LineageTree.describe()` 返回的是扁平事件数组 `LineageNodeView[]`；
   - 可以在 `@stage-ai/core` 中补充 `describeBeats(): LineageBeatView` 工具函数，或者在前端 `useBeatAggregation` 纯客户端聚合，**首期在前端聚合即可落地**，无需破坏现有协议；
2. **事件打标增强**：
   - 确认 `LineagePayload` 中的 `instruction` 与 `granularity` 随 `rewrite` 事件完整下发给前端（现有代码已支持），前端据此为 Beat 卡片贴上 `[导演注]` 或 `[整幕重写]` 标签。

---

## 6. 总结与落地实施路径

本设计规格通过**“以 Beat 聚合宏观拓扑，以抽屉承载微观剧本”**的核心架构，将底层的 append-only 事件日志转化为符合玩家心智的二次元分支世界线树；通过**“版本平行裂变动效”**直观消除对改写/回溯的误解；在保持代码四原语正交契约的前提下，为 stage-ai 提供兼具科技美感与极高操作可用性的路线树体验。
