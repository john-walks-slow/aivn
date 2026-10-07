# 结局与多周目 —— 惯例调研

日期：2026-10-07 ｜ 仓库：`stage-ai`（`packages/core` / `packages/stage`）、`dsh-aivn`
用途：为《结局与多周目》设计提供外部事实基准。惯例部分是 VN / 互动小说的通行做法；落地部分是
LLM 驱动叙事里「自由文本 + 硬边界」的真实经验。末尾给出对本项目的映射与取舍启示。

> 调研结论先写在这里：**VN 的「结局」在工程上从来不是一个按钮，而是一条被持久记录的边界**——
> 结局本身收束内容，跨周目的进度活在**存档之外**的一份 persistent 账本里；New Game+ 的全部设计
> 张力都在「什么带过去、什么重置」。这两条正好对应本需求的两块：结局 DSL（收束 + 终局态）与
> 工作区级账本（跨周目继承）。

---

## 1. VN 的 ending 惯例

### 1.1 语义：结局是「收束事件」，不是「交互点」

VNDev Wiki 的定义：ending 是「一段故事 / 一条分支 / 一条路线被收束」的事件，常伴随 credits 或
「Game Over」；**主线故事在结局之后一般不再有 gameplay**，但结局可以解锁额外内容。只有单一结局
且无选择的 VN 常被称为 kinetic novel。

关键点：结局是**终止**，不是另一种停止点。「之后不再有 gameplay」是媒介惯例，不是实现细节。
这和本需求「到达结局后舞台进入终局态：不给按钮、无法继续」完全一致。

### 1.2 结局的类型学（决定我们是否要一个 `type` 字段）

| 类型 | 含义 | 对本项目的意义 |
|---|---|---|
| Good / Bad / True | 好结局 / 坏结局 / 正典结局（true 未必是好的） | 需要区分时才有价值；本需求只要求 id/title/subtitle |
| Normal | 未达门槛的兜底结局 | 同上 |
| Character ending | 针对某个角色的结局，可与整体结局独立 | 多结局的一类，不需要专门建模 |
| Combination ending | 由多个子结局组合而成，数量随片段指数增长 | 提醒：结局数量不宜靠组合爆炸，账本应按 id 去重 |
| Hidden / Secret | 达成条件不明显的结局；true 最常见 | 账本只记「达成过」，不记条件 |
| Black screen bad end | 没有内容，直接 Game Over / 回标题 | 「终局后回标题」的媒介先例，对应我们把出口交给 DSH 分支 / 新会话 |
| Meta ending | 叙事承认自己是游戏，会提示玩家改文件、重载存档 | 多周目叙事的一种强形式，NG+ 的上限参考 |
| **Loop ending** | 玩家以为在重来，其实信息在周目之间传递；**至少一个角色能感知到「发生过」** | **与我们的 NG+ 最贴近**——见 §2.3 |

来源：[VNDev Wiki · Ending](https://vndev.wiki/Ending)、[VNDev Wiki · Branching](https://www.vndev.wiki/Branching)、
[Aravinth/Towards the End Sky · The True Ending](https://towardstheendsky.blogspot.com/2023/03/the-true-ending-anatomy-of-visual-novels.html)

### 1.3 结局的记录：persistent 账本 + union 合并

Ren'Py 的 persistent 数据是**不与任何存档点绑定的存档**（`renpy.org/doc/html/persistent.html`）：
`persistent` 上的字段在退出或显式保存时落盘；收集「已见结局」的通行做法是把它做成一个集合：

```python
init python:
    if persistent.endings is None:
        persistent.endings = set()
    # 合并两份 persistent 时取并集（Ren'Py 默认按字段取「较新」，集合需要显式声明）
    def merge_endings(old, new, current):
        current.update(old); current.update(new); return current
    renpy.register_persistent('endings', merge_endings)
```

社区教程（nami's dev diary）进一步给了可复用的写法：用一个 `all_endings` 清单顺序、一个
`persistent.endings` 集合记录已达成，展示时 `???` 占位；`collect_ending(x)` 里
`if x not in persistent.endings` 防重复。

来源：[Ren'Py Persistent Data](https://www.renpy.org/doc/html/persistent.html)、
[ren'py tip #10 ending checklist](https://nomnomnami.com/blog/posts/2024-03-04-ending-checklist)、
[ren'py tip #11 ending checklist with lists](https://nomnomnami.com/blog/posts/2024-03-09-ending-checklist2)

**要点**：账本 = 存档之外的持久集合，**以 id 去重**、跨周目累加；重复达成不重复计数。

### 1.4 结局的呈现

- **End slate（结局卡）**：一段路线文字播完后出现的图（代表该结局氛围 / 主题），通常伴随结局名；
  往往是专门绘制、不复用 CG 的简洁图。→ 本项目的「结局卡 + 标题 + 副标题」对应它。
- **Ending checklist / gallery**：列出全部结局，未解锁显示 `???`；常作为游戏菜单的一页；
  按主线首次通关才解锁入口。
- **Credits / end roll**、**Flowchart**（路线图，Zero Escape、Katawa Shoujo）。

来源：[VNDev Wiki · Special graphics（End Slates / Ending videos）](https://vndev.wiki/Special_graphics)、
[VNDev Wiki · Graphical User Interface（gallery / scene replay）](https://www.vndev.wiki/Graphical_User_Interface)

**要点**：结局卡是「标题 + 副标题 + 一段收束」的天然容器；gallery 是未来可选项，本期不做。

### 1.5 结局之后的出口

黑屏 bad end 会「直接回标题 / 关闭游戏」。普通结局播完 credits 后回标题。少数游戏有 Clear Mode
（通关后继续玩，看结局的后果）。**共同点：结局之后不是「在舞台上继续」，而是离开当前舞台。**

---

## 2. New Game+ 惯例

### 2.1 定义与起源

New Game+ = 通关后带着一部分进度重开。1995 年 Chrono Trigger 是早期代表，它的关键是**改写叙事**
（可带强属性在任意时点挑战最终 boss，通向十多个结局）。Giant Bomb 的词条强调它「通常用于有多个
结局的游戏，让玩家去追另一个结局」。

来源：[Giant Bomb · New Game Plus](https://giantbomb.com/wiki/Concepts/New_Game_Plus)

### 2.2 核心设计张力：带什么、重置什么

- 「让玩家重打同样五关、同难度，那不叫 NG+，那叫重玩」——NG+ 要**向已经证明过自己的玩家提新问题**。
- 通行原则：**带过一切「改变玩家体验方式」的东西，不带会污染「公平比较」的东西**（如分数、排行榜）。
- 常见四个要素：meaningful progression（有意义的成长）、new incentives（新奖励 / 新内容 / 新叙事）、
  consistency & convenience（缩短重复劳动，如跳过已看剧情）、明示（让玩家清楚自己在 NG+）。

来源：[Flukz · New Game Plus Design](https://flukz.org/devlog/new-game-plus-design-shmup/)、
[Red Hare Studios · Designing New Game Plus](https://redharegames.wordpress.com/2025/04/15/simple-article-designing-new-game-plus/)

### 2.3 叙事型 NG+ 与 loop ending（与我们最贴近）

Red Hare 的分析点명了两条我们直接相关的路线：

- **Alternate Story NG+（Undertale 式）**：前一周目的选择永久影响后续周目——游戏「记得」玩家做过
  什么，改变对话、事件乃至结局；模型叙事把存档、经验、NG+ 都赋予叙事意义，甚至打破第四面墙。
- **Loop ending**（VNDev）：信息在周目之间传递，且**至少一个角色能感知到「发生过」**；后续周目会
  解锁新选项、事件走向不同；true ending 可以只在多周目后达成。

来源：[VNDev Wiki · Ending（Loop endings）](https://vndev.wiki/Ending)、
[Red Hare Studios](https://redharegames.wordpress.com/2025/04/15/simple-article-designing-new-game-plus/)

**要点**：NG+ 在叙事上就是「把上周目的结局信息交给剧作家」，由它决定角色是否「记得」、是否解锁
新路线。**这正是本需求的提示词级约定**：引擎只保证账本可见，不强制解锁。

### 2.4 解锁与顺序

Unlockable route / enforced route order：true route 常在集齐其它路线后解锁；用 persistent 变量
跨周目 gate。Ren'Py 社区的常见坑：把「已通关」写成普通 store 变量，重开就重置——必须放
`persistent`。来源：[Lemma Soft Forums · NG+ 变量被重置](https://lemmasoft.renai.us/forums/viewtopic.php?t=64839)

**对本项目的意义**：账本必须独立于剧内状态（`memory/always/state/*`），否则新周目重置时会被一起
清掉——这既是 Ren'Py persistent 的教训，也是本需求已对齐的方向。

---

## 3. LLM 驱动叙事的落地经验

自由文本剧作家与预写分支的 VN 有一个本质差别：**没有预写的结局表**，结局是模型写出来的。
所以「ending」必须同时是一份**给模型用的表达手段**和一条**给引擎用的硬边界**。

### 3.1 结构化状态与历史解耦

- Narrative State Memory（wordplay workshop 论文）：把演化中的叙事状态从冗长交互历史里解耦，
  每轮注入一份压缩状态 + 最近 k 轮，长期一致性显著好于「截断历史」或「LLM 自己总结」。
- Isekaigen：每轮自动抽取 Memory Book 条目（重要事件的散文摘要）+ Lore Book（世界事实），
  检索后注入。区分「发生过什么」与「世界是什么」。
- Veyne AI / NEXUS：显式把 state / memory / relationship / world 从 LLM 里拆出来，由 runtime 承载。

来源：[Memory-Augmented LMs for Persistent Interactive Narratives](https://wordplay-workshop.github.io/pdfs/10.pdf)、
[Isekaigen Memory System](https://isekaigen.com/docs/memory-system/)、[Veyne-AI](https://github.com/Katharz1z/Veyne-AI)、
[pythagorakase/nexus](https://github.com/pythagorakase/nexus)

**要点**：结局账本本质是一份**结构化、跨周目的 state**，应当独立存储并每轮注入，而不是塞进历史。

### 3.2 回顾 / 收束散文（recap / epilogue）

- par-storygen：`Shift+R` 触发「Previously on…」的按需 recap，可选每 N 个 major beat 自动 recap、
  以及 resume 时 recap。
- 结局收束散文（epilogue）在媒介上就是「整段旅程的 recap + 主题收束」，由剧作家在结局后单独写。

来源：[paulrobello/par-storygen](https://github.com/paulrobello/par-storygen)

**要点**：收束散文是一次**独立生成**，是 recall 全文后的整体回顾，不能塞进结局那一轮
（那一轮正在收笔，且必须保持「结局是最后一行」）。

### 3.3 结局画廊的卡片形态

par-storygen 的 endings gallery：每张结局卡 = 场景图 + 旁白节选 + 走过的选择路径，可以
jump 到那个节点。→ 本项目的结局卡本期只放标题/副标题/收束散文；「场景图 / 路径」是未来扩展。

来源：[par-storygen](https://github.com/paulrobello/par-storygen)

---

## 4. 对本项目的映射与启示

| 惯例 | 本项目落法 |
|---|---|
| 结局是终止、之后无 gameplay | 舞台终局态：无按钮、不可继续；出口交给 DSH 分支 / 新会话 |
| 不能是按钮（否则轮尾变工具结果，破坏分支约束） | 结局写成**剧本末行的标签** `<ending …/>`，取代该轮的 `<stop>`，保住「轮尾是助手消息」 |
| persistent 账本、id 去重、union 累加 | 工作区级 `endings.json`，以 `id` 为键、`reachedIn` 记录周目，引擎自动落账 |
| 账本独立于存档 / 剧内状态 | 账本独立于 `memory/always/state/*`，新周目重置后者不误伤前者 |
| end slate = 结局卡 | 复用现有卡片视觉（`.choice-overlay`/`.choice`），做**非交互**的结局卡 |
| 结局后有收束 / credits | 结局后**额外一轮**生成 `<epilogue>` 收束散文，填进结局卡 |
| NG+ 是叙事型、loop ending | `play.json` 的 `newGamePlus` 开关；引擎把账本注入提示词，剧作家决定怎么用 |
| 「已通关」变量必须持久、不能被重置 | 账本在工作区根、独立于剧内状态；重置只动 `memory/always/state/*` |
| recap 是独立生成 | 收束散文由引擎在结局后注入指令、单开一轮 |

同时，惯例也给了两条**反面约束**：

1. **不要靠组合爆炸建模多结局**——账本按 id 去重；id 是唯一身份。
2. **结局数量与顺序是创作问题**，引擎不该 gate（本需求明确「引擎只保证账本可见，不强制解锁」）。

---

## 5. 主要来源

- VNDev Wiki：[Ending](https://vndev.wiki/Ending)、[Branching](https://www.vndev.wiki/Branching)、
  [Special graphics](https://vndev.wiki/Special_graphics)、[Graphical User Interface](https://www.vndev.wiki/Graphical_User_Interface)
- Ren'Py 官方文档：[Persistent Data](https://www.renpy.org/doc/html/persistent.html)、
  [Save/Load/Rollback](https://www.renpy.org/doc/html/save_load_rollback.html)、
  [Image Gallery/Music Room/Replay](https://renpy.org/dev-doc/html/rooms.html)
- 社区教程：[ending checklist（flags）](https://nomnomnami.com/blog/posts/2024-03-04-ending-checklist)、
  [ending checklist（lists）](https://nomnomnami.com/blog/posts/2024-03-09-ending-checklist2)、
  [NG+ 变量重置坑](https://lemmasoft.renai.us/forums/viewtopic.php?t=64839)
- NG+ 设计：[Flukz](https://flukz.org/devlog/new-game-plus-design-shmup/)、
  [Red Hare Studios](https://redharegames.wordpress.com/2025/04/15/simple-article-designing-new-game-plus/)、
  [Giant Bomb](https://giantbomb.com/wiki/Concepts/New_Game_Plus)、
  [NG+ 机制汇总](https://github.com/raduacg/game-mechanics-optimizations/blob/main/H_05_new_game_plus_modifiers.md)
- LLM 叙事：[Memory-Augmented LMs（wordplay）](https://wordplay-workshop.github.io/pdfs/10.pdf)、
  [Isekaigen](https://isekaigen.com/docs/memory-system/)、[par-storygen](https://github.com/paulrobello/par-storygen)、
  [Veyne-AI](https://github.com/Katharz1z/Veyne-AI)、[nexus](https://github.com/pythagorakase/nexus)
